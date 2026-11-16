import { z } from "zod";
import { config } from "@/lib/config";
import { classifyRole } from "@/lib/engine/buying-group";
import { PermanentError } from "@/lib/engine/operations";
import type { Account, CompanyFacts, OutreachTouch, Person, Seniority } from "@/lib/types";
import { httpJson } from "../http";
import { toProviderError } from "../outreach";
import type { DiscoveryProvider, EnrichmentProvider, EnrichmentResult, LaunchResult, OutreachProvider, SendResult } from "../types";

/**
 * Amplemarket (https://api.amplemarket.com, Bearer key). Implemented from
 * docs.amplemarket.com and the published OpenAPI spec, read 2026-11-16; not
 * yet verified against a real account.
 *
 *   sequences  POST /sequences/{id}/leads   (max 250 leads, 30 req/min). Our engine-written
 *              copy travels as lead `data` fields the sequence's steps reference
 *              ({{oi_step_1_body}} ...), so personalization and Lab arms still apply.
 *   events     JSON push configured in the dashboard (no API, no signature): sequence
 *              stage and reply payloads -> /api/webhooks/amplemarket?token=...
 *   enrich     GET /people/find (reveal_email, reveal_phone_numbers; credits per reveal)
 *   discovery  POST /people/search (filters from AMPLEMARKET_SEARCH_FILTERS)
 *
 * Gaps in Amplemarket's public API: a lead cannot be paused or removed from a
 * sequence, and opens, clicks, bounces and unsubscribes are not pushed.
 */

const BASE = "https://api.amplemarket.com";

export async function amplemarket<T = unknown>(path: string, opts: { method?: "GET" | "POST"; body?: unknown; context: string }): Promise<T> {
  if (!config.amplemarket.apiKey) throw new PermanentError("AMPLEMARKET_API_KEY is not set");
  try {
    const { data } = await httpJson<T>(`${BASE}${path}`, { method: opts.method, body: opts.body, headers: { authorization: `Bearer ${config.amplemarket.apiKey}` }, timeoutMs: 25_000 });
    return data;
  } catch (err) {
    throw toProviderError(err, `amplemarket ${opts.context}`);
  }
}

const Phone = z.object({ number: z.string(), type: z.string().nullish(), source: z.string().nullish(), is_wrong_number: z.boolean().nullish(), is_dnc_listed: z.boolean().nullish() }).passthrough();
const Company = z.object({ id: z.unknown().optional(), name: z.string().nullish(), website: z.string().nullish(), linkedin_url: z.string().nullish(), industry: z.string().nullish(), size: z.string().nullish() }).passthrough();
const AmPerson = z
  .object({
    id: z.unknown().optional(),
    name: z.string().nullish(),
    first_name: z.string().nullish(),
    last_name: z.string().nullish(),
    email: z.string().nullish(),
    title: z.string().nullish(),
    linkedin_url: z.string().nullish(),
    location: z.string().nullish(),
    phone_numbers: z.array(Phone).nullish(),
    company: Company.nullish(),
  })
  .passthrough();
type AmPerson = z.infer<typeof AmPerson>;

/** A direct or mobile number that is not flagged wrong or do-not-call. */
export function usablePhone(phones: z.infer<typeof Phone>[] | null | undefined): string | null {
  const ok = (phones ?? []).filter((p) => !p.is_wrong_number && !p.is_dnc_listed);
  return (ok.find((p) => p.type === "mobile" || p.type === "direct") ?? ok[0])?.number ?? null;
}

export function seniorityFromTitle(title: string): Seniority {
  if (/chief|\bc[eofr]o\b|president|owner|founder/i.test(title)) return "c_level";
  if (/\bvp\b|vice president/i.test(title)) return "vp";
  if (/director|head of/i.test(title)) return "director";
  if (/manager|lead\b/i.test(title)) return "manager";
  return "ic";
}

const domainOf = (website: string | null | undefined) => (website ?? "").replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].toLowerCase();

/** "51-200 employees" / "10001+ employees" -> a headcount. */
export function employeesFromSize(size: string | null | undefined): number {
  const nums = [...(size ?? "").replace(/,/g, "").matchAll(/\d+/g)].map((m) => Number(m[0]));
  if (!nums.length) return 0;
  return nums.length > 1 ? Math.round((nums[0] + nums[1]) / 2) : nums[0];
}

// --- Sequences ---------------------------------------------------------------------------

const AddLeads = z
  .object({
    total: z.number().optional(),
    total_added_to_sequence: z.number().optional(),
    already_in_sequence_and_skipped: z.array(z.unknown()).optional(),
    recently_contacted_and_skipped: z.array(z.unknown()).optional(),
    in_exclusion_list_and_skipped: z.array(z.unknown()).optional(),
    in_other_active_sequences_and_skipped: z.array(z.unknown()).optional(),
  })
  .passthrough();

