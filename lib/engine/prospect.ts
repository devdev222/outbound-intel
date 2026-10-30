import type { Providers } from "@/lib/providers";
import type { Store } from "@/lib/store";
import type { Account, Task } from "@/lib/types";
import { logActivity } from "./activity";
import { recordOutcome } from "./outcomes";
import { createTask } from "./tasks";
import { deterministicUuid } from "@/lib/util";

/**
 * Prospect submissions from the personalized page and the assessment. Each one
 * is an awaited business command with its own validated endpoint, not tracking
 * telemetry, so the page only shows success after the record exists.
 */

export interface MeetingRequestInput {
  /** Client-generated id; a retried submission returns the original task instead of creating another. */
  requestId: string;
  name: string;
  email: string;
  note?: string;
  preferredTimes?: string;
}

/**
 * "Send me times": records `meeting_requested` (NOT a booked meeting) and creates an
 * assigned scheduling task due now. `meeting_booked` is reserved for confirmed appointments
 * (calendar webhook or a rep confirming a time).
 */
export async function requestMeeting(store: Store, providers: Providers, account: Account, input: MeetingRequestInput): Promise<{ task: Task; replayed: boolean }> {
  const id = deterministicUuid(`prospect:meeting:${account.id}:${input.requestId}`);
  const existing = await store.getOutreach(id);
  if (existing) return { task: existing, replayed: true };
  let current = account;
  if (account.contact && !account.contact.email) {
    current = await store.upsertAccount({ ...account, contact: { ...account.contact, email: input.email } });
  }
  const task = await createTask(store, {
    id,
    account: current,
    channel: "meeting",
    title: `Send ${input.name.split(" ")[0] || "the prospect"} meeting times`,
    body: `${input.name} <${input.email}> asked for meeting times from the personalized page.${input.preferredTimes ? `\nPreferred: ${input.preferredTimes}` : ""}${input.note ? `\nNote: ${input.note}` : ""}\n\nReply with two or three options, then confirm the booking.`,
    status: "manual",
    source: "prospect",
    note: "meeting requested; not booked until a time is confirmed",
  });
  await store.updateOutreach({ ...task, taskUrl: `mailto:${encodeURIComponent(input.email)}` });
  await recordOutcome(store, providers, current, { outcomeType: "meeting_requested", notes: `${input.name} <${input.email}> requested times`, source: "prospect" });
  return { task, replayed: false };
}

export interface EstimateInput {
  requestId: string;
  name: string;
  email: string;
  inputs: Record<string, number | string>;
  results: Record<string, number | string>;
}

const fmt = (o: Record<string, unknown>) =>
  Object.entries(o)
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join(", ");

/** "Send me my estimate": an awaiting-approval email task with the prospect's numbers. */
export async function requestEstimate(store: Store, account: Account, input: EstimateInput): Promise<{ task: Task; replayed: boolean }> {
  const id = deterministicUuid(`prospect:estimate:${account.id}:${input.requestId}`);
  const existing = await store.getOutreach(id);
  if (existing) return { task: existing, replayed: true };
  let current = account;
  if (account.contact && !account.contact.email) current = await store.upsertAccount({ ...account, contact: { ...account.contact, email: input.email } });
  const task = await createTask(store, {
    id,
    account: current,
    channel: "email",
    title: `Send ${input.name.split(" ")[0] || "the prospect"} their estimate`,
    subject: `Your estimate, ${account.companyName}`,
    body: `${input.name || "Hi"},\n\nHere is the estimate you requested from the page we built for ${account.companyName}.\n\nInputs: ${fmt(input.inputs) || "n/a"}\nResults: ${fmt(input.results) || "n/a"}\n\nThese are estimates based on the numbers you entered, not measured results.\n\nWant to walk through it on a 15-minute call?`,
    status: "awaiting_approval",
    source: "prospect",
    note: `estimate requested by ${input.email}; review & approve to send`,
  });
  await logActivity(store, account.id, "system", "estimate_requested", "Prospect requested their estimate by email", [fmt(input.inputs), fmt(input.results)].filter(Boolean));
  return { task, replayed: false };
}
