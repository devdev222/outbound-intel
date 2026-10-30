import type { Account, Outcome } from "@/lib/types";

/**
 * Canonical opportunities. Outcomes are events (created, won, lost); an
 * opportunity is the business object they describe. Events are grouped by
 * opportunityId (CRM id when known, else `opp_<accountId>`), so "$100k
 * created" followed by "$100k won" is ONE opportunity worth $100k, not two
 * worth $200k. Value is the latest non-null value reported for it.
 */

export const OPPORTUNITY_EVENTS = new Set<Outcome["outcomeType"]>(["opportunity_created", "deal_won", "deal_lost"]);

export interface Opportunity {
  id: string;
  accountId: string;
  stage: "open" | "won" | "lost";
  /** Latest non-null reported value, else null (callers decide the fallback and flag it as an estimate). */
  value: number | null;
  createdAt: string;
  updatedAt: string;
}

export function opportunityIdOf(o: Pick<Outcome, "accountId" | "opportunityId">): string {
  return o.opportunityId || `opp_${o.accountId}`;
}

export function canonicalOpportunities(outcomes: Outcome[]): Opportunity[] {
  const byId = new Map<string, Outcome[]>();
  for (const o of outcomes) {
    if (!OPPORTUNITY_EVENTS.has(o.outcomeType)) continue;
    const id = opportunityIdOf(o);
    byId.set(id, [...(byId.get(id) ?? []), o]);
  }
  const out: Opportunity[] = [];
  for (const [id, events] of byId) {
    const sorted = [...events].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const last = sorted[sorted.length - 1];
    const valued = [...sorted].reverse().find((e) => e.value != null);
    out.push({
      id,
      accountId: sorted[0].accountId,
      stage: last.outcomeType === "deal_won" ? "won" : last.outcomeType === "deal_lost" ? "lost" : "open",
      value: valued?.value ?? null,
      createdAt: sorted[0].createdAt,
      updatedAt: last.createdAt,
    });
  }
  return out;
}

/** Opportunities created inside a window (by first event), excluding lost ones from pipeline. */
export function pipelineOf(
  opps: Opportunity[],
  accounts: Map<string, Account> | Account[],
  fallbackValue: number,
  opts: { since?: string; accountIds?: Set<string>; includeLost?: boolean } = {},
): { count: number; value: number; estimated: boolean; opportunities: Opportunity[] } {
  const byId = accounts instanceof Map ? accounts : new Map(accounts.map((a) => [a.id, a]));
  const rows = opps.filter((o) => (!opts.since || o.createdAt >= opts.since) && (!opts.accountIds || opts.accountIds.has(o.accountId)) && (opts.includeLost || o.stage !== "lost"));
  let value = 0;
  let estimated = false;
  for (const o of rows) {
    if (o.value != null) value += o.value;
    else {
      estimated = true;
      value += byId.get(o.accountId)?.pipelineValue ?? fallbackValue;
    }
  }
  return { count: rows.length, value, estimated, opportunities: rows };
}
