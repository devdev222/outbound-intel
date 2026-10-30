import { z } from "zod";
import { audit, requireApiRole } from "@/lib/auth";
import { json, readJson } from "@/lib/api";
import { EXPERIMENT_TEMPLATES, computeResults, newExperiment } from "@/lib/engine/experiments";
import { getStore } from "@/lib/store";
import { experiments } from "@/lib/store/collections";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireApiRole(["exec", "admin", "bdr"]);
  if ("response" in auth) return auth.response;
  const store = getStore();
  const list = await experiments.list();
  const withResults = await Promise.all(list.map(async (e) => ({ experiment: e, results: e.status === "draft" ? null : await computeResults(store, e) })));
  return json({ experiments: withResults, templates: EXPERIMENT_TEMPLATES });
}

const Arm = z.object({ key: z.string(), name: z.string(), share: z.number().min(0), config: z.record(z.string(), z.unknown()).default({}), control: z.boolean().default(false) });
const Body = z.object({
  name: z.string().min(3),
  hypothesis: z.string().min(3),
  type: z.enum(["email", "video", "landing_page", "assessment", "gifting", "testimonial"]),
  segment: z.object({ industries: z.array(z.string()).default([]), sizeBands: z.array(z.string()).default([]), signalKeys: z.array(z.string()).default([]), minScore: z.number().min(0).max(100).default(60) }),
  arms: z.array(Arm).min(2),
  primaryMetric: z.enum(["qualified_pipeline", "meetings_held", "opportunities", "meetings_booked"]),
  start: z.boolean().default(false),
});

export async function POST(req: Request) {
  const auth = await requireApiRole(["exec", "admin"]);
  if ("response" in auth) return auth.response;
  const body = await readJson(req, Body);
  if (!body.ok) return body.response;
  if (!body.data.arms.some((a) => a.control)) body.data.arms[0].control = true;
  const exp = newExperiment({ ...body.data, createdBy: auth.user.name, status: body.data.start ? "running" : "draft" });
  await experiments.put(exp);
  await audit(auth.user, "create_experiment", exp.id, exp.name);
  return json({ ok: true, experiment: exp });
}
