import type { Store } from "@/lib/store";
import { conversations as convCol, getSettings, proofStories } from "@/lib/store/collections";
import { config } from "@/lib/config";
import type { Account, Alert, Conversation, NextAction, OutreachTouch, ProofStory } from "@/lib/types";
import { describeEvent } from "./engagement";
import { rankProof } from "./proof";

/**
 * The BDR workspace feed. Every item is fully prepared: why the account is in
 * the queue, who to call, what to open with, the pain hypothesis, the proof to
 * cite, the prepared follow-up and the recommended next action.
 */

export interface QueueItem {
  slug: string;
  accountId: string;
  company: string;
  industry: string;
  priority: number;
  score: number | null;
  status: Account["status"];
  whyNow: string;
  signals: string[];
  contact: Account["contact"];
  opener: string;
  painHypothesis: string | null;
  angle: string | null;
  proof: { id: string; customer: string; line: string; placeholder: boolean } | null;
  preparedFollowUp: { subject: string; body: string } | null;
  lastInteraction: { at: string; summary: string } | null;
  nextAction: NextAction | null;
  pageUrl: string;
  readinessBlockers: string[];
  pendingTask: { id: string; channel: string; body: string; note: string | null } | null;
}

export interface WorkQueue {
  repId: string | null;
  generatedAt: string;
  callsReady: QueueItem[];
  followUps: QueueItem[];
  highIntent: QueueItem[];
  meetings: QueueItem[];
  exceptions: QueueItem[];
  counts: { callsReady: number; followUps: number; highIntent: number; meetings: number; exceptions: number };
}

function openerFor(a: Account, latestAlertTalkTrack: string | undefined): string {
  if (latestAlertTalkTrack) return latestAlertTalkTrack;
  const first = a.contact?.name.split(" ")[0] ?? "there";
  const sig = a.signals.find((s) => s.status === "verified" && s.type !== "intent");
  const why = sig ? sig.label.toLowerCase() : "how shipping coordination is scaling";
  return `Hi ${first}, this is ${config.brandName}. I noticed ${why} at ${a.companyName}, and I work with teams at your volume on exactly that. Do you have two minutes for me to ask how coordination is handled today?`;
}

function whyNowFor(a: Account): string {
  const verified = a.signals.filter((s) => s.status === "verified" && s.type !== "intent").sort((x, y) => y.detectedAt.localeCompare(x.detectedAt));
  const top = verified.slice(0, 2).map((s) => s.label.toLowerCase());
  const intent = a.signals.filter((s) => s.type === "intent").map((s) => s.label.toLowerCase());
  const parts = [...top, ...intent.slice(0, 1)];
  return parts.length ? parts.join("; ") : (a.painHypothesis ?? "scored above threshold");
}

export async function buildWorkQueue(store: Store, repId: string | null): Promise<WorkQueue> {
  const settings = await getSettings();
  const [accounts, alerts, touches, convs, stories] = await Promise.all([store.listAccounts(), store.listAlerts({ limit: 500 }), store.listOutreach({ status: "awaiting_rep", limit: 500 }), convCol.list(), proofStories.list()]);
  const mine = repId ? accounts.filter((a) => a.ownerRepId === repId) : accounts;
  const alertByAccount = new Map<string, Alert>();
  for (const al of alerts) if (!alertByAccount.has(al.accountId)) alertByAccount.set(al.accountId, al);
  const convByAccount = new Map<string, Conversation>();
  for (const c of [...convs].sort((x, y) => y.at.localeCompare(x.at))) if (!convByAccount.has(c.accountId)) convByAccount.set(c.accountId, c);
  const taskByAccount = new Map<string, OutreachTouch>();
  for (const t of touches) if (!taskByAccount.has(t.accountId)) taskByAccount.set(t.accountId, t);

  const toItem = (a: Account): QueueItem => {
    const alert = alertByAccount.get(a.id);
    const conv = convByAccount.get(a.id);
    const task = taskByAccount.get(a.id);
    const match = rankProof(a, stories as ProofStory[], { allowPlaceholders: config.demoBanner })[0];
    const proofLine = match ? (match.story.outcomes.find((o) => o.verified) ?? match.story.outcomes[0]) : null;
    return {
      slug: a.slug,
      accountId: a.id,
      company: a.companyName,
      industry: a.industry,
      priority: a.priority,
      score: a.scores?.total ?? null,
      status: a.status,
      whyNow: whyNowFor(a),
      signals: a.signals.filter((s) => s.status === "verified").map((s) => s.label),
      contact: a.contact,
      opener: openerFor(a, alert?.payload.talkTrack),
      painHypothesis: a.painHypothesis,
      angle: a.messagingAngle ?? a.campaign?.angle ?? null,
      proof: match ? { id: match.story.id, customer: match.story.customer, line: proofLine ? `${proofLine.value} ${proofLine.metric.toLowerCase()}${proofLine.verified ? "" : " (unverified placeholder)"}` : "", placeholder: match.story.placeholder } : null,
      preparedFollowUp: conv?.followUpDraft ?? (task && task.channel === "email" ? { subject: task.subject ?? "", body: task.body } : null),
      lastInteraction: conv ? { at: conv.at, summary: conv.summary } : alert ? { at: alert.createdAt, summary: `Hot lead alert: ${alert.payload.engagement[0] ?? alert.payload.triggeredBy}` } : null,
      nextAction: a.nextAction ?? null,
      pageUrl: a.campaign?.pageUrl ?? `${config.appUrl}/for/${a.slug}`,
      readinessBlockers: a.readiness?.blockers ?? [],
      pendingTask: task ? { id: task.id, channel: task.channel, body: task.body, note: task.note ?? null } : null,
    };
  };

  const active = mine.filter((a) => !["won", "lost", "disqualified"].includes(a.status));
  const now = Date.now();
  const ready = active.filter((a) => a.readiness?.ready && a.status !== "meeting_booked");
  const highIntent = ready.filter((a) => a.status === "hot" || a.pendingActivation || a.engagementScore >= settings.automation.hotThreshold).sort((x, y) => y.priority - x.priority);
  const highIds = new Set(highIntent.map((a) => a.id));
  const callsReady = ready
    .filter((a) => !highIds.has(a.id) && (a.nextAction?.type === "call" || a.nextAction?.type === "email" || a.nextAction?.type === "linkedin") && new Date(a.nextAction.dueAt).getTime() <= now + 86_400_000)
    .sort((x, y) => y.priority - x.priority);
  const followUps = active.filter((a) => taskByAccount.has(a.id) || (a.nextAction?.type === "wait" && new Date(a.nextAction.dueAt).getTime() <= now)).sort((x, y) => y.priority - x.priority);
  const meetings = active.filter((a) => a.status === "meeting_booked");
  const exceptions = active.filter((a) => a.status === "needs_enrichment" || a.nextAction?.type === "review" || a.nextAction?.type === "enrich" || (a.campaign && a.campaign.videoStatus === "failed"));

  const items = (list: Account[]) => list.map(toItem);
  return {
    repId,
    generatedAt: new Date().toISOString(),
    callsReady: items(callsReady),
    followUps: items(followUps),
    highIntent: items(highIntent),
    meetings: items(meetings),
    exceptions: items(exceptions),
    counts: { callsReady: callsReady.length, followUps: followUps.length, highIntent: highIntent.length, meetings: meetings.length, exceptions: exceptions.length },
  };
}
