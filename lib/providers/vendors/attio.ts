import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { config } from "@/lib/config";
import { classifyRole } from "@/lib/engine/buying-group";
import { PermanentError } from "@/lib/engine/operations";
import { reps } from "@/lib/store/collections";
import type { Account, HistoricalContact, HistoricalRecord, Outcome, OutcomeType, Person } from "@/lib/types";
import { httpJson } from "../http";
import { toProviderError } from "../outreach";
import type { CrmProvider, DialerProvider } from "../types";

/**
 * Attio (REST API v2), the CRM of record. Implemented from docs.attio.com,
 * read 2026-11-16; not yet verified against a real workspace.
 *
 *   history   POST /v2/objects/deals/records/query (limit/offset) + company and people records
 *   outcomes  PUT  /v2/objects/{companies|people|deals}/records?matching_attribute=... (assert = upsert)
 *             POST /v2/notes
 *   owner     custom company owner attribute, else an open deal's owner
 *   calls     POST /v2/tasks (Trellus dials Attio tasks through its native integration)
 *   webhooks  Attio-Signature = hex HMAC-SHA256(raw body, webhook secret); Idempotency-Key per delivery
 *
 * Attio has no request idempotency keys; every write is an upsert on a
 * matching attribute (company domain, person email, deal ATTIO_DEAL_MATCH_ATTRIBUTE),
 * so a retried write lands on the same records. Notes are the exception: a
 * retry after the note was written can add a second note.
 */

const BASE = "https://api.attio.com/v2";

export const DEFAULT_STAGE_MAP: Partial<Record<OutcomeType, string>> = {
  meeting_booked: "In Progress",
  opportunity_created: "In Progress",
  deal_won: "Won 🎉",
  deal_lost: "Lost",
};

export const DEFAULT_STAGE_OUTCOMES: Record<string, HistoricalRecord["outcome"]> = {
  lead: "no_response",
  "in progress": "meeting",
  "won 🎉": "won",
  won: "won",
  lost: "lost",
};

function parseJson<T>(raw: string, fallback: T, name: string): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new PermanentError(`${name} is not valid JSON`);
  }
}

export const stageMap = () => ({ ...DEFAULT_STAGE_MAP, ...parseJson<Partial<Record<OutcomeType, string>>>(config.attio.stageMap, {}, "ATTIO_STAGE_MAP") });
export const stageOutcomes = () => {
  const custom = parseJson<Record<string, HistoricalRecord["outcome"]>>(config.attio.stageOutcomes, {}, "ATTIO_STAGE_OUTCOMES");
  return { ...DEFAULT_STAGE_OUTCOMES, ...Object.fromEntries(Object.entries(custom).map(([k, v]) => [k.toLowerCase(), v])) };
};

// --- Client -------------------------------------------------------------------------------

export async function attio<T = unknown>(path: string, opts: { method?: "GET" | "POST" | "PUT" | "PATCH"; body?: unknown; context: string }): Promise<T> {
  if (!config.attio.apiKey) throw new PermanentError("ATTIO_API_KEY is not set");
  try {
    const { data } = await httpJson<T>(`${BASE}${path}`, { method: opts.method, body: opts.body, headers: { authorization: `Bearer ${config.attio.apiKey}` }, timeoutMs: 20_000 });
    return data;
  } catch (err) {
    throw toProviderError(err, `attio ${opts.context}`);
  }
}

const RecordId = z.object({ record_id: z.string() }).passthrough();
const AttioRecord = z.object({ id: RecordId, values: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))).default({}), created_at: z.string().optional() }).passthrough();
type AttioRecord = z.infer<typeof AttioRecord>;
const One = z.object({ data: AttioRecord });
const Many = z.object({ data: z.array(AttioRecord) });

/** First current value of an attribute (Attio returns every attribute as an array of value objects). */
export function first(rec: AttioRecord, slug: string): Record<string, unknown> | null {
  const vals = rec.values[slug] ?? [];
  return (vals.find((v) => v.active_until == null) ?? vals[0] ?? null) as Record<string, unknown> | null;
}
const str = (v: unknown) => (typeof v === "string" ? v : null);

export function stageTitle(rec: AttioRecord): string | null {
  const s = first(rec, "stage");
  const status = s?.status as { title?: string } | undefined;
  return status?.title ?? null;
}

