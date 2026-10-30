import { createClient, type SupabaseClient } from "@supabase/supabase-js";
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

/**
 * Supabase (Postgres) store. Schema: supabase/migrations/0001_init.sql.
 *
 * Uses the service-role / secret key on the server only. Row Level Security is
 * enabled on every table with no policies, so the browser can never read or
 * write directly; all traffic goes through our API routes.
 *
 * Column names are snake_case; JSON-heavy sub-objects (facts, signals, scores,
 * campaign, contact) live in jsonb columns so the schema does not have to change
 * every time an agent learns to extract a new fact.
 */
export class SupabaseStore implements Store {
  readonly kind = "supabase" as const;
  private readonly db: SupabaseClient;

  constructor(url: string, secretKey: string) {
    this.db = createClient(url, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  private fail(context: string, error: { message: string } | null): never {
    throw new Error(`[supabase] ${context}: ${error?.message ?? "unknown error"}`);
  }

  // Row mappers ---------------------------------------------------------------

  private accountToRow(a: Account) {
    return {
      id: a.id,
      slug: a.slug,
      company_name: a.companyName,
      company_domain: a.domain,
      industry: a.industry,
      employee_count: a.employeeCount,
      hq_city: a.hqCity,
      hq_state: a.hqState,
      facts: a.facts,
      facts_updated_at: a.factsUpdatedAt,
      signals: a.signals,
      icp_score: a.scores?.icp ?? null,
      signal_score: a.scores?.signal ?? null,
      pain_score: a.scores?.pain ?? null,
      timing_score: a.scores?.timing ?? null,
      access_score: a.scores?.access ?? null,
      total_score: a.scores?.total ?? null,
      score_explanation: a.scoreExplanation,
      verified_signals: a.verifiedSignals,
      hypotheses: a.hypotheses,
      missing_info: a.missingInfo,
      pain_hypothesis: a.painHypothesis,
      messaging_angle: a.messagingAngle,
      recommended_persona: a.recommendedPersona,
      brief: a.brief,
      contact: a.contact,
      campaign: a.campaign,
      engagement_score: a.engagementScore,
      priority: a.priority,
      status: a.status,
      model_version: a.modelVersion,
      last_alert_at: a.lastAlertAt,
      pending_activation: a.pendingActivation,
      agent_runs: a.agentRuns,
      created_at: a.createdAt,
      updated_at: new Date().toISOString(),
    };
  }

  private rowToAccount(r: Record<string, unknown>): Account {
    const hasScores = r.total_score !== null && r.total_score !== undefined;
    return {
      id: r.id as string,
      slug: r.slug as string,
      companyName: r.company_name as string,
      domain: (r.company_domain as string) ?? "",
      industry: (r.industry as string) ?? "",
      employeeCount: (r.employee_count as number) ?? 0,
      hqCity: (r.hq_city as string) ?? "",
      hqState: (r.hq_state as string) ?? "",
      facts: r.facts as Account["facts"],
      factsUpdatedAt: (r.facts_updated_at as string) ?? (r.created_at as string),
      signals: (r.signals as Account["signals"]) ?? [],
      scores: hasScores
        ? {
            icp: r.icp_score as number,
            signal: r.signal_score as number,
            pain: r.pain_score as number,
            timing: r.timing_score as number,
            access: r.access_score as number,
            total: r.total_score as number,
          }
        : null,
      scoreExplanation: (r.score_explanation as string) ?? null,
      verifiedSignals: (r.verified_signals as string[]) ?? [],
      hypotheses: (r.hypotheses as string[]) ?? [],
      missingInfo: (r.missing_info as string[]) ?? [],
      painHypothesis: (r.pain_hypothesis as string) ?? null,
      messagingAngle: (r.messaging_angle as string) ?? null,
      recommendedPersona: (r.recommended_persona as string) ?? null,
      brief: (r.brief as string) ?? null,
      contact: (r.contact as Account["contact"]) ?? null,
      campaign: (r.campaign as Account["campaign"]) ?? null,
      engagementScore: (r.engagement_score as number) ?? 0,
      priority: (r.priority as number) ?? 0,
      status: r.status as Account["status"],
      modelVersion: (r.model_version as number) ?? null,
      lastAlertAt: (r.last_alert_at as string) ?? null,
      pendingActivation: (r.pending_activation as string) ?? null,
      agentRuns: (r.agent_runs as Record<string, string>) ?? {},
      createdAt: r.created_at as string,
      updatedAt: r.updated_at as string,
    };
  }

  private historicalToRow(h: HistoricalRecord) {
    return {
      id: h.id,
      company_name: h.companyName,
      industry: h.industry,
      employee_count: h.employeeCount,
      signal_keys: h.signalKeys,
      persona: h.persona,
      seniority: h.seniority,
      messaging_angle: h.messagingAngle ?? null,
      outcome: h.outcome,
      deal_value: h.dealValue ?? null,
      first_touch_at: h.firstTouchAt,
      outcome_at: h.outcomeAt,
      source: h.source,
    };
  }

  private rowToHistorical(r: Record<string, unknown>): HistoricalRecord {
    return {
      id: r.id as string,
      companyName: r.company_name as string,
      industry: r.industry as string,
      employeeCount: r.employee_count as number,
      signalKeys: (r.signal_keys as string[]) ?? [],
      persona: r.persona as string,
      seniority: r.seniority as HistoricalRecord["seniority"],
      messagingAngle: (r.messaging_angle as string) ?? undefined,
      outcome: r.outcome as HistoricalRecord["outcome"],
      dealValue: (r.deal_value as number) ?? undefined,
      firstTouchAt: r.first_touch_at as string,
      outcomeAt: r.outcome_at as string,
      source: r.source as HistoricalRecord["source"],
    };
  }

  private modelToRow(m: ScoringModel) {
    return {
      version: m.version,
      trained_at: m.trainedAt,
      weights: m.weights,
      prior_weights: m.priorWeights,
      category_correlations: m.categoryCorrelations,
      signal_patterns: m.signalPatterns,
      icp: m.icp,
      playbook: m.playbook,
      baseline: m.baseline,
      notes: m.notes,
    };
  }

  private rowToModel(r: Record<string, unknown>): ScoringModel {
    return {
      version: r.version as number,
      trainedAt: r.trained_at as string,
      weights: r.weights as ScoringModel["weights"],
      priorWeights: r.prior_weights as ScoringModel["priorWeights"],
      categoryCorrelations: r.category_correlations as ScoringModel["categoryCorrelations"],
      signalPatterns: (r.signal_patterns as ScoringModel["signalPatterns"]) ?? [],
      icp: r.icp as ScoringModel["icp"],
      playbook: r.playbook as ScoringModel["playbook"],
      baseline: r.baseline as ScoringModel["baseline"],
      notes: (r.notes as string[]) ?? [],
    };
  }

  // Accounts -----------------------------------------------------------------

  async listAccounts(): Promise<Account[]> {
    const { data, error } = await this.db.from("accounts").select("*").order("priority", { ascending: false });
    if (error) this.fail("listAccounts", error);
    return (data ?? []).map((r) => this.rowToAccount(r));
  }

  async getAccountById(id: string): Promise<Account | null> {
    const { data, error } = await this.db.from("accounts").select("*").eq("id", id).maybeSingle();
    if (error) this.fail("getAccountById", error);
    return data ? this.rowToAccount(data) : null;
  }

  async getAccountBySlug(slug: string): Promise<Account | null> {
    const { data, error } = await this.db.from("accounts").select("*").eq("slug", slug).maybeSingle();
    if (error) this.fail("getAccountBySlug", error);
    return data ? this.rowToAccount(data) : null;
  }

  async upsertAccount(account: Account): Promise<Account> {
    const row = this.accountToRow(account);
    const { data, error } = await this.db.from("accounts").upsert(row, { onConflict: "id" }).select("*").single();
    if (error) this.fail("upsertAccount", error);
    return this.rowToAccount(data);
  }

  async upsertAccounts(accounts: Account[]): Promise<void> {
    if (!accounts.length) return;
    // Chunk to stay well under request size limits with large jsonb facts.
    for (let i = 0; i < accounts.length; i += 50) {
      const rows = accounts.slice(i, i + 50).map((a) => this.accountToRow(a));
      const { error } = await this.db.from("accounts").upsert(rows, { onConflict: "id" });
      if (error) this.fail("upsertAccounts", error);
    }
  }

  async deleteAllAccounts(): Promise<void> {
    const { error } = await this.db.from("accounts").delete().neq("slug", "");
    if (error) this.fail("deleteAllAccounts", error);
  }

  // Historical ---------------------------------------------------------------

  async listHistorical(): Promise<HistoricalRecord[]> {
    const { data, error } = await this.db.from("historical_accounts").select("*");
    if (error) this.fail("listHistorical", error);
    return (data ?? []).map((r) => this.rowToHistorical(r));
  }

  async insertHistorical(records: HistoricalRecord[]): Promise<void> {
    if (!records.length) return;
    for (let i = 0; i < records.length; i += 200) {
      const { error } = await this.db
        .from("historical_accounts")
        .upsert(records.slice(i, i + 200).map((h) => this.historicalToRow(h)), { onConflict: "id" });
      if (error) this.fail("insertHistorical", error);
    }
  }

  async replaceHistorical(records: HistoricalRecord[]): Promise<void> {
    const { error } = await this.db.from("historical_accounts").delete().neq("company_name", "");
    if (error) this.fail("replaceHistorical:delete", error);
    await this.insertHistorical(records);
  }

  // Events -------------------------------------------------------------------

  async insertEvent(event: EngagementEvent): Promise<EngagementEvent> {
    const { error } = await this.db.from("events").insert({
      id: event.id,
      account_id: event.accountId,
      event_type: event.eventType,
      properties: event.properties,
      visitor_id: event.visitorId,
      created_at: event.createdAt,
    });
    if (error) this.fail("insertEvent", error);
    return event;
  }

  async listEvents(opts: { accountId?: string; limit?: number; sinceIso?: string } = {}): Promise<EngagementEvent[]> {
    let q = this.db.from("events").select("*").order("created_at", { ascending: false });
    if (opts.accountId) q = q.eq("account_id", opts.accountId);
    if (opts.sinceIso) q = q.gte("created_at", opts.sinceIso);
    if (opts.limit) q = q.limit(opts.limit);
    const { data, error } = await q;
    if (error) this.fail("listEvents", error);
    return (data ?? []).map((r) => ({
      id: r.id,
      accountId: r.account_id,
      eventType: r.event_type,
      properties: r.properties ?? {},
      visitorId: r.visitor_id ?? null,
      createdAt: r.created_at,
    }));
  }

  // Outcomes -----------------------------------------------------------------

  async insertOutcome(outcome: Outcome): Promise<Outcome> {
    const { error } = await this.db.from("outcomes").insert({
      id: outcome.id,
      account_id: outcome.accountId,
      outcome_type: outcome.outcomeType,
      outcome_value: outcome.value,
      notes: outcome.notes,
      source: outcome.source,
      created_at: outcome.createdAt,
    });
    if (error) this.fail("insertOutcome", error);
    return outcome;
  }

  async listOutcomes(opts: { accountId?: string; limit?: number } = {}): Promise<Outcome[]> {
    let q = this.db.from("outcomes").select("*").order("created_at", { ascending: false });
    if (opts.accountId) q = q.eq("account_id", opts.accountId);
    if (opts.limit) q = q.limit(opts.limit);
    const { data, error } = await q;
    if (error) this.fail("listOutcomes", error);
    return (data ?? []).map((r) => ({
      id: r.id,
      accountId: r.account_id,
      outcomeType: r.outcome_type,
      value: r.outcome_value ?? null,
      notes: r.notes ?? null,
      source: r.source ?? "api",
      createdAt: r.created_at,
    }));
  }

  // Models -------------------------------------------------------------------

  async getLatestModel(): Promise<ScoringModel | null> {
    const { data, error } = await this.db
      .from("scoring_models")
      .select("*")
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) this.fail("getLatestModel", error);
    return data ? this.rowToModel(data) : null;
  }

  async listModels(): Promise<ScoringModel[]> {
    const { data, error } = await this.db.from("scoring_models").select("*").order("version", { ascending: false });
    if (error) this.fail("listModels", error);
    return (data ?? []).map((r) => this.rowToModel(r));
  }

  async saveModel(model: ScoringModel): Promise<ScoringModel> {
    const { error } = await this.db.from("scoring_models").insert(this.modelToRow(model));
    if (error) this.fail("saveModel", error);
    // Mirror the flattened signal_patterns table from the spec so analysts can query it directly.
    const { error: delErr } = await this.db.from("signal_patterns").delete().neq("signal_type", "");
    if (delErr) this.fail("saveModel:signal_patterns:delete", delErr);
    if (model.signalPatterns.length) {
      const { error: insErr } = await this.db.from("signal_patterns").insert(
        model.signalPatterns.map((p) => ({
          signal_type: p.type,
          signal_value: p.key,
          label: p.label,
          conversion_rate: p.rateWith,
          baseline_rate: p.rateWithout,
          lift: p.lift,
          weight: p.weight,
          sample_size: p.withN,
          model_version: model.version,
          last_updated: model.trainedAt,
        })),
      );
      if (insErr) this.fail("saveModel:signal_patterns:insert", insErr);
    }
    return model;
  }

  // Alerts / calls -----------------------------------------------------------

  async insertAlert(alert: Alert): Promise<Alert> {
    const { error } = await this.db.from("alerts").insert({
      id: alert.id,
      account_id: alert.accountId,
      kind: alert.kind,
      payload: alert.payload,
      delivered_via: alert.deliveredVia,
      created_at: alert.createdAt,
    });
    if (error) this.fail("insertAlert", error);
    return alert;
  }

  async listAlerts(opts: { accountId?: string; limit?: number } = {}): Promise<Alert[]> {
    let q = this.db.from("alerts").select("*").order("created_at", { ascending: false });
    if (opts.accountId) q = q.eq("account_id", opts.accountId);
    if (opts.limit) q = q.limit(opts.limit);
    const { data, error } = await q;
    if (error) this.fail("listAlerts", error);
    return (data ?? []).map((r) => ({
      id: r.id,
      accountId: r.account_id,
      kind: r.kind,
      payload: r.payload,
      deliveredVia: r.delivered_via ?? [],
      createdAt: r.created_at,
    }));
  }

  async enqueueCall(item: CallQueueItem): Promise<CallQueueItem> {
    const { error } = await this.db.from("call_queue").insert({
      id: item.id,
      account_id: item.accountId,
      contact_name: item.contactName,
      phone: item.phone,
      context: item.context,
      status: item.status,
      created_at: item.createdAt,
    });
    if (error) this.fail("enqueueCall", error);
    return item;
  }

  async listCallQueue(opts: { status?: CallQueueItem["status"]; limit?: number } = {}): Promise<CallQueueItem[]> {
    let q = this.db.from("call_queue").select("*").order("created_at", { ascending: false });
    if (opts.status) q = q.eq("status", opts.status);
    if (opts.limit) q = q.limit(opts.limit);
    const { data, error } = await q;
    if (error) this.fail("listCallQueue", error);
    return (data ?? []).map((r) => ({
      id: r.id,
      accountId: r.account_id,
      contactName: r.contact_name,
      phone: r.phone ?? null,
      context: r.context ?? "",
      status: r.status,
      createdAt: r.created_at,
    }));
  }

  async updateCallStatus(id: string, status: CallQueueItem["status"]): Promise<void> {
    const { error } = await this.db.from("call_queue").update({ status }).eq("id", id);
    if (error) this.fail("updateCallStatus", error);
  }

  // Outreach -----------------------------------------------------------------

  async insertOutreach(touches: OutreachTouch[]): Promise<void> {
    if (!touches.length) return;
    const { error } = await this.db.from("outreach_touches").insert(touches.map((t) => this.touchToRow(t)));
    if (error) this.fail("insertOutreach", error);
  }

  private rowToTouch(r: Record<string, unknown>): OutreachTouch {
    return {
      id: r.id as string,
      accountId: r.account_id as string,
      channel: r.channel as OutreachTouch["channel"],
      step: r.step as number,
      subject: (r.subject as string) ?? undefined,
      body: r.body as string,
      status: r.status as OutreachTouch["status"],
      scheduledFor: r.scheduled_for as string,
      sentAt: (r.sent_at as string) ?? undefined,
      provider: r.provider as string,
      externalId: (r.external_id as string) ?? undefined,
      note: (r.note as string) ?? undefined,
      taskUrl: (r.task_url as string) ?? undefined,
    };
  }

  private touchToRow(t: OutreachTouch) {
    return {
      id: t.id,
      account_id: t.accountId,
      channel: t.channel,
      step: t.step,
      subject: t.subject ?? null,
      body: t.body,
      status: t.status,
      scheduled_for: t.scheduledFor,
      sent_at: t.sentAt ?? null,
      provider: t.provider,
      external_id: t.externalId ?? null,
      note: t.note ?? null,
      task_url: t.taskUrl ?? null,
    };
  }

  async updateOutreach(touch: OutreachTouch): Promise<void> {
    const { error } = await this.db.from("outreach_touches").upsert(this.touchToRow(touch), { onConflict: "id" });
    if (error) this.fail("updateOutreach", error);
  }

  async getOutreach(id: string): Promise<OutreachTouch | null> {
    const { data, error } = await this.db.from("outreach_touches").select("*").eq("id", id).maybeSingle();
    if (error) this.fail("getOutreach", error);
    return data ? this.rowToTouch(data) : null;
  }

  async listOutreach(opts: { accountId?: string; status?: OutreachTouch["status"]; dueBefore?: string; limit?: number } = {}): Promise<OutreachTouch[]> {
    let q = this.db.from("outreach_touches").select("*").order("scheduled_for", { ascending: true });
    if (opts.accountId) q = q.eq("account_id", opts.accountId);
    if (opts.status) q = q.eq("status", opts.status);
    if (opts.dueBefore) q = q.lte("scheduled_for", opts.dueBefore);
    if (opts.limit) q = q.limit(opts.limit);
    const { data, error } = await q;
    if (error) this.fail("listOutreach", error);
    return (data ?? []).map((r) => this.rowToTouch(r));
  }

  // Activity -------------------------------------------------------------------

  async insertActivity(entries: ActivityEntry[]): Promise<void> {
    if (!entries.length) return;
    const { error } = await this.db.from("account_activity").insert(
      entries.map((e) => ({ id: e.id, account_id: e.accountId, actor: e.actor, action: e.action, summary: e.summary, details: e.details ?? [], at: e.at })),
    );
    if (error) this.fail("insertActivity", error);
  }

  async listActivity(opts: { accountId?: string; limit?: number } = {}): Promise<ActivityEntry[]> {
    let q = this.db.from("account_activity").select("*").order("at", { ascending: false });
    if (opts.accountId) q = q.eq("account_id", opts.accountId);
    if (opts.limit) q = q.limit(opts.limit);
    const { data, error } = await q;
    if (error) this.fail("listActivity", error);
    return (data ?? []).map((r) => ({
      id: r.id,
      accountId: r.account_id,
      actor: r.actor,
      action: r.action,
      summary: r.summary,
      details: r.details ?? [],
      at: r.at,
    }));
  }

  // Agent runtime ------------------------------------------------------------

  private agentRunToRow(run: AgentRun) {
    return {
      id: run.id,
      agent_id: run.agentId,
      started_at: run.startedAt,
      finished_at: run.finishedAt,
      status: run.status,
      processed: run.processed,
      summary: run.summary,
      details: run.details,
      error: run.error ?? null,
    };
  }

  private rowToAgentRun(r: Record<string, unknown>): AgentRun {
    return {
      id: r.id as string,
      agentId: r.agent_id as AgentId,
      startedAt: r.started_at as string,
      finishedAt: (r.finished_at as string) ?? null,
      status: r.status as AgentRun["status"],
      processed: (r.processed as number) ?? 0,
      summary: (r.summary as string) ?? "",
      details: (r.details as string[]) ?? [],
      error: (r.error as string) ?? undefined,
    };
  }

  async insertAgentRun(run: AgentRun): Promise<AgentRun> {
    const { error } = await this.db.from("agent_runs").insert(this.agentRunToRow(run));
    if (error) this.fail("insertAgentRun", error);
    return run;
  }

  async updateAgentRun(run: AgentRun): Promise<void> {
    const { error } = await this.db.from("agent_runs").upsert(this.agentRunToRow(run), { onConflict: "id" });
    if (error) this.fail("updateAgentRun", error);
  }

  async listAgentRuns(opts: { agentId?: AgentId; limit?: number } = {}): Promise<AgentRun[]> {
    let q = this.db.from("agent_runs").select("*").order("started_at", { ascending: false });
    if (opts.agentId) q = q.eq("agent_id", opts.agentId);
    if (opts.limit) q = q.limit(opts.limit);
    const { data, error } = await q;
    if (error) this.fail("listAgentRuns", error);
    return (data ?? []).map((r) => this.rowToAgentRun(r));
  }

  async getAgentStates(): Promise<AgentState[]> {
    const { data, error } = await this.db.from("agent_state").select("*");
    if (error) this.fail("getAgentStates", error);
    return (data ?? []).map((r) => ({
      agentId: r.agent_id as AgentId,
      enabled: r.enabled ?? true,
      lastRunAt: r.last_run_at ?? null,
      lastStatus: r.last_status ?? null,
      totalRuns: r.total_runs ?? 0,
      totalProcessed: r.total_processed ?? 0,
    }));
  }

  async saveAgentState(state: AgentState): Promise<void> {
    const { error } = await this.db.from("agent_state").upsert(
      {
        agent_id: state.agentId,
        enabled: state.enabled,
        last_run_at: state.lastRunAt,
        last_status: state.lastStatus,
        total_runs: state.totalRuns,
        total_processed: state.totalProcessed,
      },
      { onConflict: "agent_id" },
    );
    if (error) this.fail("saveAgentState", error);
  }

  // Reset --------------------------------------------------------------------

  async reset(): Promise<void> {
    // Order matters because of foreign keys.
    for (const table of ["account_activity", "outreach_touches", "call_queue", "alerts", "outcomes", "events", "agent_runs"]) {
      const { error } = await this.db.from(table).delete().not("id", "is", null);
      if (error) this.fail(`reset:${table}`, error);
    }
    const { error: a } = await this.db.from("accounts").delete().not("id", "is", null);
    if (a) this.fail("reset:accounts", a);
    const { error: h } = await this.db.from("historical_accounts").delete().not("id", "is", null);
    if (h) this.fail("reset:historical", h);
    const { error: sp } = await this.db.from("signal_patterns").delete().not("id", "is", null);
    if (sp) this.fail("reset:signal_patterns", sp);
    const { error: m } = await this.db.from("scoring_models").delete().gte("version", 0);
    if (m) this.fail("reset:models", m);
    const { error: s } = await this.db.from("agent_state").delete().neq("agent_id", "");
    if (s) this.fail("reset:agent_state", s);
  }
}
