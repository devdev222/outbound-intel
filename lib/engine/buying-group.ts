import { config } from "@/lib/config";
import type { Providers } from "@/lib/providers";
import type { Store } from "@/lib/store";
import { isSuppressed } from "@/lib/store/collections";
import type { Account, BuyingContact, BuyingGroupCoverage, BuyingGroupPlan, BuyingRole, ContactVerification, Person, ScoringModel, SegmentBuyingGroup } from "@/lib/types";
import { deterministicUuid, nowIso } from "@/lib/util";
import { logActivity } from "./activity";
import { isPhoneVerified, isRejected, mergeContact, samePerson } from "./contact-fields";
import { backoffMs } from "./operations";
import { sizeBandFor } from "./signal-catalog";

/**
 * Buying groups. Each account is worked as a group of people, starting with
 * four complementary roles, each person with an independent lifecycle.
 *
 * The contact research team (responsibilities, run by the "contacts" agent):
 *   account mapper      -> mapCandidates: likely decision-makers, owners, champions, supporters
 *   contact researcher  -> candidate evidence: title, seniority, responsibilities, sources
 *   verification agent  -> verifyContact: employment, details, freshness, duplicates, suppression
 *   coverage coordinator-> selectGroup: initial group per plan, explicit gaps, replacements
 * The outreach coordinator lives in campaign.ts (coordinated, staggered sequences)
 * and the buying-group analyst in learn-buying-group.ts (historical patterns).
 */

export const ROLE_LABEL: Record<BuyingRole, string> = {
  economic_buyer: "Economic buyer",
  operational_owner: "Operational owner",
  champion: "Potential champion",
  supporting: "Supporting stakeholder",
};

export const ROLE_PURPOSE: Record<BuyingRole, string> = {
  economic_buyer: "owns budget and the final yes",
  operational_owner: "owns the shipping work Cartage would take over",
  champion: "feels the coordination pain daily and can carry the case internally",
  supporting: "influences or gates the evaluation",
};

/** How each role is approached: what the message leads with. */
export const ROLE_ANGLE: Record<BuyingRole, string> = {
  economic_buyer: "the cost of growing volume without growing coordination headcount",
  operational_owner: "taking tendering, tracking and exceptions off the team's plate",
  champion: "fewer phone calls, fewer spreadsheets, fewer late-shipment escalations",
  supporting: "a vendor that plugs into the current process without a big rollout",
};

export const DEFAULT_PLAN: BuyingGroupPlan = {
  targetSize: 4,
  roles: ["operational_owner", "champion", "economic_buyer", "supporting"],
  stagger: [0, 2, 5, 8],
  source: "default",
  segment: "all",
  evidence: ["Default starting mix: operational owner first (owns the work), then a champion, then the economic buyer, then a supporting stakeholder, staggered over 8 days. Replaced by historical evidence once enough deals exist for the segment."],
};

const MIN_SEGMENT_N = 25;
const MIN_OVERALL_N = 40;
const FRESH_DAYS = 180;

export function segmentKey(account: Pick<Account, "industry" | "employeeCount" | "signals">): string {
  const useCase = account.signals.filter((s) => s.status === "verified" && s.type !== "intent").sort((a, b) => b.confidence - a.confidence)[0]?.type ?? "general";
  return `${account.industry}|${sizeBandFor(account.employeeCount)}|${useCase}`;
}

/** Plan for this account: learned per segment when there is enough history, else overall, else the default. */
export function planFor(account: Account, model: ScoringModel | null): BuyingGroupPlan {
  const bg = model?.buyingGroup;
  if (!bg) return DEFAULT_PLAN;
  const key = segmentKey(account);
  const seg = bg.segments.find((s) => s.segment === key && s.n >= MIN_SEGMENT_N) ?? bg.segments.find((s) => s.segment === `${account.industry}|*|*` && s.n >= MIN_SEGMENT_N) ?? bg.segments.find((s) => s.segment === `*|${sizeBandFor(account.employeeCount)}|*` && s.n >= MIN_SEGMENT_N) ?? (bg.overall.n >= MIN_OVERALL_N ? bg.overall : null);
  if (!seg) return DEFAULT_PLAN;
  return fromSegment(seg);
}

