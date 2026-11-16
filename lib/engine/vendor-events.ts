import { config } from "@/lib/config";
import type { Providers } from "@/lib/providers";
import { first, getCompany, getDeal, stageOutcomes, stageTitle, attioString } from "@/lib/providers/vendors/attio";
import { type Reveal, revealToResult } from "@/lib/providers/vendors/wiza";
import type { Store } from "@/lib/store";
import { suppressions } from "@/lib/store/collections";
import type { Account, BuyingContact, OutcomeType } from "@/lib/types";
import { nowIso, uuid } from "@/lib/util";
import { logActivity } from "./activity";
import { applyCoverage, planFor, selectGroup, verifyContact } from "./buying-group";
import { coordinateSignal } from "./coordination";
import { recordEngagement } from "./engagement";
import { recordOutcome } from "./outcomes";
import { MESSAGE_CHANNELS } from "./tasks";

/**
 * Inbound events from the sales stack, turned into the engine's own events,
 * always attributed to one person and one account. The webhook routes verify
 * and deduplicate; these functions do the work (and are what the tests drive).
 */

async function contactByEmail(store: Store, email: string | null | undefined): Promise<BuyingContact | null> {
  const e = email?.trim().toLowerCase();
  if (!e) return null;
  return (await store.listContacts()).find((c) => c.person.email?.toLowerCase() === e) ?? null;
}

const emailOf = (v: unknown): string | null => {
  if (typeof v === "string") return v.match(/[^\s<>"]+@[^\s<>"]+/)?.[0] ?? null;
  if (Array.isArray(v)) return emailOf(v[0]);
  if (v && typeof v === "object") return emailOf((v as { email?: unknown }).email);
  return null;
};

// --- Amplemarket JSON push --------------------------------------------------------------

export interface AmplemarketEventResult {
  matched: boolean;
  contactId: string | null;
  handled: string;
}

const CHANNEL_FOR_STAGE: Record<string, "email" | "linkedin" | "call"> = { email: "email", linkedin: "linkedin", linkedin_message: "linkedin", linkedin_connect: "linkedin", call: "call", phone_call: "call" };

/**
 * Sequence-stage, reply and workflow payloads. The person is found from the
 * oi_contact_id dynamic field we send with every lead, else by email.
 * Labels: ooo holds the person (an auto-reply is not a reply), hard_no opts
 * them out, not_the_right_person replaces them, a forward or introduction
 * asks the rep to add the new person, circle-back-later becomes a rep task.
 */
