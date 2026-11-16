import { callbackSecretMissing, error, json, safeEqual } from "@/lib/api";
import { config } from "@/lib/config";
import { bodyKey, onceResponse } from "@/lib/engine/idempotency";
import { handleAmplemarketEvent } from "@/lib/engine/vendor-events";
import { getProviders } from "@/lib/providers";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * Amplemarket JSON push (Settings -> Integrations -> JSON data, or a workflow's
 * "Send JSON to endpoint"). Amplemarket does not sign payloads, so the URL
 * carries a long random token: .../api/webhooks/amplemarket?token=<AMPLEMARKET_WEBHOOK_SECRET>.
 * Redeliveries of the same body are recognized and answered from the first result.
 */
export async function POST(req: Request) {
  const blocked = callbackSecretMissing(config.amplemarket.webhookSecret, "AMPLEMARKET_WEBHOOK_SECRET");
  if (blocked) return blocked;
  if (config.amplemarket.webhookSecret && !safeEqual(new URL(req.url).searchParams.get("token") ?? "", config.amplemarket.webhookSecret)) return error("unauthorized", 401);
  const raw = await req.text();
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return error("invalid JSON");
  }
  const store = getStore();
  return onceResponse(store, "webhook:amplemarket", bodyKey(raw), async () => {
    const items = (Array.isArray(body) ? body : [body]).filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === "object");
    const results = [];
    for (const p of items.slice(0, 100)) results.push(await handleAmplemarketEvent(store, getProviders(), p));
    return json({ ok: true, results });
  });
}
