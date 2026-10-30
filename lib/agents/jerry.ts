import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { config } from "@/lib/config";
import { markAgentRun } from "@/lib/engine/accounts";
import { describeEvent } from "@/lib/engine/engagement";
import { generateStructured } from "@/lib/llm";
import type { Account, Alert, CallQueueItem, HotLeadAlert, Person } from "@/lib/types";
import { nowIso, uuid } from "@/lib/util";
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

export async function activateAccount(account: Account, ctx: AgentContext): Promise<{ account: Account; alert: Alert }> {
  const { store, providers, log } = ctx;
  const priorityBefore = account.scores?.total ?? 0;

  // 1. Enrich the contact (real-time).
  let contact = account.contact ?? pickContact(account.facts.people, ctx.model);
  const enrichmentLines: string[] = [];
  if (contact) {
    try {
      const remote = config.jerry.mode === "mcp" ? await jerryMcp.enrichContact(contact, account) : null;
      const result = remote ?? (await providers.enrichment.enrichContact(contact, account));
      contact = result.contact;
      enrichmentLines.push(
        result.phoneVerified ? "Direct phone verified" : result.complete ? "No verified direct phone" : "Phone verification pending (async provider)",
        result.linkedinMatched ? "LinkedIn profile matched" : "LinkedIn profile not matched",
        ...(result.recentNews.length ? [`Recent company news pulled (${result.recentNews.length})`] : []),
        ...(result.techStack.length ? [`Tech stack identified: ${result.techStack.slice(0, 3).join(", ")}`] : []),
        ...result.notes.filter((n) => !n.startsWith("mock")),
      );
    } catch (err) {
      log(`jerry: enrichment failed for ${account.slug}: ${(err as Error).message}`);
      enrichmentLines.push("Enrichment provider unavailable; using known contact data");
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
    const r = await generateStructured({
      schema: TalkTrackSchema,
      effort: "low",
      system:
        `You are Jerry, ${config.brandName}'s sales-intelligence agent. You brief reps right before they call a prospect who just engaged with personalized content. ` +
        "Use the knowledge base below for voice, offer and objection handling. Ground every claim in the engagement and signals provided; never invent prospect facts.\n\n" +
        `# Knowledge base\n${knowledge}`,
      user:
        `Prospect: ${account.companyName} (${account.industry}, ${account.employeeCount} employees, ${account.hqCity}, ${account.hqState}).\n` +
        `Contact: ${contact ? `${contact.name}, ${contact.title}${contact.phone ? `, phone ${contact.phoneVerified ? "verified" : "unverified"}` : ", no phone"}` : "none"}.\n` +
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

  const payload: HotLeadAlert = {
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
  };

  // 4. Deliver: Slack alert, dialer queue, sequence adaptation.
  const deliveredVia: string[] = [];
  try {
    const res = await providers.alerts.sendHotLead(payload);
    if (res.delivered) deliveredVia.push(res.via);
    else log(`jerry: alert not delivered via ${res.via}: ${res.note ?? ""}`);
  } catch (err) {
    log(`jerry: alert provider failed: ${(err as Error).message}`);
  }
  if (contact) {
    try {
      const q = await providers.dialer.queueCall({ account, contact, context: talkTrack });
      const item: CallQueueItem = {
        id: q.externalId ?? uuid(),
        accountId: account.id,
        contactName: contact.name,
        phone: contact.phone ?? null,
        context: `${payload.triggeredBy}. ${talkTrack}`,
        status: "queued",
        createdAt: nowIso(),
      };
      await store.enqueueCall(item);
      deliveredVia.push(`dialer:${providers.dialer.name}`);
    } catch (err) {
      log(`jerry: dialer failed: ${(err as Error).message}`);
    }
  }
  providers.outreach.adaptSequence(account, payload.triggeredBy).catch((err) => log(`jerry: sequencer adapt failed: ${(err as Error).message}`));

  const alert: Alert = { id: uuid(), accountId: account.id, kind: "hot_lead", payload, deliveredVia, createdAt: nowIso() };
  await store.insertAlert(alert);

  // 5. Clear the flag.
  const updated = await store.upsertAccount(
    markAgentRun({ ...account, contact, lastAlertAt: nowIso(), pendingActivation: null, status: account.status === "meeting_booked" ? account.status : "hot" }, "jerry"),
  );
  return { account: updated, alert };
}

export const jerryAgent: AgentDefinition = {
  id: "jerry",
  name: "Jerry",
  role: "sales intelligence + rep activation",
  description: "Cartage's trained sales agent. Enriches the contact the moment engagement spikes, writes the talk track in the company's voice, alerts the rep in Slack and queues the call.",
  cadenceSeconds: 15,
  step: 7,
  async run(ctx) {
    const flagged = (await ctx.store.listAccounts()).filter((a) => a.pendingActivation).slice(0, ctx.batchSize);
    let delivered = 0;
    for (const a of flagged) {
      const { alert } = await activateAccount(a, ctx);
      if (alert.deliveredVia.length) delivered++;
    }
    return { processed: flagged.length, summary: flagged.length ? `${flagged.length} reps activated (${delivered} alerts delivered)` : "no accounts awaiting activation" };
  },
};
