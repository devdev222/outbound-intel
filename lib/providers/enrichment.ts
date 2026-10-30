import { config } from "@/lib/config";
import type { Account, Person } from "@/lib/types";
import { hash32 } from "@/lib/util";
import { httpJson } from "./http";
import type { EnrichmentProvider, EnrichmentResult } from "./types";

/**
 * Enrichment is the DATA tool Jerry calls to verify a phone, match a LinkedIn
 * profile and pull recent context. Jerry (the agent) decides when to call it
 * and what to do with the result; these providers only fetch.
 */

/** Deterministic mock: stable fake phone / LinkedIn per contact, synthetic news. */
export class MockEnrichmentProvider implements EnrichmentProvider {
  readonly name = "mock";

  async enrichContact(person: Person, account: Account): Promise<EnrichmentResult> {
    const h = hash32(`${account.slug}:${person.name}`);
    const area = 200 + (h % 800);
    const line = 1000 + ((h >>> 8) % 9000);
    const phone = person.phone ?? `(${area}) 555-${String(line).padStart(4, "0")}`;
    const first = person.name.split(" ")[0]?.toLowerCase() ?? "contact";
    const last = person.name.split(" ").slice(-1)[0]?.toLowerCase() ?? "";
    const latestNews = account.facts.news.slice(0, 2).map((n) => n.headline);
    return {
      contact: {
        ...person,
        phone,
        phoneVerified: true,
        email: person.email ?? `${first}.${last}@${account.domain}`,
        linkedin: person.linkedin ?? `https://www.linkedin.com/in/${first}-${last}-${(h % 9000) + 1000}`,
      },
      phoneVerified: true,
      linkedinMatched: true,
      recentNews: latestNews,
      techStack: account.facts.techStack.map((t) => t.name),
      notes: ["mock enrichment: values are synthetic"],
      complete: true,
      provider: this.name,
    };
  }
}

/**
 * Clay enrichment: push the contact into a Clay table whose columns run the
 * enrichment waterfall (phone, LinkedIn, email). Clay's HTTP API column posts
 * the finished row back to /api/webhooks/clay with `kind: "contact"`.
 * Asynchronous: returns complete=false and the webhook finishes the job.
 * Docs: https://university.clay.com/docs/webhook-integration-guide ,
 *       https://university.clay.com/docs/http-api-integration-overview
 */
export class ClayEnrichmentProvider implements EnrichmentProvider {
  readonly name = "clay";

  async enrichContact(person: Person, account: Account): Promise<EnrichmentResult> {
    const url = config.clay.enrichmentWebhookUrl;
    const pending: EnrichmentResult = {
      contact: person,
      phoneVerified: Boolean(person.phoneVerified),
      linkedinMatched: Boolean(person.linkedin),
      recentNews: [],
      techStack: [],
      notes: [],
      complete: false,
      provider: this.name,
    };
    if (!url) {
      pending.notes.push("CLAY_ENRICHMENT_WEBHOOK_URL not set");
      return pending;
    }
    await httpJson(url, {
      method: "POST",
      headers: config.clay.outboundToken ? { "x-clay-webhook-token": config.clay.outboundToken } : {},
      body: {
        kind: "contact",
        account_slug: account.slug,
        company_name: account.companyName,
        domain: account.domain,
        full_name: person.name,
        title: person.title,
        email: person.email ?? "",
        linkedin: person.linkedin ?? "",
        callback_url: `${config.appUrl}/api/webhooks/clay`,
      },
    });
    pending.notes.push("submitted to Clay enrichment table; result arrives via /api/webhooks/clay");
    return pending;
  }
}

/**
 * Generic HTTP enrichment service (for an in-house service that replaces Clay
 * later). Contract: POST {name, title, email, linkedin, company, domain} ->
 * {phone, phone_verified, linkedin, email, recent_news: string[], tech_stack: string[], notes: string[]}.
 */
export class HttpEnrichmentProvider implements EnrichmentProvider {
  readonly name = "http";

  async enrichContact(person: Person, account: Account): Promise<EnrichmentResult> {
    const { data } = await httpJson<{
      phone?: string;
      phone_verified?: boolean;
      linkedin?: string;
      email?: string;
      recent_news?: string[];
      tech_stack?: string[];
      notes?: string[];
    }>(config.enrichmentHttp.apiUrl, {
      method: "POST",
      headers: config.enrichmentHttp.apiKey ? { authorization: `Bearer ${config.enrichmentHttp.apiKey}` } : {},
      body: {
        name: person.name,
        title: person.title,
        email: person.email,
        linkedin: person.linkedin,
        company: account.companyName,
        domain: account.domain,
      },
    });
    return {
      contact: {
        ...person,
        phone: data.phone ?? person.phone,
        phoneVerified: Boolean(data.phone_verified),
        linkedin: data.linkedin ?? person.linkedin,
        email: data.email ?? person.email,
      },
      phoneVerified: Boolean(data.phone_verified),
      linkedinMatched: Boolean(data.linkedin ?? person.linkedin),
      recentNews: data.recent_news ?? [],
      techStack: data.tech_stack ?? [],
      notes: data.notes ?? [],
      complete: true,
      provider: this.name,
    };
  }
}
