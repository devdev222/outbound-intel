import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { activateAccount } from "@/lib/agents/jerry";
import { runAgent, setAgentEnabled } from "@/lib/agents/runtime";
import { attemptLaunch, launchCampaign } from "@/lib/engine/campaign";
import { logConversation } from "@/lib/engine/conversations";
import { acquireLease, releaseLease } from "@/lib/engine/operations";
import { processDueTouches } from "@/lib/engine/outreach";
import { pauseAccount, resumeAccount } from "@/lib/engine/pause";
import { nextActionFor } from "@/lib/engine/readiness";
import { committedOpenTasks, completeManually, createTask, sendTaskNow, TaskError } from "@/lib/engine/tasks";
import { getProviders } from "@/lib/providers";
import { effectsOf, failNext, testControl } from "@/lib/providers/testing";
import type { Store } from "@/lib/store";
import { agentCtx, fresh, makeAccount, makeDue, READY, rep, sleep } from "./helpers";

let store: Store;

describe("deferrals", () => {
  beforeEach(async () => {
    store = await fresh();
  });

  it('"Not now, 30 days" prevents all outreach until the pause ends', async () => {
    const a = await makeAccount(store);
    const scheduled = await createTask(store, { account: a, channel: "email", title: "Step 2", subject: "s", body: "b", status: "scheduled", source: "sequence", step: 2 });
    const conv = await logConversation(store, getProviders(), a, { channel: "call", outcome: "not_now", notes: "Call me next quarter", pauseDays: 30 }, rep);
    const paused = (await store.getAccountById(a.id))!;
    assert.ok(paused.pausedUntil && paused.pausedUntil > new Date(Date.now() + 29 * 86_400_000).toISOString());
    assert.equal(paused.nextAction?.type, "wait");
    assert.equal(conv.outcome, "not_now");

    const r = await processDueTouches(store, getProviders());
    assert.equal(r.sent, 0);
    assert.ok(r.held >= 1, "the due sequence task is held");
    assert.equal(effectsOf("send").length, 0);
    const held = (await store.getOutreach(scheduled.id))!;
    assert.ok(held.scheduledFor >= paused.pausedUntil!, "held task moves to the end of the pause");
    await assert.rejects(() => sendTaskNow(store, getProviders(), scheduled.id, rep), TaskError);

    // The follow-up created by the conversation is due when the pause ends, not before.
    const followUps = (await store.listOutreach({ accountId: a.id })).filter((t) => t.source === "conversation");
    assert.ok(followUps.every((t) => t.scheduledFor >= paused.pausedUntil!));
  });

  it("the dialer is not called while an account is paused", async () => {
    const a = await makeAccount(store, { pendingActivation: "watched 75% of the video", pendingActivationAt: new Date().toISOString(), status: "hot" });
    await pauseAccount(store, getProviders(), a, new Date(Date.now() + 10 * 86_400_000).toISOString(), "not now", "rep");
    const ctx = await agentCtx(store);
    await activateAccount((await store.getAccountById(a.id))!, ctx);
    assert.equal(effectsOf("dialer").length, 0);
  });

  it("rescoring preserves a rep's committed callback and its due date", async () => {
    const a = await makeAccount(store);
    const callbackAt = new Date(Date.now() + 3 * 86_400_000).toISOString();
    await logConversation(store, getProviders(), a, { channel: "call", outcome: "connected", notes: "Call back Thursday", callbackAt }, rep);
    const committed = committedOpenTasks(await store.listOutreach({ accountId: a.id }));
    assert.ok(committed.some((t) => t.scheduledFor === callbackAt), "callback task exists with the agreed time");
    // The follow-up email from the same call comes first; once it is sent, the callback drives the next action.
    const followUp = committed.find((t) => t.channel === "email");
    if (followUp) await completeManually(store, followUp.id, rep);
    const remaining = committedOpenTasks(await store.listOutreach({ accountId: a.id }));
    const next = nextActionFor((await store.getAccountById(a.id))!, READY, remaining);
    assert.equal(next.type, "call");
    assert.equal(next.dueAt, callbackAt);
  });

  it("pause wins over a commitment, and resume restores the recommendation", async () => {
    const a = await makeAccount(store);
    const until = new Date(Date.now() + 30 * 86_400_000).toISOString();
    const { account: p } = await pauseAccount(store, getProviders(), a, until, "not now", "rep");
    assert.equal(nextActionFor(p, READY, []).type, "wait");
    const { account: r } = await resumeAccount(store, getProviders(), p, "rep");
    assert.equal(r.pausedUntil, null);
    assert.notEqual(r.nextAction?.type, "wait");
  });

  it("a Sequencer that owns scheduling is paused once, idempotently, and retried on failure", async () => {
    store = await fresh({ ownsScheduling: true });
    const a = await makeAccount(store);
    const until = new Date(Date.now() + 30 * 86_400_000).toISOString();
    failNext("pause", 1, "timeout");
    const first = await pauseAccount(store, getProviders(), a, until, "not now", "rep");
    assert.equal(first.external, "pending");
    assert.equal(effectsOf("pause").length, 0);
    await makeDue(store, `pause:${a.id}:${until}`);
    const { retryPauseSyncs } = await import("@/lib/engine/pause");
    assert.equal(await retryPauseSyncs(store, getProviders()), 1);
    assert.equal(await retryPauseSyncs(store, getProviders()), 0);
    assert.equal(effectsOf("pause").length, 1);
  });
});

