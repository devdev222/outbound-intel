import { z } from "zod";
import { audit, requireApiRole } from "@/lib/auth";
import { json, readJson, requireAccount } from "@/lib/api";
import { logActivity } from "@/lib/engine/activity";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

/** Assign / reassign an account to a rep, or suppress-and-close it. */
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const auth = await requireApiRole(["exec", "admin", "bdr"]);
  if ("response" in auth) return auth.response;
  const { slug } = await params;
  const body = await readJson(req, z.object({ repId: z.string().nullable().optional(), status: z.enum(["disqualified", "lost"]).optional(), note: z.string().optional() }));
  if (!body.ok) return body.response;
  const store = getStore();
  const found = await requireAccount(store, slug);
  if ("response" in found) return found.response;
  const next = { ...found.account, ownerRepId: body.data.repId === undefined ? found.account.ownerRepId : body.data.repId, status: body.data.status ?? found.account.status };
  const updated = await store.upsertAccount(next);
  await logActivity(store, updated.id, "rep", body.data.status ? "account_closed" : "account_assigned", body.data.status ? `Closed as ${body.data.status} by ${auth.user.name}` : `Assigned to ${body.data.repId ?? "nobody"} by ${auth.user.name}`, body.data.note ? [body.data.note] : []);
  await audit(auth.user, body.data.status ? "close_account" : "assign_account", slug, body.data.status ?? body.data.repId ?? "");
  return json({ ok: true, account: { slug: updated.slug, ownerRepId: updated.ownerRepId, status: updated.status } });
}
