import { z } from "zod";
import { runAgent } from "@/lib/agents/runtime";
import { json, readJson } from "@/lib/api";
import { recordEngagement } from "@/lib/engine/engagement";
import { requestEstimate } from "@/lib/engine/prospect";
import { accountForPage } from "@/lib/engine/prospect-auth";
import { getProviders } from "@/lib/providers";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

const Scalar = z.union([z.number().finite(), z.string().max(200)]);
const Body = z.object({
  slug: z.string().min(1).max(120),
  token: z.string().length(8),
  requestId: z.string().min(8).max(64),
  name: z.string().trim().max(120).default(""),
  email: z.email().max(254),
  inputs: z.record(z.string().max(64), Scalar).refine((o) => Object.keys(o).length <= 40, "too many inputs"),
  results: z.record(z.string().max(64), Scalar).refine((o) => Object.keys(o).length <= 40, "too many results"),
  source: z.enum(["estimate", "assessment"]).default("estimate"),
  website: z.string().max(200).optional(), // honeypot
  visitorId: z.string().max(200).optional().nullable(),
});

/**
 * "Send me my estimate" from the personalized page or the assessment. Creates an
 * awaiting-approval email task with the prospect's numbers (never auto-sent) and
 * records the engagement. Success is returned only after the task exists.
 */
export async function POST(req: Request) {
  const body = await readJson(req, Body);
  if (!body.ok) return body.response;
  const d = body.data;
  if (d.website) return json({ ok: true });
  const store = getStore();
  const found = await accountForPage(store, d.slug, d.token);
  if ("response" in found) return found.response;
  const providers = getProviders();
  const { task, replayed } = await requestEstimate(store, found.account, { requestId: d.requestId, name: d.name, email: d.email.toLowerCase(), inputs: d.inputs, results: d.results });
  if (!replayed) {
    const fresh = (await store.getAccountById(found.account.id)) ?? found.account;
    const result = await recordEngagement(store, providers, fresh, { eventType: "estimate_submitted", properties: { email: d.email.toLowerCase(), source: d.source, taskId: task.id }, visitorId: d.visitorId ?? null, source: "page" });
    if (result.activationTriggered) void runAgent("jerry");
  }
  return json({ ok: true, taskId: task.id, replayed });
}
