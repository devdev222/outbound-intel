import { requireApiRole } from "@/lib/auth";
import { z } from "zod";
import { AGENT_BY_ID } from "@/lib/agents";
import { setAgentEnabled } from "@/lib/agents/runtime";
import { error, json, readJson } from "@/lib/api";
import type { AgentId } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole(["admin"]);
  if ("response" in auth) return auth.response;
  const { id } = await params;
  if (!(id in AGENT_BY_ID)) return error(`unknown agent "${id}"`, 404);
  const body = await readJson(req, z.object({ enabled: z.boolean() }));
  if (!body.ok) return body.response;
  const state = await setAgentEnabled(id as AgentId, body.data.enabled);
  return json({ state });
}
