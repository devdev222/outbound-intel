import { z } from "zod";
import { runAgent } from "@/lib/agents/runtime";
import { audit, requireActor } from "@/lib/auth";
import { error, json, readJson } from "@/lib/api";
import { PAGE_EVENTS, recordEngagement } from "@/lib/engine/engagement";
import { onceResponse } from "@/lib/engine/idempotency";
import { getProviders } from "@/lib/providers";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

const PROVIDER_EVENTS = ["email_sent", "email_delivered", "email_open", "email_click", "email_reply", "email_bounced", "linkedin_sent", "linkedin_accept", "linkedin_reply", "visitor_identified", "meeting_canceled"] as const;

const Body = z.object({
  /** Delivery id from the sender; required so retries are idempotent. */
  eventId: z.string().min(4).max(200),
  accountId: z.string().max(64).optional(),
  slug: z.string().max(120).optional(),
  event: z.enum(PROVIDER_EVENTS),
  properties: z.record(z.string(), z.unknown()).default({}),
  occurredAt: z.iso.datetime().optional(),
  /** Recipient or person identifier from the provider (email address, LinkedIn URL). */
  personRef: z.string().max(300).optional(),
});

/**
 * AUTHENTICATED provider events (Sequencer relay, LinkedIn tooling, custom
 * bridges). Requires a machine token with engagement:write. Each eventId is
 * processed once. Events are tagged source=provider and can activate a rep.
 * Page events belong to /api/track and are refused here.
 */
export async function POST(req: Request) {
  const auth = await requireActor(req, { roles: ["admin"], scope: "engagement:write" });
  if ("response" in auth) return auth.response;
  const body = await readJson(req, Body);
  if (!body.ok) return body.response;
  const d = body.data;
  if (PAGE_EVENTS.has(d.event)) return error("page events go to /api/track", 400);
  if (!d.accountId && !d.slug) return error("accountId or slug is required");
  const store = getStore();
  return onceResponse(store, `event:${auth.actor.id}`, d.eventId, async () => {
    const account = d.accountId ? await store.getAccountById(d.accountId) : await store.getAccountBySlug(d.slug!);
    if (!account) return error("unknown account", 404);
    const { _source: _ignored, ...properties } = d.properties;
    const r = await recordEngagement(store, getProviders(), account, { eventType: d.event, properties: { ...properties, eventId: d.eventId, personRef: d.personRef, occurredAt: d.occurredAt, reportedBy: auth.actor.id }, visitorId: d.personRef ?? null, source: "provider" });
    await audit(auth.actor, "provider_event", account.id, d.event);
    if (r.activationTriggered) void runAgent("jerry");
    return json({ ok: true, accountId: account.id, event: d.event, activationTriggered: r.activationTriggered });
  });
}
