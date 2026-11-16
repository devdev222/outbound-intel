import { config } from "@/lib/config";
import type { Providers } from "@/lib/providers";
import { listTrellusCalls, type TrellusCall } from "@/lib/providers/vendors/trellus";
import type { Store } from "@/lib/store";
import type { BuyingContact } from "@/lib/types";
import { nowIso, uuid } from "@/lib/util";
import { logActivity } from "./activity";
import { normalizePhone } from "./contact-fields";
import { coordinateSignal } from "./coordination";
import { recordEngagement } from "./engagement";
import { idempotent } from "./idempotency";

/**
 * Pull finished calls from Trellus and credit each one to the right person:
 * matched by phone number, then by name. Each call is recorded once
 * (operation trellus:<session id>) as a call_completed event with the
 * disposition and notes. A do-not-call disposition opts that person out;
 * when Trellus detects that a meeting was agreed, the rep gets a task to
 * confirm and log it (the detection is a signal, not a booking).
 */

const MIN_INTERVAL_MS = 5 * 60_000;
let lastRun = 0;

export interface CallSyncResult {
  fetched: number;
  recorded: number;
  unmatched: number;
  skipped: boolean;
}

export async function syncTrellusCalls(store: Store, providers: Providers, opts: { force?: boolean } = {}): Promise<CallSyncResult> {
  if (!config.trellus.apiKey) return { fetched: 0, recorded: 0, unmatched: 0, skipped: true };
  if (!opts.force && Date.now() - lastRun < MIN_INTERVAL_MS) return { fetched: 0, recorded: 0, unmatched: 0, skipped: true };
  lastRun = Date.now();
  const calls = await listTrellusCalls(Date.now() - config.trellus.syncHours * 3_600_000);
  const contacts = await store.listContacts({ status: ["selected", "paused", "candidate"] });
  let recorded = 0;
  let unmatched = 0;
  for (const call of calls) {
    const who = matchContact(call, contacts);
    if (!who) {
      unmatched++;
      continue;
    }
    const r = await idempotent(store, "trellus", call.sessionId, () => recordCall(store, providers, call, who), { accountId: who.accountId });
    if (r.state === "done" && !r.replayed) recorded++;
  }
  return { fetched: calls.length, recorded, unmatched, skipped: false };
}

export function matchContact(call: Pick<TrellusCall, "phone" | "name">, contacts: BuyingContact[]): BuyingContact | null {
  const digits = call.phone ? normalizePhone(call.phone) : "";
  if (digits.length >= 7) {
    const byPhone = contacts.find((c) => c.person.phone && normalizePhone(c.person.phone).endsWith(digits.slice(-10)));
    if (byPhone) return byPhone;
  }
  const name = call.name?.trim().toLowerCase();
  if (name) {
    const byName = contacts.filter((c) => c.person.name.trim().toLowerCase() === name);
    if (byName.length === 1) return byName[0];
  }
  return null;
}

async function recordCall(store: Store, providers: Providers, call: TrellusCall, who: BuyingContact): Promise<{ sessionId: string }> {
  const account = await store.getAccountById(who.accountId);
  if (!account) return { sessionId: call.sessionId };
  const minutes = Math.round(call.durationSec / 6) / 10;
  await recordEngagement(store, providers, account, {
    eventType: "call_completed",
    properties: { sessionId: call.sessionId, disposition: call.disposition, durationSec: call.durationSec, notes: call.notes?.slice(0, 500) ?? null, meetingDetected: call.meetingDetected, source: "trellus" },
    source: "provider",
    contactId: who.id,
  });
  await logActivity(store, account.id, "webhook", "call_completed", `Trellus call with ${who.person.name}: ${call.disposition ?? "no disposition"} (${minutes} min)`, [call.notes?.slice(0, 300) ?? ""]);
  if (call.disposition && /do not call|\bdnc\b|remove me/i.test(call.disposition)) {
    await coordinateSignal(store, providers, who.id, { kind: "opted_out", detail: `Trellus disposition: ${call.disposition}` }, "trellus");
  }
  if (call.meetingDetected) {
    await store.insertOutreach([
      {
        id: uuid(),
        accountId: account.id,
        contactId: who.id,
        channel: "meeting",
        step: 96,
        body: `Trellus detected that a meeting was agreed on the ${call.startedAt.slice(0, 10)} call with ${who.person.name}.${call.notes ? `\n\nNotes: ${call.notes.slice(0, 800)}` : ""}\n\nConfirm the time and log the meeting so it is credited and synced to the CRM.`,
        status: "manual",
        scheduledFor: nowIso(),
        provider: "pending",
        source: "rep",
        title: `Confirm the meeting with ${who.person.name.split(" ")[0]} (Trellus)`,
        assigneeRepId: account.ownerRepId ?? null,
        attempts: 0,
        lastError: null,
      },
    ]);
  }
  return { sessionId: call.sessionId };
}

/** Test hook: let the next sync run immediately. */
export function resetCallSyncThrottle(): void {
  lastRun = 0;
}
