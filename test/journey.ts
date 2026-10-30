import assert from "node:assert/strict";
import type { AgentContext } from "@/lib/agents/base";
import { activateAccount } from "@/lib/agents/jerry";
import { getOrBootstrapModel } from "@/lib/agents/runtime";
import { accountFromFacts } from "@/lib/engine/accounts";
import { attemptLaunch, launchCampaign } from "@/lib/engine/campaign";
import { logConversation } from "@/lib/engine/conversations";
import { recordEngagement } from "@/lib/engine/engagement";
import { enrichAccountContact } from "@/lib/engine/enrichment";
import { canonicalOpportunities } from "@/lib/engine/opportunities";
import { processDueTouches } from "@/lib/engine/outreach";
import { recordOutcome } from "@/lib/engine/outcomes";
import { pauseAccount, resumeAccount } from "@/lib/engine/pause";
import { requestMeeting } from "@/lib/engine/prospect";
import { assignOwner, evaluateReadiness, nextActionFor } from "@/lib/engine/readiness";
import { approveTask, committedOpenTasks } from "@/lib/engine/tasks";
import { getProviders } from "@/lib/providers";
import { effectsOf, failNext, testControl } from "@/lib/providers/testing";
import type { Store } from "@/lib/store";
import { getSettings, reps } from "@/lib/store/collections";
import type { Account, User } from "@/lib/types";
import { nowIso, uuid } from "@/lib/util";

/**
 * The definition-of-done journey, end to end on whatever store is active and
 * the controllable test adapters:
 *
 *   import -> enrich -> qualify -> assign -> approve -> deliver -> record conversation
 *   -> pause -> resume -> request meeting -> confirm meeting -> sync outcome
 *
 * With `faults`, every external step first times out once and two workers race
 * each delivery step; the journey must still end with exactly one effect each.
 * It only creates its own uniquely named account and never resets the store.
 */
export interface JourneyOptions {
  faults: boolean;
  log?: (line: string) => void;
}

const user: User = { id: "u_journey", email: "journey@test.local", name: "Journey Rep", role: "bdr", repId: "rep_journey" };

async function forceDue(store: Store, id: string): Promise<void> {
  const op = await store.getOperation(id);
  if (op && op.status !== "succeeded") await store.finishOperation(id, op.leaseOwner ?? "", { nextAttemptAt: new Date(0).toISOString() });
}

/** Two workers when faults are on; one otherwise. */
async function workers<T>(faults: boolean, fn: () => Promise<T>): Promise<T[]> {
  return faults ? Promise.all([fn(), fn()]) : [await fn()];
}

