import { z } from "zod";
import { audit, requireApiRole } from "@/lib/auth";
import { error, json, readJson } from "@/lib/api";
import { computeResults } from "@/lib/engine/experiments";
import { getStore } from "@/lib/store";
import { experiments } from "@/lib/store/collections";
import { nowIso } from "@/lib/util";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole(["exec", "admin", "bdr"]);
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const exp = await experiments.get(id);
  if (!exp) return error("unknown experiment", 404);
  return json({ experiment: exp, results: await computeResults(getStore(), exp) });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole(["exec", "admin"]);
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const exp = await experiments.get(id);
  if (!exp) return error("unknown experiment", 404);
  const body = await readJson(req, z.object({ action: z.enum(["start", "stop", "archive"]) }));
  if (!body.ok) return body.response;
  const next = body.data.action === "start" ? { ...exp, status: "running" as const, startedAt: exp.startedAt ?? nowIso(), endedAt: null } : { ...exp, status: "completed" as const, endedAt: nowIso() };
  await experiments.put(next);
  await audit(auth.user, `experiment_${body.data.action}`, id, exp.name);
  return json({ ok: true, experiment: next });
}
