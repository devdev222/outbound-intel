import { hostname } from "node:os";
import type { Store } from "@/lib/store";
import type { Operation, OperationKind } from "@/lib/types";
import { nowIso, uuid } from "@/lib/util";

/**
 * Durable operations: every external side effect (sequence launch, email send,
 * Slack alert, dialer queue, sequence pause) runs through `runOperation` with a
 * stable idempotency key.
 *
 *  - The record is created once (insert-if-absent).
 *  - A worker must atomically claim it before calling the provider; a second
 *    worker gets `busy` and does nothing.
 *  - A succeeded operation is never executed again; callers get the stored result.
 *  - Failures are retried with bounded exponential backoff, then marked `dead`.
 *  - The same key is passed to the provider (Idempotency-Key header) so even a
 *    crash between the provider call and our write cannot create a second effect
 *    on providers that honour it.
 */

export const WORKER_ID = `${hostname()}:${process.pid}:${uuid().slice(0, 6)}`;
const DEFAULT_LEASE_MS = 2 * 60_000;

export type OperationOutcome<T> =
  | { state: "succeeded"; result: T; remoteId: string | null; replayed: boolean; op: Operation }
  | { state: "failed"; error: string; retryable: boolean; attempts: number; op: Operation }
  | { state: "busy"; op: Operation }
  | { state: "not_due"; op: Operation };

export class PermanentError extends Error {
  readonly permanent = true;
}

export interface OperationSpec {
  id: string;
  kind: OperationKind;
  accountId: string | null;
  destination: string;
  maxAttempts?: number;
  leaseMs?: number;
}

export function backoffMs(attempt: number): number {
  return Math.min(60 * 60_000, 30_000 * 2 ** Math.max(0, attempt - 1));
}

function blank(spec: OperationSpec): Operation {
  const now = nowIso();
  return {
    id: spec.id,
    kind: spec.kind,
    accountId: spec.accountId,
    destination: spec.destination,
    status: "pending",
    attempts: 0,
    maxAttempts: spec.maxAttempts ?? 3,
    leaseOwner: null,
    leaseUntil: null,
    nextAttemptAt: null,
    remoteId: null,
    lastError: null,
    result: null,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Run `fn` at most once successfully for `spec.id`.
 * `fn` receives the idempotency key to forward to the provider and returns
 * `{ remoteId, result }` on acknowledgment; throw to fail (PermanentError = no retry).
 */
export async function runOperation<T extends Record<string, unknown>>(
  store: Store,
  spec: OperationSpec,
  fn: (idempotencyKey: string) => Promise<{ remoteId?: string | null; result: T }>,
  owner = WORKER_ID,
): Promise<OperationOutcome<T>> {
  const stored = await store.ensureOperation(blank(spec));
  if (stored.status === "succeeded") {
    return { state: "succeeded", result: (stored.result ?? {}) as T, remoteId: stored.remoteId, replayed: true, op: stored };
  }
  if (stored.status === "dead") {
    return { state: "failed", error: stored.lastError ?? "operation failed permanently", retryable: false, attempts: stored.attempts, op: stored };
  }
  if (stored.nextAttemptAt && stored.nextAttemptAt > nowIso() && stored.status !== "running") {
    return { state: "not_due", op: stored };
  }
  const claimed = await store.claimOperation(spec.id, owner, spec.leaseMs ?? DEFAULT_LEASE_MS);
  if (!claimed) {
    const current = (await store.getOperation(spec.id)) ?? stored;
    if (current.status === "succeeded") return { state: "succeeded", result: (current.result ?? {}) as T, remoteId: current.remoteId, replayed: true, op: current };
    return { state: "busy", op: current };
  }

  const attempts = claimed.attempts + 1;
  try {
    const { remoteId = null, result } = await fn(spec.id);
    const done = await store.finishOperation(spec.id, owner, { status: "succeeded", attempts, remoteId, result, lastError: null, nextAttemptAt: null, leaseUntil: null });
    return { state: "succeeded", result, remoteId, replayed: false, op: done ?? { ...claimed, status: "succeeded", attempts, remoteId, result } };
  } catch (err) {
    const message = (err as Error).message ?? String(err);
    const permanent = Boolean((err as { permanent?: boolean }).permanent);
    const exhausted = attempts >= claimed.maxAttempts;
    const status: Operation["status"] = permanent || exhausted ? "dead" : "failed";
    const nextAttemptAt = status === "failed" ? new Date(Date.now() + backoffMs(attempts)).toISOString() : null;
    const failed = await store.finishOperation(spec.id, owner, { status, attempts, lastError: message.slice(0, 500), nextAttemptAt, leaseUntil: null });
    return { state: "failed", error: message, retryable: status === "failed", attempts, op: failed ?? { ...claimed, status, attempts, lastError: message } };
  }
}

/** Allow a person to retry a failed / dead operation (e.g. after fixing credentials). */
export async function resetOperation(store: Store, id: string): Promise<Operation | null> {
  return store.requeueOperation(id);
}

// --- Leases (single-runner guarantees for agent runs) -------------------------------

export async function acquireLease(store: Store, name: string, ms: number, owner = WORKER_ID): Promise<boolean> {
  const id = `lease:${name}`;
  await store.ensureOperation({ ...blank({ id, kind: "lease", accountId: null, destination: "runtime" }), maxAttempts: 1_000_000 });
  return Boolean(await store.claimOperation(id, owner, ms));
}

export async function releaseLease(store: Store, name: string, owner = WORKER_ID): Promise<void> {
  await store.finishOperation(`lease:${name}`, owner, { status: "pending", leaseUntil: null, leaseOwner: null });
}
