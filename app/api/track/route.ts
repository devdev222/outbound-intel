import { z } from "zod";
import { runAgent } from "@/lib/agents/runtime";
import { json, readJson, requireAccount } from "@/lib/api";
import { recordEngagement } from "@/lib/engine/engagement";
import { getProviders } from "@/lib/providers";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

const Body = z.object({
  slug: z.string().min(1),
  event: z.string().min(1).max(64),
  properties: z.record(z.string(), z.unknown()).default({}),
  visitorId: z.string().max(200).optional().nullable(),
});

/**
 * First-party engagement tracking for the personalized pages (and for email /
 * LinkedIn events relayed by the Sequencer). Stores the event, mirrors it to
 * PostHog when configured, updates engagement + priority, and hands the account
 * to Jerry when a threshold is crossed.
 */
export async function POST(req: Request) {
  const body = await readJson(req, Body);
  if (!body.ok) return body.response;
  const store = getStore();
  const found = await requireAccount(store, body.data.slug);
  if ("response" in found) return found.response;

  const result = await recordEngagement(store, getProviders(), found.account, {
    eventType: body.data.event,
    properties: body.data.properties,
    visitorId: body.data.visitorId ?? null,
  });
  if (result.activationTriggered) void runAgent("jerry");

  return json({
    ok: true,
    engagementScore: result.account.engagementScore,
    priority: result.account.priority,
    status: result.account.status,
    activationTriggered: result.activationTriggered,
  });
}