export async function runJourney(store: Store, opts: JourneyOptions): Promise<{ accountId: string; steps: string[] }> {
  const steps: string[] = [];
  const step = (s: string) => {
    steps.push(s);
    opts.log?.(s);
  };
  const providers = getProviders();
  const model = await getOrBootstrapModel(store);
  const ctx: AgentContext = { store, providers, model, batchSize: 10, log: () => undefined, activity: () => undefined };
  if (opts.faults) Object.assign(testControl().delayMs, { send: 30, alert: 30, dialer: 30, launch: 30 });
  if (!(await reps.list()).some((r) => r.id === "rep_journey")) await reps.put({ id: "rep_journey", name: "Journey Rep", email: "journey@test.local", capacityPerDay: 30, active: true });

  // 1. Import
  const n = uuid().slice(0, 8);
  let a: Account = await store.upsertAccount(
    accountFromFacts({
      companyName: `Journey Logistics ${n}`,
      domain: `journey-${n}.example`,
      industry: "3PL",
      employeeCount: 650,
      hqCity: "Dallas",
      hqState: "TX",
      jobPostings: [{ title: "Freight Coordinator", department: "Logistics", postedAt: nowIso(), url: `https://journey-${n}.example/jobs/1` }],
      news: [],
      techStack: [],
      painEvidence: [],
      people: [{ name: "Riley Moss", title: "Director of Transportation", seniority: "director" }],
      source: "test",
    }),
  );
  step("imported");

  // 2. Enrich (times out once under faults, then succeeds on the bounded retry)
  if (opts.faults) failNext("enrich", 1, "timeout");
  let enriched = await enrichAccountContact(store, providers, a, a.facts.people[0]);
  if (!enriched.ok) {
    assert.ok(enriched.retryable, "a timeout is retryable");
    assert.ok(enriched.account.enrichment?.lastError, "the failure is recorded on the account");
    enriched = await enrichAccountContact(store, providers, enriched.account, a.facts.people[0]);
  }
  assert.ok(enriched.ok, "enrichment succeeds");
  a = enriched.account;
  assert.equal(a.contact?.phoneVerified, true);
  step("enriched");

  // 3. Qualify (readiness with a fresh verified signal) and 4. assign
  a = await store.upsertAccount({
    ...a,
    signals: [{ key: "hiring:freight_coordinator", type: "hiring", label: "Hiring freight coordinators", status: "verified", confidence: 0.9, detectedAt: nowIso(), agent: "research", evidence: [{ title: "Job post", url: `https://journey-${n}.example/jobs/1`, source: "test" }] }],
    painHypothesis: "manual carrier coordination at growing volume",
    messagingAngle: "coordination without adding headcount",
    scores: { total: 82, signal: 80, icp: 80, pain: 80, timing: 80, access: 80 } as Account["scores"],
  });
  const readiness = evaluateReadiness(a, { model, settings: (await getSettings()).automation, crmOwner: null, suppressed: false });
  a = await store.upsertAccount({ ...a, readiness, status: readiness.ready ? "qualified" : "needs_enrichment" });
  const owner = await assignOwner(store, { ...a, ownerRepId: "rep_journey" });
  a = await store.upsertAccount({ ...a, ownerRepId: owner, nextAction: nextActionFor(a, readiness) });
  assert.equal(readiness.ready, true, `readiness blockers: ${readiness.blockers.join("; ")}`);
  assert.equal(owner, "rep_journey");
  step(`qualified and assigned to ${owner}`);

  // Launch the sequence: times out once under faults; never "live" until acknowledged.
  if (opts.faults) failNext("launch", 1, "timeout");
  a = await launchCampaign(a, ctx);
  a = await store.upsertAccount(a);
  if (a.campaign?.launchState !== "live") {
    assert.notEqual(a.status, "campaign_live");
    await forceDue(store, `launch:${a.id}`);
    const relaunched = await workers(opts.faults, async () => attemptLaunch(store, providers, (await store.getAccountById(a.id))!));
    a = await store.upsertAccount(relaunched.find((x) => x.campaign?.launchState === "live") ?? relaunched[0]);
  }
  assert.equal(a.campaign?.launchState, "live");
  step("sequence launched");

  // 5. Approve + 6. deliver: the first email goes through approval, then the provider (with a timeout + two workers under faults).
  const first = (await store.listOutreach({ accountId: a.id })).filter((t) => t.channel === "email").sort((x, y) => x.step - y.step)[0];
  assert.ok(first, "the sequence has an email step");
  await store.updateOutreach({ ...first, status: "awaiting_approval", scheduledFor: nowIso() });
  const approved = await approveTask(store, providers, first.id, user);
  assert.equal(approved.status, "scheduled");
  assert.equal(effectsOf("send", a.id).length, 0, "approval alone sends nothing");
  // Push every other sequence task into the future so only the approved one is due.
  for (const t of await store.listOutreach({ accountId: a.id })) if (t.id !== first.id && t.status !== "sent") await store.updateOutreach({ ...t, scheduledFor: new Date(Date.now() + 7 * 86_400_000).toISOString() });
  if (opts.faults) failNext("send", 1, "timeout");
  await workers(opts.faults, () => processDueTouches(store, providers));
  if ((await store.getOutreach(first.id))?.status !== "sent") {
    // Let the backoff elapse: the operation and the task's retry time both come due.
    await forceDue(store, `send:${first.id}`);
    await store.updateOutreach({ ...(await store.getOutreach(first.id))!, scheduledFor: nowIso() });
    await workers(opts.faults, () => processDueTouches(store, providers));
  }
  assert.equal((await store.getOutreach(first.id))?.status, "sent");
  assert.equal(effectsOf("send", a.id).length, 1, "exactly one email reached the provider");
  step("approved and delivered");

  // Engagement crosses the threshold: Jerry alerts the rep and queues the call (alert fails once under faults).
  const eng = await recordEngagement(store, providers, (await store.getAccountById(a.id))!, { eventType: "pricing_viewed", visitorId: "journey" });
  assert.equal(eng.activationTriggered, true);
  if (opts.faults) failNext("alert", 1, "timeout");
  let activations = await workers(opts.faults, async () => activateAccount((await store.getAccountById(a.id))!, ctx));
  if (!activations.some((r) => r.complete)) {
    for (const op of await store.listOperations({ accountId: a.id, kind: "alert" })) await forceDue(store, op.id);
    activations = await workers(opts.faults, async () => activateAccount((await store.getAccountById(a.id))!, ctx));
  }
  assert.ok(activations.some((r) => r.complete), "activation completes");
  assert.equal(effectsOf("alert", a.id).length, 1, "one rep alert");
  assert.equal(effectsOf("dialer", a.id).length, 1, "one queued call");
  step("rep activated (alert + call queued)");

  // 7. Record a conversation with an agreed callback.
  const callbackAt = new Date(Date.now() + 2 * 86_400_000).toISOString();
  await logConversation(store, providers, (await store.getAccountById(a.id))!, { channel: "call", outcome: "connected", notes: "Interested, call back Thursday", callbackAt }, user);
  assert.ok(committedOpenTasks(await store.listOutreach({ accountId: a.id })).some((t) => t.scheduledFor === callbackAt));
  step("conversation recorded");

  // 8. Pause: nothing goes out while paused.
  const until = new Date(Date.now() + 30 * 86_400_000).toISOString();
  await pauseAccount(store, providers, (await store.getAccountById(a.id))!, until, "not now", user.name);
  for (const t of await store.listOutreach({ accountId: a.id })) if (t.status === "scheduled") await store.updateOutreach({ ...t, scheduledFor: nowIso() });
  const sentBefore = effectsOf("send", a.id).length;
  const held = await processDueTouches(store, providers);
  assert.equal(effectsOf("send", a.id).length, sentBefore, "no outreach while paused");
  step(`paused (${held.held} held)`);

  // 9. Resume.
  const resumed = await resumeAccount(store, providers, (await store.getAccountById(a.id))!, user.name);
  assert.equal(resumed.account.pausedUntil, null);
  step("resumed");

  // 10. Prospect requests a meeting (retried by the browser) and 11. the booking is confirmed.
  const req = { requestId: `journey-${n}`, name: "Riley Moss", email: `riley@journey-${n}.example` };
  const m1 = await requestMeeting(store, providers, (await store.getAccountById(a.id))!, req);
  const m2 = await requestMeeting(store, providers, (await store.getAccountById(a.id))!, req);
  assert.equal(m2.task.id, m1.task.id);
  assert.notEqual((await store.getAccountById(a.id))?.status, "meeting_booked");
  await recordOutcome(store, providers, (await store.getAccountById(a.id))!, { outcomeType: "meeting_booked", source: "calendly" });
  assert.equal((await store.getAccountById(a.id))?.status, "meeting_booked");
  assert.equal((await store.getOutreach(m1.task.id))?.status, "done");
  step("meeting requested and confirmed");

  // 12. Sync outcome: created then won is one opportunity.
  await recordOutcome(store, providers, (await store.getAccountById(a.id))!, { outcomeType: "opportunity_created", value: 100_000, source: "crm" });
  await recordOutcome(store, providers, (await store.getAccountById(a.id))!, { outcomeType: "deal_won", value: 100_000, source: "crm" });
  const opps = canonicalOpportunities(await store.listOutcomes({ accountId: a.id }));
  assert.equal(opps.length, 1);
  assert.equal(opps[0].value, 100_000);
  assert.equal((await store.getAccountById(a.id))?.status, "won");
  step("outcome synced (1 opportunity, $100,000, won)");

  return { accountId: a.id, steps };
}
