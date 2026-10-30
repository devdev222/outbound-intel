import type { Providers } from "@/lib/providers";
import type { Store } from "@/lib/store";
import { getSettings, isSuppressed } from "@/lib/store/collections";
import type { Account, OutreachTouch, Task } from "@/lib/types";
import { nowIso } from "@/lib/util";
import { ACCOUNT_LIMITS } from "./coordination";
import { isPaused } from "./pause";
import { deliverTask, MESSAGE_CHANNELS, providerCanSend, taskUrlFor } from "./tasks";

/**
 * Task scheduler (runs inside the Campaign Agent). For every due `scheduled` task:
 *
 *   account closed            -> skipped
 *   recipient suppressed      -> skipped (opt-out always wins)
 *   account paused            -> held: due date moves to pausedUntil, nothing is sent
 *   auto-send off (sequence)  -> awaiting_approval
 *   no provider for channel   -> manual (a person does it and marks it sent/done)
 *   otherwise                 -> deliverTask (durable, idempotent, bounded retries)
 *
 * When the Sequencer owns scheduling it receives the cadence at launch; this
 * loop then only converts due non-message tasks (gifts, calls) into manual work.
 * It also recovers tasks stranded in `sending` by a crashed worker.
 */

export interface DueTouchResult {
  sent: number;
  manual: number;
  retrying: number;
  failed: number;
  skipped: number;
  held: number;
  approvals: number;
}

type ActivityFn = (accountId: string, action: string, summary: string, details?: string[]) => void;

export async function processDueTouches(store: Store, providers: Providers, opts: { log?: (s: string) => void; activity?: ActivityFn; limit?: number } = {}): Promise<DueTouchResult> {
  const result: DueTouchResult = { sent: 0, manual: 0, retrying: 0, failed: 0, skipped: 0, held: 0, approvals: 0 };
  const settings = await getSettings();
  const now = nowIso();

  await recoverStrandedSends(store);

  const due = await store.listOutreach({ status: "scheduled", dueBefore: now, limit: opts.limit ?? 50 });
  const accounts = new Map<string, Account | null>();
  for (const task of due) {
    if (!accounts.has(task.accountId)) accounts.set(task.accountId, await store.getAccountById(task.accountId));
    const account = accounts.get(task.accountId);
    if (!account) continue;

    if (["won", "lost", "disqualified"].includes(account.status)) {
      await store.updateOutreach({ ...task, status: "skipped", note: `sequence stopped: account ${account.status}` });
      result.skipped++;
      continue;
    }
    // Per-person lifecycle: a task for someone who opted out, was replaced or is held never goes out.
    const person = task.contactId ? await store.getContact(task.contactId) : null;
    if (person && ["rejected", "replaced", "opted_out"].includes(person.status)) {
      await store.updateOutreach({ ...task, status: "skipped", note: `${person.person.name} is ${person.status.replace("_", " ")}` });
      result.skipped++;
      continue;
    }
    if (person?.status === "paused") {
      const until = person.outreach.heldUntil && person.outreach.heldUntil > now ? person.outreach.heldUntil : new Date(Date.now() + 86_400_000).toISOString();
      await store.updateOutreach({ ...task, scheduledFor: until, note: `held: ${person.outreach.heldReason ?? "coordinating the group"}` });
      result.held++;
      continue;
    }
    const recipient = person ? { ...account, contact: person.person } : account;
    const sup = await isSuppressed(recipient.contact?.email, account.domain);
    if (sup && MESSAGE_CHANNELS.includes(task.channel)) {
      await store.updateOutreach({ ...task, status: "skipped", note: `suppressed: ${sup.reason}` });
      opts.activity?.(account.id, "touch_suppressed", `${task.title ?? `Step ${task.step}`} skipped: ${sup.target} is suppressed (${sup.reason})`);
      result.skipped++;
      continue;
    }
    if (isPaused(account, now)) {
      await store.updateOutreach({ ...task, scheduledFor: account.pausedUntil!, note: `held: outreach paused until ${account.pausedUntil!.slice(0, 10)}` });
      result.held++;
      continue;
    }
    // Account-wide limits: never two people at the same company the same day, and a weekly cap.
    if (MESSAGE_CHANNELS.includes(task.channel) && task.source === "sequence" && task.contactId) {
      const wait = await spacingDelay(store, account.id, task);
      if (wait) {
        await store.updateOutreach({ ...task, scheduledFor: wait.until, note: `spaced: ${wait.reason}` });
        result.held++;
        continue;
      }
    }
    // A sequence the Sequencer acknowledged is delivered there, not here.
    if (providers.outreach.ownsScheduling && task.source === "sequence" && providerCanSend(providers, task.channel)) continue;

    if (task.channel === "email" && task.source === "sequence" && !settings.automation.autoSendEmail) {
      await store.updateOutreach({ ...task, status: "awaiting_approval", note: "auto-send is off; review & approve to schedule" });
      opts.activity?.(account.id, "approval_required", `${task.title ?? `Step ${task.step}`} email waiting for approval (auto-send off)`);
      result.approvals++;
      continue;
    }
    if (!providerCanSend(providers, task.channel) || providers.outreach.ownsScheduling) {
      await store.updateOutreach({ ...task, status: "manual", taskUrl: task.taskUrl ?? taskUrlFor(account, task.channel), note: MESSAGE_CHANNELS.includes(task.channel) ? `no provider sends ${task.channel} here; send it yourself, then mark it sent` : "due; do it, then mark it done" });
      opts.activity?.(account.id, "manual_task_due", `${task.title ?? `Step ${task.step} (${task.channel})`} is due for a rep`, [task.body.slice(0, 140)]);
      result.manual++;
      continue;
    }

    const r = await deliverTask(store, providers, task, account);
    if (r.state === "sent") result.sent++;
    else if (r.state === "retry_scheduled") {
      result.retrying++;
      opts.log?.(`send retry scheduled for ${account.slug} (${task.id.slice(0, 8)}): ${r.error}`);
    } else if (r.state === "failed") result.failed++;
  }
  return result;
}

