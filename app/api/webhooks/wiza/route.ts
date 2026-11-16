import { error, json } from "@/lib/api";
import { bodyKey, onceResponse } from "@/lib/engine/idempotency";
import { handleWizaReveal } from "@/lib/engine/vendor-events";
import { getProviders } from "@/lib/providers";
import { Reveal, verifyWizaCallback } from "@/lib/providers/vendors/wiza";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * Wiza individual-reveal callback (callback_url set per reveal, with the
 * buying-group person in ?contact=). Verified with x-auth-key = SHA256(WIZA_API_KEY).
 * Wiza retries up to 3 times on non-2xx and stops after repeated 403/404.
 */
export async function POST(req: Request) {
  if (!verifyWizaCallback(req.headers.get("x-auth-key"))) return error("invalid auth key", 401);
  const contactId = new URL(req.url).searchParams.get("contact");
  const raw = await req.text();
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return error("invalid JSON");
  }
  const parsed = Reveal.safeParse((body as { data?: unknown })?.data ?? body);
  if (!parsed.success) return error("unexpected reveal shape");
  if (!contactId) return json({ ok: true, handled: "no contact in the callback URL" });
  const store = getStore();
  return onceResponse(store, "webhook:wiza", `${parsed.data.id}:${parsed.data.status}:${bodyKey(raw).slice(0, 16)}`, async () => json({ ok: true, ...(await handleWizaReveal(store, getProviders(), contactId, parsed.data)) }));
}