function fromSegment(seg: SegmentBuyingGroup): BuyingGroupPlan {
  const roles = seg.recommended.roles.length ? seg.recommended.roles.slice(0, Math.max(2, Math.min(6, seg.recommended.size))) : DEFAULT_PLAN.roles;
  return {
    targetSize: roles.length,
    roles,
    stagger: roles.map((_, i) => [0, 2, 5, 8, 11, 14][i] ?? i * 3),
    source: "learned",
    segment: seg.segment,
    evidence: [...seg.recommended.rationale, `Based on ${seg.n} historical deals (${seg.wins} won). Associations, not proven causes; confirm with a Lab experiment.`],
  };
}

// --- Account mapper + contact researcher ----------------------------------------------------

/** Role from title and seniority, with the evidence used. */
export function classifyRole(p: Pick<Person, "title" | "seniority">): { role: BuyingRole; confidence: number; evidence: string[] } {
  const t = p.title.toLowerCase();
  const ev = (why: string) => [`Title "${p.title}" (${p.seniority.replace("_", "-")}): ${why}`];
  if (/\b(cfo|chief financial|coo|chief operating|ceo|president|owner)\b/.test(t)) return { role: "economic_buyer", confidence: 0.85, evidence: ev("executive with budget authority") };
  if (/\bvp\b|vice president/.test(t) && /supply chain|operations|finance/.test(t)) return { role: "economic_buyer", confidence: 0.75, evidence: ev("VP over the budget that pays for shipping") };
  if (/(vp|vice president|director|head)\b.*(transport|logistics|shipping|freight|distribution)|(transport|logistics).*(director)/.test(t)) return { role: "operational_owner", confidence: 0.85, evidence: ev("leads the transportation/logistics function") };
  if (/director of operations|operations director/.test(t)) return { role: "operational_owner", confidence: 0.65, evidence: ev("leads operations, which usually includes shipping") };
  if (/transportation manager|logistics manager|supply chain manager|shipping manager|plant manager|warehouse manager|distribution manager/.test(t)) return { role: "champion", confidence: 0.75, evidence: ev("runs day-to-day shipping and feels the coordination load") };
  if (/procurement|purchasing|sourcing|buyer\b|it\b|systems|analyst|coordinator|specialist|controller/.test(t)) return { role: "supporting", confidence: 0.65, evidence: ev("involved in vendor selection or the daily process") };
  if (p.seniority === "c_level") return { role: "economic_buyer", confidence: 0.55, evidence: ev("executive") };
  if (p.seniority === "vp" || p.seniority === "director") return { role: "operational_owner", confidence: 0.5, evidence: ev("senior leader; function unclear from title") };
  if (p.seniority === "manager") return { role: "champion", confidence: 0.45, evidence: ev("manager; function unclear from title") };
  return { role: "supporting", confidence: 0.4, evidence: ev("individual contributor") };
}

export function contactIdFor(accountId: string, p: Pick<Person, "name" | "email">): string {
  return deterministicUuid(`contact:${accountId}:${(p.email ?? p.name).trim().toLowerCase()}`);
}

const emptyVerification = (): ContactVerification => ({ employment: null, email: null, phone: null, fresh: false, duplicateOf: null, suppressed: false, checkedAt: null, attempts: 0, nextAttemptAt: null, lastError: null, problems: [] });

export function newContact(account: Account, person: Person, source: BuyingContact["source"], extra: Partial<BuyingContact> = {}): BuyingContact {
  const r = classifyRole(person);
  const now = nowIso();
  const factsDate = account.factsUpdatedAt?.slice(0, 10) ?? now.slice(0, 10);
  return {
    id: contactIdFor(account.id, person),
    accountId: account.id,
    person,
    role: r.role,
    roleConfidence: r.confidence,
    roleEvidence: [...r.evidence, `Listed at ${account.companyName} in ${account.facts.source} data (${factsDate})`],
    relationship: r.role === "economic_buyer" ? "decision_maker" : r.role === "operational_owner" ? "decision_maker" : r.role === "champion" ? "user" : "influencer",
    status: "candidate",
    verification: emptyVerification(),
    ready: false,
    blockers: ["not verified yet"],
    selectedReason: null,
    outreach: { order: null, startDay: null, touchesSent: 0, lastTouchAt: null, heldReason: null },
    engagement: { score: 0, lastEventAt: null, replied: false, meeting: false, optedOut: false },
    source,
    createdAt: now,
    updatedAt: now,
    ...extra,
  };
}

