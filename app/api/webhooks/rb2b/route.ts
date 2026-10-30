import { runAgent, tick } from "@/lib/agents/runtime";
import { error, json, safeEqual } from "@/lib/api";
import { config } from "@/lib/config";
import { recordEngagement } from "@/lib/engine/engagement";
import { ingestFacts } from "@/lib/engine/ingest";
import { getProviders } from "@/lib/providers";
import { getStore } from "@/lib/store";
import type { CompanyFacts } from "@/lib/types";
import { slugify } from "@/lib/util";

export const dynamic = "force-dynamic";

/**
 * RB2B visitor de-anonymization webhook. RB2B POSTs one JSON object per
 * identified page view with space-separated keys (verbatim from their docs):
 *   "LinkedIn URL", "First Name", "Last Name", "Title", "Company Name",
 *   "Business Email", "Website", "Industry", "Employee Count", "Estimate Revenue",
 *   "City", "State", "Zipcode", "Seen At", "Referrer", "Captured URL", "Tags",
 *   "is_repeat_visit" | "is_repeat_visitor"
 * RB2B has no request signing: put a long random token in the URL
 * (.../api/webhooks/rb2b?token=<RB2B_WEBHOOK_SECRET>). Return 2xx quickly or
 * RB2B disables the webhook after repeated failures.
 * Docs: https://support.rb2b.com/en/articles/8976614-setup-guide-webhook
 *
 * Behaviour: if the visitor's company is a known account -> visitor_identified
 * engagement event (high value, feeds activation). If unknown -> create a
 * discovered account from the visitor's company so the team researches it.
 */
export async function POST(req: Request) {
  if (config.rb2b.webhookSecret) {
    const token = new URL(req.url).searchParams.get("token") ?? "";
    if (!safeEqual(token, config.rb2b.webhookSecret)) return error("unauthorized", 401);
  }
  let p: Record<string, unknown>;
  try {
    p = (await req.json()) as Record<string, unknown>;
  } catch {
    return error("invalid JSON");
  }
  const str = (k: string) => (typeof p[k] === "string" ? (p[k] as string) : "");
  const company = str("Company Name");
  const website = str("Website");
  const domain = website ? website.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] : "";
  const name = `${str("First Name")} ${str("Last Name")}`.trim();
  const title = str("Title");
  const capturedUrl = str("Captured URL");
  const isRepeat = Boolean(p.is_repeat_visit ?? p.is_repeat_visitor);
  if (!company && !domain) return json({ ok: true, ignored: "no company" });

  const store = getStore();
  const providers = getProviders();
  const all = await store.listAccounts();
  const account =
    (domain && all.find((a) => a.domain.toLowerCase().replace(/^www\./, "") === domain.toLowerCase())) ||
    all.find((a) => a.companyName.toLowerCase() === company.toLowerCase());

  if (account) {
    const r = await recordEngagement(store, providers, account, {
      eventType: "visitor_identified",
      properties: { name, title, email: str("Business Email"), linkedin: str("LinkedIn URL"), capturedUrl, referrer: str("Referrer"), tags: str("Tags"), isRepeat, source: "rb2b" },
      visitorId: str("LinkedIn URL") || str("Business Email") || null,
    });
    if (r.activationTriggered) void runAgent("jerry");
    return json({ ok: true, matched: true, slug: account.slug, activationTriggered: r.activationTriggered });
  }

  const facts: CompanyFacts = {
    companyName: company || domain,
    domain: domain || `${slugify(company)}.com`,
    industry: str("Industry") || "Unknown",
    employeeCount: Number(String(p["Employee Count"] ?? "").replace(/[^0-9]/g, "")) || 0,
    hqCity: str("City"),
    hqState: str("State"),
    jobPostings: [],
    news: [],
    techStack: [],
    painEvidence: [],
    people: name ? [{ name, title, seniority: "manager", email: str("Business Email") || undefined, linkedin: str("LinkedIn URL") || undefined }] : [],
    source: "rb2b",
  };
  const { account: created } = await ingestFacts(store, facts);
  await recordEngagement(store, providers, created, {
    eventType: "visitor_identified",
    properties: { name, title, capturedUrl, isRepeat, source: "rb2b", note: "new account created from website visitor" },
    visitorId: str("LinkedIn URL") || null,
  });
  void tick();
  return json({ ok: true, matched: false, created: created.slug });
}
