import { z } from "zod";
import { audit, requireApiRole } from "@/lib/auth";
import { error, json, readJson } from "@/lib/api";
import { suppressions } from "@/lib/store/collections";
import { nowIso, uuid } from "@/lib/util";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireApiRole(["exec", "admin", "bdr"]);
  if ("response" in auth) return auth.response;
  return json({ suppressions: await suppressions.list() });
}

export async function POST(req: Request) {
  const auth = await requireApiRole(["exec", "admin", "bdr"]);
  if ("response" in auth) return auth.response;
  const body = await readJson(req, z.object({ target: z.string().min(3), reason: z.enum(["opt_out", "customer", "competitor", "do_not_contact", "bounced", "manual"]), note: z.string().optional() }));
  if (!body.ok) return body.response;
  const s = { id: uuid(), target: body.data.target.trim().toLowerCase(), reason: body.data.reason, note: body.data.note ?? null, createdBy: auth.user.name, at: nowIso() };
  await suppressions.put(s);
  await audit(auth.user, "suppress", s.target, s.reason);
  return json({ ok: true, suppression: s });
}

export async function DELETE(req: Request) {
  const auth = await requireApiRole(["admin"]);
  if ("response" in auth) return auth.response;
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return error("id required");
  await suppressions.remove(id);
  await audit(auth.user, "unsuppress", id);
  return json({ ok: true });
}
