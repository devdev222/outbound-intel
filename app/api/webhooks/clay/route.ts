import { z } from "zod";
import { isRejected, mergeContact } from "@/lib/engine/contact";
import { bodyKey, onceResponse } from "@/lib/engine/idempotency";
import { tick } from "@/lib/agents/runtime";
import { error, json, safeEqual, callbackSecretMissing } from "@/lib/api";
import { config } from "@/lib/config";
import { logActivity } from "@/lib/engine/activity";
import { ingestFacts } from "@/lib/engine/ingest";
import { clayRowToFacts, type ClayRow } from "@/lib/providers/discovery/clay";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Inbound from Clay. Configure an "HTTP API" enrichment column in the Clay
 * table with:  POST {APP_URL}/api/webhooks/clay , header x-webhook-secret: <CLAY_WEBHOOK_SECRET>,
 * and a JSON body built from the row's columns using Clay's "/Column Name" syntax
 * (see docs/WIRING.md for the exact body). Two payload kinds:
 *
 *   kind "company" (default): a company row -> upsert account + facts.
 *   kind "contact": an enriched contact row -> update the account's contact.
 *
 * Docs: https://university.clay.com/docs/http-api-integration-overview
 */
const ContactRow = z.object({
  kind: z.literal("contact"),
  account_slug: z.string(),
  full_name: z.string().optional(),
  title: z.string().optional(),
  email: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  phone_verified: z.union([z.boolean(), z.string()]).optional(),
  linkedin: z.string().optional().nullable(),
});

export async function POST(req: Request) {
  const blocked = callbackSecretMissing(config.clay.inboundSecret, "CLAY_WEBHOOK_SECRET");
  if (blocked) return blocked;
  if (config.clay.inboundSecret) {
    const header = req.headers.get("x-webhook-secret") ?? "";
    if (!safeEqual(header, config.clay.inboundSecret)) return error("unauthorized", 401);
  }
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return error("invalid JSON");
  }
  const store = getStore();
  // Persistent idempotency: a redelivered webhook returns the stored response instead of acting twice.
  return onceResponse(store, "webhook:clay", bodyKey(JSON.stringify(raw)), async () => {

  const contact = ContactRow.safeParse(raw);
  if (contact.success) {
    const account = await store.getAccountBySlug(contact.data.account_slug);
    if (!account) return error("unknown account_slug", 404);
    // Field-level merge with provenance: a new number is never treated as verified unless Clay
    // verified THAT number, and a different person never inherits the previous person's details.
    const verified = contact.data.phone_verified === true || contact.data.phone_verified === "true";
    const updated =
      (await store.patchAccount(account.id, (cur) => {
        const merged = mergeContact(cur.contact, { name: contact.data.full_name ?? undefined, title: contact.data.title ?? undefined, email: contact.data.email ?? undefined, phone: contact.data.phone ?? undefined, linkedin: contact.data.linkedin ?? undefined, phoneVerified: verified && Boolean(contact.data.phone ?? cur.contact?.phone) }, "clay");
        if (isRejected(cur, merged)) return null;
        return { ...cur, contact: merged };
      })) ?? account;
    await logActivity(store, updated.id, "webhook", "clay_contact_enriched", "Clay returned enriched contact data", [
      contact.data.phone ? "phone received" : "no phone",
      contact.data.linkedin ? "LinkedIn received" : "no LinkedIn",
      contact.data.email ? "email received" : "no email",
    ]);
    return json({ ok: true, kind: "contact", slug: updated.slug });
  }

  const row = raw as Partial<ClayRow>;
  if (!row.company_name) return error("company_name is required");
  const facts = clayRowToFacts(row as ClayRow);
  const { account, created } = await ingestFacts(store, facts);
  await logActivity(store, account.id, "webhook", created ? "clay_row_created" : "clay_row_updated", `${created ? "Account created" : "Facts refreshed"} from a Clay row`, [
    `${facts.jobPostings.length} postings, ${facts.news.length} news items, ${facts.techStack.length} technologies, ${facts.painEvidence.length} pain quotes, ${facts.people.length} people`,
  ]);
  void tick(); // let the team pick it up right away
  return json({ ok: true, kind: "company", created, slug: account.slug, page_url: `${config.appUrl}/for/${account.slug}` });
  });
}
