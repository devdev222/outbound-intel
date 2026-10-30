import type { Providers } from "@/lib/providers";
import type { Store } from "@/lib/store";
import type { Account, HistoricalRecord, Outcome, OutcomeType } from "@/lib/types";
import { nowIso, uuid } from "@/lib/util";

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
  };
  await store.insertOutcome(outcome);

  providers.crm.logOutcome(account, outcome).catch((err) => console.warn(`[crm] ${(err as Error).message}`));

  let fedBack = false;
  const histOutcome = HISTORY_OUTCOME[input.outcomeType];
  if (histOutcome) {
    const existing = await store.listHistorical();
    const without = existing.filter((h) => h.id !== `loop_${account.id}`);
    await store.replaceHistorical([...without, accountToHistorical(account, histOutcome, input.value)]);
    fedBack = true;
  }

  const status = STATUS_FOR[input.outcomeType] ?? account.status;
  const updated = await store.upsertAccount({ ...account, status, pendingActivation: null });
  return { outcome, account: updated, fedBack };
}
