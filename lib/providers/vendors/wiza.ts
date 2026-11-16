import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { config } from "@/lib/config";
import { PermanentError } from "@/lib/engine/operations";
import type { Account, Person } from "@/lib/types";
import { httpJson } from "../http";
import { toProviderError } from "../outreach";
import type { EnrichmentProvider, EnrichmentResult } from "../types";

/**
 * Wiza individual reveals (https://wiza.co/api, Bearer key). Implemented from
 * docs.wiza.co, read 2026-11-16; not yet verified against a real account.
 *
 *   POST /api/individual_reveals  { individual_reveal: {profile_url} | {email} | {full_name, domain}, enrichment_level, email_options, callback_url }
 *   GET  /api/individual_reveals/{id}   status: queued | resolving | finished | failed
 *   callback: same body as the GET; x-auth-key header = SHA256(API key)
 *
 * enrichContact polls for up to WIZA_POLL_SECONDS. A reveal still running
 * after that finishes through the callback (/api/webhooks/wiza?contact=<id>).
 * Credits: 2 for a valid email, 5 when a phone is found, nothing when nothing is found.
 */

const BASE = "https://wiza.co/api";

export async function wiza<T = unknown>(path: string, opts: { method?: "GET" | "POST"; body?: unknown; context: string }): Promise<T> {
  if (!config.wiza.apiKey) throw new PermanentError("WIZA_API_KEY is not set");
  try {
    const { data } = await httpJson<T>(`${BASE}${path}`, { method: opts.method, body: opts.body, headers: { authorization: `Bearer ${config.wiza.apiKey}` }, timeoutMs: 20_000 });
    return data;
  } catch (err) {
    throw toProviderError(err, `wiza ${opts.context}`);
  }
}

export const Reveal = z
  .object({
    id: z.union([z.string(), z.number()]).transform(String),
    status: z.string(),
    is_complete: z.boolean().nullish(),
    fail_error: z.string().nullish(),
    name: z.string().nullish(),
    title: z.string().nullish(),
    linkedin_profile_url: z.string().nullish(),
    email: z.string().nullish(),
    email_type: z.string().nullish(),
    email_status: z.string().nullish(),
    mobile_phone: z.string().nullish(),
    phone_number: z.string().nullish(),
    phone_status: z.string().nullish(),
    phones: z.array(z.object({ number: z.string(), pretty_number: z.string().nullish(), type: z.string().nullish() }).passthrough()).nullish(),
    company_domain: z.string().nullish(),
  })
  .passthrough();
export type Reveal = z.infer<typeof Reveal>;
const Envelope = z.object({ data: Reveal });

/** Map a finished reveal onto the person: only a "valid" email and a found phone count as verified. */
export function revealToResult(person: Person, r: Reveal, provider = "wiza"): EnrichmentResult {
  const validEmail = r.email && r.email_status === "valid" ? r.email : null;
  const phone = r.mobile_phone ?? r.phones?.find((p) => p.type === "mobile")?.number ?? r.phone_number ?? r.phones?.[0]?.number ?? null;
  const phoneVerified = Boolean(phone && r.phone_status === "found");
  return {
    contact: { ...person, email: validEmail ?? person.email, phone: phone ?? person.phone, phoneVerified, linkedin: r.linkedin_profile_url ?? person.linkedin, title: r.title ?? person.title, verifiedBy: validEmail || phoneVerified ? provider : (person.verifiedBy ?? null) },
    phoneVerified,
    linkedinMatched: Boolean(r.linkedin_profile_url),
    recentNews: [],
    techStack: [],
    notes: [
      r.email ? `Wiza email ${r.email_status ?? "unknown"}${r.email_type ? ` (${r.email_type})` : ""}` : "Wiza: no email found",
      phone ? `Wiza phone ${r.phone_status ?? "unknown"}` : "Wiza: no phone found",
    ],
    complete: true,
    provider,
    provenance: "provider",
  };
}

export class WizaEnrichmentProvider implements EnrichmentProvider {
  readonly name = "wiza";

  async enrichContact(person: Person, account: Account, opts: { contactId?: string } = {}): Promise<EnrichmentResult> {
    const input = person.linkedin ? { profile_url: person.linkedin } : person.email ? { email: person.email } : { full_name: person.name, domain: account.domain };
    const callback = /^https:\/\//.test(config.appUrl) ? `${config.appUrl}/api/webhooks/wiza${opts.contactId ? `?contact=${encodeURIComponent(opts.contactId)}` : ""}` : undefined;
    const started = Envelope.parse(
      await wiza(`/individual_reveals`, {
        method: "POST",
        body: { individual_reveal: input, enrichment_level: config.wiza.enrichmentLevel, email_options: { accept_work: true, accept_personal: false }, ...(callback ? { callback_url: callback } : {}) },
        context: "start reveal",
      }),
    ).data;
    let r = started;
    const deadline = Date.now() + config.wiza.pollSeconds * 1000;
    while (r.status !== "finished" && r.status !== "failed" && Date.now() < deadline) {
      await new Promise((res) => setTimeout(res, 2000));
      r = Envelope.parse(await wiza(`/individual_reveals/${encodeURIComponent(started.id)}`, { context: "poll reveal" })).data;
    }
    if (r.status === "failed") {
      // Billing problems arrive as HTTP 200 with status failed; retrying cannot help.
      if (r.fail_error === "billing_issue") throw new PermanentError("wiza: billing issue (check credits and subscription)");
      return { contact: person, phoneVerified: false, linkedinMatched: Boolean(person.linkedin), recentNews: [], techStack: [], notes: [`Wiza reveal failed: ${r.fail_error ?? "unknown"}`], complete: true, provider: this.name, provenance: "provider" };
    }
    if (r.status !== "finished") {
      return { contact: person, phoneVerified: false, linkedinMatched: Boolean(person.linkedin), recentNews: [], techStack: [], notes: [`Wiza reveal ${r.id} still ${r.status}; the result arrives on the callback`], complete: false, provider: this.name, provenance: "provider" };
    }
    return revealToResult(person, r, this.name);
  }
}

/** Callback check: x-auth-key must equal SHA256(API key), compared in constant time. */
export function verifyWizaCallback(header: string | null, apiKey = config.wiza.apiKey): boolean {
  if (!apiKey || !header) return false;
  const expected = Buffer.from(createHash("sha256").update(apiKey).digest("hex"));
  const got = Buffer.from(header.trim().toLowerCase());
  return expected.length === got.length && timingSafeEqual(expected, got);
}

/** Read-only connection check: credit balance. */
export async function testWiza(): Promise<{ ok: boolean; message: string }> {
  const r = await wiza<{ credits?: Record<string, unknown> }>(`/meta/credits`, { context: "credits" });
  const c = r.credits ?? {};
  return { ok: Boolean(r.credits), message: `authenticated; credits: email ${String(c.email_credits ?? "?")}, phone ${String(c.phone_credits ?? "?")}, api ${String(c.api_credits ?? "?")}` };
}
