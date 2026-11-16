import { config } from "@/lib/config";
import { getStore } from "@/lib/store";

/**
 * Enrichment budget. Every paid verification (Wiza, Amplemarket, Clay, the
 * waterfall, Jerry, an in-house service) counts as one lookup against a daily
 * and a monthly cap (ENRICHMENT_DAILY_LIMIT, ENRICHMENT_MONTHLY_LIMIT; 0 means
 * no cap). When a cap is reached, verification waits until it resets instead
 * of spending. Mock and test providers cost nothing and are not counted.
 *
 * Counts live in the store's documents (one per UTC day and month), so every
 * worker sees the same numbers. Two workers reserving at the same instant can
 * go one or two over a cap; they never go over by more than that.
 */

const FREE = new Set(["mock", "test", "synthetic"]);

interface SpendDoc {
  id: string;
  count: number;
  bySource: Record<string, number>;
  updatedAt: string;
}

const dayKey = (d = new Date()) => `day:${d.toISOString().slice(0, 10)}`;
const monthKey = (d = new Date()) => `month:${d.toISOString().slice(0, 7)}`;
const nextDay = (d = new Date()) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)).toISOString();
const nextMonth = (d = new Date()) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString();

export function isPaidSource(provider: string): boolean {
  return !FREE.has(provider);
}

async function read(id: string): Promise<SpendDoc> {
  return (await getStore().getDoc<SpendDoc>("enrichment_spend", id)) ?? { id, count: 0, bySource: {}, updatedAt: new Date(0).toISOString() };
}

export interface BudgetStatus {
  day: { used: number; limit: number; resetsAt: string };
  month: { used: number; limit: number; resetsAt: string };
  bySourceToday: Record<string, number>;
}

export async function budgetStatus(at = new Date()): Promise<BudgetStatus> {
  const [d, m] = await Promise.all([read(dayKey(at)), read(monthKey(at))]);
  return {
    day: { used: d.count, limit: config.enrichmentBudget.daily, resetsAt: nextDay(at) },
    month: { used: m.count, limit: config.enrichmentBudget.monthly, resetsAt: nextMonth(at) },
    bySourceToday: d.bySource,
  };
}

/**
 * Reserve one paid lookup. Returns ok:false (and when it resets) when a cap
 * is reached; nothing is counted then.
 */
export async function reserveLookup(provider: string, at = new Date()): Promise<{ ok: true } | { ok: false; reason: string; retryAt: string }> {
  if (!isPaidSource(provider)) return { ok: true };
  const s = await budgetStatus(at);
  if (s.day.limit > 0 && s.day.used >= s.day.limit) return { ok: false, reason: `daily enrichment budget reached (${s.day.used}/${s.day.limit})`, retryAt: s.day.resetsAt };
  if (s.month.limit > 0 && s.month.used >= s.month.limit) return { ok: false, reason: `monthly enrichment budget reached (${s.month.used}/${s.month.limit})`, retryAt: s.month.resetsAt };
  const store = getStore();
  for (const id of [dayKey(at), monthKey(at)]) {
    const doc = await read(id);
    await store.putDoc<SpendDoc>("enrichment_spend", { id, count: doc.count + 1, bySource: { ...doc.bySource, [provider]: (doc.bySource[provider] ?? 0) + 1 }, updatedAt: at.toISOString() });
  }
  return { ok: true };
}
