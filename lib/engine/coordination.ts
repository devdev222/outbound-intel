import type { Providers } from "@/lib/providers";
import type { Store } from "@/lib/store";
import type { Account, BuyingContact, ScoringModel, Task } from "@/lib/types";
import { nowIso, uuid } from "@/lib/util";
import { logActivity } from "./activity";
import { newContact, replaceContact, ROLE_ANGLE, ROLE_LABEL, ROLE_PURPOSE, selectGroup, applyCoverage, planFor, verifyContact } from "./buying-group";
import { MESSAGE_CHANNELS } from "./tasks";

/**
 * Outreach coordinator. One account, several people: sequences are staggered,
 * personalized by responsibility, spaced so two people at the same company
 * never get messages the same day, and capped account-wide per week. What one
 * person does (reply, meeting, opt-out, wrong contact, referral) updates that
 * person and is coordinated across the rest of the group.
 */

export const ACCOUNT_LIMITS = {
  /** Messages (email, LinkedIn, InMail) to anyone at the account per calendar day. */
  messagesPerDay: 1,
  /** Messages to anyone at the account in any rolling 7 days. */
  messagesPerWeek: 5,
  /** Other people's outreach is held this long after someone replies, unless a rep resumes it. */
  holdAfterReplyDays: 5,
};

const DAY = 86_400_000;
const dayOf = (iso: string) => Math.floor(new Date(iso).getTime() / DAY);
const isMessage = (t: Pick<Task, "channel">) => MESSAGE_CHANNELS.includes(t.channel);

/**
 * Space a group's touches under the account-wide limits. Contacts are placed
 * in group order; when a message has to move, the rest of that person's
 * sequence moves with it so their own gaps are kept. `existing` are tasks
 * already on the account (scheduled or sent) that count toward the limits.
 */
export function coordinateSchedule(groups: { contactId: string; touches: Task[] }[], existing: Pick<Task, "channel" | "scheduledFor" | "sentAt" | "status">[] = [], limits = ACCOUNT_LIMITS): Task[] {
  const occupied: number[] = existing.filter((t) => isMessage(t) && !["skipped", "failed"].includes(t.status)).map((t) => dayOf(t.sentAt ?? t.scheduledFor));
  const count = (from: number, to: number) => occupied.filter((d) => d >= from && d <= to).length;
  const fits = (d: number) => count(d, d) < limits.messagesPerDay && Array.from({ length: 7 }, (_, k) => d - 6 + k).every((s) => count(s, s + 6) < limits.messagesPerWeek);
  const out: Task[] = [];
  for (const g of groups) {
    let shift = 0;
    for (const t of [...g.touches].sort((a, b) => a.step - b.step)) {
      const orig = dayOf(t.scheduledFor);
      let d = orig + shift;
      if (isMessage(t)) {
        while (!fits(d)) d++;
        occupied.push(d);
        shift = d - orig;
      }
      const moved = d - orig;
      out.push(moved ? { ...t, scheduledFor: new Date(new Date(t.scheduledFor).getTime() + moved * DAY).toISOString(), note: [t.note, `moved ${moved} day${moved === 1 ? "" : "s"} to keep account-wide spacing`].filter(Boolean).join("; ") } : t);
    }
  }
  return out.sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor));
}

const ROLE_LINE: Record<BuyingContact["role"], string> = {
  economic_buyer: "For leadership the question is usually the cost of growing volume without growing coordination headcount.",
  operational_owner: "For the team running transportation, it means tendering, tracking and exceptions come off your plate.",
  champion: "For whoever is on the phone with carriers every day, it means fewer calls, fewer spreadsheets and fewer late-load escalations.",
  supporting: "It plugs into your current process and systems without a big rollout.",
};

/** Personalize one person's touches by their responsibility and label them with who they are for. */
export function personalizeForRole(touches: Task[], contact: BuyingContact): Task[] {
  const first = contact.person.name.split(" ")[0];
  const role = ROLE_LABEL[contact.role].toLowerCase();
  let firstEmail = true;
  return touches.map((t) => {
    let body = t.body;
    if (t.channel === "email" && firstEmail) {
      firstEmail = false;
      const i = body.indexOf("\n\n");
      if (i > 0 && !body.includes(ROLE_LINE[contact.role])) {
        const j = body.indexOf("\n\n", i + 2);
        body = j > 0 ? `${body.slice(0, j)} ${ROLE_LINE[contact.role]}${body.slice(j)}` : `${body}\n\n${ROLE_LINE[contact.role]}`;
      }
    }
    if (t.channel === "call") body = `${body}\nWho: ${contact.person.name}, ${contact.person.title} (${role}: ${ROLE_PURPOSE[contact.role]}).\nLead with: ${ROLE_ANGLE[contact.role]}.`;
    return { ...t, body, contactId: contact.id, title: `${t.title ?? `Step ${t.step}`} · ${first} (${role})` };
  });
}

