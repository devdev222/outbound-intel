import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { config } from "@/lib/config";
import { markAgentRun } from "@/lib/engine/accounts";
import { describeEvent } from "@/lib/engine/engagement";
import { enrichAccountContact, enrichmentDue } from "@/lib/engine/enrichment";
import { runOperation } from "@/lib/engine/operations";
import { adaptNextTouch } from "@/lib/engine/outreach";
import { getPlaybook, playbookPrompt } from "@/lib/engine/playbook";
import { generateStructured } from "@/lib/llm";
import type { Account, Alert, CallQueueItem, Delivery, HotLeadAlert, Person } from "@/lib/types";
import { hash32, nowIso } from "@/lib/util";
import { type AgentContext, type AgentDefinition } from "./base";
import { jerryMcp } from "./jerry-mcp";
import { pickContact } from "./signal-agents";

/**
 * Jerry: Cartage's sales-intelligence agent. Jerry knows the offer, the
 * clients and how reps talk; the rest of the team knows prospects. When the
 * monitor flags an account (engagement threshold crossed), Jerry:
 *
 *   1. enriches the contact in real time through the enrichment DATA provider
 *      (Clay, an in-house service, or the mock),
 *   2. reads the engagement history and the original signals,
 *   3. writes the talk track in the company's voice (knowledge/jerry/*.md),
 *   4. sends the Hot Lead Alert (Slack), queues the call (Dialer) and adapts
 *      the running sequence (Sequencer),
 *   5. clears the activation flag and stamps the alert time.
 *
 * JERRY_MODE=mcp delegates steps 1 and 3 to the real Jerry over MCP.
 */

// --- Knowledge base -------------------------------------------------------------

let knowledgeCache: { text: string; loadedAt: number } | null = null;

export async function loadJerryKnowledge(): Promise<string> {
  if (knowledgeCache && Date.now() - knowledgeCache.loadedAt < 60_000) return knowledgeCache.text;
  const dir = path.resolve(process.cwd(), config.jerry.knowledgeDir);
  let text = "";
  try {
    // Knowledge files are read at runtime from a configurable folder (not bundled); the ignore
    // comments stop Turbopack from tracing the whole project into the server output.
    const files = (await fs.readdir(/* turbopackIgnore: true */ dir)).filter((f) => f.endsWith(".md") && !f.startsWith("00-")).sort();
    const parts = await Promise.all(files.map(async (f) => `<!-- ${f} -->\n${await fs.readFile(/* turbopackIgnore: true */ path.join(dir, f), "utf8")}`));
    text = parts.join("\n\n");
  } catch {
    text = "(no knowledge base found; using defaults)";
  }
  knowledgeCache = { text, loadedAt: Date.now() };
  return text;
}

// --- Talk track -----------------------------------------------------------------

const TalkTrackSchema = z.object({
  talkTrack: z.string().describe("2-3 sentences the rep says on the call, opening with what the prospect just did; one number, one question"),
  action: z.string().describe("The single next action for the rep, e.g. 'Call now; if voicemail, send the case study link'"),
  enrichmentNotes: z.array(z.string()).describe("3-5 short bullets of context the rep should know before dialing"),
});

export function templateTalkTrack(account: Account, contact: Person | null, engagement: string[], shipments: number | undefined): { talkTrack: string; action: string } {
  const first = contact?.name.split(" ")[0] ?? "there";
  const calc = engagement.find((e) => e.startsWith("Used ROI calculator"));
  const video = engagement.find((e) => e.includes("video"));
  const opener = calc
    ? `noticed you've been exploring the ROI calculator; looks like you're shipping around ${shipments?.toLocaleString() ?? "a few hundred"} loads a month from ${account.hqCity}`
    : video
      ? `saw you watched the short note on ${account.companyName}`
      : `saw you were on the page we built for ${account.companyName}`;
  return {
    talkTrack: `Hi ${first}, ${opener}. Want me to walk through how teams at similar volume are saving 40+ hours a week?`,
    action: contact?.phone ? "Call queued in Cartage Dialer; if voicemail, reply to their thread with the case study link" : "No verified phone; reply in-thread and send a 15-minute calendar link",
  };
}

// --- Activation ---------------------------------------------------------------------

/** Stable activation id: the same flagged engagement always maps to the same alert and operations. */
export function activationIdFor(account: Account): string {
  const stamp = account.pendingActivationAt ?? account.pendingActivation ?? "unknown";
  return `act_${account.id.slice(0, 8)}_${hash32(`${account.id}:${stamp}`).toString(36)}`;
}

