import { z } from "zod";
import { audit, requireApiRole } from "@/lib/auth";
import { error, json, readJson } from "@/lib/api";
import { computeResults, conflictFor, ExperimentError, getExperiment, listExperiments, rolloutArm, verdictFor } from "@/lib/engine/experiments";
import { getStore } from "@/lib/store";
import { experiments } from "@/lib/store/collections";
import { nowIso } from "@/lib/util";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole(["exec", "admin", "bdr"]);
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const exp = await getExperiment(id);
  if (!exp) return error("unknown experiment", 404);
  const results = await computeResults(getStore(), exp);
  return json({ experiment: exp, results, verdict: verdictFor(exp, results) });
}

const Body = z.discriminatedUnion("action", [z.object({ action: z.literal("start") }), z.object({ action: z.literal("stop") }), z.object({ action: z.literal("rollout"), armKey: z.string().min(1).max(64) })]);

/** Start (refused if another running experiment changes the same setting), stop, or roll out an arm as the new default. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole(["exec", "admin"]);
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const exp = await getExperiment(id);
  if (!exp) return error("unknown experiment", 404);
  const body = await readJson(req, Body);
  if (!body.ok) return body.response;
  const d = body.data;

  if (d.action === "start") {
    if (exp.status === "completed") return error("this experiment has ended; create a new one", 409);
    const other = conflictFor(exp, await listExperiments());
    if (other) return error(`"${other.name}" is already testing this setting; stop it first`, 409);
    const next = { ...exp, status: "running" as const, startedAt: exp.startedAt ?? nowIso(), endedAt: null };
    await experiments.put(next);
    await audit(auth.user, "experiment_start", id, exp.name);
    return json({ ok: true, experiment: next });
  }
  if (d.action === "stop") {
    const next = { ...exp, status: "completed" as const, endedAt: nowIso() };
    await experiments.put(next);
    await audit(auth.user, "experiment_stop", id, exp.name);
    return json({ ok: true, experiment: next });
  }
  try {
    const r = await rolloutArm(exp, d.armKey, auth.user);
    await audit(auth.user, "experiment_rollout", id, r.applied);
    return json({ ok: true, experiment: r.experiment, applied: r.applied });
  } catch (err) {
    if (err instanceof ExperimentError) return error(err.message, 422);
    throw err;
  }
}
