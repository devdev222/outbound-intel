import type { Providers } from "@/lib/providers";
import type { Store } from "@/lib/store";
import type { Account, HistoricalRecord, Outcome, OutcomeType } from "@/lib/types";
import { nowIso, uuid } from "@/lib/util";
import { logActivity } from "./activity";
import { syncOutcomeToCrm } from "./crm-sync";

/**
 * LEARN AGAIN (spec Phase 4). Every meeting booked, opportunity created, deal
 * won or lost becomes a historical record with the account's verified signals,
 * persona and messaging angle, so the next learn pass retrains on it. The
 * record for an account is replaced as its outcome progresses (meeting -> won).
 */

const HISTORY_OUTCOME: Partial<Record<OutcomeType, HistoricalRecord["outcome"]>> = {
  meeting_booked: "meeting",
  opportunity_created: "meeting",
  deal_won: "won",
  deal_lost: "lost",
  no_response: "no_response",
};

const STATUS_FOR: Partial<Record<OutcomeType, Account["status"]>> = {
  replied: "engaged",
  meeting_requested: "engaged",
  meeting_booked: "meeting_booked",
  opportunity_created: "meeting_booked",
  deal_won: "won",
  deal_lost: "lost",
  no_response: "lost",
  disqualified: "disqualified",
};

export function accountToHistorical(account: Account, outcome: HistoricalRecord["outcome"], dealValue?: number | null): HistoricalRecord {
  return {
    id: `loop_${account.id}`,
    companyName: account.companyName,
    industry: account.industry,
    employeeCount: account.employeeCount,
    signalKeys: account.signals.filter((s) => s.status === "verified" && s.type !== "intent").map((s) => s.key),
    persona: account.contact?.title ?? account.recommendedPersona ?? "Unknown",
    seniority: account.contact?.seniority ?? "manager",
    messagingAngle: account.campaign?.angle ?? account.messagingAngle ?? undefined,
    outcome,
    dealValue: dealValue ?? undefined,
    firstTouchAt: account.campaign?.launchedAt ?? account.createdAt,
    outcomeAt: nowIso(),
    source: "loop",
  };
}

export interface RecordOutcomeInput {
  outcomeType: OutcomeType;
  value?: number | null;
  notes?: string | null;
  source?: string;
  /** CRM opportunity id when known; defaults to one opportunity per account. */
  opportunityId?: string | null;
}

const OPPORTUNITY_TYPES: OutcomeType[] = ["opportunity_created", "deal_won", "deal_lost"];

/** Lifecycle order; outcomes never move an account backwards (a late "replied" cannot undo "won"). */
const RANK: Partial<Record<Account["status"], number>> = { engaged: 1, hot: 1, meeting_booked: 2, won: 4, lost: 4, disqualified: 4 };

/** Training-history stage order; higher never gets overwritten by lower. */
export function historyRank(o: HistoricalRecord["outcome"]): number {
  return o === "won" || o === "lost" ? 3 : o === "meeting" ? 2 : o === "no_response" ? 1 : 0;
}

export function defaultOpportunityId(accountId: string): string {
  return `opp_${accountId}`;
}

export async function recordOutcome(
  store: Store,
  providers: Providers,
  account: Account,
  input: RecordOutcomeInput,
): Promise<{ outcome: Outcome; account: Account; fedBack: boolean }> {
  const outcome: Outcome = {
    id: uuid(),
    accountId: account.id,
    outcomeType: input.outcomeType,
    value: input.value ?? null,
    notes: input.notes ?? null,
    source: input.source ?? "api",
    createdAt: nowIso(),
    opportunityId: OPPORTUNITY_TYPES.includes(input.outcomeType) ? (input.opportunityId ?? defaultOpportunityId(account.id)) : null,
  };
  await store.insertOutcome(outcome);

  // Durable CRM write-back (operation crm:<outcome id>); failures retry and stay visible.
  await syncOutcomeToCrm(store, providers, account, outcome);

  let fedBack = false;
  const histOutcome = HISTORY_OUTCOME[input.outcomeType];
  if (histOutcome) {
    // One record per account. A late or out-of-order outcome never regresses it:
    // a "meeting" arriving after "won" is ignored; equal stages keep the newest.
    const existing = await store.getHistorical(`loop_${account.id}`);
    const next = accountToHistorical(account, histOutcome, input.value ?? existing?.dealValue ?? null);
    if (!existing || historyRank(next.outcome) > historyRank(existing.outcome) || (historyRank(next.outcome) === historyRank(existing.outcome) && next.outcomeAt >= existing.outcomeAt)) {
      await store.upsertHistorical(next);
      fedBack = true;
    }
  }

  // Atomic status change on the latest account: assignments, pauses and scores written concurrently are kept.
  let before: Account["status"] = account.status;
  let status: Account["status"] = account.status;
  const updated =
    (await store.patchAccount(account.id, (current) => {
      before = current.status;
      const proposed = STATUS_FOR[input.outcomeType] ?? current.status;
      // Move forward only; an equal-rank outcome (e.g. a meeting request on a hot account) keeps the current status.
      status = (RANK[proposed] ?? 0) > (RANK[current.status] ?? 0) ? proposed : current.status;
      const closing = status === "won" || status === "lost" || status === "disqualified";
      return { ...current, status, pendingActivation: null, ...(closing ? { pausedUntil: null, pauseReason: null } : {}) };
    })) ?? account;
  const current = { status: before };

  // A confirmed booking completes the open "send times" scheduling task.
  if (input.outcomeType === "meeting_booked") {
    const open = (await store.listOutreach({ accountId: account.id })).filter((t) => t.channel === "meeting" && t.status === "manual");
    for (const t of open) await store.updateOutreach({ ...t, status: "done", sentAt: nowIso(), completionMode: "provider", completedBy: outcome.source, note: `booking confirmed (${outcome.source})` });
  }
  const actor = outcome.source === "calendly" || outcome.source === "resend" ? "webhook" : outcome.source === "demo" || outcome.source === "mcp" ? "system" : "rep";
  await logActivity(store, account.id, actor, "outcome_logged", `Outcome: ${input.outcomeType.replace(/_/g, " ")}${input.value ? ` ($${Number(input.value).toLocaleString()})` : ""}`, [
    input.notes ?? "",
    fedBack ? "fed back into the historical set; model retrains on the next learning pass" : "",
    status !== current.status ? `status ${current.status} -> ${status}` : "",
  ]);
  return { outcome, account: updated, fedBack };
}
