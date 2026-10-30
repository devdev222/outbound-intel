import type { Providers } from "@/lib/providers";
import type { Store } from "@/lib/store";
import type { Account, BuyingContact, BuyingGroupCoverage, Person, ScoringModel, Task } from "@/lib/types";
import { nowIso } from "@/lib/util";
import { logActivity } from "./activity";
import { applyCoverage, buildBuyingGroup, newContact, planFor, replaceContact, ROLE_LABEL, selectGroup, verifyContact } from "./buying-group";
import { isRejected, samePerson } from "./contact-fields";
import { resumeContact } from "./coordination";
import { isOpen } from "./tasks";

/**
 * Contact commands shared by the account page, REST (/api/accounts/:slug/contacts,
 * /api/contacts/:id) and the machine contracts / MCP tools, so every surface
 * has the same permissions, provenance and idempotency.
 */

export class ContactError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export interface ContactView {
  contact: BuyingContact;
  /** Open tasks for this person, earliest first. */
  openTasks: Task[];
  /** The one thing to do for this person now. */
  nextAction: string;
}

export interface CoverageView {
  accountId: string;
  slug: string;
  coverage: BuyingGroupCoverage | null;
  group: ContactView[];
  candidates: ContactView[];
  /** Replaced, rejected and opted-out people: kept with their history. */
  history: ContactView[];
  nextAction: string;
}

const TERMINAL = ["rejected", "replaced", "opted_out"];

export function contactNextAction(c: BuyingContact, open: Task[]): string {
  if (c.status === "opted_out") return "Opted out; never contact again";
  if (c.status === "rejected" || c.status === "replaced") return c.replacedBy ? "Replaced; history kept" : "Marked wrong; history kept";
  if (c.engagement.meeting) return "Meeting booked; prepare the brief";
  if (c.engagement.replied && !open.some((t) => t.source !== "sequence")) return `Answer ${c.person.name.split(" ")[0]}'s reply`;
  const committed = open.find((t) => t.source && t.source !== "sequence");
  if (committed) return committed.title ?? `${committed.channel} task`;
  if (c.status === "paused") return `Held: ${c.outreach.heldReason ?? "coordinating the group"}${c.outreach.heldUntil ? ` until ${c.outreach.heldUntil.slice(0, 10)}` : ""}`;
  if (c.status === "candidate") return c.ready ? "Verified; available if a role opens" : `Verify: ${c.blockers[0] ?? "pending"}`;
  const next = open[0];
  if (!next) return c.outreach.touchesSent ? "Sequence finished; call or wait for engagement" : "Sequence starts at the next launch";
  if (next.status === "awaiting_approval") return `Approve "${next.title ?? next.channel}"`;
  if (next.status === "manual" || next.status === "failed") return next.title ?? `${next.channel} task`;
  return `${next.title ?? next.channel} on ${next.scheduledFor.slice(0, 10)}`;
}

export async function coverageView(store: Store, account: Account): Promise<CoverageView> {
  const [contacts, tasks] = await Promise.all([store.listContacts({ accountId: account.id }), store.listOutreach({ accountId: account.id })]);
  const view = (c: BuyingContact): ContactView => {
    const openTasks = tasks.filter((t) => t.contactId === c.id && isOpen(t)).sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor));
    return { contact: c, openTasks, nextAction: contactNextAction(c, openTasks) };
  };
  const group = contacts.filter((c) => c.status === "selected" || c.status === "paused").sort((a, b) => (a.outreach.order ?? 99) - (b.outreach.order ?? 99)).map(view);
  const candidates = contacts.filter((c) => c.status === "candidate").sort((a, b) => Number(b.ready) - Number(a.ready) || b.roleConfidence - a.roleConfidence).map(view);
  const history = contacts.filter((c) => TERMINAL.includes(c.status)).map(view);
  const g = account.buyingGroup ?? null;
  const urgent = group.find((v) => /^(Answer|Approve|Call|Meeting)/.test(v.nextAction) || v.openTasks.some((t) => t.status === "manual" && t.scheduledFor <= nowIso()));
  const nextAction = urgent
    ? `${urgent.contact.person.name}: ${urgent.nextAction}`
    : g?.gaps.length
      ? `Find a ${ROLE_LABEL[g.gaps[0].role].toLowerCase()}: ${g.gaps[0].reason}`
      : group[0]
        ? `${group[0].contact.person.name}: ${group[0].nextAction}`
        : "Research the buying group";
  return { accountId: account.id, slug: account.slug, coverage: g, group, candidates, history, nextAction };
}

