import { NextResponse } from "next/server";
import type { z } from "zod";
import type { Store } from "@/lib/store";
import type { Account, PipelineSummary } from "@/lib/types";

/** Small helpers shared by the route handlers. */

export function json<T>(data: T, status = 200): NextResponse<T> {
  return NextResponse.json(data, { status });
}

export function error(message: string, status = 400): NextResponse<{ ok: false; error: string }> {
  return NextResponse.json({ ok: false as const, error: message }, { status });
}

export async function readJson<S extends z.ZodType>(req: Request, schema: S): Promise<{ ok: true; data: z.infer<S> } | { ok: false; response: NextResponse }> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return { ok: false, response: error("invalid JSON body") };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { ok: false, response: error(`invalid body: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`) };
  return { ok: true, data: parsed.data };
}

export async function requireAccount(store: Store, slug: string): Promise<{ account: Account } | { response: NextResponse }> {
  const account = await store.getAccountBySlug(slug);
  if (!account) return { response: error(`no account with slug "${slug}"`, 404) };
  return { account };
}

export async function pipelineSummary(store: Store): Promise<PipelineSummary> {
  const [accounts, alerts, events, model] = await Promise.all([store.listAccounts(), store.listAlerts(), store.listEvents(), store.getLatestModel()]);
  const count = (s: Account["status"]) => accounts.filter((a) => a.status === s).length;
  return {
    accounts: accounts.length,
    scored: accounts.filter((a) => a.scores !== null).length,
    qualified: count("qualified"),
    campaignsLive: accounts.filter((a) => a.campaign !== null).length,
    engaged: count("engaged"),
    hot: count("hot"),
    meetings: count("meeting_booked"),
    won: count("won"),
    lost: count("lost"),
    alerts: alerts.length,
    events: events.length,
    modelVersion: model?.version ?? null,
  };
}

/** Constant-time string compare for webhook secrets. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

/**
 * Callback guard: in live mode a callback whose verification secret is not
 * configured is refused outright (503) instead of accepting unsigned requests.
 * Demo/test keep the permissive behaviour so local tooling works.
 */
export function callbackSecretMissing(secret: string, envName: string): NextResponse | null {
  if (secret) return null;
  if (process.env.APP_MODE === "live") return error(`callback disabled: ${envName} is not configured`, 503);
  return null;
}