function splitName(full: string): { first_name: string; last_name: string; full_name: string } {
  const parts = full.trim().split(/\s+/);
  return { first_name: parts[0] ?? full, last_name: parts.slice(1).join(" "), full_name: full.trim() };
}

/** "51-200" or "1K-5K" style ranges -> a midpoint headcount. */
export function employeesFromRange(title: string | null): number {
  if (!title) return 0;
  const nums = [...title.replace(/,/g, "").matchAll(/(\d+(?:\.\d+)?)\s*([kK])?/g)].map((m) => Number(m[1]) * (m[2] ? 1000 : 1));
  if (!nums.length) return 0;
  return Math.round(nums.length > 1 ? (nums[0] + nums[1]) / 2 : nums[0]);
}

export async function assertCompany(account: Pick<Account, "domain" | "companyName">): Promise<string> {
  const r = One.parse(await attio(`/objects/companies/records?matching_attribute=domains`, { method: "PUT", body: { data: { values: { domains: [account.domain], name: account.companyName } } }, context: "assert company" }));
  return r.data.id.record_id;
}

export async function assertPerson(person: Person, domain: string): Promise<string | null> {
  if (!person.email) return null;
  const values: Record<string, unknown> = { email_addresses: [person.email], name: splitName(person.name), job_title: person.title, company: domain };
  const r = One.parse(await attio(`/objects/people/records?matching_attribute=email_addresses`, { method: "PUT", body: { data: { values } }, context: "assert person" }));
  return r.data.id.record_id;
}

// --- CRM provider -----------------------------------------------------------------------

export class AttioCrmProvider implements CrmProvider {
  readonly name = "attio";
  private ownerCache = new Map<string, { owner: string | null; at: number }>();

  /**
   * Past deals as training history. Signals are not stored in Attio, so they
   * come back empty; industry, size, persona and the deal's people (as the
   * buying group, all counted as having taken part) do.
   */
  async exportHistorical(): Promise<HistoricalRecord[]> {
    const deals: AttioRecord[] = [];
    for (let offset = 0; offset < 5000; offset += 500) {
      const page = Many.parse(await attio(`/objects/deals/records/query`, { method: "POST", body: { limit: 500, offset }, context: "list deals" }));
      deals.push(...page.data);
      if (page.data.length < 500) break;
    }
    const outcomes = stageOutcomes();
    const companies = new Map<string, AttioRecord | null>();
    const people = new Map<string, AttioRecord | null>();
    const fetchRec = async (object: string, id: string, cache: Map<string, AttioRecord | null>) => {
      if (cache.has(id)) return cache.get(id)!;
      const r = await attio(`/objects/${object}/records/${id}`, { context: `get ${object}` })
        .then((x) => One.parse(x).data)
        .catch(() => null);
      cache.set(id, r);
      return r;
    };
    const out: HistoricalRecord[] = [];
    for (const deal of deals) {
      const stage = stageTitle(deal);
      const outcome = stage ? outcomes[stage.toLowerCase()] : undefined;
      if (!outcome) continue;
      const companyId = str(first(deal, "associated_company")?.target_record_id);
      const company = companyId ? await fetchRec("companies", companyId, companies) : null;
      const personIds = (deal.values.associated_people ?? []).map((v) => str(v.target_record_id)).filter((x): x is string => Boolean(x)).slice(0, 8);
      const persons = (await Promise.all(personIds.map((id) => fetchRec("people", id, people)))).filter((x): x is AttioRecord => Boolean(x));
      const titles = persons.map((p) => str(first(p, "job_title")?.value) ?? "").filter(Boolean);
      const contacts: HistoricalContact[] = titles.map((title) => {
        const seniority = /chief|cfo|coo|ceo|president|owner/i.test(title) ? "c_level" : /\bvp\b|vice president/i.test(title) ? "vp" : /director|head/i.test(title) ? "director" : /manager/i.test(title) ? "manager" : "ic";
        return { role: classifyRole({ title, seniority }).role, title, seniority, contactedOrder: null, replied: false, influenced: true, bookedMeeting: outcome === "meeting" || outcome === "won", inWin: outcome === "won" };
      });
      const categories = (company?.values.categories ?? []).map((c) => str((c.option as { title?: string } | undefined)?.title)).filter(Boolean) as string[];
      const stageAt = str(first(deal, "stage")?.active_from) ?? deal.created_at ?? new Date().toISOString();
      out.push({
        id: `attio_${deal.id.record_id}`,
        companyName: (company && str(first(company, "name")?.value)) ?? str(first(deal, "name")?.value) ?? "Unknown",
        industry: categories[0] ?? "Unknown",
        employeeCount: company ? employeesFromRange(str((first(company, "employee_range")?.option as { title?: string } | undefined)?.title)) : 0,
        signalKeys: [],
        persona: titles[0] ?? "Unknown",
        seniority: contacts[0]?.seniority ?? "manager",
        outcome,
        dealValue: outcome === "won" ? (Number(first(deal, "value")?.currency_value) || undefined) : undefined,
        firstTouchAt: deal.created_at ?? stageAt,
        outcomeAt: stageAt,
        source: "crm_export",
        contacts: contacts.length ? contacts : undefined,
      });
    }
    return out;
  }

