import type { Store } from "@/lib/store";
import type { ActivityEntry } from "@/lib/types";
import { nowIso, uuid } from "@/lib/util";

/** Build an activity entry (the per-account audit trail). */
export function activityEntry(accountId: string, actor: ActivityEntry["actor"], action: string, summary: string, details?: string[]): ActivityEntry {
  return { id: uuid(), accountId, actor, action, summary, details: details?.filter(Boolean), at: nowIso() };
}

/** Write one entry immediately (webhooks, routes, reps). Agents use ctx.activity() which batches per run. */
export async function logActivity(store: Store, accountId: string, actor: ActivityEntry["actor"], action: string, summary: string, details?: string[]): Promise<void> {
  await store.insertActivity([activityEntry(accountId, actor, action, summary, details)]);
}