/** Research more: map new people, verify what is due, refill the plan. */
export async function researchContacts(store: Store, providers: Providers, account: Account, model: ScoringModel | null, by: string) {
  // A rep asking explicitly also refreshes everyone's verification (employment and details change).
  for (const c of await store.listContacts({ accountId: account.id, status: ["selected", "paused", "candidate"] })) {
    await store.patchContact(c.id, (cur) => ({ ...cur, verification: { ...cur.verification, checkedAt: null, attempts: 0, nextAttemptAt: null, lastError: null } }));
  }
  const r = await buildBuyingGroup(store, providers, account, model, { verifyLimit: 10 });
  await logActivity(store, account.id, "rep", "contacts_researched", `${by} asked for more contact research: ${r.coverage.summary}`, r.coverage.gaps.map((g) => `gap: ${ROLE_LABEL[g.role]}: ${g.reason}`));
  return r;
}

/** A person a rep knows about: verified like anyone else, then the coordinator decides where they fit. */
export async function addContact(store: Store, providers: Providers, account: Account, person: Pick<Person, "name" | "title"> & Partial<Person>, by: string, model: ScoringModel | null): Promise<BuyingContact> {
  if (isRejected(account, person)) throw new ContactError(`${person.name} was marked wrong for this account and cannot be re-added`, 409);
  const existing = (await store.listContacts({ accountId: account.id })).find((c) => samePerson(c.person, person));
  if (existing) return existing;
  const full: Person = { seniority: "manager", ...person };
  let c = await store.upsertContact(newContact(account, full, "rep", { roleEvidence: [`Added by ${by}`] }));
  c = await verifyContact(store, providers, account, c);
  const fresh = (await store.getAccountById(account.id)) ?? account;
  const { coverage, selected } = await selectGroup(store, fresh, fresh.buyingGroup?.plan ?? planFor(fresh, model));
  await applyCoverage(store, fresh, coverage, selected);
  await logActivity(store, account.id, "rep", "contact_added", `${by} added ${c.person.name} (${c.person.title}) as a ${ROLE_LABEL[c.role].toLowerCase()} candidate`, [c.ready ? "verified" : `not verified: ${c.blockers.join("; ")}`, coverage.summary]);
  return (await store.getContact(c.id)) ?? c;
}

export async function loadContact(store: Store, id: string): Promise<{ contact: BuyingContact; account: Account }> {
  const contact = await store.getContact(id);
  if (!contact) throw new ContactError("unknown contact", 404);
  const account = await store.getAccountById(contact.accountId);
  if (!account) throw new ContactError("contact's account no longer exists", 404);
  return { contact, account };
}

export async function replaceContactCmd(store: Store, providers: Providers, id: string, reason: string, by: string, model: ScoringModel | null) {
  const { contact } = await loadContact(store, id);
  if (TERMINAL.includes(contact.status)) throw new ContactError(`${contact.person.name} is already ${contact.status.replace("_", " ")}`, 409);
  return replaceContact(store, providers, id, reason, by, model);
}

export async function pauseContactCmd(store: Store, id: string, reason: string, by: string): Promise<BuyingContact> {
  const { contact } = await loadContact(store, id);
  if (contact.status !== "selected") throw new ContactError(`${contact.person.name} is ${contact.status}; only selected people can be paused`, 409);
  const c = (await store.patchContact(id, (cur) => ({ ...cur, status: "paused", outreach: { ...cur.outreach, heldReason: `${reason} (${by})`, heldUntil: null } })))!;
  await logActivity(store, c.accountId, "rep", "contact_paused", `${by} paused outreach to ${c.person.name}`, [reason]);
  return c;
}

export async function resumeContactCmd(store: Store, id: string, by: string): Promise<BuyingContact> {
  const { contact } = await loadContact(store, id);
  if (contact.status !== "paused") throw new ContactError(`${contact.person.name} is ${contact.status}, not paused`, 409);
  return (await resumeContact(store, id, by))!;
}
