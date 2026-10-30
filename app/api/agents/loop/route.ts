import { z } from "zod";
import { loopStatus, startLoop, stopLoop } from "@/lib/agents/runtime";
import { json, readJson } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * Start / stop the in-process agent loop. In `next dev` and on a long-running
 * host this keeps the team ticking inside the web server; on serverless hosts
 * use /api/agents/tick from a scheduler or `npm run worker` instead.
 */
export async function POST(req: Request) {
  const body = await readJson(req, z.object({ action: z.enum(["start", "stop"]), intervalSeconds: z.number().int().min(5).max(3600).optional() }));
  if (!body.ok) return body.response;
  if (body.data.action === "start") startLoop(body.data.intervalSeconds);
  else stopLoop();
  return json(loopStatus());
}

export async function GET() {
  return json(loopStatus());
}
