import { createHmac } from "node:crypto";
import { runAgent } from "@/lib/agents/runtime";
import { error, json, safeEqual, callbackSecretMissing } from "@/lib/api";
import { config } from "@/lib/config";
import { recordOutcome } from "@/lib/engine/outcomes";
import { getProviders } from "@/lib/providers";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * Calendly webhook (invitee.created / invitee.canceled). Create the
 * subscription with POST https://api.calendly.com/webhook_subscriptions
 * { url: "<APP_URL>/api/webhooks/calendly", events: ["invitee.created","invitee.canceled"],
 *   organization, scope: "organization", signing_key: "<CALENDLY_WEBHOOK_SIGNING_KEY>" }.
 * Signature header: Calendly-Webhook-Signature: t=<unix>,v1=<hex>, where
 * v1 = HMAC-SHA256(signing_key, `${t}.${rawBody}`); reject if t is older than 3 minutes.
 * Docs: https://developer.calendly.com/api-docs/overview/webhooks/webhook-signatures.md ,
 *       https://developer.calendly.com/api-docs/calendly-api/webhooks/create-webhook-subscription.md
 *
 * Matching: utm_campaign (we set it to the account slug on the embed) first,
 * then the invitee's email domain.
 */
export async function POST(req: Request) {
  const blocked = callbackSecretMissing(config.calendly.signingKey, "CALENDLY_WEBHOOK_SIGNING_KEY");
  if (blocked) return blocked;
  const raw = await req.text();
  if (config.calendly.signingKey) {
    const header = req.headers.get("calendly-webhook-signature") ?? "";
    const parts = Object.fromEntries(header.split(",").map((kv) => kv.split("=") as [string, string]));
    const t = parts.t;
    const v1 = parts.v1;
    if (!t || !v1) return error("missing signature", 401);
    if (Math.abs(Date.now() / 1000 - Number(t)) > 180) return error("signature too old", 401);
    const expected = createHmac("sha256", config.calendly.signingKey).update(`${t}.${raw}`).digest("hex");
    if (!safeEqual(expected, v1)) return error("invalid signature", 401);
  }

  let body: {
    event?: string;
    payload?: { name?: string; email?: string; scheduled_event?: { start_time?: string; name?: string }; tracking?: { utm_campaign?: string | null } };
  };
  try {
    body = JSON.parse(raw);
  } catch {
    return error("invalid JSON");
  }
  if (!body.event || !body.payload) return error("event and payload are required");

  const store = getStore();
  const all = await store.listAccounts();
  const utm = body.payload.tracking?.utm_campaign ?? "";
  const emailDomain = body.payload.email?.split("@")[1]?.toLowerCase() ?? "";
  const account =
    (utm && all.find((a) => a.slug === utm)) || (emailDomain && all.find((a) => a.domain.toLowerCase().replace(/^www\./, "") === emailDomain.replace(/^www\./, ""))) || null;
  if (!account) return json({ ok: true, matched: false });

  if (body.event === "invitee.created") {
    const r = await recordOutcome(store, getProviders(), account, {
      outcomeType: "meeting_booked",
      notes: `Calendly: ${body.payload.scheduled_event?.name ?? "meeting"} at ${body.payload.scheduled_event?.start_time ?? "?"} with ${body.payload.name ?? body.payload.email ?? "invitee"}`,
      source: "calendly",
    });
    if (r.fedBack) void runAgent("learning", { force: true });
    return json({ ok: true, matched: true, slug: account.slug, outcome: "meeting_booked" });
  }
  if (body.event === "invitee.canceled") {
    await store.insertEvent({
      id: crypto.randomUUID(),
      accountId: account.id,
      eventType: "meeting_canceled",
      properties: { source: "calendly", name: body.payload.name, email: body.payload.email },
      visitorId: null,
      createdAt: new Date().toISOString(),
    });
    return json({ ok: true, matched: true, slug: account.slug, event: "meeting_canceled" });
  }
  return json({ ok: true, matched: true, ignored: body.event });
}
