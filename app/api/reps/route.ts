import { z } from "zod";
import { audit, requireApiRole } from "@/lib/auth";
import { ensureDemoIdentities } from "@/lib/auth/users";
import { json, readJson } from "@/lib/api";
import { reps } from "@/lib/store/collections";
import { uuid } from "@/lib/util";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireApiRole(["bdr", "exec", "admin"]);
  if ("response" in auth) return auth.response;
  await ensureDemoIdentities();
  return json({ reps: await reps.list() });
}

export async function POST(req: Request) {
  const auth = await requireApiRole(["admin", "exec"]);
  if ("response" in auth) return auth.response;
  const body = await readJson(req, z.object({ id: z.string().optional(), name: z.string().min(2), email: z.string().email(), capacityPerDay: z.number().int().min(1).max(200), active: z.boolean().default(true) }));
  if (!body.ok) return body.response;
  const rep = { ...body.data, id: body.data.id ?? `rep_${uuid().slice(0, 8)}` };
  await reps.put(rep);
  await audit(auth.user, "upsert_rep", rep.id, `${rep.name} ${rep.capacityPerDay}/day ${rep.active ? "active" : "inactive"}`);
  return json({ ok: true, rep });
}
