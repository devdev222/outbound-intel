import { config } from "@/lib/config";
import type { CompanyFacts, JobPosting, NewsItem, PainEvidence, Person, TechStackItem } from "@/lib/types";
import { slugify } from "@/lib/util";
import { httpJson } from "../http";
import type { DiscoveryProvider, SignalCollector } from "../types";

/**
 * Clay adapter.
 *
 * Clay is push-based in both directions, so this adapter has two halves:
 *
 *  1. Outbound (us -> Clay): POST a JSON row to a Clay table's "Monitor webhook"
 *     source. Clay creates a row per POST; keys become columns. Optional auth
 *     token goes in a header (Clay shows the token once when you create the
 *     source). Clay never answers with data on this request.
 *     Docs: https://university.clay.com/docs/webhook-integration-guide
 *
 *  2. Inbound (Clay -> us): a Clay "HTTP API" enrichment column POSTs the
 *     enriched row to /api/webhooks/clay with a body you author in Clay using
 *     the "/Column Name" syntax. The payload schema is therefore ours; see
 *     `ClayRow` below and docs/WIRING.md for the column mapping to configure.
 *     Docs: https://university.clay.com/docs/http-api-integration-overview
 *
 * Clay also exposes a hosted MCP server (https://api.clay.com/v3/mcp, OAuth 2.0
 * PKCE) that agents can call directly for searches; that path is used by the
 * agent runtime when CLAY_MCP is configured and is outside this adapter.
 * Docs: https://university.clay.com/docs/connect-to-clay-mcp
 */

/** The flat row shape we ask Clay to send us. Configure the HTTP API column body to match. */
export interface ClayRow {
  company_name: string;
  domain: string;
  industry?: string;
  employee_count?: number | string;
  hq_city?: string;
  hq_state?: string;
  description?: string;
  /** JSON string or array: [{title, department, posted_at, url, location}] */
  job_postings?: string | Array<Record<string, string>>;
  /** JSON string or array: [{headline, kind, published_at, url, summary}] */
  news?: string | Array<Record<string, string>>;
  /** JSON string or array of technology names, or [{name, category}] */
  tech_stack?: string | Array<string | Record<string, string>>;
  /** JSON string or array: [{text, theme, source, url, captured_at}] */
  pain_evidence?: string | Array<Record<string, string>>;
  /** JSON string or array: [{name, title, email, linkedin, phone}] */
  people?: string | Array<Record<string, string>>;
  estimated_shipments_per_month?: number | string;
  clay_record_id?: string;
}

function parseMaybeJson<T>(v: unknown, fallback: T): T {
  if (v === undefined || v === null || v === "") return fallback;
  if (typeof v === "string") {
    try {
      return JSON.parse(v) as T;
    } catch {
      return fallback;
    }
  }
  return v as T;
}

function seniorityFromTitle(title: string): Person["seniority"] {
  const t = title.toLowerCase();
  if (/\b(ceo|coo|cfo|cio|cto|chief|president|owner|founder)\b/.test(t)) return "c_level";
  if (/\b(vp|vice president|svp|evp)\b/.test(t)) return "vp";
  if (/\bdirector|head of\b/.test(t)) return "director";
  if (/\bmanager|lead|supervisor\b/.test(t)) return "manager";
  return "ic";
}

/** Convert an inbound Clay row into the engine's CompanyFacts. */
export function clayRowToFacts(row: ClayRow): CompanyFacts {
  const jobs = parseMaybeJson<Array<Record<string, string>>>(row.job_postings, []);
  const news = parseMaybeJson<Array<Record<string, string>>>(row.news, []);
  const tech = parseMaybeJson<Array<string | Record<string, string>>>(row.tech_stack, []);
  const pain = parseMaybeJson<Array<Record<string, string>>>(row.pain_evidence, []);
  const people = parseMaybeJson<Array<Record<string, string>>>(row.people, []);
  const now = new Date().toISOString();

  return {
    companyName: row.company_name,
    domain: row.domain || `${slugify(row.company_name)}.com`,
    industry: row.industry ?? "Unknown",
    employeeCount: Number(row.employee_count) || 0,
    hqCity: row.hq_city ?? "",
    hqState: row.hq_state ?? "",
    description: row.description,
    jobPostings: jobs.map<JobPosting>((j) => ({
      title: j.title ?? "",
      department: j.department ?? "",
      postedAt: j.posted_at ?? now,
      url: j.url ?? "",
      location: j.location,
      description: j.description,
    })),
    news: news.map<NewsItem>((n) => ({
      headline: n.headline ?? "",
      kind: (n.kind as NewsItem["kind"]) ?? "other",
      publishedAt: n.published_at ?? now,
      url: n.url ?? "",
      summary: n.summary,
    })),
    techStack: tech.map<TechStackItem>((t) =>
      typeof t === "string"
        ? { name: t, category: "other", source: "clay" }
        : { name: t.name ?? "", category: (t.category as TechStackItem["category"]) ?? "other", source: "clay" },
    ),
    painEvidence: pain.map<PainEvidence>((p) => ({
      text: p.text ?? "",
      theme: p.theme ?? "operations",
      source: p.source ?? "clay",
      url: p.url ?? "",
      capturedAt: p.captured_at ?? now,
    })),
    people: people.map<Person>((p) => ({
      name: p.name ?? "",
      title: p.title ?? "",
      seniority: seniorityFromTitle(p.title ?? ""),
      email: p.email,
      linkedin: p.linkedin,
      phone: p.phone,
    })),
    estimatedShipmentsPerMonth: row.estimated_shipments_per_month ? Number(row.estimated_shipments_per_month) : undefined,
    source: "clay",
    externalId: row.clay_record_id,
  };
}

export class ClayDiscoveryProvider implements DiscoveryProvider {
  readonly name = "clay";

  /** Clay pushes to us; nothing to pull. New companies arrive at /api/webhooks/clay. */
  async discover(): Promise<CompanyFacts[]> {
    return [];
  }

  /** Re-submit the company to the Clay table; the enriched row comes back asynchronously. */
  async refresh(facts: CompanyFacts): Promise<CompanyFacts> {
    await this.submit(facts);
    return facts;
  }

  async submit(facts: CompanyFacts): Promise<{ accepted: boolean; note: string }> {
    const url = config.clay.discoveryWebhookUrl;
    if (!url) return { accepted: false, note: "CLAY_DISCOVERY_WEBHOOK_URL not set" };
    // Clay webhook source: HTTP POST, JSON body, one row per request.
    await httpJson(url, {
      method: "POST",
      headers: config.clay.outboundToken ? { "x-clay-webhook-token": config.clay.outboundToken } : {},
      body: {
        company_name: facts.companyName,
        domain: facts.domain,
        industry: facts.industry,
        employee_count: facts.employeeCount,
        hq_city: facts.hqCity,
        hq_state: facts.hqState,
        requested_at: new Date().toISOString(),
        callback_url: `${config.appUrl}/api/webhooks/clay`,
      },
    });
    return { accepted: true, note: "row submitted to Clay table; enrichment arrives via /api/webhooks/clay" };
  }
}

/**
 * Signal collector backed by Clay. Because Clay enriches asynchronously, the
 * collector only re-submits the company and returns nothing new synchronously;
 * the inbound webhook merges the enriched facts into the account.
 */
export class ClaySignalCollector implements SignalCollector {
  readonly name = "clay";
  constructor(private readonly provider: ClayDiscoveryProvider) {}
  async collect(facts: CompanyFacts): Promise<Partial<CompanyFacts>> {
    await this.provider.submit(facts);
    return {};
  }
}