/** Account mapper: every known person not already tracked or rejected becomes a candidate. */
export async function mapCandidates(store: Store, account: Account): Promise<BuyingContact[]> {
  const existing = await store.listContacts({ accountId: account.id });
  const created: BuyingContact[] = [];
  const people = [...account.facts.people];
  if (account.contact && !people.some((p) => samePerson(p, account.contact))) people.unshift(account.contact);
  for (const p of people) {
    if (!p.name?.trim() || isRejected(account, p)) continue;
    if (existing.some((c) => samePerson(c.person, p)) || created.some((c) => samePerson(c.person, p))) continue;
    const isCurrent = Boolean(account.contact && samePerson(account.contact, p));
    // An account already in outreach with one contact: that person keeps their place and their tasks.
    const legacy = isCurrent && Boolean(account.campaign) && !account.primaryContactId;
    const c = newContact(account, isCurrent ? { ...p, ...account.contact! } : p, legacy ? "legacy" : "research", legacy ? { status: "selected" } : {});
    created.push(await store.upsertContact(c));
    if (legacy) await migrateLegacyAccount(store, account, c);
  }
  return created;
}

/**
 * Migration from the single-contact model: the existing contact becomes the
 * primary buying-group contact and every task, outcome and conversation that
 * had no person gets theirs, so history stays attributed to the right person.
 */
export async function migrateLegacyAccount(store: Store, account: Account, contact: BuyingContact): Promise<number> {
  await store.patchAccount(account.id, (cur) => (cur.primaryContactId ? null : { ...cur, primaryContactId: contact.id }));
  let n = 0;
  for (const t of await store.listOutreach({ accountId: account.id })) {
    if (t.contactId) continue;
    await store.updateOutreach({ ...t, contactId: contact.id });
    n++;
  }
  const sent = (await store.listOutreach({ accountId: account.id })).filter((t) => t.contactId === contact.id && t.sentAt);
  if (sent.length) await store.patchContact(contact.id, (c) => ({ ...c, outreach: { ...c.outreach, touchesSent: sent.length, lastTouchAt: sent.map((t) => t.sentAt!).sort().at(-1) ?? null } }));
  await logActivity(store, account.id, "system", "contact_migrated", `${contact.person.name} became the primary contact of the buying group`, [`${n} existing task${n === 1 ? "" : "s"} attributed to them`]);
  return n;
}

// --- Verification agent -----------------------------------------------------------------------

export const MAX_VERIFY_ATTEMPTS = 5;

export function verifyDue(c: BuyingContact, at = nowIso()): boolean {
  if (["rejected", "replaced", "opted_out"].includes(c.status)) return false;
  if (c.verification.checkedAt && !c.verification.lastError) return false;
  if (c.verification.attempts >= MAX_VERIFY_ATTEMPTS) return false;
  return !c.verification.nextAttemptAt || c.verification.nextAttemptAt <= at;
}

/**
 * Verify one person independently: contact details via the enrichment
 * provider (or Jerry over MCP), employment and freshness from the source,
 * duplicates within the account, and suppression. Failures are recorded with
 * a bounded retry; synthetic data never counts as verified in live mode.
 */
