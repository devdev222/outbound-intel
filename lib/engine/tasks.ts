import type { Providers } from "@/lib/providers";
import type { Store } from "@/lib/store";
import type { Account, EngagementEvent, OutreachChannel, Task, TaskSource, TaskStatus, User } from "@/lib/types";
import { nowIso, uuid } from "@/lib/util";
import { logActivity } from "./activity";
import { runOperation } from "./operations";

/**
 * The one authoritative task lifecycle.
 *
 *   awaiting_approval --approve--> scheduled --(scheduler / Send email)--> sending --ack--> sent
 *                                         \--(no provider for channel)--> manual --Mark done/sent--> done | sent
 *   any open status --skip--> skipped;  delivery exhausted / permanent error --> failed (retryable by a person)
 *
 * Approving never marks a task sent. Only a provider acknowledgment (completionMode
 * "provider") or a person recording work done outside the platform
 * (completionMode "manual") moves a task to sent/done.
 */

export const OPEN_STATUSES: TaskStatus[] = ["awaiting_approval", "scheduled", "sending", "manual", "failed"];
export const MAX_SEND_ATTEMPTS = 4;
/** Sources that represent a commitment by a person; rescoring never replaces them. */
export const COMMITTED_SOURCES: TaskSource[] = ["rep", "conversation", "prospect"];

export const MESSAGE_CHANNELS: OutreachChannel[] = ["email", "linkedin", "inmail"];

export function isOpen(t: Task): boolean {
  return OPEN_STATUSES.includes(t.status);
}

export function providerCanSend(providers: Providers, channel: OutreachChannel): boolean {
  return providers.outreach.channels.includes(channel) && MESSAGE_CHANNELS.includes(channel);
}

/** What the primary button for a task does, given its state and the active adapter. */
export type TaskAction = "review_approve" | "send_email" | "mark_sent" | "mark_done" | "retry" | "none";

export function primaryActionFor(t: Task, providers: Providers): TaskAction {
  if (t.status === "awaiting_approval") return "review_approve";
  if (t.status === "failed") return providerCanSend(providers, t.channel) ? "retry" : MESSAGE_CHANNELS.includes(t.channel) ? "mark_sent" : "mark_done";
  if (t.status === "scheduled") return providerCanSend(providers, t.channel) && !providers.outreach.ownsScheduling ? "send_email" : "none";
  if (t.status === "manual") return MESSAGE_CHANNELS.includes(t.channel) || t.channel === "gift" ? "mark_sent" : "mark_done";
  return "none";
}

export function taskUrlFor(account: Account, channel: OutreachChannel): string | undefined {
  if (channel === "linkedin" || channel === "inmail") return account.contact?.linkedin ?? undefined;
  if (channel === "email" || channel === "estimate") return account.contact?.email ? `mailto:${account.contact.email}` : undefined;
  if (channel === "call") return account.contact?.phone ? `tel:${account.contact.phone.replace(/[^\d+]/g, "")}` : undefined;
  return undefined;
}

export interface NewTask {
  /** Stable id for idempotent creation (prospect submissions retried by the browser). */
  id?: string;
  account: Account;
  channel: OutreachChannel;
  title: string;
  body: string;
  subject?: string;
  dueAt?: string;
  status: TaskStatus;
  source: TaskSource;
  step?: number;
  note?: string;
  conversationId?: string | null;
  assigneeRepId?: string | null;
}

export async function createTask(store: Store, input: NewTask): Promise<Task> {
  const task: Task = {
    id: input.id ?? uuid(),
    accountId: input.account.id,
    channel: input.channel,
    step: input.step ?? 0,
    subject: input.subject,
    body: input.body,
    status: input.status,
    scheduledFor: input.dueAt ?? nowIso(),
    provider: "pending",
    note: input.note,
    taskUrl: taskUrlFor(input.account, input.channel),
    title: input.title,
    source: input.source,
    assigneeRepId: input.assigneeRepId ?? input.account.ownerRepId ?? null,
    attempts: 0,
    lastError: null,
    conversationId: input.conversationId ?? null,
  };
  await store.insertOutreach([task]);
  return task;
}

async function emit(store: Store, accountId: string, eventType: string, task: Task, provider: string): Promise<void> {
  const ev: EngagementEvent = { id: uuid(), accountId, eventType, properties: { step: task.step, channel: task.channel, provider, touchId: task.id }, visitorId: null, createdAt: nowIso() };
  await store.insertEvent(ev);
}

