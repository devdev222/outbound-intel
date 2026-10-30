import type { Providers } from "@/lib/providers";
import type { Store } from "@/lib/store";
import type { Account } from "@/lib/types";
import { nowIso } from "@/lib/util";
import { logActivity } from "./activity";
import { runOperation } from "./operations";
import { nextActionFor } from "./readiness";
import { committedOpenTasks } from "./tasks";

/**
 * Explicit deferral. While `pausedUntil` is in the future no outreach is sent:
 * the local scheduler holds every due task, and a provider that owns scheduling
 * (Sequencer) is told to pause under an idempotent operation. A deferral is
 * distinct from a closed loss (status lost) and from an opt-out (suppression).
 */

export function isPaused(account: Pick<Account, "pausedUntil">, at = nowIso()): boolean {
  return Boolean(account.pausedUntil && account.pausedUntil > at);
}

export async function pauseAccount(store: Store, providers: Providers, account: Account, until: string, reason: string, by: string): Promise<{ account: Account; external: "not_needed" | "paused" | "pending" | "failed"; error?: string }> {
  const updated = (await store.patchAccount(account.id, (cur) => ({ ...cur, pausedUntil: until, pauseReason: reason, nextAction: { type: "wait", label: `Paused until ${until.slice(0, 10)}`, reason, dueAt: until } }))) ?? account;
  await logActivity(store, account.id, "rep", "account_paused", `Outreach paused until ${until.slice(0, 10)} by ${by}: ${reason}`);
  if (!providers.outreach.ownsScheduling || !providers.outreach.pauseSequence) return { account: updated, external: "not_needed" };
  const op = await runOperation(store, { id: `pause:${account.id}:${until}`, kind: "sequence_pause", accountId: account.id, destination: providers.outreach.name, maxAttempts: 5 }, async (key) => {
    await providers.outreach.pauseSequence!(updated, until, reason, key);
    return { result: { until } };
  });
  if (op.state === "succeeded") return { account: updated, external: "paused" };
  if (op.state === "failed") {
    await logActivity(store, account.id, "system", "pause_sync_failed", `Could not pause the external sequence${op.retryable ? "; retrying" : ""}`, [op.error]);
    return { account: updated, external: op.retryable ? "pending" : "failed", error: op.error };
  }
  return { account: updated, external: "pending" };
}

export async function resumeAccount(store: Store, providers: Providers, account: Account, by: string): Promise<{ account: Account; external: "not_needed" | "resumed" | "pending" | "failed"; error?: string }> {
  const previous = account.pausedUntil;
  const committed = committedOpenTasks(await store.listOutreach({ accountId: account.id }));
  const updated =
    (await store.patchAccount(account.id, (cur) => {
      const resumed: Account = { ...cur, pausedUntil: null, pauseReason: null };
      return { ...resumed, nextAction: cur.readiness ? nextActionFor(resumed, cur.readiness, committed) : null };
    })) ?? account;
  await logActivity(store, account.id, "rep", "account_resumed", `Outreach resumed by ${by}`);
  if (!previous || !providers.outreach.ownsScheduling || !providers.outreach.resumeSequence) return { account: updated, external: "not_needed" };
  const op = await runOperation(store, { id: `resume:${account.id}:${previous}`, kind: "sequence_pause", accountId: account.id, destination: providers.outreach.name, maxAttempts: 5 }, async (key) => {
    await providers.outreach.resumeSequence!(updated, key);
    return { result: { resumedAt: nowIso() } };
  });
  if (op.state === "succeeded") return { account: updated, external: "resumed" };
  if (op.state === "failed") return { account: updated, external: op.retryable ? "pending" : "failed", error: op.error };
  return { account: updated, external: "pending" };
}

/** Retry external pause/resume syncs that failed transiently (called by the Campaign Agent each run). */
export async function retryPauseSyncs(store: Store, providers: Providers): Promise<number> {
  if (!providers.outreach.ownsScheduling) return 0;
  const failed = (await store.listOperations({ kind: "sequence_pause", status: "failed" })).filter((o) => !o.nextAttemptAt || o.nextAttemptAt <= nowIso());
  let n = 0;
  for (const op of failed) {
    const account = op.accountId ? await store.getAccountById(op.accountId) : null;
    if (!account) continue;
    if (op.id.startsWith("pause:") && account.pausedUntil) {
      const r = await runOperation(store, { id: op.id, kind: "sequence_pause", accountId: account.id, destination: providers.outreach.name, maxAttempts: op.maxAttempts }, async (key) => {
        await providers.outreach.pauseSequence?.(account, account.pausedUntil!, account.pauseReason ?? "deferred", key);
        return { result: { until: account.pausedUntil } };
      });
      if (r.state === "succeeded") n++;
    } else if (op.id.startsWith("resume:") && !account.pausedUntil) {
      const r = await runOperation(store, { id: op.id, kind: "sequence_pause", accountId: account.id, destination: providers.outreach.name, maxAttempts: op.maxAttempts }, async (key) => {
        await providers.outreach.resumeSequence?.(account, key);
        return { result: {} };
      });
      if (r.state === "succeeded") n++;
    }
  }
  return n;
}