export async function verifyContact(store: Store, providers: Providers, account: Account, contact: BuyingContact): Promise<BuyingContact> {
  const at = nowIso();
  let person = contact.person;
  let enrichError: string | null = null;
  let provider: string = providers.enrichment.name;
  let synthetic = false;
  try {
    const res = config.jerry.mode === "mcp" ? await (await import("@/lib/agents/jerry-mcp")).jerryMcp.enrichContactOrThrow(person, account) : await providers.enrichment.enrichContact(person, account);
    provider = config.jerry.mode === "mcp" ? "jerry-mcp" : res.provider;
    synthetic = res.provenance === "synthetic";
    person = mergeContact(person, { name: res.contact.name, title: res.contact.title, email: res.contact.email, phone: res.contact.phone, linkedin: res.contact.linkedin, phoneVerified: res.phoneVerified === true }, synthetic ? "synthetic" : provider);
    if (synthetic) person = { ...person, verifiedBy: "synthetic" };
  } catch (err) {
    enrichError = `${provider}: ${(err as Error).message}`.slice(0, 300);
  }

  const others = (await store.listContacts({ accountId: account.id })).filter((o) => o.id !== contact.id && !["rejected", "replaced"].includes(o.status));
  // Same email, name or LinkedIn profile. A shared phone (a main line) does not make two people one.
  const dup = others.find((o) => samePerson(o.person, person) || Boolean(o.person.linkedin && person.linkedin && o.person.linkedin.toLowerCase() === person.linkedin.toLowerCase()));
  const suppressed = Boolean(await isSuppressed(person.email, account.domain));
  const listed = account.facts.people.some((p) => samePerson(p, person)) || contact.source === "rep" || contact.source === "referral" || contact.source === "legacy" || contact.source === "import";
  const freshDays = (Date.now() - new Date(account.factsUpdatedAt ?? account.createdAt).getTime()) / 86_400_000;
  const live = config.mode === "live";
  const syntheticBlock = live && (synthetic || person.verifiedBy === "synthetic");

  const verification: ContactVerification = {
    employment: listed ? { ok: freshDays <= FRESH_DAYS, source: contact.source === "rep" ? "rep" : account.facts.source, at: account.factsUpdatedAt ?? at, detail: freshDays <= FRESH_DAYS ? `listed at ${account.companyName} ${Math.round(freshDays)} days ago` : `last seen at ${account.companyName} ${Math.round(freshDays)} days ago (stale)` } : { ok: false, source: "none", at, detail: "not found in current company data" },
    // Demo mode accepts synthetic details (labelled); live mode never does.
    email: person.email ? { ok: !syntheticBlock, source: person.fieldSources?.email?.source ?? provider, at, detail: synthetic ? `${person.email} (synthetic demo data)` : person.email } : null,
    phone: person.phone ? { ok: !syntheticBlock && isPhoneVerified(person), source: person.fieldSources?.phone?.source ?? provider, at, detail: `${isPhoneVerified(person) ? "verified number" : "number not verified"}${synthetic ? " (synthetic demo data)" : ""}` } : null,
    fresh: freshDays <= FRESH_DAYS,
    duplicateOf: dup?.id ?? null,
    suppressed,
    checkedAt: enrichError ? contact.verification.checkedAt : at,
    attempts: enrichError ? contact.verification.attempts + 1 : 0,
    nextAttemptAt: enrichError && contact.verification.attempts + 1 < MAX_VERIFY_ATTEMPTS ? new Date(Date.now() + backoffMs(contact.verification.attempts + 1)).toISOString() : null,
    lastError: enrichError,
    problems: [],
  };
  const blockers: string[] = [];
  if (enrichError) blockers.push(`verification failed: ${enrichError}`);
  if (!verification.employment?.ok) blockers.push(`employment not confirmed (${verification.employment?.detail})`);
  if (suppressed) blockers.push("on the suppression list");
  if (dup) blockers.push(`duplicate of ${dup.person.name}`);
  if (syntheticBlock) blockers.push("synthetic data cannot be used in live mode");
  if (!verification.email?.ok && !verification.phone?.ok && !person.linkedin) blockers.push("no verified way to reach them");
  verification.problems = blockers;

  const saved = (await store.patchContact(contact.id, (cur) => ({ ...cur, person, verification, ready: blockers.length === 0, blockers }))) ?? contact;
  return saved;
}

// --- Coverage coordinator ---------------------------------------------------------------------

