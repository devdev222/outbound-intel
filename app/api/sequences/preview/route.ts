import { z } from "zod";
import { getOrBootstrapModel } from "@/lib/agents/runtime";
import { requireApiRole } from "@/lib/auth";
import { error, json, readJson } from "@/lib/api";
import { previewSequence } from "@/lib/engine/campaign";
import { allSequences, normalizeSteps } from "@/lib/engine/sequences";
import { getStore } from "@/lib/store";
import { nowIso } from "@/lib/util";
import { StepSchema } from "@/lib/engine/sequence-schemas";

export const dynamic = "force-dynamic";

const Body = z.object({ sequenceId: z.string().max(64).optional(), steps: z.array(StepSchema).min(1).max(12).optional(), slug: z.string().max(120).optional() });

/** Render a saved or unsaved sequence for one account. Nothing is created or sent. */
export async function POST(req: Request) {
  const auth = await requireApiRole(["bdr", "exec", "admin"]);
  if ("response" in auth) return auth.response;
  const body = await readJson(req, Body);
  if (!body.ok) return body.response;
  const store = getStore();
  const accounts = await store.listAccounts();
  const account = body.data.slug ? accounts.find((a) => a.slug === body.data.slug) : accounts.filter((a) => a.contact && a.signals.length).sort((a, b) => b.priority - a.priority)[0];
  if (!account) return error("no account to preview with; load or import accounts first", 404);
  let sequence = body.data.sequenceId ? (await allSequences()).find((s) => s.id === body.data.sequenceId) : undefined;
  if (body.data.steps) {
    const now = nowIso();
    sequence = { ...(sequence ?? { id: "preview", name: "Preview", description: "", status: "draft", isDefault: false, appliesTo: { industries: [], sizeBands: [], signalKeys: [] }, priority: 0, createdBy: auth.user.name, createdAt: now, updatedAt: now }), steps: normalizeSteps(body.data.steps.map((s) => ({ ...s, templateId: s.templateId ?? null }))) };
  }
  if (!sequence) return error("unknown sequence", 404);
  const steps = await previewSequence(account, sequence, await getOrBootstrapModel(store));
  return json({ ok: true, account: { slug: account.slug, company: account.companyName, contact: account.contact?.name ?? null }, steps });
}