async function buildPayload(account: Account, ctx: AgentContext): Promise<{ payload: HotLeadAlert; contact: Person | null; account: Account }> {
  const { store, providers } = ctx;
  const priorityBefore = account.scores?.total ?? 0;

  // 1. Enrich the contact. A failure is recorded on the account (visible blocker), never replaced with synthetic data.
  let contact = account.contact ?? pickContact(account.facts.people, ctx.model);
  const enrichmentLines: string[] = [];
  if (contact) {
    const r = await enrichAccountContact(store, providers, account, contact);
    account = r.account;
    if (r.ok) {
      contact = r.result.contact;
      const synthetic = r.result.provenance === "synthetic";
      enrichmentLines.push(
        r.result.phoneVerified ? (synthetic ? "Phone on file (synthetic demo data, not verified)" : "Direct phone verified") : r.result.complete ? "No verified direct phone" : "Phone verification pending (async provider)",
        r.result.linkedinMatched ? (synthetic ? "LinkedIn on file (synthetic demo data)" : "LinkedIn profile matched") : "LinkedIn profile not matched",
        ...(r.result.recentNews.length ? [`Recent company news pulled (${r.result.recentNews.length})`] : []),
        ...(r.result.techStack.length ? [`Tech stack identified: ${r.result.techStack.slice(0, 3).join(", ")}`] : []),
        ...r.result.notes,
      );
    } else {
      enrichmentLines.push(`Enrichment failed: ${r.error}${r.retryable ? " (retrying automatically)" : " (needs attention)"}`);
    }
  } else {
    enrichmentLines.push("No contact on file; research needed before calling");
  }

  // 2. Engagement history (last 48h) and original signals.
  const since = new Date(Date.now() - 48 * 3_600_000).toISOString();
  const events = await store.listEvents({ accountId: account.id, sinceIso: since, limit: 30 });
  const engagement = [...new Set(events.map(describeEvent))].slice(0, 8);
  const originalSignals = account.signals.filter((s) => s.type !== "intent" && s.status === "verified").map((s) => (s.value ? `${s.label} (${s.value})` : s.label));
  const calc = events.find((e) => e.eventType === "calculator_completed");
  const shipments = (calc?.properties.shipmentsPerMonth as number | undefined) ?? account.campaign?.roiDefaults.shipmentsPerMonth;

  // 3. Talk track in Cartage's voice.
  let { talkTrack, action } = templateTalkTrack(account, contact, engagement, shipments);
  const remoteTrack = config.jerry.mode === "mcp" ? await jerryMcp.talkTrack(account, contact, engagement, originalSignals) : null;
  if (remoteTrack) {
    talkTrack = remoteTrack.talkTrack;
    action = remoteTrack.action;
    enrichmentLines.push(...remoteTrack.notes);
  } else {
    const knowledge = await loadJerryKnowledge();
    const team = playbookPrompt(await getPlaybook(), { signalKey: account.signals.find((x) => x.status === "verified" && x.type !== "intent")?.key, contactTitle: contact?.title, objections: true });
    const r = await generateStructured({
      schema: TalkTrackSchema,
      effort: "low",
      system:
        `You are Jerry, ${config.brandName}'s sales-intelligence agent. You brief reps right before they call a prospect who just engaged with personalized content. ` +
        "Use the knowledge base below for voice, offer and objection handling. Ground every claim in the engagement and signals provided; never invent prospect facts or customer results.\n\n" +
        `# Knowledge base\n${knowledge}` +
        (team ? `\n\n# ${team}` : ""),
      user:
        `Prospect: ${account.companyName} (${account.industry}, ${account.employeeCount} employees, ${account.hqCity}, ${account.hqState}).\n` +
        `Contact: ${contact ? `${contact.name}, ${contact.title}${contact.phone ? `, phone ${contact.phoneVerified && contact.verifiedBy !== "synthetic" ? "verified" : "unverified"}` : ", no phone"}` : "none"}.\n` +
        `Original signals: ${originalSignals.join("; ") || "none"}.\nPain hypothesis: ${account.painHypothesis ?? "n/a"}.\nMessaging angle: ${account.messagingAngle ?? account.campaign?.angle ?? "n/a"}.\n` +
        `Engagement in the last 48h (newest first): ${engagement.join("; ") || "none"}.\n` +
        `ROI calculator inputs: ${calc ? JSON.stringify(calc.properties) : "not used"}.\nPriority: ${priorityBefore} -> ${account.priority}.\n` +
        `Trigger: ${account.pendingActivation}.`,
    });
    if (r) {
      talkTrack = r.talkTrack;
      action = r.action;
      enrichmentLines.push(...r.enrichmentNotes.map((n) => `Context: ${n}`));
    }
  }

  return {
    account,
    contact,
    payload: {
      accountId: account.id,
      slug: account.slug,
      companyName: account.companyName,
      contact,
      originalSignals,
      engagement,
      priorityBefore,
      priorityAfter: account.priority,
      enrichment: enrichmentLines,
      talkTrack,
      action,
      pageUrl: account.campaign?.pageUrl ?? `${config.appUrl}/for/${account.slug}`,
      triggeredBy: account.pendingActivation ?? "engagement threshold",
    },
  };
}

