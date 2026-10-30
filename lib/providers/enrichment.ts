import { z } from "zod";
import { config, isLive } from "@/lib/config";
import { PermanentError } from "@/lib/engine/operations";
import type { Account, Person } from "@/lib/types";
import { hash32 } from "@/lib/util";
import { httpJson } from "./http";
import type { EnrichmentProvider, EnrichmentResult } from "./types";

/**
 * Enrichment is the DATA tool Jerry calls to verify a phone, match a LinkedIn
 * profile and pull recent context. Jerry (the agent) decides when to call it
 * and what to do with the result; these providers only fetch.
 */

/**
 * Deterministic mock: stable fake phone / LinkedIn per contact, synthetic news.
 * Results carry provenance "synthetic" and verifiedBy "synthetic" so readiness and
 * the UI never present them as verified real contacts. Refused in live mode.
 */
export class MockEnrichmentProvider implements EnrichmentProvider {
  readonly name = "mock";

  async enrichContact(person: Person, account: Account): Promise<EnrichmentResult> {
    if (isLive()) throw new PermanentError("mock enrichment is disabled in live mode; configure ENRICHMENT_PROVIDER");
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
        verifiedBy: "synthetic",
      },
      phoneVerified: true,
      linkedinMatched: true,
      recentNews: latestNews,
      techStack: account.facts.techStack.map((t) => t.name),
      notes: ["synthetic demo data: not a real verified contact"],
      complete: true,
      provider: this.name,
      provenance: "synthetic",
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

const HttpEnrichmentResponse = z.object({
  phone: z.string().min(3).optional().nullable().transform((v) => v ?? undefined),
  phone_verified: z.boolean().optional().nullable(),
  linkedin: z.string().url().optional().nullable().transform((v) => v ?? undefined),
  email: z.string().email().optional().nullable().transform((v) => v ?? undefined),
  recent_news: z.array(z.string()).optional().default([]),
  tech_stack: z.array(z.string()).optional().default([]),
  notes: z.array(z.string()).optional().default([]),
});

/**
 * Generic HTTP enrichment service (for an in-house service that replaces Clay
 * later). Contract: POST {name, title, email, linkedin, company, domain} ->
 * {phone, phone_verified, linkedin, email, recent_news: string[], tech_stack: string[], notes: string[]}.
 */
export class HttpEnrichmentProvider implements EnrichmentProvider {
  readonly name = "http";

  async enrichContact(person: Person, account: Account): Promise<EnrichmentResult> {
    if (!config.enrichmentHttp.apiUrl) throw new PermanentError("ENRICHMENT_API_URL is required for ENRICHMENT_PROVIDER=http");
    const { data: raw } = await httpJson<unknown>(config.enrichmentHttp.apiUrl, {
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
    const parsed = HttpEnrichmentResponse.safeParse(raw);
    if (!parsed.success) throw new PermanentError(`enrichment service returned an unexpected shape: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`);
    const data = parsed.data;
    // Only a literal boolean true verifies a phone; "false", "yes", 1 never do.
    const phoneVerified = data.phone_verified === true && Boolean(data.phone ?? person.phone);
    return {
      contact: {
        ...person,
        phone: data.phone ?? person.phone,
        phoneVerified,
        linkedin: data.linkedin ?? person.linkedin,
        email: data.email ?? person.email,
        verifiedBy: phoneVerified || data.email ? this.name : (person.verifiedBy ?? null),
      },
      phoneVerified,
      linkedinMatched: Boolean(data.linkedin ?? person.linkedin),
      recentNews: data.recent_news,
      techStack: data.tech_stack,
      notes: data.notes,
      complete: true,
      provider: this.name,
      provenance: "provider",
    };
  }
}
