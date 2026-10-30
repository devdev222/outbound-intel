import { z } from "zod";
import { audit, requireApiRole } from "@/lib/auth";
import { error, json, readJson } from "@/lib/api";
import { buildArms, computeResults, conflictFor, EXPERIMENT_TYPES, ExperimentError, listExperiments, newExperiment, verdictFor } from "@/lib/engine/experiments";
import { getStore } from "@/lib/store";
import { experiments, getSettings } from "@/lib/store/collections";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireApiRole(["exec", "admin", "bdr"]);
  if ("response" in auth) return auth.response;
  const store = getStore();
  const list = await listExperiments();
  const withResults = await Promise.all(
    list.map(async (e) => {
      const results = e.status === "draft" ? null : await computeResults(store, e);
      return { experiment: e, results, verdict: verdictFor(e, results) };
    }),
  );
  return json({ experiments: withResults, types: EXPERIMENT_TYPES });
}

const Body = z.object({
  type: z.enum(["sequence", "template", "angle", "video", "landing_page", "proof", "assessment", "gifting"]),
  choices: z
    .object({
      sequenceIds: z.array(z.string().max(64)).max(2).optional(),
      templateStep: z.number().int().min(1).max(12).optional(),
      templateIds: z.array(z.string().max(64)).max(2).optional(),
      angle: z.string().trim().max(300).optional(),
      includeNoProof: z.boolean().optional(),
    })
    .default({}),
  name: z.string().trim().max(140).optional(),
  hypothesis: z.string().trim().max(500).optional(),
  segment: z.object({ industries: z.array(z.string()).default([]), sizeBands: z.array(z.string()).default([]), signalKeys: z.array(z.string()).default([]), minScore: z.number().min(0).max(100).default(60) }).default({ industries: [], sizeBands: [], signalKeys: [], minScore: 60 }),
  primaryMetric: z.enum(["qualified_pipeline", "meetings_held", "opportunities", "meetings_booked"]),
  targetPerArm: z.number().int().min(10).max(500).default(30),
  start: z.boolean().default(false),
});

/** Create an experiment from choices; the server builds the arms (control = today's setting). */
export async function POST(req: Request) {
  const auth = await requireApiRole(["exec", "admin"]);
  if ("response" in auth) return auth.response;
  const body = await readJson(req, Body);
  if (!body.ok) return body.response;
  const d = body.data;
  try {
    const built = await buildArms(d.type, d.choices, (await getSettings()).defaults);
    const exp = newExperiment({
      name: d.name || built.name,
      hypothesis: d.hypothesis || built.hypothesis,
      type: d.type,
      segment: d.segment,
      arms: built.arms,
      primaryMetric: d.primaryMetric,
      targetPerArm: d.targetPerArm,
      createdBy: auth.user.name,
      status: "draft",
    });
    let started = false;
    let conflict: string | null = null;
    if (d.start) {
      const other = conflictFor(exp, await listExperiments());
      if (other) conflict = `"${other.name}" is already testing this; it was saved as a draft`;
      else {
        exp.status = "running";
        exp.startedAt = exp.createdAt;
        started = true;
      }
    }
    await experiments.put(exp);
    await audit(auth.user, "create_experiment", exp.id, exp.name);
    return json({ ok: true, experiment: exp, started, conflict });
  } catch (err) {
    if (err instanceof ExperimentError) return error(err.message, 422);
    throw err;
  }
}