/** Lead data fields: lowercase snake_case, string values of at most 1024 characters, at most 50 per lead. */
export function leadData(account: Account, touches: OutreachTouch[]): Record<string, string> {
  const c = account.contact!;
  const [first, ...rest] = c.name.trim().split(/\s+/);
  const out: Record<string, string> = {
    first_name: first ?? c.name,
    last_name: rest.join(" "),
    company_name: account.companyName,
    title: c.title,
    oi_account_id: account.id,
    oi_page_url: account.campaign?.pageUrl ?? "",
    oi_angle: account.campaign?.angle ?? account.messagingAngle ?? "",
  };
  if (touches[0]?.contactId) out.oi_contact_id = touches[0].contactId;
  // One subject/body pair per sequence step, in order, for the sequence's templates to reference.
  touches
    .filter((t) => t.channel === "email" || t.channel === "linkedin" || t.channel === "inmail")
    .slice(0, 20)
    .forEach((t, i) => {
      if (t.subject) out[`oi_step_${i + 1}_subject`] = t.subject.slice(0, 1024);
      out[`oi_step_${i + 1}_body`] = t.body.slice(0, 1024);
    });
  for (const k of Object.keys(out)) if (!out[k]) delete out[k];
  return Object.fromEntries(Object.entries(out).slice(0, 50));
}

export function sequenceFor(person: Person): string {
  const byRole = config.amplemarket.sequenceByRole ? (JSON.parse(config.amplemarket.sequenceByRole) as Record<string, string>) : {};
  const id = byRole[classifyRole(person).role] ?? config.amplemarket.sequenceId;
  if (!id) throw new PermanentError("AMPLEMARKET_SEQUENCE_ID is not set");
  return id;
}

export class AmplemarketOutreachProvider implements OutreachProvider {
  readonly name = "amplemarket";
  readonly channels: OutreachTouch["channel"][] = ["email", "linkedin"];
  readonly ownsScheduling = true;

  async launchSequence(account: Account, touches: OutreachTouch[]): Promise<LaunchResult> {
    const person = account.contact;
    if (!person) throw new PermanentError("no contact to add to the Amplemarket sequence");
    if (!person.email && !person.linkedin) throw new PermanentError(`${person.name} has no email or LinkedIn URL; Amplemarket needs one`);
    const sequenceId = sequenceFor(person);
    const r = AddLeads.parse(
      await amplemarket(`/sequences/${encodeURIComponent(sequenceId)}/leads`, {
        method: "POST",
        body: { leads: [{ email: person.email ?? null, linkedin_url: person.linkedin ?? null, data: leadData(account, touches), overrides: { ignore_recently_contacted: false } }], settings: { leads_distribution: "sequence_senders" } },
        context: "add lead to sequence",
      }),
    );
    const skipped = (["already_in_sequence_and_skipped", "recently_contacted_and_skipped", "in_exclusion_list_and_skipped", "in_other_active_sequences_and_skipped"] as const).find((k) => (r[k]?.length ?? 0) > 0);
    const note = skipped ? `Amplemarket skipped ${person.name}: ${skipped.replace(/_and_skipped$/, "").replace(/_/g, " ")}` : `added to Amplemarket sequence ${sequenceId}`;
    return {
      sequenceId,
      touches: touches.map((t) =>
        this.channels.includes(t.channel) ? { ...t, provider: this.name, externalId: sequenceId, status: skipped ? ("skipped" as const) : ("scheduled" as const), note } : t,
      ),
    };
  }

  async sendTouch(): Promise<SendResult> {
    return { status: "failed", note: "Amplemarket runs the sequence; single sends are not used", retryable: false };
  }

  async adaptSequence(_account: Account, reason: string) {
    return { adapted: false, note: `Amplemarket's API cannot edit a running sequence; the rep sees "${reason}" on the account` };
  }

  async pauseSequence(account: Account): Promise<void> {
    throw new PermanentError(`Amplemarket's API cannot pause a lead; pause ${account.contact?.name ?? "the lead"} in Amplemarket`);
  }

  async resumeSequence(account: Account): Promise<void> {
    throw new PermanentError(`Amplemarket's API cannot resume a lead; resume ${account.contact?.name ?? "the lead"} in Amplemarket`);
  }
}

// --- Enrichment ----------------------------------------------------------------------------

export class AmplemarketEnrichmentProvider implements EnrichmentProvider {
  readonly name = "amplemarket";

  async enrichContact(person: Person, account: Account): Promise<EnrichmentResult> {
    const q = new URLSearchParams({ reveal_email: "true", reveal_phone_numbers: String(config.amplemarket.revealPhones) });
    if (person.email) q.set("email", person.email);
    else if (person.linkedin) q.set("linkedin_url", person.linkedin);
    else {
      q.set("name", person.name);
      q.set("company_domain", account.domain);
      if (person.title) q.set("title", person.title);
    }
    let found: AmPerson | null = null;
    try {
      found = AmPerson.parse(await amplemarket(`/people/find?${q}`, { context: "find person" }));
    } catch (err) {
      if (/HTTP 404/.test((err as Error).message)) found = null;
      else throw err;
    }
    if (!found) return { contact: person, phoneVerified: false, linkedinMatched: Boolean(person.linkedin), recentNews: [], techStack: [], notes: ["Amplemarket: person not found"], complete: true, provider: this.name, provenance: "provider" };
    const phone = usablePhone(found.phone_numbers);
    const phoneVerified = Boolean(phone && (found.phone_numbers ?? []).some((p) => p.number === phone && (p.type === "mobile" || p.type === "direct")));
    return {
      contact: { ...person, email: found.email ?? person.email, phone: phone ?? person.phone, phoneVerified, linkedin: found.linkedin_url ?? person.linkedin, title: found.title ?? person.title, verifiedBy: this.name },
      phoneVerified,
      linkedinMatched: Boolean(found.linkedin_url),
      recentNews: [],
      techStack: [],
      notes: [found.email ? "Amplemarket email (not validated; Amplemarket returns no email status)" : "Amplemarket: no email", phone ? `phone ${phoneVerified ? "direct/mobile" : "found"} from Amplemarket` : "no usable phone"],
      complete: true,
      provider: this.name,
      provenance: "provider",
    };
  }
}

