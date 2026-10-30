import { z } from "zod";
import { runAgent, runAgentUntilDrained } from "@/lib/agents/runtime";
import { audit, requireActor } from "@/lib/auth";
import { json, readJson, requireAccount } from "@/lib/api";
import { onceResponse, requestKey } from "@/lib/engine/idempotency";
import { recordOutcome } from "@/lib/engine/outcomes";
import { getProviders } from "@/lib/providers";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

const Body = z.object({
  slug: z.string().min(1),
  outcomeType: z.enum(["replied", "meeting_booked", "opportunity_created", "deal_won", "deal_lost", "no_response", "disqualified"]),
  value: z.number().optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  source: z.string().max(64).optional(),
  /** CRM opportunity id; created -> won with the same id count as one opportunity. Defaults to opp_<accountId>. */
  opportunityId: z.string().trim().min(1).max(120).optional().nullable(),
  /** Idempotency key (or send the Idempotency-Key header). Retries with the same key never record twice. */
  requestId: z.string().min(8).max(200).optional(),
});

/** Log a sales outcome (users, or machines with outcomes:write). Terminal outcomes feed history; CRM sync is durable. */
export async function POST(req: Request) {
  const auth = await requireActor(req, { roles: ["bdr", "exec", "admin"], scope: "outcomes:write" });
  if ("response" in auth) return auth.response;
  const body = await readJson(req, Body);
  if (!body.ok) return body.response;
  const store = getStore();
  const run = async () => {
    const found = await requireAccount(store, body.data.slug);
    if ("response" in found) return found.response;
    const { requestId: _r, ...input } = body.data;
    const result = await recordOutcome(store, getProviders(), found.account, { ...input, source: input.source ?? (auth.actor.kind === "machine" ? auth.actor.id : `rep:${auth.actor.name}`) });
    await audit(auth.actor, "outcome_record", found.account.id, `${input.outcomeType}${input.opportunityId ? ` ${input.opportunityId}` : ""}`);
    if (result.fedBack) void runAgent("learning", { force: true }).then(() => runAgentUntilDrained("scoring"));
    return json({ ok: true, status: result.account.status, fedBack: result.fedBack, outcome: result.outcome, opportunityId: result.outcome.opportunityId ?? null });
  };
  const key = requestKey(req, body.data.requestId);
  return key ? onceResponse(store, `outcome:${auth.actor.id}`, key, run) : run();
}

export async function GET(req: Request) {
  const auth = await requireActor(req, { roles: ["bdr", "exec", "admin"], scope: "read" });
  if ("response" in auth) return auth.response;
  const url = new URL(req.url);
  const slug = url.searchParams.get("slug");
  const opportunityId = url.searchParams.get("opportunityId");
  const store = getStore();
  let rows = slug ? null : await store.listOutcomes({ limit: 200 });
  if (slug) {
    const found = await requireAccount(store, slug);
    if ("response" in found) return found.response;
    rows = await store.listOutcomes({ accountId: found.account.id });
  }
  if (opportunityId) rows = (rows ?? []).filter((o) => o.opportunityId === opportunityId);
  return json({ outcomes: (rows ?? []).map((o) => ({ ...o, opportunityId: o.opportunityId ?? null })) });
}
