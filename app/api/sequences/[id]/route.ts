import { z } from "zod";
import { audit, requireApiRole } from "@/lib/auth";
import { error, json, readJson } from "@/lib/api";
import { listExperiments } from "@/lib/engine/experiments";
import { BUILTIN_SEQUENCE_ID, normalizeSteps, setDefaultSequence, validateSequence } from "@/lib/engine/sequences";
import { sequences } from "@/lib/store/collections";
import { nowIso } from "@/lib/util";
import { AppliesTo, StepSchema } from "@/lib/engine/sequence-schemas";

export const dynamic = "force-dynamic";

const Body = z.object({
  action: z.enum(["save", "set_default", "activate", "archive", "draft"]).default("save"),
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  steps: z.array(StepSchema).min(1).max(12).optional(),
  appliesTo: AppliesTo.optional(),
  priority: z.number().int().min(0).max(100).optional(),
});

/** Edit a sequence, make it the default, activate, return to draft or archive it. The built-in sequence can only be made default. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole(["exec", "admin"]);
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const body = await readJson(req, Body);
  if (!body.ok) return body.response;
  const d = body.data;

  if (id === BUILTIN_SEQUENCE_ID) {
    if (d.action !== "set_default") return error("the built-in sequence cannot be edited; duplicate it instead", 409);
    await setDefaultSequence("");
    await audit(auth.user, "sequence_default", id, "built-in");
    return json({ ok: true });
  }
  const current = await sequences.get(id);
  if (!current) return error("unknown sequence", 404);

  const running = (await listExperiments()).filter((e) => e.status === "running" && e.arms.some((a) => a.config.sequenceId === id));
  if (running.length && (d.action === "archive" || d.action === "draft" || d.steps)) {
    return error(`a running experiment uses this sequence ("${running[0].name}"); stop it before changing the sequence`, 409);
  }

  let next = { ...current, updatedAt: nowIso() };
  if (d.name !== undefined) next.name = d.name;
  if (d.description !== undefined) next.description = d.description;
  if (d.steps) next.steps = normalizeSteps(d.steps.map((s) => ({ ...s, templateId: s.templateId ?? null })));
  if (d.appliesTo) next.appliesTo = d.appliesTo;
  if (d.priority !== undefined) next.priority = d.priority;
  if (d.action === "activate" || d.action === "set_default") next.status = "active";
  if (d.action === "draft") next = { ...next, status: "draft", isDefault: false };
  if (d.action === "archive") next = { ...next, status: "archived", isDefault: false };

  if (next.status !== "archived") {
    const problems = await validateSequence(next);
    if (problems.length) return error(problems.join("; "), 422);
  }
  await sequences.put(next);
  if (d.action === "set_default") await setDefaultSequence(id);
  if ((d.action === "archive" || d.action === "draft") && current.isDefault) await setDefaultSequence("");
  await audit(auth.user, `sequence_${d.action}`, id, next.name);
  return json({ ok: true, sequence: (await sequences.get(id)) ?? next });
}