function upsertDelivery(list: Delivery[], d: Delivery): Delivery[] {
  return [...list.filter((x) => x.destination !== d.destination), d];
}

/**
 * Activate a rep for a flagged account. Each destination (alert channel, dialer)
 * is its own durable operation keyed by the activation id: a failed Slack post is
 * retried on the next run without re-queuing a call that already succeeded, and two
 * workers never both deliver. The flag clears only when every destination succeeded
 * or permanently failed (the failure stays visible on the alert).
 */
export async function activateAccount(account: Account, ctx: AgentContext): Promise<{ account: Account; alert: Alert; complete: boolean }> {
  const { store, providers, log } = ctx;
  const activationId = activationIdFor(account);
  const existing = (await store.listAlerts({ accountId: account.id, limit: 20 })).find((a) => a.id === activationId);

  let alert: Alert;
  let contact: Person | null;
  if (existing) {
    alert = existing;
    contact = existing.payload.contact;
  } else {
    const built = await buildPayload(account, ctx);
    account = built.account;
    contact = built.contact;
    alert = { id: activationId, accountId: account.id, kind: "hot_lead", payload: built.payload, deliveredVia: [], deliveries: [], createdAt: nowIso() };
    await store.insertAlert(alert);
  }

  let deliveries = alert.deliveries ?? [];
  const settle = (destination: string, r: Awaited<ReturnType<typeof runOperation>>) => {
    const status: Delivery["status"] = r.state === "succeeded" ? "succeeded" : r.state === "failed" ? "failed" : "pending";
    deliveries = upsertDelivery(deliveries, {
      destination,
      status,
      remoteId: r.state === "succeeded" ? r.remoteId : null,
      error: r.state === "failed" ? r.error : null,
      attempts: r.op.attempts,
      at: nowIso(),
    });
    return r.state === "succeeded" || (r.state === "failed" && !r.retryable);
  };

  // Alert channel (Slack / console / test).
  const alertDest = `alert:${providers.alerts.name}`;
  const alertRun = await runOperation(store, { id: `alert:${activationId}:${providers.alerts.name}`, kind: "alert", accountId: account.id, destination: providers.alerts.name, maxAttempts: 5 }, async (key) => {
    const res = await providers.alerts.sendHotLead(alert.payload, key);
    if (!res.delivered) throw new Error(res.note ?? `not delivered via ${res.via}`);
    return { remoteId: res.remoteId ?? null, result: { via: res.via } };
  });
  let done = settle(alertDest, alertRun);
  if (alertRun.state === "failed") log(`jerry: alert delivery failed for ${account.slug}: ${alertRun.error}`);

  // Dialer (only with a contact, and never while outreach is paused: a queued call is outreach).
  const paused = Boolean(account.pausedUntil && account.pausedUntil > nowIso());
  if (contact && paused) log(`jerry: ${account.slug} is paused until ${account.pausedUntil!.slice(0, 10)}; alert only, no call queued`);
  if (contact && !paused) {
    const dialDest = `dialer:${providers.dialer.name}`;
    const dialRun = await runOperation(store, { id: `dialer:${activationId}`, kind: "dialer", accountId: account.id, destination: providers.dialer.name, maxAttempts: 5 }, async (key) => {
      const q = await providers.dialer.queueCall({ account, contact: contact!, context: alert.payload.talkTrack, idempotencyKey: key });
      const item: CallQueueItem = {
        id: `call_${activationId}`,
        accountId: account.id,
        contactName: contact!.name,
        phone: contact!.phone ?? null,
        context: `${alert.payload.triggeredBy}. ${alert.payload.talkTrack}`,
        status: "queued",
        createdAt: nowIso(),
      };
      const already = (await store.listCallQueue({ limit: 500 })).some((c) => c.id === item.id);
      if (!already) await store.enqueueCall(item);
      return { remoteId: q.externalId ?? null, result: { note: q.note } };
    });
    done = settle(dialDest, dialRun) && done;
    if (dialRun.state === "failed") log(`jerry: dialer failed for ${account.slug}: ${dialRun.error}`);
  }

  alert = { ...alert, deliveries, deliveredVia: deliveries.filter((d) => d.status === "succeeded").map((d) => d.destination) };
  await store.insertAlert(alert);

  if (!done) {
    // Leave the activation flagged; the next run retries only the destinations that have not succeeded.
    const latest = (await store.getAccountById(account.id)) ?? account;
    return { account: latest, alert, complete: false };
  }

  // Adapt the running sequence once per activation.
  let adaptedNote = "";
  if (providers.outreach.ownsScheduling) {
    const adapt = await runOperation(store, { id: `adapt:${activationId}`, kind: "send", accountId: account.id, destination: providers.outreach.name, maxAttempts: 3 }, async () => {
      const r = await providers.outreach.adaptSequence(account, alert.payload.triggeredBy);
      return { result: { note: r.note } };
    });
    adaptedNote = adapt.state === "succeeded" ? "sequencer asked to adapt the next touch" : `sequencer adapt not confirmed: ${adapt.state === "failed" ? adapt.error : adapt.state}`;
  } else {
    const adapted = await adaptNextTouch(store, account, alert.payload.triggeredBy, alert.payload.engagement).catch(() => null);
    if (adapted) adaptedNote = `next email (step ${adapted.step}) rewritten to reference the engagement and moved up`;
  }

  const failedDest = deliveries.filter((d) => d.status === "failed");
  ctx.activity(account.id, "rep_activated", `Jerry activated the rep: ${alert.payload.triggeredBy}`, [
    ...deliveries.map((d) => `${d.destination}: ${d.status}${d.error ? ` (${d.error})` : ""}`),
    `talk track: "${alert.payload.talkTrack}"`,
    ...alert.payload.enrichment.map((l) => `enrichment: ${l}`),
    adaptedNote,
    failedDest.length ? "some deliveries failed permanently; see Needs attention" : "",
  ]);

  const latest = (await store.getAccountById(account.id)) ?? account;
  const updated = await store.upsertAccount(
    markAgentRun({ ...latest, contact: contact ?? latest.contact, lastAlertAt: nowIso(), pendingActivation: null, pendingActivationAt: null, status: latest.status === "meeting_booked" ? latest.status : "hot" }, "jerry"),
  );
  return { account: updated, alert, complete: true };
}

