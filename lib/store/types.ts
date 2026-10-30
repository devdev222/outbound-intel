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
  Operation,
  Outcome,
  OutreachTouch,
  ScoringModel,
} from "@/lib/types";

/** Fields of an Operation a claimant may update when finishing it. */
export type OperationPatch = Partial<Pick<Operation, "status" | "attempts" | "nextAttemptAt" | "remoteId" | "lastError" | "result" | "leaseOwner" | "leaseUntil">>;

/**
 * Persistence boundary. Two implementations ship: FileStore (JSON on disk, zero
 * config) and SupabaseStore (the spec's Postgres schema). The engine only talks
 * to this interface.
 */
export interface Store {
  readonly kind: "file" | "memory" | "supabase";

  /** Applied schema version (Supabase: app_meta.schema_version; local stores: the code version). null when unreadable. */
  schemaVersion(): Promise<string | null>;

  // Accounts
  listAccounts(): Promise<Account[]>;
  getAccountById(id: string): Promise<Account | null>;
  getAccountBySlug(slug: string): Promise<Account | null>;
  upsertAccount(account: Account): Promise<Account>;
  /**
   * Atomic read-modify-write of one account. `fn` receives the LATEST stored
   * account and returns the next one (or null for no change). Concurrent
   * writers never overwrite each other's fields: file/memory stores serialize,
   * Supabase uses compare-and-swap on updated_at with retries.
   */
  patchAccount(id: string, fn: (current: Account) => Account | null): Promise<Account | null>;
  upsertAccounts(accounts: Account[]): Promise<void>;
  deleteAllAccounts(): Promise<void>;

  // Historical records (training data)
  listHistorical(): Promise<HistoricalRecord[]>;
  insertHistorical(records: HistoricalRecord[]): Promise<void>;
  /** Insert or replace ONE record by id (outcome feedback). Never rewrites other rows. */
  upsertHistorical(record: HistoricalRecord): Promise<void>;
  getHistorical(id: string): Promise<HistoricalRecord | null>;
  /** Administrative full replacement (CRM re-import / demo seed only). */
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
  listOutreach(opts?: { accountId?: string; status?: OutreachTouch["status"] | OutreachTouch["status"][]; dueBefore?: string; limit?: number }): Promise<OutreachTouch[]>;

  // Durable operations (idempotency + leases). Claims are atomic per operation id:
  // two workers calling claimOperation for the same id never both succeed.
  /** Insert the operation if no record with that id exists; return the stored record either way. */
  ensureOperation(op: Operation): Promise<Operation>;
  getOperation(id: string): Promise<Operation | null>;
  /**
   * Atomically claim: succeeds only when status is pending/failed, the lease is free or
   * expired, and nextAttemptAt has passed. Returns the claimed record or null.
   */
  claimOperation(id: string, owner: string, leaseMs: number): Promise<Operation | null>;
  /** Update an operation the caller holds (owner must match the current lease owner). */
  finishOperation(id: string, owner: string, patch: OperationPatch): Promise<Operation | null>;
  /** Put a failed/dead operation back to pending (a person chose to retry). No-op while actively leased. */
  requeueOperation(id: string): Promise<Operation | null>;
  listOperations(opts?: { accountId?: string; status?: Operation["status"]; kind?: Operation["kind"]; limit?: number }): Promise<Operation[]>;

  // Per-account activity (team audit trail)
  insertActivity(entries: ActivityEntry[]): Promise<void>;
  listActivity(opts?: { accountId?: string; limit?: number }): Promise<ActivityEntry[]>;

  // Agent team runtime
  insertAgentRun(run: AgentRun): Promise<AgentRun>;
  updateAgentRun(run: AgentRun): Promise<void>;
  listAgentRuns(opts?: { agentId?: AgentId; limit?: number }): Promise<AgentRun[]>;
  getAgentStates(): Promise<AgentState[]>;
  saveAgentState(state: AgentState): Promise<void>;

  // Generic document collections (reps, users, conversations, experiments, proof, gifts,
  // assessments, settings, suppressions, audit). Typed wrappers live in lib/store/collections.ts.
  getDoc<T>(collection: string, id: string): Promise<T | null>;
  listDocs<T>(collection: string): Promise<T[]>;
  putDoc<T extends { id: string }>(collection: string, doc: T): Promise<T>;
  deleteDoc(collection: string, id: string): Promise<void>;

  // Danger: wipe everything (used by `npm run reset` and the dashboard reset button)
  reset(): Promise<void>;
}