/** Number steps across the whole group in date order (one sequence per account at the Sequencer). */
export function renumber(touches: Task[], from = 1): Task[] {
  return [...touches].sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor)).map((t, i) => ({ ...t, step: from + i }));
}

// --- Signals from one person, coordinated across the group --------------------------------

export type ContactSignal =
  | { kind: "replied"; detail?: string }
  | { kind: "meeting"; detail?: string }
  | { kind: "opted_out"; detail?: string }
  | { kind: "wrong_contact"; detail?: string }
  | { kind: "referred"; detail?: string; referral: { name: string; title: string; email?: string | null; linkedin?: string | null } };

const OPEN = ["scheduled", "awaiting_approval", "manual"] as const;
const isOpenSequence = (t: Task) => (OPEN as readonly string[]).includes(t.status) && (t.source === "sequence" || t.source === undefined);

/**
 * Apply what one person did and coordinate the rest of the group:
 *   replied        -> their own sequence stops (a rep takes over); others are held for a few days; a rep task to coordinate
 *   meeting        -> every remaining sequence step at the account stops; others become context for the meeting
 *   opted_out      -> only that person stops and is never contacted again; the group continues; the role becomes a gap
 *   wrong_contact  -> that person is replaced (history kept, tasks held) and the role refilled
 *   referred       -> the referred person becomes a candidate, verified like anyone else
 */