export const jerryAgent: AgentDefinition = {
  id: "jerry",
  name: "Jerry",
  role: "sales intelligence + rep activation",
  description: "Cartage's trained sales agent. Enriches the contact the moment engagement spikes, writes the talk track in the company's voice, alerts the rep and queues the call; retries failed deliveries per destination.",
  cadenceSeconds: 15,
  step: 7,
  async run(ctx) {
    const all = await ctx.store.listAccounts();
    const flagged = all.filter((a) => a.pendingActivation).slice(0, ctx.batchSize);
    let complete = 0;
    let retrying = 0;
    for (const a of flagged) {
      const r = await activateAccount(a, ctx);
      if (r.complete) complete++;
      else retrying++;
    }
    // Readiness blockers about contact data: enrich with bounded retries; failures stay visible as blockers.
    const blocked = all
      .filter((a) => a.status === "needs_enrichment" && a.readiness && a.readiness.checks.some((c) => (c.key === "contact" || c.key === "decision_maker") && !c.pass) && enrichmentDue(a))
      .filter((a) => !a.enrichment?.lastSuccessAt || (a.agentRuns.scoring ?? "") > (a.enrichment.lastSuccessAt ?? ""))
      .slice(0, ctx.batchSize);
    let enriched = 0;
    let failed = 0;
    for (const a of blocked) {
      const person = a.contact ?? pickContact(a.facts.people, ctx.model);
      if (!person) {
        if (!a.agentRuns.jerry) {
          await ctx.store.upsertAccount(markAgentRun(a, "jerry"));
          ctx.activity(a.id, "enrichment_skipped", "No person on file to enrich; needs discovery data");
        }
        continue;
      }
      const r = await enrichAccountContact(ctx.store, ctx.providers, a, person);
      if (r.ok) {
        await ctx.store.upsertAccount(markAgentRun(r.account, "jerry"));
        ctx.activity(a.id, "contact_enriched", `Contact enriched via ${r.result.provider}${r.result.provenance === "synthetic" ? " (synthetic demo data)" : ""}: ${[r.result.phoneVerified ? "phone" : null, r.result.contact.email ? "email" : null, r.result.linkedinMatched ? "LinkedIn" : null].filter(Boolean).join(", ") || "nothing new"}`, r.result.notes);
        enriched++;
      } else {
        failed++;
        ctx.log(`jerry: enrichment failed for ${a.slug}: ${r.error}`);
        ctx.activity(a.id, "enrichment_failed", `Contact enrichment failed${r.retryable ? "; will retry" : "; needs attention"}`, [r.error]);
      }
    }
    const parts = [
      flagged.length ? `${complete} activations delivered${retrying ? `, ${retrying} awaiting delivery retry` : ""}` : "no activations",
      enriched ? `${enriched} blocked accounts enriched` : null,
      failed ? `${failed} enrichment failures recorded` : null,
    ].filter(Boolean);
    return { processed: flagged.length + enriched + failed, summary: parts.join(", ") };
  },
};