  /**
   * Upsert the company, the person (when they have an email) and, for
   * pipeline outcomes, the deal keyed by our opportunity id; then add a note.
   */
  async logOutcome(account: Account, outcome: Outcome): Promise<{ remoteId?: string | null }> {
    const companyId = await assertCompany(account);
    const person = account.contact;
    const personId = person ? await assertPerson(person, account.domain).catch(() => null) : null;
    let dealId: string | null = null;
    const stage = stageMap()[outcome.outcomeType];
    if (stage) {
      const values: Record<string, unknown> = {
        [config.attio.dealMatchAttribute]: outcome.opportunityId ?? `opp_${account.id}`,
        name: `${account.companyName} · outbound`,
        stage: [{ status: stage }],
        associated_company: [{ target_object: "companies", target_record_id: companyId }],
        ...(personId ? { associated_people: [{ target_object: "people", target_record_id: personId }] } : {}),
        ...(outcome.value ? { value: [{ currency_value: outcome.value }] } : {}),
        ...(config.attio.defaultOwnerEmail ? { owner: [{ workspace_member_email_address: config.attio.defaultOwnerEmail }] } : {}),
      };
      const r = One.parse(await attio(`/objects/deals/records?matching_attribute=${encodeURIComponent(config.attio.dealMatchAttribute)}`, { method: "PUT", body: { data: { values } }, context: "assert deal" }));
      dealId = r.data.id.record_id;
    }
    const label = outcome.outcomeType.replace(/_/g, " ");
    const lines = [
      `**${label}**${person ? ` with ${person.name} (${person.title})` : ""}`,
      outcome.value ? `Value: $${outcome.value.toLocaleString("en-US")}` : "",
      outcome.notes ?? "",
      `Source: ${outcome.source} · outcome ${outcome.id}${outcome.contactId ? ` · contact ${outcome.contactId}` : ""}`,
      `${config.appUrl}/accounts/${account.slug}`,
    ].filter(Boolean);
    const note = await attio<{ data?: { id?: { note_id?: string } } }>(`/notes`, {
      method: "POST",
      body: { data: { parent_object: dealId ? "deals" : "companies", parent_record_id: dealId ?? companyId, title: `Outbound Intel: ${label}`, format: "markdown", content: lines.join("\n\n") } },
      context: "create note",
    });
    return { remoteId: dealId ?? note?.data?.id?.note_id ?? companyId };
  }

  /**
   * Who owns the account in Attio, if anyone: the custom company owner
   * attribute when configured, otherwise the owner of an open deal on the
   * company that this app did not create. Cached for an hour per domain.
   */
  async ownerOf(account: Pick<Account, "domain">): Promise<string | null> {
    const hit = this.ownerCache.get(account.domain);
    if (hit && Date.now() - hit.at < 3_600_000) return hit.owner;
    const companies = Many.parse(await attio(`/objects/companies/records/query`, { method: "POST", body: { filter: { domains: { root_domain: account.domain } }, limit: 1 }, context: "find company" })).data;
    let owner: string | null = null;
    const company = companies[0];
    if (company && config.attio.companyOwnerAttribute) {
      const ref = first(company, config.attio.companyOwnerAttribute);
      owner = ref ? await memberName(str(ref.referenced_actor_id)) : null;
    } else if (company) {
      const deals = Many.parse(await attio(`/objects/deals/records/query`, { method: "POST", body: { filter: { associated_company: { target_record_id: company.id.record_id } }, limit: 20 }, context: "find deals" })).data;
      const open = deals.find((d) => {
        const st = (stageTitle(d) ?? "").toLowerCase();
        const ours = String(first(d, config.attio.dealMatchAttribute)?.value ?? "").startsWith("opp_");
        return !ours && stageOutcomes()[st] !== "lost";
      });
      const ref = open ? first(open, "owner") : null;
      owner = ref ? await memberName(str(ref.referenced_actor_id)) : null;
    }
    this.ownerCache.set(account.domain, { owner, at: Date.now() });
    return owner;
  }
}

