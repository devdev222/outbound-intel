import { z } from "zod";
import { audit, requireApiRole } from "@/lib/auth";
import { error, json, readJson, requireAccount } from "@/lib/api";
import { pauseAccount, resumeAccount } from "@/lib/engine/pause";
import { getProviders } from "@/lib/providers";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("pause"), days: z.number().int().min(1).max(365).optional(), until: z.iso.datetime().optional(), reason: z.string().trim().min(1).max(300) }),
  z.object({ action: z.literal("resume") }),
]);

/** Defer outreach for an account ("Not now, 30 days") or resume it. Enforced locally and in the Sequencer. */
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const auth = await requireApiRole(["bdr", "exec", "admin"]);
  if ("response" in auth) return auth.response;
  const { slug } = await params;
  const body = await readJson(req, Body);
  if (!body.ok) return body.response;
  const store = getStore();
  const found = await requireAccount(store, slug);
  if ("response" in found) return found.response;
  const providers = getProviders();
  if (body.data.action === "resume") {
    const r = await resumeAccount(store, providers, found.account, auth.user.name);
    await audit(auth.user, "account_resume", found.account.id, r.external);
    return json({ ok: true, account: r.account, external: r.external, error: r.error });
  }
  const until = body.data.until ?? new Date(Date.now() + (body.data.days ?? 30) * 86_400_000).toISOString();
  if (until <= new Date().toISOString()) return error("pause end must be in the future");
  const r = await pauseAccount(store, providers, found.account, until, body.data.reason, auth.user.name);
  await audit(auth.user, "account_pause", found.account.id, `${until} ${body.data.reason}`);
  return json({ ok: true, account: r.account, external: r.external, error: r.error });
}