export async function handleAmplemarketEvent(store: Store, providers: Providers, p: Record<string, unknown>): Promise<AmplemarketEventResult> {
  const dyn = (p.dynamic_fields ?? {}) as Record<string, unknown>;
  const labels = (Array.isArray(p.labels) ? p.labels : Array.isArray((p.email_message as { tag?: unknown[] } | undefined)?.tag) ? (p.email_message as { tag: unknown[] }).tag : []).map((l) => String(l).toLowerCase().replace(/\s+/g, "_"));
  const isReply = p.is_reply === true || labels.length > 0 || Boolean(p.email_message);
  let contact: BuyingContact | null = typeof dyn.oi_contact_id === "string" ? await store.getContact(dyn.oi_contact_id) : null;
  if (!contact) contact = await contactByEmail(store, isReply ? (emailOf(p.from) ?? emailOf((p.lead as { email?: unknown } | undefined)?.email)) : emailOf(p.to));
  if (!contact) return { matched: false, contactId: null, handled: "no matching person" };
  const account = await store.getAccountById(contact.accountId);
  if (!account) return { matched: false, contactId: contact.id, handled: "account no longer exists" };
  const first = contact.person.name.split(" ")[0];
  const meta = { source: "amplemarket", sequence: (p.sequence as { name?: string } | undefined)?.name ?? null, subject: typeof p.subject === "string" ? p.subject : null };

  if (isReply) {
    if (labels.includes("ooo")) {
      const ret = (p.additional_info as { return_date?: string } | undefined)?.return_date;
      const until = ret && !Number.isNaN(Date.parse(ret)) ? new Date(ret).toISOString() : new Date(Date.now() + 7 * 86_400_000).toISOString();
      await recordEngagement(store, providers, account, { eventType: "email_auto_reply", properties: { ...meta, until }, source: "provider", contactId: contact.id });
      await store.patchContact(contact.id, (c) => (c.status === "selected" ? { ...c, status: "paused", outreach: { ...c.outreach, heldReason: "out of office", heldUntil: until } } : null));
      await logActivity(store, account.id, "webhook", "contact_out_of_office", `${contact.person.name} is out of office until ${until.slice(0, 10)}`, ["Amplemarket keeps running its own steps; pause the lead there if needed"]);
      return { matched: true, contactId: contact.id, handled: "out of office" };
    }
    await recordEngagement(store, providers, account, { eventType: "email_reply", properties: { ...meta, labels }, source: "provider", contactId: contact.id });
    if (labels.includes("hard_no")) {
      await coordinateSignal(store, providers, contact.id, { kind: "opted_out", detail: "replied with a hard no (Amplemarket)" }, "amplemarket");
      const email = contact.person.email?.toLowerCase();
      if (email && !(await suppressions.list()).some((s) => s.target.toLowerCase() === email)) await suppressions.put({ id: uuid(), target: email, reason: "opt_out", note: "hard no (Amplemarket reply label)", createdBy: "amplemarket", at: nowIso() });
      return { matched: true, contactId: contact.id, handled: "opted out" };
    }
    if (labels.includes("not_the_right_person")) {
      await coordinateSignal(store, providers, contact.id, { kind: "wrong_contact", detail: "replied: not the right person (Amplemarket)" }, "amplemarket", await store.getLatestModel());
      return { matched: true, contactId: contact.id, handled: "wrong person replaced" };
    }
    const repTask = labels.includes("forwarded_to_the_right_person") || labels.includes("introduction") ? `Add the person ${first} pointed you to` : labels.includes("asked_to_circle_back_later") ? `Circle back with ${first} later` : null;
    if (repTask) {
      await store.insertOutreach([{ id: uuid(), accountId: account.id, contactId: contact.id, channel: "email", step: 97, body: `${contact.person.name} replied in Amplemarket (${labels.join(", ")}).${meta.subject ? `\nSubject: ${meta.subject}` : ""}\n\nRead the reply in Amplemarket, then ${repTask.startsWith("Add") ? "add the person they named on the account's Contacts section (Add contact) so they are verified and sequenced" : "set the follow-up date"}.`, status: "manual", scheduledFor: nowIso(), provider: "pending", source: "rep", title: repTask, assigneeRepId: account.ownerRepId ?? null, attempts: 0, lastError: null }]);
    }
    return { matched: true, contactId: contact.id, handled: labels.length ? `reply (${labels.join(", ")})` : "reply" };
  }

  // A step Amplemarket ran: mark the matching task sent and count the touch.
  const stage = (p.sequence_stage ?? {}) as { index?: number; type?: string };
  const channel = CHANNEL_FOR_STAGE[String(stage.type ?? "").toLowerCase()] ?? "email";
  if (channel === "call") {
    const call = (p.call ?? {}) as { disposition?: string; duration?: number; recording_url?: string };
    await recordEngagement(store, providers, account, { eventType: "call_completed", properties: { ...meta, disposition: call.disposition ?? null, durationSec: call.duration ?? null }, source: "provider", contactId: contact.id });
    return { matched: true, contactId: contact.id, handled: "call" };
  }
  const sentAt = typeof p.date === "string" && !Number.isNaN(Date.parse(p.date)) ? new Date(p.date).toISOString() : nowIso();
  const mine = (await store.listOutreach({ accountId: account.id })).filter((t) => t.contactId === contact!.id && MESSAGE_CHANNELS.includes(t.channel) && (t.source === "sequence" || t.source === undefined)).sort((a, b) => a.step - b.step);
  const task = (stage.index && mine[stage.index - 1]) || mine.find((t) => t.channel === channel && t.status === "scheduled");
  if (task && task.status !== "sent") await store.updateOutreach({ ...task, status: "sent", sentAt, completionMode: "provider", note: `sent by Amplemarket${meta.sequence ? ` (${meta.sequence})` : ""}` });
  await store.patchContact(contact.id, (c) => ({ ...c, outreach: { ...c.outreach, touchesSent: c.outreach.touchesSent + 1, lastTouchAt: sentAt } }));
  await recordEngagement(store, providers, account, { eventType: channel === "linkedin" ? "linkedin_sent" : "email_sent", properties: { ...meta, step: stage.index ?? null, touchId: task?.id }, source: "provider", contactId: contact.id });
  return { matched: true, contactId: contact.id, handled: `${channel} step sent` };
}

