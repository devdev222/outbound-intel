import { config } from "@/lib/config";
import type { Providers } from "@/lib/providers";
import type { Store } from "@/lib/store";
import { conversations as convCol, getSettings, proofStories } from "@/lib/store/collections";
import type { Account, Alert, Conversation, NextAction, OutreachChannel, ProofStory, Task } from "@/lib/types";
import { nowIso } from "@/lib/util";
import { getPlaybook } from "./playbook";
import { rankProof } from "./proof";
import { OPEN_STATUSES, type TaskAction, primaryActionFor } from "./tasks";

/**
 * The BDR's day as ONE prioritized queue, one row per account.
 *
 * Every account lands in exactly one category, so the filter counts add up:
 *   now             ready accounts with live intent or a call/touch due today
 *   meetings        booked meetings and prospect meeting requests to schedule
 *   follow_ups      tasks due today (approvals, LinkedIn, manual sends, callbacks)
 *   needs_attention failed deliveries, failed enrichment, blocked readiness, failed launches
 * Paused accounts stay out of the queue (counted separately) unless a person's
 * committed task is due. Each row carries one primary action; the rest of the
 * account's due tasks are a count with details on expand.
 */

export type QueueCategory = "now" | "meetings" | "follow_ups" | "needs_attention";
export const CATEGORY_ORDER: QueueCategory[] = ["now", "meetings", "follow_ups", "needs_attention"];
export const CATEGORY_LABEL: Record<QueueCategory, string> = { now: "Now", meetings: "Meetings", follow_ups: "Follow-ups", needs_attention: "Needs attention" };

export const CHANNEL_LABEL: Record<OutreachChannel, string> = {
  email: "Email",
  linkedin: "LinkedIn message",
  inmail: "LinkedIn InMail",
  gift: "Gift",
  call: "Call",
  meeting: "Meeting",
  estimate: "Estimate",
};

export interface QueueTask {
  task: Task;
  action: TaskAction;
  channelLabel: string;
}

export type PrimaryAction =
  | { kind: "task"; item: QueueTask }
  | { kind: "call"; label: string; phone: string | null }
  | { kind: "open"; label: string; href: string };

export interface QueueItem {
  slug: string;
  accountId: string;
  company: string;
  industry: string;
  priority: number;
  score: number | null;
  status: Account["status"];
  category: QueueCategory;
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
  /** Label + due date shown on the row. */
  next: { label: string; dueAt: string | null; overdue: boolean };
  primary: PrimaryAction;
  /** Open tasks due today for this account, primary first. */
  tasks: QueueTask[];
  /** Due tasks beyond the primary one. */
  moreTasks: number;
  attention: string[];
  readinessBlockers: string[];
  pageUrl: string;
  pausedUntil: string | null;
  /** Your playbook's objection handling, for the call. */
  objections: { objection: string; response: string }[];
}

export interface WorkQueue {
  repId: string | null;
  generatedAt: string;
  items: QueueItem[];
  counts: Record<QueueCategory, number> & { all: number };
  /** Accounts left out because outreach is paused. */
  paused: number;
}

export function openerFor(a: Account, latestAlertTalkTrack: string | undefined): string {
  if (latestAlertTalkTrack) return latestAlertTalkTrack;
  const first = a.contact?.name.split(" ")[0] ?? "there";
  const sig = a.signals.find((s) => s.status === "verified" && s.type !== "intent");
  const why = sig ? sig.label.toLowerCase() : "how shipping coordination is scaling";
  return `Hi ${first}, this is ${config.brandName}. I noticed ${why} at ${a.companyName}, and I work with teams at your volume on exactly that. Do you have two minutes for me to ask how coordination is handled today?`;
}

function whyNowFor(a: Account, alert: Alert | undefined): string {
  if (a.pendingActivation) return a.pendingActivation;
  if (alert && Date.now() - new Date(alert.createdAt).getTime() < 3 * 86_400_000) return alert.payload.triggeredBy;
  const verified = a.signals.filter((s) => s.status === "verified" && s.type !== "intent").sort((x, y) => y.detectedAt.localeCompare(x.detectedAt));
  const top = verified.slice(0, 2).map((s) => s.label.toLowerCase());
  const intent = a.signals.filter((s) => s.type === "intent").map((s) => s.label.toLowerCase());
  const parts = [...top, ...intent.slice(0, 1)];
  return parts.length ? parts.join("; ") : (a.painHypothesis ?? "scored above threshold");
}

const TASK_RANK: Partial<Record<Task["status"], number>> = { failed: 0, awaiting_approval: 1, manual: 2, scheduled: 3 };

function endOfToday(): string {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d.toISOString();
}