const RANK_STATUS = (c: BuyingContact) => (c.status === "selected" ? 0 : 1);

/**
 * Select the group for the plan: for each planned role, the best ready
 * contact not already used (current selections are kept, so people are not
 * swapped back and forth). Unfilled roles become explicit gaps with a reason.
 */
export async function selectGroup(store: Store, account: Account, plan: BuyingGroupPlan): Promise<{ coverage: BuyingGroupCoverage; selected: BuyingContact[] }> {
  const all = await store.listContacts({ accountId: account.id });
  const usable = all.filter((c) => !["rejected", "replaced", "opted_out"].includes(c.status));
  const used = new Map<string, number>(); // contactId -> plan position
  const filled: BuyingGroupCoverage["filled"] = [];
  const gaps: BuyingGroupCoverage["gaps"] = [];
  plan.roles.forEach((role, position) => {
    const pick = usable
      .filter((c) => c.role === role && c.ready && !used.has(c.id))
      .sort((a, b) => RANK_STATUS(a) - RANK_STATUS(b) || b.roleConfidence - a.roleConfidence || Number(isPhoneVerified(b.person)) - Number(isPhoneVerified(a.person)))[0];
    if (pick) {
      used.set(pick.id, position);
      filled.push({ role, contactId: pick.id });
      return;
    }
    const waiting = usable.filter((c) => c.role === role && !c.ready);
    const rejected = all.filter((c) => c.role === role && ["rejected", "replaced"].includes(c.status));
    gaps.push({
      role,
      reason: waiting.length
        ? `${waiting.length} candidate${waiting.length === 1 ? "" : "s"} not verified yet (${waiting[0].blockers[0] ?? "pending"})`
        : rejected.length
          ? `previous ${ROLE_LABEL[role].toLowerCase()} marked wrong; researching a replacement`
          : `no ${ROLE_LABEL[role].toLowerCase()} found at ${account.companyName} yet`,
    });
  });

  const at = nowIso();
  const selected: BuyingContact[] = [];
  for (const c of usable) {
    const position = used.get(c.id);
    if (position !== undefined) {
      const order = filled.findIndex((f) => f.contactId === c.id) + 1;
      const startDay = plan.stagger[position] ?? position * 3;
      const reason = `${ROLE_LABEL[c.role]} (${ROLE_PURPOSE[c.role]}): ${c.person.title}. ${c.roleEvidence[0] ?? ""}`.trim();
      const s = await store.patchContact(c.id, (cur) => ({ ...cur, status: cur.status === "paused" ? "paused" : "selected", selectedReason: reason, outreach: { ...cur.outreach, order, startDay } }));
      if (s) selected.push(s);
    } else if (c.status === "selected") {
      await store.patchContact(c.id, (cur) => ({ ...cur, status: "candidate", outreach: { ...cur.outreach, order: null, startDay: null } }));
    }
  }
  const coverage: BuyingGroupCoverage = {
    plan,
    filled,
    gaps,
    verifiedCount: usable.filter((c) => c.ready).length,
    selectedCount: filled.length,
    summary: gaps.length ? `${filled.length} of ${plan.targetSize} roles covered; missing ${gaps.map((g) => ROLE_LABEL[g.role].toLowerCase()).join(", ")}` : `${filled.length} of ${plan.targetSize} roles covered`,
    updatedAt: at,
  };
  return { coverage, selected: selected.sort((a, b) => (a.outreach.order ?? 99) - (b.outreach.order ?? 99)) };
}

/**
 * Apply coverage to the account and mirror the primary contact (first
 * selected, ready contact in plan order) into account.contact so every
 * single-contact view keeps working.
 */
export async function applyCoverage(store: Store, account: Account, coverage: BuyingGroupCoverage, selected: BuyingContact[]): Promise<Account> {
  return (
    (await store.patchAccount(account.id, (cur) => {
      // The primary person stays primary while they are still in the group (their sequence is the account-level one).
      const primary = selected.find((s) => s.id === cur.primaryContactId) ?? selected[0] ?? null;
      return { ...cur, buyingGroup: coverage, primaryContactId: primary?.id ?? null, contact: primary ? primary.person : cur.contactHold ? null : cur.contact };
    })) ?? account
  );
}