/**
 * When a message to one person in a buying group would break the account-wide
 * limits (someone else at the company already got one today, or the weekly cap
 * is reached), the time it may go instead.
 */
export async function spacingDelay(store: Store, accountId: string, task: Task): Promise<{ until: string; reason: string } | null> {
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const sent = (await store.listOutreach({ accountId })).filter((t) => t.id !== task.id && MESSAGE_CHANNELS.includes(t.channel) && (t.status === "sent" || t.status === "sending") && (t.sentAt ?? t.scheduledFor) >= weekAgo);
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate() + 1, 14)).toISOString();
  const sameDay = sent.filter((t) => (t.sentAt ?? t.scheduledFor).slice(0, 10) === today);
  if (sameDay.filter((t) => t.contactId !== task.contactId).length >= ACCOUNT_LIMITS.messagesPerDay) return { until: tomorrow, reason: "someone at this account already got a message today" };
  if (sent.length >= ACCOUNT_LIMITS.messagesPerWeek) {
    const oldest = sent.map((t) => t.sentAt ?? t.scheduledFor).sort()[0];
    return { until: new Date(new Date(oldest).getTime() + 7 * 86_400_000 + 60_000).toISOString(), reason: `${ACCOUNT_LIMITS.messagesPerWeek} messages to this account in the last 7 days` };
  }
  return null;
}

/** A task left in `sending` (worker died mid-call) is reconciled from its operation record. */
async function recoverStrandedSends(store: Store): Promise<void> {
  const sending = await store.listOutreach({ status: "sending" });
  const now = nowIso();
  for (const task of sending) {
    const op = await store.getOperation(`send:${task.id}`);
    if (!op) {
      await store.updateOutreach({ ...task, status: "scheduled" });
    } else if (op.status === "succeeded") {
      await store.updateOutreach({ ...task, status: "sent", sentAt: task.sentAt ?? op.updatedAt, externalId: op.remoteId ?? task.externalId, completionMode: "provider" });
    } else if (op.status === "dead") {
      await store.updateOutreach({ ...task, status: "failed", lastError: op.lastError, attempts: op.attempts });
    } else if (op.status !== "running" || (op.leaseUntil && op.leaseUntil < now)) {
      await store.updateOutreach({ ...task, status: "scheduled", scheduledFor: op.nextAttemptAt ?? now, attempts: op.attempts });
    }
  }
}

/**
 * After an engagement spike, rewrite the next scheduled sequence email so it
 * references what the prospect just did. Committed tasks and paused accounts are left alone.
 */
export async function adaptNextTouch(store: Store, account: Account, reason: string, lines: string[]): Promise<OutreachTouch | null> {
  if (isPaused(account)) return null;
  const next = (await store.listOutreach({ accountId: account.id, status: "scheduled" })).find((t: Task) => t.channel === "email" && t.source !== "conversation" && t.source !== "rep");
  if (!next) return null;
  const first = account.contact?.name.split(" ")[0] ?? "there";
  const hint = lines[0] ? lines[0].replace(/^Viewed personalized page.*$/, "spent time on the page we built for you").replace(/^Watched/, "watched").replace(/^Used/, "used") : reason;
  const body = `${first}, saw you ${hint.charAt(0).toLowerCase()}${hint.slice(1)}. Happy to walk through the numbers on a quick call.\n\n${next.body}`;
  const updated: OutreachTouch = { ...next, body, note: `adapted after: ${reason}`, scheduledFor: new Date(Date.now() + 30 * 60_000).toISOString() };
  await store.updateOutreach(updated);
  return updated;
}