let members: { id: string; name: string; email: string }[] | null = null;
async function memberName(id: string | null): Promise<string | null> {
  if (!id) return null;
  if (!members) {
    const r = await attio<{ data: { id: { workspace_member_id: string }; first_name?: string; last_name?: string; email_address?: string }[] }>(`/workspace_members`, { context: "list members" });
    members = r.data.map((m) => ({ id: m.id.workspace_member_id, name: [m.first_name, m.last_name].filter(Boolean).join(" ") || (m.email_address ?? m.id.workspace_member_id), email: m.email_address ?? "" }));
  }
  return members.find((m) => m.id === id)?.name ?? "an Attio user";
}

/** Read-only connection check: lists workspace members. */
export async function testAttio(): Promise<{ ok: boolean; message: string }> {
  const r = await attio<{ data: unknown[] }>(`/workspace_members`, { context: "list members" });
  return { ok: Array.isArray(r.data), message: `authenticated; ${r.data.length} workspace member(s)` };
}

// --- Calls via Attio tasks (Trellus) ----------------------------------------------------

/**
 * Trellus dials tasks it reads from Attio (native integration), so a queued
 * call is an Attio task linked to the person and company, assigned to the
 * account's rep, due now, with the talk track as its content.
 */
export class TrellusAttioDialerProvider implements DialerProvider {
  readonly name = "trellus";

  async queueCall(input: { account: Account; contact: Person; context: string; idempotencyKey: string }) {
    const companyId = await assertCompany(input.account);
    const personId = await assertPerson(input.contact, input.account.domain).catch(() => null);
    const rep = input.account.ownerRepId ? await reps.get(input.account.ownerRepId) : null;
    const assignee = rep?.email || config.attio.defaultOwnerEmail;
    if (!assignee) throw new PermanentError("no rep email to assign the call task to (set ATTIO_DEFAULT_OWNER_EMAIL)");
    const content = `Call ${input.contact.name} (${input.contact.title}) at ${input.account.companyName}${input.contact.phone ? ` · ${input.contact.phone}` : ""}. ${input.context}`.slice(0, 2000);
    const r = await attio<{ data?: { id?: { task_id?: string } } }>(`/tasks`, {
      method: "POST",
      body: {
        data: {
          content,
          format: "plaintext",
          deadline_at: new Date().toISOString(),
          is_completed: false,
          linked_records: [{ target_object: "companies", target_record_id: companyId }, ...(personId ? [{ target_object: "people", target_record_id: personId }] : [])],
          assignees: [{ workspace_member_email_address: assignee }],
        },
      },
      context: "create call task",
    });
    return { queued: true, externalId: r?.data?.id?.task_id, note: `Attio task for ${assignee}; Trellus dials it from its Attio integration` };
  }
}

// --- Webhooks ---------------------------------------------------------------------------

/** Attio-Signature: hex HMAC-SHA256 of the raw body with the webhook secret. */
export function verifyAttioSignature(raw: string, signature: string | null, secret = config.attio.webhookSecret): boolean {
  if (!secret || !signature) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(raw).digest("hex"));
  const got = Buffer.from(signature.trim());
  return expected.length === got.length && timingSafeEqual(expected, got);
}

export async function getDeal(objectId: string, recordId: string): Promise<AttioRecord> {
  return One.parse(await attio(`/objects/${objectId}/records/${recordId}`, { context: "get deal" })).data;
}

export async function getCompany(recordId: string): Promise<AttioRecord | null> {
  return attio(`/objects/companies/records/${recordId}`, { context: "get company" })
    .then((x) => One.parse(x).data)
    .catch(() => null);
}

export { str as attioString };
