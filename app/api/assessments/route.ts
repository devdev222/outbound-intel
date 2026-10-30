import { z } from "zod";
import { runAgent } from "@/lib/agents/runtime";
import { json, readJson, requireAccount } from "@/lib/api";
import { logActivity } from "@/lib/engine/activity";
import { computeAssessment, defaultInputsFor } from "@/lib/engine/assessment";
import { recordEngagement } from "@/lib/engine/engagement";
import { getProviders } from "@/lib/providers";
import { getStore } from "@/lib/store";
import { assessments } from "@/lib/store/collections";
import { nowIso, uuid } from "@/lib/util";

export const dynamic = "force-dynamic";

const Inputs = z.object({
  shipmentsPerMonth: z.number().min(0).max(100000),
  quotesPerWeek: z.number().min(0).max(10000),
  minutesPerQuote: z.number().min(0).max(240),
  carriersContactedPerLoad: z.number().min(0).max(50),
  minutesPerCarrierContact: z.number().min(0).max(120),
  trackingChecksPerDay: z.number().min(0).max(5000),
  minutesPerTrackingCheck: z.number().min(0).max(60),
  exceptionsPerWeek: z.number().min(0).max(5000),
  minutesPerException: z.number().min(0).max(480),
  expectedGrowthPercent: z.number().min(0).max(500),
  hourlyCost: z.number().min(1).max(500),
});

/** Public: the prospect (or a rep) completes the Freight Operations Efficiency Assessment. */
export async function POST(req: Request) {
  const body = await readJson(req, z.object({ slug: z.string(), inputs: Inputs, source: z.enum(["prospect", "rep"]).default("prospect"), visitorId: z.string().optional() }));
  if (!body.ok) return body.response;
  const store = getStore();
  const found = await requireAccount(store, body.data.slug);
  if ("response" in found) return found.response;
  const results = computeAssessment(body.data.inputs);
  const assessment = { id: uuid(), accountId: found.account.id, inputs: body.data.inputs, results, source: body.data.source, at: nowIso() };
  await assessments.put(assessment);
  await logActivity(store, found.account.id, body.data.source === "rep" ? "rep" : "system", "assessment_completed", `Freight operations assessment completed (${body.data.source}): ${results.totalHoursPerWeek} hrs/week manual, ${results.recoverableHoursLow}-${results.recoverableHoursHigh} recoverable (estimate)`);
  if (body.data.source === "prospect") {
    const r = await recordEngagement(store, getProviders(), found.account, { eventType: "calculator_completed", properties: { assessment: true, shipmentsPerMonth: body.data.inputs.shipmentsPerMonth, hoursSaved: results.recoverableHoursHigh }, visitorId: body.data.visitorId ?? null });
    if (r.activationTriggered) void runAgent("jerry");
  }
  return json({ ok: true, assessment });
}

/** GET ?slug=x -> latest assessments + default inputs for that account (public read is limited to defaults). */
export async function GET(req: Request) {
  const slug = new URL(req.url).searchParams.get("slug");
  const store = getStore();
  const account = slug ? await store.getAccountBySlug(slug) : null;
  const defaults = defaultInputsFor(account);
  const list = account ? (await assessments.list()).filter((a) => a.accountId === account.id).sort((a, b) => b.at.localeCompare(a.at)) : [];
  return json({ defaults, assessments: list.slice(0, 5), preview: computeAssessment(defaults) });
}
