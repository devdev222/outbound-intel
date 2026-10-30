import { createHmac, timingSafeEqual } from "node:crypto";
import { runAgent } from "@/lib/agents/runtime";
import { error, json } from "@/lib/api";
import { config } from "@/lib/config";
import { logActivity } from "@/lib/engine/activity";
import { recordEngagement } from "@/lib/engine/engagement";
import { getProviders } from "@/lib/providers";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * Resend email events. Payload (verified 2026-10-30):
 *   { type: "email.delivered" | "email.opened" | "email.clicked" | "email.bounced" | "email.complained" | ...,
 *     created_at, data: { email_id, from, to: string[], subject, tags: {account_slug, touch_id, step}, click?: { link, timestamp, ipAddress, userAgent } } }
 * Signed with Svix: headers svix-id, svix-timestamp, svix-signature ("v1,<base64>" space-separated);
 * signature = HMAC-SHA256(base64decode(secret without "whsec_"), `${id}.${timestamp}.${rawBody}`) in base64.
 * Docs: https://resend.com/docs/dashboard/webhooks/verify-webhooks-requests , https://docs.svix.com/receiving/verifying-payloads/how-manual
 */
function verify(raw: string, headers: Headers): boolean {
  const secret = config.resend.webhookSecret;
  if (!secret) return true; // not configured: accept (set RESEND_WEBHOOK_SECRET before going live)
  const id = headers.get("svix-id") ?? headers.get("webhook-id");
  const ts = headers.get("svix-timestamp") ?? headers.get("webhook-timestamp");
  const sigHeader = headers.get("svix-signature") ?? headers.get("webhook-signature");
  if (!id || !ts || !sigHeader) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${id}.${ts}.${raw}`).digest("base64");
  return sigHeader.split(" ").some((part) => {
    const [, sig] = part.split(",");
    if (!sig) return false;
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  });
}

const EVENT_MAP: Record<string, string> = {
  "email.delivered": "email_delivered",
  "email.opened": "email_open",
  "email.clicked": "email_click",
  "email.bounced": "email_bounced",
  "email.complained": "email_bounced",
};

export async function POST(req: Request) {
  const raw = await req.text();
  if (!verify(raw, req.headers)) return error("invalid signature", 401);
  let body: { type?: string; data?: { email_id?: string; tags?: Record<string, string>; click?: { link?: string }; to?: string[] } };
  try {
    body = JSON.parse(raw);
  } catch {
    return error("invalid JSON");
  }
  const type = body.type ?? "";
  const eventType = EVENT_MAP[type];
  if (!eventType) return json({ ok: true, ignored: type });

  const store = getStore();
  const tags = body.data?.tags ?? {};
  const touch = tags.touch_id ? await store.getOutreach(tags.touch_id) : null;
  const account = touch ? await store.getAccountById(touch.accountId) : tags.account_slug ? await store.getAccountBySlug(tags.account_slug) : null;
  if (!account) return json({ ok: true, matched: false });

  if (eventType === "email_bounced" && touch) {
    await store.updateOutreach({ ...touch, status: "failed", note: `${type} reported by Resend` });
    await logActivity(store, account.id, "webhook", "email_bounced", `Email step ${touch.step} ${type.replace("email.", "")}`);
  }
  const r = await recordEngagement(store, getProviders(), account, {
    eventType,
    properties: { step: touch?.step ?? (Number(tags.step) || undefined), touchId: touch?.id, emailId: body.data?.email_id, link: body.data?.click?.link, source: "resend" },
    visitorId: body.data?.to?.[0] ?? null,
  });
  if (r.activationTriggered) void runAgent("jerry");
  return json({ ok: true, matched: true, slug: account.slug, eventType, activationTriggered: r.activationTriggered });
}
