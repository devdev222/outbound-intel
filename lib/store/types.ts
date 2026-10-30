import type {
  Account,
  ActivityEntry,
  AgentId,
  AgentRun,
  AgentState,
  Alert,
  CallQueueItem,
  EngagementEvent,
  HistoricalRecord,
  Outcome,
  OutreachTouch,
  ScoringModel,
} from "@/lib/types";

/**
 * Persistence boundary. Two implementations ship: FileStore (JSON on disk, zero
 * config) and SupabaseStore (the spec's Postgres schema). The engine only talks
 * to this interface.
 */
export interface Store {
  readonly kind: "file" | "memory" | "supabase";

  // Accounts
  listAccounts(): Promise<Account[]>;
  getAccountById(id: string): Promise<Account | null>;
  getAccountBySlug(slug: string): Promise<Account | null>;
  upsertAccount(account: Account): Promise<Account>;
  upsertAccounts(accounts: Account[]): Promise<void>;
  deleteAllAccounts(): Promise<void>;

  // Historical records (training data)
  listHistorical(): Promise<HistoricalRecord[]>;
  insertHistorical(records: HistoricalRecord[]): Promise<void>;
  replaceHistorical(records: HistoricalRecord[]): Promise<void>;

  // Engagement events
  insertEvent(event: EngagementEvent): Promise<EngagementEvent>;
  listEvents(opts?: { accountId?: string; limit?: number; sinceIso?: string }): Promise<EngagementEvent[]>;

  // Outcomes
  insertOutcome(outcome: Outcome): Promise<Outcome>;
  listOutcomes(opts?: { accountId?: string; limit?: number }): Promise<Outcome[]>;

  // Learned scoring models (versioned)
  getLatestModel(): Promise<ScoringModel | null>;
  listModels(): Promise<ScoringModel[]>;
  saveModel(model: ScoringModel): Promise<ScoringModel>;

  // Rep activation
  insertAlert(alert: Alert): Promise<Alert>;
  listAlerts(opts?: { accountId?: string; limit?: number }): Promise<Alert[]>;
  enqueueCall(item: CallQueueItem): Promise<CallQueueItem>;
  listCallQueue(opts?: { status?: CallQueueItem["status"]; limit?: number }): Promise<CallQueueItem[]>;
  updateCallStatus(id: string, status: CallQueueItem["status"]): Promise<void>;

  // Outreach log
  insertOutreach(touches: OutreachTouch[]): Promise<void>;
  updateOutreach(touch: OutreachTouch): Promise<void>;
  getOutreach(id: string): Promise<OutreachTouch | null>;
  listOutreach(opts?: { accountId?: string; status?: OutreachTouch["status"]; dueBefore?: string; limit?: number }): Promise<OutreachTouch[]>;

  // Per-account activity (team audit trail)
  insertActivity(entries: ActivityEntry[]): Promise<void>;
  listActivity(opts?: { accountId?: string; limit?: number }): Promise<ActivityEntry[]>;

  // Agent team runtime
  insertAgentRun(run: AgentRun): Promise<AgentRun>;
  updateAgentRun(run: AgentRun): Promise<void>;
  listAgentRuns(opts?: { agentId?: AgentId; limit?: number }): Promise<AgentRun[]>;
  getAgentStates(): Promise<AgentState[]>;
  saveAgentState(state: AgentState): Promise<void>;

  // Danger: wipe everything (used by `npm run reset` and the dashboard reset button)
  reset(): Promise<void>;
}
