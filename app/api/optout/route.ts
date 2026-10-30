import { logActivity } from "@/lib/engine/activity";
import { escapeHtml, verifyOptOut } from "@/lib/engine/optout";
import { getStore } from "@/lib/store";
import { suppressions } from "@/lib/store/collections";
import { nowIso, uuid } from "@/lib/util";

export const dynamic = "force-dynamic";

const EMAIL = /^[^\s@<>"']{1,64}@[^\s@<>"']{1,190}\.[a-z]{2,24}$/i;

function page(title: string, body: string, status = 200): Response {
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><body style="font-family:system-ui;padding:40px 16px;max-width:520px;margin:auto;color:#16181d"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(body)}</p></body>`,
    { status, headers: { "content-type": "text/html; charset=utf-8", "x-content-type-options": "nosniff" } },
  );
}

/**
 * One-click opt-out from a signed link: /api/optout?a=<accountId>&e=<email>&t=<token>.
 * Only the exact recipient bound to the token is suppressed. All output is escaped.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const accountId = url.searchParams.get("a") ?? "";
  const email = (url.searchParams.get("e") ?? "").trim().toLowerCase();
  const token = url.searchParams.get("t") ?? "";
  if (!EMAIL.test(email) || !(await verifyOptOut(accountId, email, token))) {
    return page("This unsubscribe link is not valid", "The link may be incomplete. Reply to the email and we will remove you by hand.", 400);
  }
  const existing = (await suppressions.list()).find((s) => s.target === email);
  if (!existing) {
    await suppressions.put({ id: uuid(), target: email, reason: "opt_out", note: `one-click opt-out (account ${accountId})`, createdBy: "prospect", at: nowIso() });
    const store = getStore();
    if (await store.getAccountById(accountId)) await logActivity(store, accountId, "webhook", "opted_out", `${email} unsubscribed; all outreach to this address stops`);
  }
  return page("You're unsubscribed", `${email} will not receive further outreach from us.`);
}
