import { requireApiRole } from "@/lib/auth";
import { z } from "zod";
import { runAgent, runAgentUntilDrained } from "@/lib/agents/runtime";
import { json, readJson, requireAccount } from "@/lib/api";
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
});

/** Log a sales outcome. Terminal outcomes feed history; learning and re-scoring run in the background. */
export async function POST(req: Request) {
  const auth = await requireApiRole(["bdr", "exec", "admin"]);
  if ("response" in auth) return auth.response;
  const body = await readJson(req, Body);
  if (!body.ok) return body.response;
  const store = getStore();
  const found = await requireAccount(store, body.data.slug);
  if ("response" in found) return found.response;

  const result = await recordOutcome(store, getProviders(), found.account, body.data);
  if (result.fedBack) {
    void runAgent("learning", { force: true }).then(() => runAgentUntilDrained("scoring"));
  }
  return json({ ok: true, status: result.account.status, fedBack: result.fedBack, outcome: result.outcome });
}

export async function GET(req: Request) {
  const auth = await requireApiRole(["bdr", "exec", "admin"]);
  if ("response" in auth) return auth.response;
  const slug = new URL(req.url).searchParams.get("slug");
  const store = getStore();
  if (!slug) return json({ outcomes: await store.listOutcomes({ limit: 200 }) });
  const found = await requireAccount(store, slug);
  if ("response" in found) return found.response;
  return json({ outcomes: await store.listOutcomes({ accountId: found.account.id }) });
}
