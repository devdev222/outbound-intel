import { requireApiRole } from "@/lib/auth";
import { isLive } from "@/lib/config";
import { z } from "zod";
import { json, readJson, error } from "@/lib/api";
import { seed } from "@/lib/engine/seed";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Seed (or reset) the demo environment from the dashboard. */
export async function POST(req: Request) {
  const auth = await requireApiRole(["admin"]);
  if ("response" in auth) return auth.response;
  if (isLive()) return error("demo actions are disabled in live mode", 403);
  const body = await readJson(req, z.object({ count: z.number().int().min(0).max(1000).optional(), resetOnly: z.boolean().optional() }));
  if (!body.ok) return body.response;
  if (body.data.resetOnly) {
    await getStore().reset();
    return json({ ok: true, historical: 0, accounts: 0, modelVersion: null, runs: [] });
  }
  const result = await seed({ count: body.data.count ?? 120 });
  return json({ ok: true, historical: result.historical, accounts: result.accounts, modelVersion: result.model.version, runs: result.runs });
}
