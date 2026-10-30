import type { Store } from "@/lib/store";
import type { Providers } from "@/lib/providers";
import type { Account, AgentId, ScoringModel } from "@/lib/types";

/**
 * Agent contract for the 24/7 team. Each agent is a worker with a cadence; the
 * runtime (lib/agents/runtime.ts) calls `run` whenever the cadence has elapsed
 * and records the result. Agents pull their own work from the store (accounts
 * in a given stage), process a bounded batch, and write results back, so a
 * crash mid-run loses at most one account's partial work.
 */
export interface AgentContext {
  store: Store;
  providers: Providers;
  model: ScoringModel;
  batchSize: number;
  log: (line: string) => void;
}

export interface AgentResult {
  processed: number;
  summary: string;
}

export interface AgentDefinition {
  id: AgentId;
  name: string;
  role: string;
  /** What this agent does, in one line, for the team page. */
  description: string;
  /** Seconds between runs when the runtime loop is on. */
  cadenceSeconds: number;
  /** Which pipeline step this agent belongs to (1..8, from the spec). */
  step: number;
  run(ctx: AgentContext): Promise<AgentResult>;
}

/** Accounts an agent has never processed, or whose facts changed since it last ran. */
export function needsRun(account: Account, agentId: AgentId): boolean {
  const last = account.agentRuns[agentId];
  if (!last) return true;
  return account.factsUpdatedAt > last;
}

/** True when any of the upstream agents ran after `agentId` last did (or `agentId` never ran). */
export function upstreamChangedSince(account: Account, agentId: AgentId, upstream: AgentId[]): boolean {
  const last = account.agentRuns[agentId];
  if (!last) return true;
  return upstream.some((u) => (account.agentRuns[u] ?? "") > last);
}

/** Run `fn` over items with bounded concurrency, collecting results in order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}
