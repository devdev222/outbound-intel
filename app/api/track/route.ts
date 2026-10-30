import { z } from "zod";
import { runAgent } from "@/lib/agents/runtime";
import { error, json, readJson } from "@/lib/api";
import { PAGE_EVENTS, recordEngagement } from "@/lib/engine/engagement";
import { accountForPage } from "@/lib/engine/prospect-auth";
import { getProviders } from "@/lib/providers";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

const Body = z.object({
  slug: z.string().min(1).max(120),
  token: z.string().length(8),
  event: z.string().min(1).max(64),
  properties: z.record(z.string(), z.unknown()).default({}),
  visitorId: z.string().min(4).max(200),
});

/** Same visitor + same event (+ same section) inside this window counts once. */
const DEDUPE_MS = 10 * 60_000;

/**
 * PUBLIC page telemetry only. Anyone with the page link can call this, so:
 *  - it needs the page token rendered into the personalized page;
 *  - only page events are accepted (views, video, calculator, booking click);
 *    email/LinkedIn/visitor events must arrive authenticated (provider webhooks
 *    or POST /api/events with a machine token);
 *  - repeats from the same visitor are ignored, and the score it can add per
 *    account per day is capped;
 *  - page events alone never activate a rep: activation needs an authenticated
 *    touch to corroborate them (see recordEngagement).
 */
export async function POST(req: Request) {
  const body = await readJson(req, Body);
  if (!body.ok) return body.response;
  const d = body.data;
  if (!PAGE_EVENTS.has(d.event)) return error(`${d.event} is not a page event; provider events must be sent authenticated to /api/events or a webhook`, 400);
  const store = getStore();
  const found = await accountForPage(store, d.slug, d.token);
  if ("response" in found) return found.response;
  const account = found.account;

  const since = new Date(Date.now() - DEDUPE_MS).toISOString();
  const section = typeof d.properties.section === "string" ? d.properties.section : null;
  const dup = (await store.listEvents({ accountId: account.id, sinceIso: since })).some((e) => e.visitorId === d.visitorId && e.eventType === d.event && (e.properties?.section ?? null) === section && d.event !== "scroll_depth" && d.event !== "calculator_input");
  if (dup) return json({ ok: true, deduplicated: true });

  // Strip any attempt to spoof the source from the client.
  const { _source: _ignored, ...properties } = d.properties;
  const result = await recordEngagement(store, getProviders(), account, { eventType: d.event, properties, visitorId: d.visitorId, source: "page" });
  if (result.activationTriggered) void runAgent("jerry");
  return json({ ok: true });
}
