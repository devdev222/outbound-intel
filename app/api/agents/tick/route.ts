import { z } from "zod";
import { tick } from "@/lib/agents/runtime";
import { getSession } from "@/lib/auth";
import { error, json, safeEqual } from "@/lib/api";
import { config, isLive } from "@/lib/config";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * One runtime tick: runs every agent whose cadence has elapsed, in order.
 * Callers, in order of precedence:
 *  - a scheduler sending `Authorization: Bearer <CRON_SECRET>` (Vercel Cron does this),
 *  - a signed-in admin,
 *  - demo mode only, with no CRON_SECRET configured: Vercel Cron by user agent.
 * Live mode without CRON_SECRET refuses every call.
 */
async function authorized(req: Request): Promise<Response | null> {
  const auth = req.headers.get("authorization") ?? "";
  if (config.cronSecret) {
    if (safeEqual(auth, `Bearer ${config.cronSecret}`)) return null;
  } else if (isLive()) {
    return error("CRON_SECRET is not configured", 503);
  } else if ((req.headers.get("user-agent") ?? "").startsWith("vercel-cron")) {
    return null;
  }
  const user = await getSession();
  if (user?.role === "admin") return null;
  return error(user ? "not permitted for your role" : "unauthorized", user ? 403 : 401);
}

async function handle(req: Request) {
  const denied = await authorized(req);
  if (denied) return denied;
  let force = false;
  if (req.method === "POST") {
    const body = z.object({ force: z.boolean().optional() }).safeParse(await req.json().catch(() => ({})));
    force = body.success ? Boolean(body.data.force) : false;
  }
  const runs = await tick({ force });
  return json({ runs });
}

export const GET = handle;
export const POST = handle;