/** Attention reasons that need a person, independent of tasks due. */
function attentionFor(a: Account, alert: Alert | undefined, failedTasks: Task[]): string[] {
  const out: string[] = [];
  for (const t of failedTasks) out.push(`${CHANNEL_LABEL[t.channel]} delivery failed${t.lastError ? `: ${t.lastError}` : ""}`);
  if (a.enrichment?.lastError) out.push(`Enrichment failed: ${a.enrichment.lastError}`);
  if (a.campaign?.launchState === "failed") out.push(`Sequence launch failed${a.campaign.launchError ? `: ${a.campaign.launchError}` : ""}`);
  else if (a.campaign?.launchState === "pending" && a.campaign.launchError) out.push(`Sequence launch retrying: ${a.campaign.launchError}`);
  if (a.campaign?.videoStatus === "failed") out.push("Personalized video failed to render");
  const failedDest = (alert?.deliveries ?? []).filter((d) => d.status === "failed");
  for (const d of failedDest) out.push(`Rep alert to ${d.destination} failed${d.error ? `: ${d.error}` : ""}`);
  if (a.status === "needs_enrichment") for (const b of a.readiness?.blockers ?? []) if (!out.some((o) => o.includes(b))) out.push(b);
  if (a.nextAction?.type === "review") out.push(a.nextAction.reason);
  return out;
}