describe("delivery failures", () => {
  beforeEach(async () => {
    store = await fresh();
  });

  it("a failed sequence launch is never shown as live, and recovers on retry", async () => {
    store = await fresh({ ownsScheduling: true });
    const a = await makeAccount(store);
    const ctx = await agentCtx(store);
    failNext("launch", 1, "timeout");
    const launched = await launchCampaign(a, ctx);
    assert.notEqual(launched.campaign?.launchState, "live");
    assert.notEqual(launched.status, "campaign_live");
    await store.upsertAccount(launched);
    await makeDue(store, `launch:${a.id}`);
    const retried = await attemptLaunch(store, getProviders(), (await store.getAccountById(a.id))!);
    assert.equal(retried.campaign?.launchState, "live");
    assert.ok(retried.campaign?.sequenceId);
    assert.equal(effectsOf("launch").length, 1);
  });

  it("a failed Slack alert is retried without re-queuing a dialer call that succeeded", async () => {
    const a = await makeAccount(store, { pendingActivation: "viewed pricing", pendingActivationAt: new Date().toISOString(), status: "hot" });
    const ctx = await agentCtx(store);
    failNext("alert", 1, "timeout");
    const first = await activateAccount(a, ctx);
    assert.equal(first.complete, false);
    assert.equal(effectsOf("dialer").length, 1);
    assert.equal(effectsOf("alert").length, 0);
    assert.ok((await store.getAccountById(a.id))?.pendingActivation, "activation stays flagged until every destination succeeds");
    const alertOp = (await store.listOperations({ kind: "alert" }))[0];
    await makeDue(store, alertOp.id);
    const second = await activateAccount((await store.getAccountById(a.id))!, ctx);
    assert.equal(second.complete, true);
    assert.equal(effectsOf("alert").length, 1);
    assert.equal(effectsOf("dialer").length, 1, "the dialer is not called again");
    assert.equal((await store.getAccountById(a.id))?.pendingActivation, null);
    assert.ok(second.alert.deliveries?.every((d) => d.status === "succeeded"));
  });

  it("two workers activating the same account produce one alert and one call", async () => {
    const a = await makeAccount(store, { pendingActivation: "viewed pricing", pendingActivationAt: new Date().toISOString(), status: "hot" });
    const ctx = await agentCtx(store);
    testControl().delayMs.alert = 60;
    testControl().delayMs.dialer = 60;
    await Promise.all([activateAccount(a, ctx), activateAccount(a, ctx)]);
    assert.equal(effectsOf("alert").length, 1);
    assert.equal(effectsOf("dialer").length, 1);
  });
});

describe("agent runtime", () => {
  beforeEach(async () => {
    store = await fresh();
  });

  it("an admin pausing an agent mid-run is not overwritten when the run finishes", async () => {
    const a = await makeAccount(store);
    await createTask(store, { account: a, channel: "email", title: "Due", subject: "s", body: "b", status: "scheduled", source: "rep" });
    testControl().delayMs.send = 150;
    const run = runAgent("campaign", { force: true });
    await sleep(40);
    await setAgentEnabled("campaign", false);
    await run;
    const state = (await store.getAgentStates()).find((s) => s.agentId === "campaign");
    assert.equal(state?.enabled, false);
    assert.equal(state?.totalRuns, 1);
  });

  it("an agent lease admits one worker at a time", async () => {
    assert.equal(await acquireLease(store, "agent:test", 60_000, "worker-a"), true);
    assert.equal(await acquireLease(store, "agent:test", 60_000, "worker-b"), false);
    await releaseLease(store, "agent:test", "worker-a");
    assert.equal(await acquireLease(store, "agent:test", 60_000, "worker-b"), true);
  });
});
