import { requireApiRole } from "@/lib/auth";
import { AGENT_BY_ID } from "@/lib/agents";
import { runAgent } from "@/lib/agents/runtime";
import { error, json } from "@/lib/api";
import type { AgentId } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole(["admin"]);
  if ("response" in auth) return auth.response;
  const { id } = await params;
  if (!(id in AGENT_BY_ID)) return error(`unknown agent "${id}"`, 404);
  const run = await runAgent(id as AgentId, { force: true });
  return json({ run });
}