/** Research -> verify -> select for one account. Returns the updated account. */
export async function buildBuyingGroup(store: Store, providers: Providers, account: Account, model: ScoringModel | null, opts: { verifyLimit?: number } = {}): Promise<{ account: Account; selected: BuyingContact[]; coverage: BuyingGroupCoverage; verified: number }> {
  await mapCandidates(store, account);
  const plan = planFor(account, model);
  let verified = 0;
  const due = (await store.listContacts({ accountId: account.id })).filter((c) => verifyDue(c)).sort((a, b) => plan.roles.indexOf(a.role) - plan.roles.indexOf(b.role));
  for (const c of due.slice(0, opts.verifyLimit ?? 8)) {
    const v = await verifyContact(store, providers, account, c);
    if (v.ready) verified++;
  }
  const { coverage, selected } = await selectGroup(store, account, plan);
  const updated = await applyCoverage(store, account, coverage, selected);
  return { account: updated, selected, coverage, verified };
}

// --- Per-contact lifecycle events ------------------------------------------------------------

/**
 * Replace a contact without losing history: the person is marked rejected
 * (record, tasks and engagement kept), added to the account's rejected list,
 * their open tasks are held, and the coordinator fills the role from the
 * remaining candidates (or reports the gap and keeps researching).
 */
export async function replaceContact(store: Store, providers: Providers, contactId: string, reason: string, by: string, model: ScoringModel | null): Promise<{ account: Account | null; replacement: BuyingContact | null }> {
  const at = nowIso();
  const c = await store.patchContact(contactId, (cur) => ({ ...cur, status: "rejected", ready: false, blockers: [`marked wrong by ${by}: ${reason}`], outreach: { ...cur.outreach, order: null, heldReason: `marked wrong by ${by}` } }));
  if (!c) return { account: null, replacement: null };
  const account = await store.patchAccount(c.accountId, (cur) => ({ ...cur, rejectedContacts: [...(cur.rejectedContacts ?? []), { name: c.person.name, title: c.person.title, email: c.person.email, phone: c.person.phone, linkedin: c.person.linkedin, reason, at, by }] }));
  if (!account) return { account: null, replacement: null };
  for (const t of await store.listOutreach({ accountId: c.accountId })) {
    if (t.contactId === contactId && ["awaiting_approval", "scheduled", "manual", "failed"].includes(t.status)) await store.updateOutreach({ ...t, status: "skipped", note: `Held: ${c.person.name} marked wrong (${reason})` });
  }
  const { coverage, selected } = await selectGroup(store, account, account.buyingGroup?.plan ?? planFor(account, model));
  const updated = await applyCoverage(store, account, coverage, selected);
  const replacement = selected.find((s) => s.role === c.role && s.id !== c.id) ?? null;
  if (replacement) await store.patchContact(contactId, (cur) => ({ ...cur, status: "replaced", replacedBy: replacement.id }));
  if (replacement) await store.patchContact(replacement.id, (cur) => ({ ...cur, replaces: contactId }));
  await logActivity(store, c.accountId, "rep", "contact_replaced", `${by} marked ${c.person.name} (${ROLE_LABEL[c.role].toLowerCase()}) wrong${replacement ? `; ${replacement.person.name} takes the role` : "; researching a replacement"}`, [reason, coverage.summary]);
  void providers;
  return { account: updated, replacement };
}

/** Find the buying-group contact an inbound reference (email, LinkedIn URL, name) points to. */
export async function resolveContact(store: Store, accountId: string, ref: string | null | undefined): Promise<BuyingContact | null> {
  if (!ref) return null;
  const r = ref.trim().toLowerCase();
  const all = await store.listContacts({ accountId });
  return all.find((c) => c.id === ref) ?? all.find((c) => c.person.email?.toLowerCase() === r) ?? all.find((c) => c.person.linkedin?.toLowerCase() === r) ?? all.find((c) => c.person.name.toLowerCase() === r) ?? null;
}