export async function buildWorkQueue(store: Store, providers: Providers, repId: string | null): Promise<WorkQueue> {
  const settings = await getSettings();
  const [accounts, alerts, openTasks, convs, stories] = await Promise.all([
    store.listAccounts(),
    store.listAlerts({ limit: 1000 }),
    store.listOutreach({ status: OPEN_STATUSES, limit: 5000 }),
    convCol.list(),
    proofStories.list(),
  ]);
  const objections = (await getPlaybook()).objections.slice(0, 4).map((o) => ({ objection: o.objection, response: o.response }));
  const now = nowIso();
  const todayEnd = endOfToday();
  const mine = (repId ? accounts.filter((a) => a.ownerRepId === repId) : accounts).filter((a) => !["won", "lost", "disqualified"].includes(a.status));

  const alertByAccount = new Map<string, Alert>();
  for (const al of [...alerts].sort((x, y) => y.createdAt.localeCompare(x.createdAt))) if (!alertByAccount.has(al.accountId)) alertByAccount.set(al.accountId, al);
  const convByAccount = new Map<string, Conversation>();
  for (const c of [...convs].sort((x, y) => y.at.localeCompare(x.at))) if (!convByAccount.has(c.accountId)) convByAccount.set(c.accountId, c);
  const tasksByAccount = new Map<string, Task[]>();
  for (const t of openTasks) tasksByAccount.set(t.accountId, [...(tasksByAccount.get(t.accountId) ?? []), t]);

  let paused = 0;
  const items: QueueItem[] = [];
  for (const a of mine) {
    const alert = alertByAccount.get(a.id);
    const conv = convByAccount.get(a.id);
    const isPaused = Boolean(a.pausedUntil && a.pausedUntil > now);
    const open = tasksByAccount.get(a.id) ?? [];
    // Tasks a person can act on today. Paused accounts only surface committed (person-made) tasks.
    const due = open
      .map((task) => ({ task, action: primaryActionFor(task, providers), channelLabel: CHANNEL_LABEL[task.channel] }))
      // Scheduled tasks are delivered by the scheduler on their own; only work a person must do counts.
      .filter((q) => q.action !== "none" && q.task.status !== "scheduled" && (q.task.status === "failed" || q.task.scheduledFor <= todayEnd))
      .filter((q) => !isPaused || q.task.source === "rep" || q.task.source === "conversation" || q.task.source === "prospect")
      .sort((x, y) => (TASK_RANK[x.task.status] ?? 9) - (TASK_RANK[y.task.status] ?? 9) || x.task.scheduledFor.localeCompare(y.task.scheduledFor));
    const failed = due.filter((q) => q.task.status === "failed").map((q) => q.task);
    const attention = attentionFor(a, alert, failed);
    const ready = Boolean(a.readiness?.ready);
    const intent = Boolean(a.status === "hot" || a.pendingActivation || a.engagementScore >= settings.automation.hotThreshold);
    const touchDue = Boolean(a.nextAction && ["call", "email", "linkedin"].includes(a.nextAction.type) && a.nextAction.dueAt <= todayEnd);
    const meetingTask = due.find((q) => q.task.channel === "meeting");

    let category: QueueCategory | null = null;
    if (a.status === "meeting_booked" || meetingTask) category = "meetings";
    else if (!isPaused && ready && (intent || touchDue)) category = "now";
    else if (attention.length) category = "needs_attention";
    else if (due.length || (!isPaused && a.nextAction?.type === "wait" && a.nextAction.dueAt <= now)) category = "follow_ups";
    if (!category) {
      if (isPaused) paused++;
      continue;
    }

    // One primary action per row.
    let primary: PrimaryAction;
    const firstName = a.contact?.name.split(" ")[0] ?? "the contact";
    if (category === "meetings") {
      primary = meetingTask ? { kind: "task", item: meetingTask } : { kind: "open", label: "Prepare for the meeting", href: `/accounts/${a.slug}` };
    } else if (category === "now" && (a.contact?.phone && a.contact.phoneVerified ? true : a.nextAction?.type === "call")) {
      primary = { kind: "call", label: `Call ${firstName}`, phone: a.contact?.phoneVerified ? (a.contact.phone ?? null) : null };
    } else if (category === "needs_attention" && !failed.length) {
      primary = { kind: "open", label: a.enrichment?.lastError || a.status === "needs_enrichment" ? "Review blockers" : "Review", href: `/accounts/${a.slug}?tab=technical` };
    } else if (due[0]) {
      primary = { kind: "task", item: due[0] };
    } else {
      primary = { kind: "open", label: a.nextAction?.label ?? "Open account", href: `/accounts/${a.slug}` };
    }
    const tasks = primary.kind === "task" ? [primary.item, ...due.filter((q) => q.task.id !== (primary as { item: QueueTask }).item.task.id)] : due;
    const moreTasks = tasks.length - (primary.kind === "task" ? 1 : 0);

    const nextDue = primary.kind === "task" ? primary.item.task.scheduledFor : (a.nextAction?.dueAt ?? null);
    const nextLabel = primary.kind === "task" ? (primary.item.task.title ?? `${primary.item.channelLabel} task`) : primary.kind === "call" ? (a.nextAction?.label ?? "Call") : primary.label;

    const match = rankProof(a, stories as ProofStory[], { allowPlaceholders: config.demoBanner })[0];
    const proofLine = match ? (match.story.outcomes.find((o) => o.verified) ?? match.story.outcomes[0]) : null;
    const emailTask = open.find((t) => t.channel === "email" && (t.status === "awaiting_approval" || t.status === "manual"));
    items.push({
      slug: a.slug,
      accountId: a.id,
      company: a.companyName,
      industry: a.industry,
      priority: a.priority,
      score: a.scores?.total ?? null,
      status: a.status,
      category,
      whyNow: whyNowFor(a, alert),
      signals: a.signals.filter((s) => s.status === "verified").map((s) => s.label),
      contact: a.contact,
      opener: openerFor(a, alert?.payload.talkTrack),
      painHypothesis: a.painHypothesis,
      angle: a.messagingAngle ?? a.campaign?.angle ?? null,
      proof: match ? { id: match.story.id, customer: match.story.customer, line: proofLine ? `${proofLine.value} ${proofLine.metric.toLowerCase()}${proofLine.verified ? "" : " (unverified placeholder)"}` : "", placeholder: match.story.placeholder } : null,
      preparedFollowUp: conv?.followUpDraft ?? (emailTask ? { subject: emailTask.subject ?? "", body: emailTask.body } : null),
      lastInteraction: conv ? { at: conv.at, summary: conv.summary } : alert ? { at: alert.createdAt, summary: `Hot lead alert: ${alert.payload.engagement[0] ?? alert.payload.triggeredBy}` } : null,
      nextAction: a.nextAction ?? null,
      next: { label: nextLabel, dueAt: nextDue, overdue: Boolean(nextDue && nextDue < now && Date.now() - new Date(nextDue).getTime() > 3_600_000) },
      primary,
      tasks,
      moreTasks,
      attention,
      readinessBlockers: a.readiness?.blockers ?? [],
      pageUrl: a.campaign?.pageUrl ?? `${config.appUrl}/for/${a.slug}`,
      pausedUntil: isPaused ? (a.pausedUntil ?? null) : null,
      objections,
    });
  }

  const flagged = new Set(mine.filter((a) => a.pendingActivation).map((a) => a.id));
  const hot = (i: QueueItem) => (i.status === "hot" || flagged.has(i.accountId) ? 0 : 1);
  items.sort((x, y) => {
    const c = CATEGORY_ORDER.indexOf(x.category) - CATEGORY_ORDER.indexOf(y.category);
    if (c) return c;
    if (x.category === "now") return hot(x) - hot(y) || y.priority - x.priority;
    if (x.category === "follow_ups" || x.category === "meetings") return (x.next.dueAt ?? "").localeCompare(y.next.dueAt ?? "") || y.priority - x.priority;
    return y.priority - x.priority;
  });

  const counts = { now: 0, meetings: 0, follow_ups: 0, needs_attention: 0, all: items.length };
  for (const i of items) counts[i.category]++;
  return { repId, generatedAt: now, items, counts, paused };
}
