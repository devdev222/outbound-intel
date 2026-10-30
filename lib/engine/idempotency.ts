import { createHash } from "node:crypto";
import type { Store } from "@/lib/store";
import { nowIso } from "@/lib/util";
import { WORKER_ID } from "./operations";

/**
 * Persistent idempotency for inbound requests: webhook deliveries,
 * conversation submissions, outcome writes and machine/MCP mutations.
 *
 * One operations row per (scope, key), id `idem:<scope>:<sha256(key)>`. The
 * first request claims it, runs, and stores its JSON result; a retry with the
 * same key returns the stored result without running again. A concurrent
 * duplicate while the first is still running gets `in_progress` (HTTP 409),
 * never a second side effect. A failed attempt is released so a retry runs.
 * Rows survive restarts and are shared by every worker (operations table).
 */

export type IdempotentResult<T> = { state: "done"; result: T; replayed: boolean } | { state: "in_progress" };

export function idempotencyId(scope: string, key: string): string {
  return `idem:${scope}:${createHash("sha256").update(key).digest("hex").slice(0, 40)}`;
}

/** Stable key for a JSON body when the sender provides no delivery id. */
export function bodyKey(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export async function idempotent<T>(store: Store, scope: string, key: string, fn: () => Promise<T>, opts: { accountId?: string | null; leaseMs?: number } = {}): Promise<IdempotentResult<T>> {
  const id = idempotencyId(scope, key);
  const now = nowIso();
  const existing = await store.ensureOperation({
    id,
    kind: "request",
    accountId: opts.accountId ?? null,
    destination: scope,
    status: "pending",
    attempts: 0,
    maxAttempts: 1_000_000,
    leaseOwner: null,
    leaseUntil: null,
    nextAttemptAt: null,
    remoteId: null,
    lastError: null,
    result: null,
    createdAt: now,
    updatedAt: now,
  });
  if (existing.status === "succeeded") return { state: "done", result: (existing.result as { value: T } | null)?.value as T, replayed: true };
  const owner = `${WORKER_ID}:${Math.random().toString(36).slice(2, 8)}`;
  const claimed = await store.claimOperation(id, owner, opts.leaseMs ?? 60_000);
  if (!claimed) {
    const cur = await store.getOperation(id);
    if (cur?.status === "succeeded") return { state: "done", result: (cur.result as { value: T } | null)?.value as T, replayed: true };
    return { state: "in_progress" };
  }
  try {
    const value = await fn();
    await store.finishOperation(id, owner, { status: "succeeded", attempts: claimed.attempts + 1, result: { value: value as unknown }, lastError: null, leaseUntil: null });
    return { state: "done", result: value, replayed: false };
  } catch (err) {
    // Release so the sender's retry runs again (the work did not complete).
    await store.finishOperation(id, owner, { status: "failed", attempts: claimed.attempts + 1, lastError: (err as Error).message.slice(0, 500), nextAttemptAt: null, leaseUntil: null });
    throw err;
  }
}

/** Read an Idempotency-Key header (or a body requestId) for HTTP routes. */
export function requestKey(req: Request, bodyRequestId?: string | null): string | null {
  const h = req.headers.get("idempotency-key") ?? req.headers.get("x-idempotency-key");
  const k = (h ?? bodyRequestId ?? "").trim();
  return k && k.length <= 200 ? k : null;
}

/**
 * Run a route body once per delivery id. The JSON response is stored, and a
 * redelivery gets the stored response (with duplicate: true) instead of a
 * second side effect. 5xx responses are not stored, so the sender retries.
 */
export async function onceResponse(store: Store, scope: string, key: string, fn: () => Promise<Response>): Promise<Response> {
  let res: IdempotentResult<{ status: number; body: unknown }>;
  try {
    res = await idempotent(store, scope, key, async () => {
      const r = await fn();
      const body = await r.clone().json().catch(() => ({}));
      if (r.status >= 500) throw Object.assign(new Error(`handler failed with ${r.status}`), { response: r });
      return { status: r.status, body };
    });
  } catch (err) {
    const r = (err as { response?: Response }).response;
    if (r) return r;
    throw err;
  }
  if (res.state === "in_progress") return Response.json({ ok: false, error: "this delivery is already being processed" }, { status: 409 });
  const body = res.replayed && res.result.body && typeof res.result.body === "object" ? { ...(res.result.body as Record<string, unknown>), duplicate: true } : res.result.body;
  return Response.json(body, { status: res.result.status });
}