function sentEventFor(channel: OutreachChannel): string {
  return channel === "email" ? "email_sent" : channel === "gift" ? "gift_sent" : channel === "linkedin" || channel === "inmail" ? "linkedin_sent" : `${channel}_done`;
}

// --- Delivery -----------------------------------------------------------------------

export type DeliveryResult = { state: "sent" | "retry_scheduled" | "failed" | "busy" | "not_due"; task: Task; error?: string };

/**
 * Deliver one task through the provider under a durable operation keyed
 * `send:<taskId>`. Two workers cannot both send it; a replayed success just
 * records the earlier acknowledgment.
 */
export async function deliverTask(store: Store, providers: Providers, task: Task, account: Account): Promise<DeliveryResult> {
  const sending: Task = { ...task, status: "sending" };
  const outcome = await runOperation(store, { id: `send:${task.id}`, kind: "send", accountId: account.id, destination: providers.outreach.name, maxAttempts: MAX_SEND_ATTEMPTS }, async (key) => {
    await store.updateOutreach(sending);
    const r = await providers.outreach.sendTouch(account, task, key);
    if (r.status !== "sent") {
      const err = new Error(r.note ?? "provider did not accept the message") as Error & { permanent?: boolean };
      if (r.retryable === false) err.permanent = true;
      throw err;
    }
    return { remoteId: r.externalId ?? null, result: { note: r.note ?? null, provider: providers.outreach.name } };
  });

  if (outcome.state === "busy" || outcome.state === "not_due") {
    return { state: outcome.state, task };
  }
  if (outcome.state === "succeeded") {
    const done: Task = { ...task, status: "sent", sentAt: task.sentAt ?? nowIso(), externalId: outcome.remoteId ?? task.externalId, provider: providers.outreach.name, completionMode: "provider", attempts: outcome.op.attempts, lastError: null, note: (outcome.result.note as string | null) ?? task.note };
    await store.updateOutreach(done);
    if (!outcome.replayed) {
      await emit(store, account.id, sentEventFor(task.channel), task, providers.outreach.name);
      await logActivity(store, account.id, "system", "task_sent", `${task.title ?? `Step ${task.step} ${task.channel}`} delivered via ${providers.outreach.name}`, [task.subject ?? ""]);
    }
    return { state: "sent", task: done };
  }
  // failed
  if (outcome.retryable) {
    const retry: Task = { ...task, status: "scheduled", attempts: outcome.attempts, lastError: outcome.error, scheduledFor: outcome.op.nextAttemptAt ?? task.scheduledFor, note: `delivery attempt ${outcome.attempts} failed; retrying automatically` };
    await store.updateOutreach(retry);
    return { state: "retry_scheduled", task: retry, error: outcome.error };
  }
  const failed: Task = { ...task, status: "failed", attempts: outcome.attempts, lastError: outcome.error, note: "delivery failed; retry or mark sent manually" };
  await store.updateOutreach(failed);
  await logActivity(store, account.id, "system", "task_failed", `${task.title ?? `Step ${task.step} ${task.channel}`} could not be delivered`, [outcome.error]);
  return { state: "failed", task: failed, error: outcome.error };
}

// --- Commands (API, UI and MCP all call these) ---------------------------------------

export class TaskError extends Error {
  constructor(
    message: string,
    readonly status = 409,
  ) {
    super(message);
  }
}

async function load(store: Store, id: string): Promise<{ task: Task; account: Account }> {
  const task = await store.getOutreach(id);
  if (!task) throw new TaskError("unknown task", 404);
  const account = await store.getAccountById(task.accountId);
  if (!account) throw new TaskError("task account no longer exists", 404);
  return { task, account };
}