// --- Discovery ------------------------------------------------------------------------------

const DEFAULT_FILTERS = {
  person_titles: ["VP of Transportation", "Director of Logistics", "Transportation Manager", "VP of Supply Chain", "Director of Operations", "Logistics Manager", "CFO", "COO", "Procurement Manager"],
  company_sizes: ["51-200 employees", "201-500 employees", "501-1000 employees", "1001-5000 employees"],
};

const SearchPage = z.object({ results: z.array(AmPerson).default([]), _pagination: z.object({ total_pages: z.number().optional() }).passthrough().optional() }).passthrough();

/** People search results grouped into companies with their buying-group candidates. */
export function peopleToCompanies(people: AmPerson[]): CompanyFacts[] {
  const byDomain = new Map<string, CompanyFacts>();
  for (const p of people) {
    const domain = domainOf(p.company?.website);
    const name = p.name ?? [p.first_name, p.last_name].filter(Boolean).join(" ");
    if (!domain || !name || !p.company?.name) continue;
    const facts =
      byDomain.get(domain) ??
      ({
        companyName: p.company.name,
        domain,
        industry: p.company.industry ?? "Unknown",
        employeeCount: employeesFromSize(p.company.size),
        hqCity: (p.location ?? "").split(",")[0]?.trim() ?? "",
        hqState: (p.location ?? "").split(",")[1]?.trim() ?? "",
        jobPostings: [],
        news: [],
        techStack: [],
        painEvidence: [],
        people: [],
        source: "amplemarket",
      } as CompanyFacts);
    const title = p.title ?? "";
    if (!facts.people.some((x) => x.name === name)) {
      facts.people.push({ name, title, seniority: seniorityFromTitle(title), email: p.email ?? undefined, linkedin: p.linkedin_url ?? undefined, phone: usablePhone(p.phone_numbers) ?? undefined });
    }
    byDomain.set(domain, facts);
  }
  return [...byDomain.values()];
}

export class AmplemarketDiscoveryProvider implements DiscoveryProvider {
  readonly name = "amplemarket";

  private filters(): Record<string, unknown> {
    if (!config.amplemarket.searchFilters) return DEFAULT_FILTERS;
    try {
      return JSON.parse(config.amplemarket.searchFilters);
    } catch {
      throw new PermanentError("AMPLEMARKET_SEARCH_FILTERS is not valid JSON");
    }
  }

  async discover(limit: number): Promise<CompanyFacts[]> {
    const people: AmPerson[] = [];
    for (let page = 1; page <= 10; page++) {
      const r = SearchPage.parse(await amplemarket(`/people/search`, { method: "POST", body: { ...this.filters(), page, page_size: 100 }, context: "search people" }));
      people.push(...r.results);
      if (peopleToCompanies(people).length >= limit || page >= (r._pagination?.total_pages ?? 1) || !r.results.length) break;
    }
    return peopleToCompanies(people).slice(0, limit);
  }

  async refresh(facts: CompanyFacts): Promise<CompanyFacts> {
    const r = SearchPage.parse(await amplemarket(`/people/search`, { method: "POST", body: { ...this.filters(), company_domains: [facts.domain], page: 1, page_size: 100 }, context: "search company people" }));
    const fresh = peopleToCompanies(r.results).find((f) => f.domain === facts.domain);
    if (!fresh) return facts;
    const people = [...facts.people];
    for (const p of fresh.people) if (!people.some((x) => x.name.toLowerCase() === p.name.toLowerCase())) people.push(p);
    return { ...facts, people, employeeCount: facts.employeeCount || fresh.employeeCount, industry: facts.industry === "Unknown" ? fresh.industry : facts.industry };
  }

  async submit(): Promise<{ accepted: boolean; note: string }> {
    return { accepted: false, note: "Amplemarket discovery pulls from search; it does not accept submitted companies" };
  }
}

/** Read-only connection check: lists one sequence. */
export async function testAmplemarket(): Promise<{ ok: boolean; message: string }> {
  const r = await amplemarket<{ sequences?: unknown[]; data?: unknown[] }>(`/sequences?page[size]=1`, { context: "list sequences" });
  const n = (r.sequences ?? r.data ?? []).length;
  return { ok: true, message: `authenticated; sequences endpoint answered (${n} on the first page)` };
}