// --- Attio deal changes ------------------------------------------------------------------

const OUTCOME_FOR: Record<string, OutcomeType | undefined> = { won: "deal_won", lost: "deal_lost", meeting: "opportunity_created" };

/**
 * A deal changed in Attio. Won, lost and in-progress stages become outcomes
 * on the matching account (by our opportunity id, else the deal's company
 * domain), credited to the deal's first person we know. They are not synced
 * back to Attio (that would loop), and an outcome already recorded for the
 * same opportunity is never recorded twice.
 */
export async function handleAttioEvent(store: Store, providers: Providers, ev: { event_type?: string; id?: { object_id?: string; record_id?: string } }): Promise<{ handled: string }> {
  if (!ev.event_type?.startsWith("record.") || !ev.id?.object_id || !ev.id.record_id) return { handled: "ignored" };
  const deal = await getDeal(ev.id.object_id, ev.id.record_id);
  const stage = stageTitle(deal);
  if (!stage) return { handled: "not a deal" };
  const outcomeType = OUTCOME_FOR[stageOutcomes()[stage.toLowerCase()] ?? ""];
  if (!outcomeType) return { handled: `stage ${stage} is not an outcome` };

  const ours = String(first(deal, config.attio.dealMatchAttribute)?.value ?? "");
  let account: Account | null = ours.startsWith("opp_") ? await store.getAccountById(ours.slice(4)) : null;
  if (!account) {
    const companyId = attioString(first(deal, "associated_company")?.target_record_id);
    const company = companyId ? await getCompany(companyId) : null;
    const domains = (company?.values.domains ?? []).map((d) => String((d as { domain?: string }).domain ?? "").toLowerCase()).filter(Boolean);
    account = domains.length ? ((await store.listAccounts()).find((a) => domains.includes(a.domain.toLowerCase())) ?? null) : null;
  }
  if (!account) return { handled: "no matching account" };
  const opportunityId = ours.startsWith("opp_") ? ours : `attio_${deal.id.record_id}`;
  if ((await store.listOutcomes({ accountId: account.id })).some((o) => o.outcomeType === outcomeType && (o.opportunityId ?? `opp_${account!.id}`) === opportunityId)) return { handled: "already recorded" };

  const value = Number(first(deal, "value")?.currency_value) || null;
  await recordOutcome(store, providers, account, { outcomeType, value, notes: `Attio deal moved to ${stage}`, source: "attio", opportunityId, syncToCrm: false });
  return { handled: `${outcomeType} recorded` };
}

// --- Wiza reveal callback ---------------------------------------------------------------

/** A reveal finished after enrichContact stopped polling: apply it to the person and refill coverage. */
export async function handleWizaReveal(store: Store, providers: Providers, contactId: string, reveal: Reveal): Promise<{ handled: string }> {
  const contact = await store.getContact(contactId);
  if (!contact) return { handled: "unknown contact" };
  const account = await store.getAccountById(contact.accountId);
  if (!account) return { handled: "account no longer exists" };
  if (reveal.status !== "finished") return { handled: `reveal ${reveal.status}` };
  const verified = await verifyContact(store, providers, account, contact, revealToResult(contact.person, reveal));
  const fresh = (await store.getAccountById(account.id)) ?? account;
  const { coverage, selected } = await selectGroup(store, fresh, fresh.buyingGroup?.plan ?? planFor(fresh, await store.getLatestModel()));
  await applyCoverage(store, fresh, coverage, selected);
  return { handled: verified.ready ? "verified" : `not verified: ${verified.blockers[0] ?? "unknown"}` };
}
