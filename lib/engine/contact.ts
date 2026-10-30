import type { Providers } from "@/lib/providers";
import type { Store } from "@/lib/store";
import type { Account, RejectedContact } from "@/lib/types";
import { nowIso } from "@/lib/util";
import { logActivity } from "./activity";
import { runOperation } from "./operations";

/**
 * Contact data with field-level provenance.
 *
 *  - Phone verification belongs to a NUMBER, not to the contact: it is valid
 *    only while the current phone equals the number a provider verified.
 *  - Every field records which source supplied it and whether that source
 *    verified it, so a later merge from a weaker source never upgrades it.
 *  - A different person (name or email changed) never inherits the previous
 *    person's phone, email or verification.
 */

export { isPhoneVerified, isRejected, mergeContact, normalizePhone, samePerson, type ContactUpdate } from "./contact-fields";
import { isPhoneVerified, isRejected } from "./contact-fields";

const CONTACT_CHANNELS = new Set(["email", "linkedin", "inmail", "call", "gift", "meeting", "estimate"]);

/**
 * "Wrong contact": remove the contact and its verification, block readiness,
 * hold every contact-specific open task (skipped with a note; the sequence is
 * rebuilt for the next verified contact), pause an external sequence, and send
 * the account back to research, which will not pick this person again.
 */
export async function markWrongContact(store: Store, providers: Providers, accountId: string, by: string, reason: string): Promise<Account | null> {
  const at = nowIso();
  let rejected: RejectedContact | null = null;
  const updated = await store.patchAccount(accountId, (a) => {
    if (!a.contact) return null;
    const c = a.contact;
    rejected = { name: c.name, title: c.title, email: c.email, phone: c.phone, linkedin: c.linkedin, reason, at, by };
    const blocker = `Contact marked wrong by ${by}: ${c.name}. Research is finding the right person.`;
    return {
      ...a,
      contact: null,
      rejectedContacts: [...(a.rejectedContacts ?? []), rejected],
      contactHold: { since: at, reason, by },
      status: ["won", "lost", "disqualified", "meeting_booked"].includes(a.status) ? a.status : "needs_enrichment",
      readiness: { ready: false, checks: [...(a.readiness?.checks ?? []).filter((k) => k.key !== "contact" && k.key !== "decision_maker"), { key: "contact", label: "Usable contact information", pass: false, detail: blocker }], blockers: [blocker], evaluatedAt: at },
      nextAction: { type: "enrich", label: "Find the right contact", reason: blocker, dueAt: at },
      pendingActivation: null,
      enrichment: null,
      // Research and Jerry re-run for this account.
      agentRuns: Object.fromEntries(Object.entries(a.agentRuns).filter(([k]) => k !== "research" && k !== "jerry" && k !== "icp")),
      factsUpdatedAt: at,
    };
  });
  if (!updated || !rejected) return updated;
  const held: string[] = [];
  for (const t of await store.listOutreach({ accountId })) {
    if (!["awaiting_approval", "scheduled", "manual", "failed"].includes(t.status) || !CONTACT_CHANNELS.has(t.channel)) continue;
    await store.updateOutreach({ ...t, status: "skipped", note: `Held: contact marked wrong (${(rejected as RejectedContact).name}). Rebuilt for the new contact once verified.` });
    held.push(t.title ?? t.channel);
  }
  if (providers.outreach.ownsScheduling && providers.outreach.pauseSequence) {
    await runOperation(store, { id: `contact-hold:${accountId}:${at}`, kind: "sequence_pause", accountId, destination: providers.outreach.name, maxAttempts: 5 }, async (key) => {
      await providers.outreach.pauseSequence!(updated, new Date(Date.now() + 90 * 86_400_000).toISOString(), "wrong contact", key);
      return { result: {} };
    });
  }
  await logActivity(store, accountId, "rep", "contact_rejected", `${by} marked ${(rejected as RejectedContact).name} as the wrong contact; outreach held and research reopened`, [reason, held.length ? `held ${held.length} task(s): ${held.join(", ")}` : "no open tasks"]);
  return updated;
}

/** Clear the hold once a different, verified contact is on file. Returns true when cleared. */
export function holdCanClear(a: Account): boolean {
  return Boolean(a.contactHold && a.contact && !isRejected(a, a.contact) && (isPhoneVerified(a.contact) || a.contact.email));
}
