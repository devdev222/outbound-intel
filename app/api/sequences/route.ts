import { z } from "zod";
import { audit, requireApiRole } from "@/lib/auth";
import { error, json, readJson } from "@/lib/api";
import { allSequences, newSequence, validateSequence } from "@/lib/engine/sequences";
import { AppliesTo, StepSchema } from "@/lib/engine/sequence-schemas";
import { sequences } from "@/lib/store/collections";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireApiRole(["bdr", "exec", "admin"]);
  if ("response" in auth) return auth.response;
  return json({ sequences: await allSequences() });
}

const Body = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().max(500).default(""),
  steps: z.array(StepSchema).min(1).max(12),
  appliesTo: AppliesTo.default({ industries: [], sizeBands: [], signalKeys: [] }),
  priority: z.number().int().min(0).max(100).default(0),
  status: z.enum(["draft", "active"]).default("draft"),
});

export async function POST(req: Request) {
  const auth = await requireApiRole(["exec", "admin"]);
  if ("response" in auth) return auth.response;
  const body = await readJson(req, Body);
  if (!body.ok) return body.response;
  const seq = newSequence({ ...body.data, steps: body.data.steps.map((s) => ({ ...s, templateId: s.templateId ?? null })) }, auth.user.name);
  const problems = await validateSequence(seq);
  if (problems.length) return error(problems.join("; "), 422);
  await sequences.put(seq);
  await audit(auth.user, "sequence_create", seq.id, seq.name);
  return json({ ok: true, sequence: seq });
}
