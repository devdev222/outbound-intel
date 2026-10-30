import type { Account, ContactField, FieldSource, Person } from "@/lib/types";
import { nowIso } from "@/lib/util";

/**
 * Pure contact-field helpers (safe for client components): phone verification
 * bound to the verified number, field-level provenance, merging, rejection.
 */

export function normalizePhone(phone: string | null | undefined): string {
  const digits = (phone ?? "").replace(/\D/g, "");
  // Drop a leading US country code so +1 (555) 010-1234 and 555-010-1234 compare equal.
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
}

/** True only when the current phone is the exact number a provider verified. */
export function isPhoneVerified(c: Pick<Person, "phone" | "phoneVerified" | "phoneVerifiedNumber" | "verifiedBy"> | null | undefined): boolean {
  if (!c?.phone || !c.phoneVerified) return false;
  // Older records predate phoneVerifiedNumber; treat their flag as applying to the stored phone.
  if (c.phoneVerifiedNumber === undefined) return true;
  return Boolean(c.phoneVerifiedNumber) && normalizePhone(c.phone) === c.phoneVerifiedNumber;
}

export function samePerson(a: Pick<Person, "name" | "email"> | null | undefined, b: Pick<Person, "name" | "email"> | null | undefined): boolean {
  if (!a || !b) return false;
  if (a.email && b.email) return a.email.trim().toLowerCase() === b.email.trim().toLowerCase();
  return a.name.trim().toLowerCase() === b.name.trim().toLowerCase();
}

export interface ContactUpdate {
  name?: string | null;
  title?: string | null;
  seniority?: Person["seniority"];
  email?: string | null;
  phone?: string | null;
  linkedin?: string | null;
  /** The source verified THIS phone number (a literal boolean from the provider). */
  phoneVerified?: boolean;
  emailVerified?: boolean;
}

/**
 * Merge an update from one source into the current contact.
 * - Different person: start from the update alone (no inherited fields).
 * - Same person: update wins for fields it supplies; phone verification is
 *   recomputed for the resulting number.
 */
export function mergeContact(prev: Person | null | undefined, update: ContactUpdate, source: string): Person {
  const at = nowIso();
  const incomingName = update.name?.trim() || prev?.name || "";
  const isNewPerson = Boolean(prev && update.name && !samePerson(prev, { name: incomingName, email: update.email ?? undefined }) && !(update.email && prev.email && update.email.toLowerCase() === prev.email.toLowerCase()));
  const base: Person = isNewPerson || !prev ? { name: incomingName, title: update.title ?? "", seniority: update.seniority ?? prev?.seniority ?? "manager", fieldSources: {} } : { ...prev, fieldSources: { ...(prev.fieldSources ?? {}) } };
  const sources = base.fieldSources as Partial<Record<ContactField, FieldSource>>;
  const set = (field: ContactField, value: string | null | undefined, verified = false) => {
    if (value === undefined || value === null || value === "") return;
    (base as unknown as Record<string, unknown>)[field] = value;
    sources[field] = { source, verified, at };
  };
  set("name", update.name ?? undefined);
  set("title", update.title ?? undefined);
  if (update.seniority) base.seniority = update.seniority;
  set("email", update.email ?? undefined, Boolean(update.emailVerified));
  set("linkedin", update.linkedin ?? undefined);

  const prevPhone = normalizePhone(base.phone);
  if (update.phone) {
    const next = normalizePhone(update.phone);
    base.phone = update.phone;
    if (update.phoneVerified === true) {
      base.phoneVerified = true;
      base.phoneVerifiedNumber = next;
      sources.phone = { source, verified: true, at };
    } else if (next !== prevPhone || isNewPerson) {
      // A new number is unverified until a source verifies that number.
      base.phoneVerified = false;
      base.phoneVerifiedNumber = null;
      sources.phone = { source, verified: false, at };
    }
  } else if (update.phoneVerified === true && base.phone) {
    base.phoneVerified = true;
    base.phoneVerifiedNumber = prevPhone;
    sources.phone = { source, verified: true, at };
  }
  // Re-assert the invariant for whatever we ended up with.
  if (base.phoneVerified && base.phoneVerifiedNumber !== undefined && base.phoneVerifiedNumber !== normalizePhone(base.phone)) {
    base.phoneVerified = false;
    base.phoneVerifiedNumber = null;
  }
  base.verifiedBy = Object.values(sources).some((x) => x?.verified) ? source : (isNewPerson ? null : (prev?.verifiedBy ?? null));
  return base;
}

/** Is this person one the rep already rejected for the account? */
export function isRejected(account: Pick<Account, "rejectedContacts">, p: Pick<Person, "name" | "email" | "phone">): boolean {
  return (account.rejectedContacts ?? []).some(
    (r) => (r.email && p.email && r.email.toLowerCase() === p.email.toLowerCase()) || r.name.trim().toLowerCase() === p.name.trim().toLowerCase() || (r.phone && p.phone && normalizePhone(r.phone) === normalizePhone(p.phone)),
  );
}

