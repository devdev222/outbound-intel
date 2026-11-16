import { error, json } from "@/lib/api";
import { config } from "@/lib/config";
import { bodyKey, onceResponse } from "@/lib/engine/idempotency";
import { handleAttioEvent } from "@/lib/engine/vendor-events";
import { getProviders } from "@/lib/providers";
import { verifyAttioSignature } from "@/lib/providers/vendors/attio";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * Attio webhooks (created with POST /v2/webhooks; subscribe to record.updated
 * and record.created on Deals). Verified with Attio-Signature (hex HMAC-SHA256
 * of the raw body with the secret Attio returned when the webhook was created).
 * Delivery is at least once; the Idempotency-Key header is stable across retries.
 * Attio needs a 2xx within 5 seconds.
 */
export async function POST(req: Request) {
  if (!config.attio.webhookSecret) return error("Attio webhooks are not configured: set ATTIO_WEBHOOK_SECRET", 503);
  const raw = await req.text();
  if (!verifyAttioSignature(raw, req.headers.get("attio-signature") ?? req.headers.get("x-attio-signature"))) return error("invalid signature", 401);
  let body: { events?: { event_type?: string; id?: { object_id?: string; record_id?: string } }[] };
  try {
    body = JSON.parse(raw);
  } catch {
    return error("invalid JSON");
  }
  const store = getStore();
  return onceResponse(store, "webhook:attio", req.headers.get("idempotency-key") ?? bodyKey(raw), async () => {
    const results = [];
    for (const ev of (body.events ?? []).slice(0, 20)) results.push(await handleAttioEvent(store, getProviders(), ev));
    return json({ ok: true, results });
  });
}
