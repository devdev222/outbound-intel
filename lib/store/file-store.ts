import { promises as fs } from "node:fs";
import path from "node:path";
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
import type { Store } from "./types";

export type Collection =
  | "accounts"
  | "historical"
  | "events"
  | "outcomes"
  | "models"
  | "alerts"
  | "call_queue"
  | "outreach"
  | "activity"
  | "agent_runs"
  | "agent_state"
  | `docs_${string}`;

/**
 * JSON-on-disk store. One file per collection under DATA_DIR. Writes are
 * serialized through a single promise chain so concurrent route handlers in
 * `next dev` cannot interleave read-modify-write cycles. Good for a demo and
 * for anyone cloning the repo with no Supabase project; not for production.
 */
export class FileStore implements Store {
  readonly kind: "file" | "memory" = "file";
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly dir: string) {}

  private file(c: Collection): string {
    return path.join(this.dir, `${c}.json`);
  }

  protected async read<T>(c: Collection): Promise<T[]> {
    try {
      const raw = await fs.readFile(this.file(c), "utf8");
      return JSON.parse(raw) as T[];
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
  }

  protected async write<T>(c: Collection, rows: T[]): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
    const target = this.file(c);
    const tmp = `${target}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(rows), "utf8");
    await fs.rename(tmp, target);
  }

  /** Run a read-modify-write atomically with respect to other mutations in this process. */
  private mutate<T, R>(c: Collection, fn: (rows: T[]) => { rows: T[]; result: R }): Promise<R> {
    const run = async () => {
      const rows = await this.read<T>(c);
      const { rows: next, result } = fn(rows);
      await this.write(c, next);
      return result;
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => undefined);
    return p;
  }

  // Accounts -----------------------------------------------------------------

  async listAccounts(): Promise<Account[]> {
    const rows = await this.read<Account>("accounts");
    return rows.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  }

  async getAccountById(id: string): Promise<Account | null> {
    return (await this.read<Account>("accounts")).find((a) => a.id === id) ?? null;
  }

  async getAccountBySlug(slug: string): Promise<Account | null> {
    return (await this.read<Account>("accounts")).find((a) => a.slug === slug) ?? null;
  }

  upsertAccount(account: Account): Promise<Account> {
    return this.mutate<Account, Account>("accounts", (rows) => {
      const idx = rows.findIndex((a) => a.id === account.id || a.slug === account.slug);
      const next = { ...account, updatedAt: new Date().toISOString() };
      if (idx >= 0) rows[idx] = next;
      else rows.push(next);
      return { rows, result: next };
    });
  }

  upsertAccounts(accounts: Account[]): Promise<void> {
    return this.mutate<Account, void>("accounts", (rows) => {
      const byId = new Map(rows.map((a) => [a.id, a]));
      for (const a of accounts) byId.set(a.id, a);
      return { rows: [...byId.values()], result: undefined };
    });
  }

  deleteAllAccounts(): Promise<void> {
    return this.mutate<Account, void>("accounts", () => ({ rows: [], result: undefined }));
  }

  // Historical ---------------------------------------------------------------

  listHistorical(): Promise<HistoricalRecord[]> {
    return this.read<HistoricalRecord>("historical");
  }

  insertHistorical(records: HistoricalRecord[]): Promise<void> {
    return this.mutate<HistoricalRecord, void>("historical", (rows) => ({
      rows: [...rows, ...records],
      result: undefined,
    }));
  }

  replaceHistorical(records: HistoricalRecord[]): Promise<void> {
    return this.mutate<HistoricalRecord, void>("historical", () => ({ rows: records, result: undefined }));
  }

  // Events -------------------------------------------------------------------

  insertEvent(event: EngagementEvent): Promise<EngagementEvent> {
    return this.mutate<EngagementEvent, EngagementEvent>("events", (rows) => {
      rows.push(event);
      return { rows, result: event };
    });
  }

  async listEvents(opts: { accountId?: string; limit?: number; sinceIso?: string } = {}): Promise<EngagementEvent[]> {
    let rows = await this.read<EngagementEvent>("events");
    if (opts.accountId) rows = rows.filter((e) => e.accountId === opts.accountId);
    if (opts.sinceIso) rows = rows.filter((e) => e.createdAt >= opts.sinceIso!);
    rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return opts.limit ? rows.slice(0, opts.limit) : rows;
  }

  // Outcomes -----------------------------------------------------------------

  insertOutcome(outcome: Outcome): Promise<Outcome> {
    return this.mutate<Outcome, Outcome>("outcomes", (rows) => {
      rows.push(outcome);
      return { rows, result: outcome };
    });
  }

  async listOutcomes(opts: { accountId?: string; limit?: number } = {}): Promise<Outcome[]> {
    let rows = await this.read<Outcome>("outcomes");
    if (opts.accountId) rows = rows.filter((o) => o.accountId === opts.accountId);
    rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return opts.limit ? rows.slice(0, opts.limit) : rows;
  }

  // Models -------------------------------------------------------------------

  async getLatestModel(): Promise<ScoringModel | null> {
    const rows = await this.read<ScoringModel>("models");
    return rows.sort((a, b) => b.version - a.version)[0] ?? null;
  }

  async listModels(): Promise<ScoringModel[]> {
    return (await this.read<ScoringModel>("models")).sort((a, b) => b.version - a.version);
  }

  saveModel(model: ScoringModel): Promise<ScoringModel> {
    return this.mutate<ScoringModel, ScoringModel>("models", (rows) => {
      rows.push(model);
      return { rows, result: model };
    });
  }

  // Alerts / calls -----------------------------------------------------------

  insertAlert(alert: Alert): Promise<Alert> {
    return this.mutate<Alert, Alert>("alerts", (rows) => {
      rows.push(alert);
      return { rows, result: alert };
    });
  }

  async listAlerts(opts: { accountId?: string; limit?: number } = {}): Promise<Alert[]> {
    let rows = await this.read<Alert>("alerts");
    if (opts.accountId) rows = rows.filter((a) => a.accountId === opts.accountId);
    rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return opts.limit ? rows.slice(0, opts.limit) : rows;
  }

  enqueueCall(item: CallQueueItem): Promise<CallQueueItem> {
    return this.mutate<CallQueueItem, CallQueueItem>("call_queue", (rows) => {
      rows.push(item);
      return { rows, result: item };
    });
  }

  async listCallQueue(opts: { status?: CallQueueItem["status"]; limit?: number } = {}): Promise<CallQueueItem[]> {
    let rows = await this.read<CallQueueItem>("call_queue");
    if (opts.status) rows = rows.filter((c) => c.status === opts.status);
    rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return opts.limit ? rows.slice(0, opts.limit) : rows;
  }

  updateCallStatus(id: string, status: CallQueueItem["status"]): Promise<void> {
    return this.mutate<CallQueueItem, void>("call_queue", (rows) => {
      const item = rows.find((c) => c.id === id);
      if (item) item.status = status;
      return { rows, result: undefined };
    });
  }

  // Outreach -----------------------------------------------------------------

  insertOutreach(touches: OutreachTouch[]): Promise<void> {
    return this.mutate<OutreachTouch, void>("outreach", (rows) => ({
      rows: [...rows, ...touches],
      result: undefined,
    }));
  }

  updateOutreach(touch: OutreachTouch): Promise<void> {
    return this.mutate<OutreachTouch, void>("outreach", (rows) => {
      const idx = rows.findIndex((t) => t.id === touch.id);
      if (idx >= 0) rows[idx] = touch;
      else rows.push(touch);
      return { rows, result: undefined };
    });
  }

  async getOutreach(id: string): Promise<OutreachTouch | null> {
    return (await this.read<OutreachTouch>("outreach")).find((t) => t.id === id) ?? null;
  }

  async listOutreach(opts: { accountId?: string; status?: OutreachTouch["status"]; dueBefore?: string; limit?: number } = {}): Promise<OutreachTouch[]> {
    let rows = await this.read<OutreachTouch>("outreach");
    if (opts.accountId) rows = rows.filter((t) => t.accountId === opts.accountId);
    if (opts.status) rows = rows.filter((t) => t.status === opts.status);
    if (opts.dueBefore) rows = rows.filter((t) => t.scheduledFor <= opts.dueBefore!);
    rows.sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor));
    return opts.limit ? rows.slice(0, opts.limit) : rows;
  }

  // Activity ------------------------------------------------------------------

  insertActivity(entries: ActivityEntry[]): Promise<void> {
    if (!entries.length) return Promise.resolve();
    return this.mutate<ActivityEntry, void>("activity", (rows) => {
      const next = [...rows, ...entries];
      return { rows: next.length > 20000 ? next.slice(next.length - 20000) : next, result: undefined };
    });
  }

  async listActivity(opts: { accountId?: string; limit?: number } = {}): Promise<ActivityEntry[]> {
    let rows = await this.read<ActivityEntry>("activity");
    if (opts.accountId) rows = rows.filter((e) => e.accountId === opts.accountId);
    rows.sort((a, b) => b.at.localeCompare(a.at));
    return opts.limit ? rows.slice(0, opts.limit) : rows;
  }

  // Agent runtime ------------------------------------------------------------

  insertAgentRun(run: AgentRun): Promise<AgentRun> {
    return this.mutate<AgentRun, AgentRun>("agent_runs", (rows) => {
      rows.push(run);
      // keep the log bounded
      const trimmed = rows.length > 2000 ? rows.slice(rows.length - 2000) : rows;
      return { rows: trimmed, result: run };
    });
  }

  updateAgentRun(run: AgentRun): Promise<void> {
    return this.mutate<AgentRun, void>("agent_runs", (rows) => {
      const idx = rows.findIndex((r) => r.id === run.id);
      if (idx >= 0) rows[idx] = run;
      else rows.push(run);
      return { rows, result: undefined };
    });
  }

  async listAgentRuns(opts: { agentId?: AgentId; limit?: number } = {}): Promise<AgentRun[]> {
    let rows = await this.read<AgentRun>("agent_runs");
    if (opts.agentId) rows = rows.filter((r) => r.agentId === opts.agentId);
    rows.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    return opts.limit ? rows.slice(0, opts.limit) : rows;
  }

  getAgentStates(): Promise<AgentState[]> {
    return this.read<AgentState>("agent_state");
  }

  saveAgentState(state: AgentState): Promise<void> {
    return this.mutate<AgentState, void>("agent_state", (rows) => {
      const idx = rows.findIndex((s) => s.agentId === state.agentId);
      if (idx >= 0) rows[idx] = state;
      else rows.push(state);
      return { rows, result: undefined };
    });
  }

  // Generic documents ---------------------------------------------------------

  async getDoc<T>(collection: string, id: string): Promise<T | null> {
    return (await this.read<T & { id: string }>(`docs_${collection}`)).find((d) => d.id === id) ?? null;
  }

  listDocs<T>(collection: string): Promise<T[]> {
    return this.read<T>(`docs_${collection}`);
  }

  putDoc<T extends { id: string }>(collection: string, doc: T): Promise<T> {
    return this.mutate<T, T>(`docs_${collection}`, (rows) => {
      const idx = rows.findIndex((r) => r.id === doc.id);
      if (idx >= 0) rows[idx] = doc;
      else rows.push(doc);
      return { rows, result: doc };
    });
  }

  deleteDoc(collection: string, id: string): Promise<void> {
    return this.mutate<{ id: string }, void>(`docs_${collection}`, (rows) => ({ rows: rows.filter((r) => r.id !== id), result: undefined }));
  }

  // Reset --------------------------------------------------------------------

  async reset(): Promise<void> {
    try {
      const files = await fs.readdir(this.dir);
      for (const f of files) if (f.startsWith("docs_") && f.endsWith(".json")) await this.mutate<unknown, void>(f.replace(/.json$/, "") as Collection, () => ({ rows: [], result: undefined }));
    } catch {
      /* no data dir yet */
    }
    const all: Collection[] = [
      "accounts",
      "historical",
      "events",
      "outcomes",
      "models",
      "alerts",
      "call_queue",
      "outreach",
      "activity",
      "agent_runs",
      "agent_state",
    ];
    for (const c of all) await this.mutate<unknown, void>(c, () => ({ rows: [], result: undefined }));
  }
}