/** Review & approve: awaiting_approval -> scheduled (provider channel) or manual (no provider). Never sends. */
export async function approveTask(store: Store, providers: Providers, id: string, user: User, edits?: { subject?: string; body?: string; dueAt?: string }): Promise<Task> {
  const { task, account } = await load(store, id);
  if (task.status !== "awaiting_approval") throw new TaskError(`task is ${task.status}, not awaiting approval`);
  const status: TaskStatus = providerCanSend(providers, task.channel) ? "scheduled" : "manual";
  const updated: Task = {
    ...task,
    subject: edits?.subject ?? task.subject,
    body: edits?.body ?? task.body,
    scheduledFor: edits?.dueAt ?? (task.scheduledFor > nowIso() ? task.scheduledFor : nowIso()),
    status,
    approvedBy: user.name,
    approvedAt: nowIso(),
    note: status === "scheduled" ? `approved by ${user.name}; scheduled for delivery` : `approved by ${user.name}; send it yourself, then mark it sent`,
  };
  await store.updateOutreach(updated);
  await logActivity(store, account.id, "rep", "task_approved", `${user.name} approved "${task.title ?? task.subject ?? task.channel}" (${status === "scheduled" ? "scheduled, not yet sent" : "manual send"})`);
  return updated;
}

/** Send email: request provider delivery now. Returns the post-attempt task. */
export async function sendTaskNow(store: Store, providers: Providers, id: string, user: User): Promise<DeliveryResult> {
  const { task, account } = await load(store, id);
  if (!["scheduled", "failed"].includes(task.status)) throw new TaskError(`task is ${task.status}; only scheduled or failed tasks can be sent`);
  if (!providerCanSend(providers, task.channel)) throw new TaskError(`no provider can send ${task.channel}; mark it sent manually instead`);
  if (providers.outreach.ownsScheduling) throw new TaskError("the Sequencer owns delivery for this account");
  if (account.pausedUntil && account.pausedUntil > nowIso()) throw new TaskError(`outreach is paused until ${account.pausedUntil.slice(0, 10)} (${account.pauseReason ?? "deferred"})`);
  if (task.status === "failed") {
    const { resetOperation } = await import("./operations");
    await resetOperation(store, `send:${task.id}`);
  }
  await logActivity(store, account.id, "rep", "task_send_requested", `${user.name} requested delivery of "${task.title ?? task.subject ?? task.channel}"`);
  return deliverTask(store, providers, { ...task, scheduledFor: nowIso() }, account);
}

/** Mark manually sent / done: work completed outside the platform. */
export async function completeManually(store: Store, id: string, user: User, note?: string): Promise<Task> {
  const { task, account } = await load(store, id);
  if (!isOpen(task)) throw new TaskError(`task is already ${task.status}`);
  if (task.status === "sending") throw new TaskError("delivery is in progress; wait for the provider result");
  const message = MESSAGE_CHANNELS.includes(task.channel) || task.channel === "gift";
  const updated: Task = { ...task, status: message ? "sent" : "done", sentAt: nowIso(), completedBy: user.name, completionMode: "manual", note: note ?? `${message ? "sent" : "done"} outside the platform by ${user.name}` };
  await store.updateOutreach(updated);
  await emit(store, account.id, sentEventFor(task.channel), task, "manual");
  await logActivity(store, account.id, "rep", "task_done_manually", `${user.name} recorded "${task.title ?? task.channel}" as ${message ? "sent" : "done"} outside the platform`, note ? [note] : []);
  return updated;
}

export async function skipTask(store: Store, id: string, user: User, reason?: string): Promise<Task> {
  const { task, account } = await load(store, id);
  if (!isOpen(task) || task.status === "sending") throw new TaskError(`task is ${task.status}`);
  const updated: Task = { ...task, status: "skipped", completedBy: user.name, note: reason ?? `skipped by ${user.name}` };
  await store.updateOutreach(updated);
  await logActivity(store, account.id, "rep", "task_skipped", `${user.name} skipped "${task.title ?? task.channel}"`, reason ? [reason] : []);
  return updated;
}

export async function rescheduleTask(store: Store, id: string, user: User, dueAt: string): Promise<Task> {
  const { task, account } = await load(store, id);
  if (!isOpen(task) || task.status === "sending") throw new TaskError(`task is ${task.status}`);
  const updated: Task = { ...task, scheduledFor: dueAt, note: `rescheduled by ${user.name}` };
  await store.updateOutreach(updated);
  await logActivity(store, account.id, "rep", "task_rescheduled", `${user.name} moved "${task.title ?? task.channel}" to ${dueAt.slice(0, 10)}`);
  return updated;
}

/** Open committed tasks (rep/conversation/prospect) for an account, earliest first. */
export function committedOpenTasks(tasks: Task[]): Task[] {
  return tasks.filter((t) => isOpen(t) && t.source && COMMITTED_SOURCES.includes(t.source)).sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor));
}
