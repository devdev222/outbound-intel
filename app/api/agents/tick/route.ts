import { z } from "zod";
import { tick } from "@/lib/agents/runtime";
import { error, json } from "@/lib/api";
import { safeEqual } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * One runtime tick: runs every agent whose cadence has elapsed, in order.
 * This is the serverless way to run the team 24/7: point a scheduler at it
 * every minute (Vercel Cron, GitHub Actions, pg_cron + pg_net, ...). When
 * CRON_SECRET is set, the caller must send `Authorization: Bearer <CRON_SECRET>`
 * (the header Vercel Cron sends automatically).
 */
async function handle(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization") ?? "";
    if (!safeEqual(auth, `Bearer ${secret}`)) return error("unauthorized", 401);
  }
  let force = false;
  if (req.method === "POST") {
    try {
      const body = z.object({ force: z.boolean().optional() }).parse(await req.json().catch(() => ({})));
      force = Boolean(body.force);
    } catch {
      /* ignore malformed body */
    }
  }
  const runs = await tick({ force });
  return json({ runs });
}

export const GET = handle;
export const POST = handle;
