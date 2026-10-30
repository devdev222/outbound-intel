import { json } from "@/lib/api";
import { getStore } from "@/lib/store";
import { suppressions } from "@/lib/store/collections";
import { nowIso, uuid } from "@/lib/util";

export const dynamic = "force-dynamic";

/** Public one-click opt-out link from emails: /api/optout?slug=<account>&e=<email>. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const slug = url.searchParams.get("slug");
  const email = url.searchParams.get("e")?.toLowerCase();
  const account = slug ? await getStore().getAccountBySlug(slug) : null;
  const target = email ?? (account?.contact?.email ? account.contact.email.toLowerCase() : account ? `@${account.domain}` : null);
  if (!target) return json({ ok: false, error: "nothing to opt out" }, 400);
  await suppressions.put({ id: uuid(), target, reason: "opt_out", note: `one-click opt-out${slug ? ` from ${slug}` : ""}`, createdBy: "prospect", at: nowIso() });
  return new Response(`<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;padding:40px;max-width:520px;margin:auto"><h2>You're unsubscribed</h2><p>${target} will not receive further outreach from us.</p></body>`, { headers: { "content-type": "text/html; charset=utf-8" } });
}
