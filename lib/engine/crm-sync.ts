import type { Providers } from "@/lib/providers";
import type { Store } from "@/lib/store";
import type { Account, Operation, Outcome } from "@/lib/types";
import { nowIso } from "@/lib/util";
import { logActivity } from "./activity";
import { runOperation } from "./operations";
import { recipientView } from "./tasks";

/**
 * Durable CRM write-back. Each outcome is one operation `crm:<outcome id>`:
 *  - the outcome id is the stable external id and the Idempotency-Key, so a
 *    retry never creates a second CRM record;
 *  - transient failures are retried with backoff by the Learning Agent (and on
 *    demand from the Integrations page); permanent failures stay visible;
 *  - nothing is fire-and-forget: the operation row is the record of truth.
 */

export const MAX_CRM_ATTEMPTS = 6;

export async function syncOutcomeToCrm(store: Store, providers: Providers, account: Account, outcome: Outcome): Promise<{ state: "synced" | "pending" | "failed" | "skipped"; error?: string }> {
  if (providers.crm.name === "mock") {
    // Record that there was nothing to sync, so the status page is truthful.
    return { state: "skipped" };
  }
  const r = await runOperation(store, { id: `crm:${outcome.id}`, kind: "crm_sync", accountId: account.id, destination: providers.crm.name, maxAttempts: MAX_CRM_ATTEMPTS }, async (key) => {
    // The CRM sees the person the outcome belongs to.
    const res = await providers.crm.logOutcome(await recipientView(store, account, { contactId: outcome.contactId ?? null }), outcome, key);
    return { remoteId: res?.remoteId ?? null, result: { outcomeId: outcome.id, opportunityId: outcome.opportunityId ?? null } };
  });
  if (r.state === "succeeded") return { state: "synced" };
  if (r.state === "failed") {
    await logActivity(store, account.id, "system", "crm_sync_failed", `CRM write-back failed for ${outcome.outcomeType.replace(/_/g, " ")}${r.retryable ? "; retrying automatically" : "; needs attention"}`, [r.error]);
    return { state: r.retryable ? "pending" : "failed", error: r.error };
  }
  return { state: "pending" };
}

/** Retry CRM syncs whose backoff has elapsed. Called by the Learning Agent each run. */
export async function retryCrmSyncs(store: Store, providers: Providers, limit = 25): Promise<{ synced: number; failed: number }> {
  if (providers.crm.name === "mock") return { synced: 0, failed: 0 };
  const due = (await store.listOperations({ kind: "crm_sync", status: "failed", limit: 500 })).filter((o) => !o.nextAttemptAt || o.nextAttemptAt <= nowIso()).slice(0, limit);
  let synced = 0;
  let failed = 0;
  const outcomes = due.length ? await store.listOutcomes() : [];
  for (const op of due) {
    const outcome = outcomes.find((o) => `crm:${o.id}` === op.id);
    const account = outcome ? await store.getAccountById(outcome.accountId) : null;
    if (!outcome || !account) continue;
    const r = await syncOutcomeToCrm(store, providers, account, outcome);
    if (r.state === "synced") synced++;
    else failed++;
  }
  return { synced, failed };
}

/** CRM sync state for display (account page, Integrations). */
export async function crmSyncStatus(store: Store, outcomeIds: string[]): Promise<Map<string, Operation>> {
  const ops = await store.listOperations({ kind: "crm_sync", limit: 2000 });
  const wanted = new Set(outcomeIds.map((id) => `crm:${id}`));
  return new Map(ops.filter((o) => wanted.has(o.id)).map((o) => [o.id.slice(4), o]));
}