export async function coordinateSignal(store: Store, providers: Providers, contactId: string, signal: ContactSignal, by: string, model: ScoringModel | null = null): Promise<{ contact: BuyingContact | null; changed: string[] }> {
  const contact = await store.getContact(contactId);
  if (!contact) return { contact: null, changed: [] };
  const account = await store.getAccountById(contact.accountId);
  if (!account) return { contact, changed: [] };
  const at = nowIso();
  const tasks = await store.listOutreach({ accountId: account.id });
  const others = (await store.listContacts({ accountId: account.id })).filter((c) => c.id !== contactId && ["selected", "paused"].includes(c.status));
  const changed: string[] = [];
  const first = contact.person.name.split(" ")[0];

  const skip = async (pred: (t: Task) => boolean, note: string) => {
    let n = 0;
    for (const t of tasks) if (isOpenSequence(t) && pred(t)) {
      await store.updateOutreach({ ...t, status: "skipped", note });
      n++;
    }
    return n;
  };

  switch (signal.kind) {
    case "replied": {
      if (contact.engagement.replied && contact.outreach.heldReason === "replied") return { contact, changed };
      await store.patchContact(contactId, (c) => ({ ...c, engagement: { ...c.engagement, replied: true, lastEventAt: at }, outreach: { ...c.outreach, heldReason: "replied" } }));
      const n = await skip((t) => t.contactId === contactId, `${first} replied; the rep takes it from here`);
      const until = new Date(Date.now() + ACCOUNT_LIMITS.holdAfterReplyDays * DAY).toISOString();
      for (const o of others.filter((o) => o.status === "selected")) {
        await store.patchContact(o.id, (c) => ({ ...c, status: "paused", outreach: { ...c.outreach, heldReason: `${first} replied`, heldUntil: until } }));
        changed.push(`${o.person.name} held until ${until.slice(0, 10)}`);
      }
      await insertCoordinationTask(store, account, contact, `Coordinate: ${first} replied`, `${contact.person.name} (${ROLE_LABEL[contact.role].toLowerCase()}) replied${signal.detail ? `: ${signal.detail}` : ""}.\n\nOutreach to ${others.length ? others.map((o) => o.person.name).join(", ") : "the rest of the group"} is held until ${until.slice(0, 10)}. Decide whether to ask ${first} to bring them in, resume them, or keep them paused.`);
      changed.unshift(`${n} remaining step${n === 1 ? "" : "s"} for ${contact.person.name} stopped`);
      break;
    }
    case "meeting": {
      await store.patchContact(contactId, (c) => ({ ...c, engagement: { ...c.engagement, meeting: true, lastEventAt: at }, outreach: { ...c.outreach, heldReason: "meeting booked" } }));
      const n = await skip(() => true, `meeting booked with ${contact.person.name}; group sequence stopped`);
      for (const o of others) await store.patchContact(o.id, (c) => ({ ...c, status: "paused", outreach: { ...c.outreach, heldReason: `meeting booked with ${first}`, heldUntil: null } }));
      changed.push(`${n} sequence step${n === 1 ? "" : "s"} stopped across the group`, ...others.map((o) => `${o.person.name} paused (invite them through ${first})`));
      break;
    }
    case "opted_out": {
      await store.patchContact(contactId, (c) => ({ ...c, status: "opted_out", ready: false, engagement: { ...c.engagement, optedOut: true }, outreach: { ...c.outreach, order: null, heldReason: "opted out" } }));
      const n = await skip((t) => t.contactId === contactId, `${contact.person.name} opted out`);
      const fresh = (await store.getAccountById(account.id)) ?? account;
      const { coverage, selected } = await selectGroup(store, fresh, fresh.buyingGroup?.plan ?? planFor(fresh, model));
      await applyCoverage(store, fresh, coverage, selected);
      changed.push(`${n} step${n === 1 ? "" : "s"} for ${contact.person.name} stopped; others continue`, coverage.summary);
      break;
    }
    case "wrong_contact": {
      const r = await replaceContact(store, providers, contactId, signal.detail ?? "marked wrong", by, model);
      changed.push(r.replacement ? `${r.replacement.person.name} takes the ${ROLE_LABEL[contact.role].toLowerCase()} role` : "researching a replacement");
      break;
    }
    case "referred": {
      const person = { name: signal.referral.name, title: signal.referral.title, seniority: "manager" as const, email: signal.referral.email ?? undefined, linkedin: signal.referral.linkedin ?? undefined };
      const existing = (await store.listContacts({ accountId: account.id })).find((c) => c.person.name.toLowerCase() === person.name.toLowerCase());
      if (existing) {
        changed.push(`${person.name} is already tracked (${existing.status})`);
        break;
      }
      const c = await store.upsertContact(newContact(account, person, "referral", { referredBy: contactId }));
      await store.patchContact(c.id, (cur) => ({ ...cur, roleEvidence: [`Referred by ${contact.person.name} (${contact.person.title})${signal.detail ? `: ${signal.detail}` : ""}`, ...cur.roleEvidence] }));
      await verifyContact(store, providers, account, (await store.getContact(c.id)) ?? c);
      const fresh = (await store.getAccountById(account.id)) ?? account;
      const { coverage, selected } = await selectGroup(store, fresh, fresh.buyingGroup?.plan ?? planFor(fresh, model));
      await applyCoverage(store, fresh, coverage, selected);
      changed.push(`${person.name} (${person.title}) added as a candidate from ${first}'s referral`, coverage.summary);
      break;
    }
  }
  await logActivity(store, account.id, "system", `contact_${signal.kind}`, `${contact.person.name}: ${signal.kind.replace("_", " ")}${by ? ` (${by})` : ""}`, changed);
  return { contact: await store.getContact(contactId), changed };
}

async function insertCoordinationTask(store: Store, account: Account, contact: BuyingContact, title: string, body: string): Promise<void> {
  await store.insertOutreach([
    {
      id: uuid(),
      accountId: account.id,
      contactId: contact.id,
      channel: "call",
      step: 95,
      body,
      status: "manual",
      scheduledFor: nowIso(),
      provider: "pending",
      source: "rep",
      title,
      assigneeRepId: account.ownerRepId ?? null,
      attempts: 0,
      lastError: null,
    },
  ]);
}

/** Resume a held person (rep decision, or automatically once the hold window ends). */
export async function resumeContact(store: Store, contactId: string, by: string): Promise<BuyingContact | null> {
  const c = await store.patchContact(contactId, (cur) => (cur.status === "paused" ? { ...cur, status: "selected", outreach: { ...cur.outreach, heldReason: null, heldUntil: null } } : null));
  if (c) await logActivity(store, c.accountId, "rep", "contact_resumed", `Outreach to ${c.person.name} resumed by ${by}`);
  return c;
}

/** Holds with an end date that has passed are lifted (run by the Campaign Agent). */
export async function liftExpiredHolds(store: Store, at = nowIso()): Promise<number> {
  let n = 0;
  for (const c of await store.listContacts({ status: "paused" })) {
    if (c.outreach.heldUntil && c.outreach.heldUntil <= at) {
      await resumeContact(store, c.id, "coordinator (hold window ended)");
      n++;
    }
  }
  return n;
}
