import { z } from "zod";
import { AGENTS } from "@/lib/agents";
import { runAgent, tick } from "@/lib/agents/runtime";
import type { Actor, Scope } from "@/lib/auth/machine";
import { markWrongContact } from "@/lib/engine/contact";
import { isPhoneVerified } from "@/lib/engine/contact-fields";
import { logConversation } from "@/lib/engine/conversations";
import { PAGE_EVENTS, recordEngagement } from "@/lib/engine/engagement";
import { idempotent } from "@/lib/engine/idempotency";
import { recordOutcome } from "@/lib/engine/outcomes";
import { approveTask, completeManually, OPEN_STATUSES, skipTask, TaskError } from "@/lib/engine/tasks";
import type { Providers } from "@/lib/providers";
import type { Store } from "@/lib/store";
import type { Account, Task, User } from "@/lib/types";

/**
 * Shared, runtime-validated operation contracts.
 *
 * One definition per operation is used by BOTH transports:
 *   HTTP: POST /api/v1/<name>   (machine token with the scope, or a signed-in user)
 *   MCP:  tool <name>           (stdio server; MCP_SCOPES grants scopes, default read)
 * and by `npm run contracts:doc`, which writes docs/CONTRACTS.md (JSON Schemas).
 *
 * Inputs and outputs are validated at runtime on every call. Mutations require
 * an idempotencyKey and are recorded once per (operation, caller, key) in the
 * operations table: retrying with the same key returns the original result.
 * List operations page with an opaque cursor. Errors are { code, message }.
 */

export type ErrorCode = "invalid_input" | "not_found" | "conflict" | "forbidden" | "unauthenticated" | "in_progress" | "internal";

export class ContractError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export const HTTP_STATUS: Record<ErrorCode, number> = { invalid_input: 400, unauthenticated: 401, forbidden: 403, not_found: 404, conflict: 409, in_progress: 409, internal: 500 };

export interface OperationContext {
  store: Store;
  providers: Providers;
  actor: Actor;
  /** User-shaped actor for engine commands that record a name. */
  user: User;
}

export interface Operation<I extends z.ZodObject = z.ZodObject, O extends z.ZodObject = z.ZodObject> {
  name: string;
  title: string;
  description: string;
  scope: Scope;
  /** Changes state. Mutations require idempotencyKey. */
  mutates: boolean;
  /** Irreversible or removes information (MCP destructiveHint). */
  destructive: boolean;
  /** Calls or affects systems outside this app (MCP openWorldHint). */
  openWorld: boolean;
  input: I;
  output: O;
  errors: { code: ErrorCode; when: string }[];
  pagination?: { cursor: "nextCursor"; maxLimit: number };
  retry: string;
  run(ctx: OperationContext, input: z.infer<I>): Promise<z.infer<O>>;
}

const op = <I extends z.ZodObject, O extends z.ZodObject>(o: Operation<I, O>) => o;

// --- Shared shapes ---------------------------------------------------------------------

const AccountRef = { accountId: z.string().min(1).max(64).optional().describe("Stable account id (preferred)"), slug: z.string().min(1).max(120).optional().describe("Account slug (alternative to accountId)") };
const IdempotencyKey = z.string().min(8).max(200).describe("Caller-chosen key; a retry with the same key returns the first result and never acts twice");
const Cursor = z.string().max(400).optional().describe("Opaque cursor from the previous page's nextCursor");

const AccountSummary = z.object({
  accountId: z.string(),
  slug: z.string(),
  company: z.string(),
  industry: z.string(),
  status: z.string(),
  score: z.number().nullable(),
  priority: z.number(),
  engagement: z.number(),
  ownerRepId: z.string().nullable(),
  ready: z.boolean(),
  paused: z.boolean(),
  contact: z.object({ name: z.string(), title: z.string(), phoneVerified: z.boolean(), hasEmail: z.boolean() }).nullable(),
  nextAction: z.object({ type: z.string(), label: z.string(), dueAt: z.string() }).nullable(),
  pageUrl: z.string().nullable(),
});

const TaskOut = z.object({ taskId: z.string(), accountId: z.string(), channel: z.string(), status: z.string(), title: z.string().nullable(), step: z.number(), dueAt: z.string(), subject: z.string().nullable(), body: z.string(), source: z.string().nullable(), assigneeRepId: z.string().nullable(), lastError: z.string().nullable() });

function summarize(a: Account): z.infer<typeof AccountSummary> {
  return {
    accountId: a.id,
    slug: a.slug,
    company: a.companyName,
    industry: a.industry,
    status: a.status,
    score: a.scores?.total ?? null,
    priority: a.priority,
    engagement: a.engagementScore,
    ownerRepId: a.ownerRepId ?? null,
    ready: Boolean(a.readiness?.ready),
    paused: Boolean(a.pausedUntil && a.pausedUntil > new Date().toISOString()),
    contact: a.contact ? { name: a.contact.name, title: a.contact.title, phoneVerified: isPhoneVerified(a.contact), hasEmail: Boolean(a.contact.email) } : null,
    nextAction: a.nextAction ? { type: a.nextAction.type, label: a.nextAction.label, dueAt: a.nextAction.dueAt } : null,
    pageUrl: a.campaign?.pageUrl ?? null,
  };
}

const taskOut = (t: Task): z.infer<typeof TaskOut> => ({ taskId: t.id, accountId: t.accountId, channel: t.channel, status: t.status, title: t.title ?? null, step: t.step, dueAt: t.scheduledFor, subject: t.subject ?? null, body: t.body, source: t.source ?? null, assigneeRepId: t.assigneeRepId ?? null, lastError: t.lastError ?? null });

const encodeCursor = (offset: number) => Buffer.from(JSON.stringify({ o: offset })).toString("base64url");
function decodeCursor(c: string | undefined): number {
  if (!c) return 0;
  try {
    const o = JSON.parse(Buffer.from(c, "base64url").toString("utf8")).o;
    if (Number.isInteger(o) && o >= 0) return o;
  } catch {
    /* fall through */
  }
  throw new ContractError("invalid_input", "cursor is not valid; start again without it");
}

function page<T>(rows: T[], cursor: string | undefined, limit: number): { items: T[]; nextCursor: string | null } {
  const offset = decodeCursor(cursor);
  const items = rows.slice(offset, offset + limit);
  return { items, nextCursor: offset + limit < rows.length ? encodeCursor(offset + limit) : null };
}

async function resolveAccount(store: Store, ref: { accountId?: string; slug?: string }): Promise<Account> {
  if (!ref.accountId && !ref.slug) throw new ContractError("invalid_input", "accountId or slug is required");
  const a = ref.accountId ? await store.getAccountById(ref.accountId) : await store.getAccountBySlug(ref.slug!);
  if (!a) throw new ContractError("not_found", `no account ${ref.accountId ?? ref.slug}`);
  return a;
}

/** Run a mutation once per (operation, caller, idempotencyKey). */
async function once<T>(ctx: OperationContext, name: string, key: string, fn: () => Promise<T>, accountId?: string | null): Promise<T> {
  const r = await idempotent(ctx.store, `op:${name}:${ctx.actor.id}`, key, fn, { accountId });
  if (r.state === "in_progress") throw new ContractError("in_progress", "the same request is still running; retry shortly with the same idempotencyKey");
  return r.result;
}

// --- Operations ------------------------------------------------------------------------------

export const OPERATIONS = [
  op({
    name: "list_accounts",
    title: "List accounts",
    description: "Accounts sorted by priority, with readiness, owner, contact verification and next action. Filter by status, owner or text.",
    scope: "read",
    mutates: false,
    destructive: false,
    openWorld: false,
    input: z.object({ status: z.string().max(40).optional(), ownerRepId: z.string().max(64).optional(), query: z.string().max(120).optional(), readyOnly: z.boolean().default(false), limit: z.number().int().min(1).max(100).default(25), cursor: Cursor }),
    output: z.object({ items: z.array(AccountSummary), nextCursor: z.string().nullable() }),
    errors: [{ code: "invalid_input", when: "bad filter or cursor" }],
    pagination: { cursor: "nextCursor", maxLimit: 100 },
    retry: "Safe to retry (read-only).",
    async run({ store }, i) {
      const q = i.query?.toLowerCase();
      const rows = (await store.listAccounts())
        .filter((a) => (!i.status || a.status === i.status) && (!i.ownerRepId || a.ownerRepId === i.ownerRepId) && (!i.readyOnly || a.readiness?.ready))
        .filter((a) => !q || a.companyName.toLowerCase().includes(q) || a.industry.toLowerCase().includes(q) || a.signals.some((s) => s.label.toLowerCase().includes(q)))
        .sort((x, y) => y.priority - x.priority || x.id.localeCompare(y.id))
        .map(summarize);
      return page(rows, i.cursor, i.limit);
    },
  }),
  op({
    name: "list_hot_leads",
    title: "List hot leads",
    description: "Engaged, hot and meeting-booked accounts, highest priority first.",
    scope: "read",
    mutates: false,
    destructive: false,
    openWorld: false,
    input: z.object({ limit: z.number().int().min(1).max(50).default(10) }),
    output: z.object({ items: z.array(AccountSummary) }),
    errors: [],
    retry: "Safe to retry (read-only).",
    async run({ store }, i) {
      return { items: (await store.listAccounts()).filter((a) => ["engaged", "hot", "meeting_booked"].includes(a.status)).sort((x, y) => y.priority - x.priority).slice(0, i.limit).map(summarize) };
    },
  }),
  op({
    name: "get_account_brief",
    title: "Get account brief",
    description: "One account: score and explanation, signals with evidence, pain hypothesis, angle, contact with field provenance, open tasks, recent engagement and alerts.",
    scope: "read",
    mutates: false,
    destructive: false,
    openWorld: false,
    input: z.object(AccountRef),
    output: z.object({
      account: AccountSummary,
      scoreExplanation: z.string().nullable(),
      painHypothesis: z.string().nullable(),
      messagingAngle: z.string().nullable(),
      signals: z.array(z.object({ key: z.string(), label: z.string(), status: z.string(), confidence: z.number(), evidence: z.array(z.object({ title: z.string(), url: z.string() })) })),
      contactProvenance: z.record(z.string(), z.object({ source: z.string(), verified: z.boolean(), at: z.string() })).nullable(),
      rejectedContacts: z.array(z.object({ name: z.string(), reason: z.string(), at: z.string(), by: z.string() })),
      openTasks: z.array(TaskOut),
      recentEvents: z.array(z.object({ at: z.string(), type: z.string(), source: z.string() })),
      alerts: z.array(z.object({ at: z.string(), triggeredBy: z.string(), talkTrack: z.string() })),
    }),
    errors: [{ code: "not_found", when: "no such account" }],
    retry: "Safe to retry (read-only).",
    async run({ store }, i) {
      const a = await resolveAccount(store, i);
      const [events, alerts, tasks] = await Promise.all([store.listEvents({ accountId: a.id, limit: 20 }), store.listAlerts({ accountId: a.id, limit: 5 }), store.listOutreach({ accountId: a.id, status: OPEN_STATUSES })]);
      return {
        account: summarize(a),
        scoreExplanation: a.scoreExplanation ?? null,
        painHypothesis: a.painHypothesis,
        messagingAngle: a.messagingAngle,
        signals: a.signals.map((s) => ({ key: s.key, label: s.label, status: s.status, confidence: s.confidence, evidence: s.evidence.map((e) => ({ title: e.title, url: e.url })) })),
        contactProvenance: (a.contact?.fieldSources as Record<string, { source: string; verified: boolean; at: string }> | undefined) ?? null,
        rejectedContacts: (a.rejectedContacts ?? []).map((r) => ({ name: r.name, reason: r.reason, at: r.at, by: r.by })),
        openTasks: tasks.map(taskOut),
        recentEvents: events.map((e) => ({ at: e.createdAt, type: e.eventType, source: String(e.properties?._source ?? "internal") })),
        alerts: alerts.map((al) => ({ at: al.createdAt, triggeredBy: al.payload.triggeredBy, talkTrack: al.payload.talkTrack })),
      };
    },
  }),
  op({
    name: "list_tasks",
    title: "List tasks",
    description: "Tasks (open by default) across accounts or for one account or rep, earliest due first.",
    scope: "read",
    mutates: false,
    destructive: false,
    openWorld: false,
    input: z.object({ accountId: z.string().max(64).optional(), assigneeRepId: z.string().max(64).optional(), status: z.array(z.string()).max(8).optional().describe("Defaults to open statuses"), limit: z.number().int().min(1).max(100).default(25), cursor: Cursor }),
    output: z.object({ items: z.array(TaskOut), nextCursor: z.string().nullable() }),
    errors: [{ code: "invalid_input", when: "bad cursor" }],
    pagination: { cursor: "nextCursor", maxLimit: 100 },
    retry: "Safe to retry (read-only).",
    async run({ store }, i) {
      const rows = (await store.listOutreach({ accountId: i.accountId, status: (i.status as Task["status"][] | undefined) ?? OPEN_STATUSES }))
        .filter((t) => !i.assigneeRepId || t.assigneeRepId === i.assigneeRepId)
        .sort((x, y) => x.scheduledFor.localeCompare(y.scheduledFor) || x.id.localeCompare(y.id))
        .map(taskOut);
      return page(rows, i.cursor, i.limit);
    },
  }),
  op({
    name: "act_on_task",
    title: "Act on a task",
    description: "approve (schedules; never sends), complete_manual (record it was done outside the platform) or skip.",
    scope: "tasks:write",
    mutates: true,
    destructive: false,
    openWorld: false,
    input: z.object({ taskId: z.string().min(1).max(64), action: z.enum(["approve", "complete_manual", "skip"]), note: z.string().max(500).optional(), idempotencyKey: IdempotencyKey }),
    output: z.object({ task: TaskOut }),
    errors: [
      { code: "not_found", when: "no such task" },
      { code: "conflict", when: "the task is not in a state that allows the action" },
      { code: "in_progress", when: "the same key is still running" },
    ],
    retry: "Retry with the same idempotencyKey; the action runs at most once.",
    async run(ctx, i) {
      return once(ctx, "act_on_task", i.idempotencyKey, async () => {
        try {
          const t = i.action === "approve" ? await approveTask(ctx.store, ctx.providers, i.taskId, ctx.user) : i.action === "complete_manual" ? await completeManually(ctx.store, i.taskId, ctx.user, i.note) : await skipTask(ctx.store, i.taskId, ctx.user, i.note);
          return { task: taskOut(t) };
        } catch (err) {
          if (err instanceof TaskError) throw new ContractError(err.status === 404 ? "not_found" : "conflict", err.message);
          throw err;
        }
      });
    },
  }),
  op({
    name: "record_provider_event",
    title: "Record a provider event",
    description: "Report an authenticated engagement event (email open/click/reply, LinkedIn accept/reply, identified visitor). Can activate a rep. Page events are not accepted here.",
    scope: "engagement:write",
    mutates: true,
    destructive: false,
    openWorld: true,
    input: z.object({ ...AccountRef, eventId: z.string().min(4).max(200).describe("Sender's delivery id; also the idempotency key"), event: z.enum(["email_open", "email_click", "email_reply", "email_bounced", "linkedin_accept", "linkedin_reply", "visitor_identified", "meeting_canceled"]), properties: z.record(z.string(), z.unknown()).default({}), personRef: z.string().max(300).optional() }),
    output: z.object({ accountId: z.string(), engagementScore: z.number(), activationTriggered: z.boolean() }),
    errors: [{ code: "not_found", when: "no such account" }],
    retry: "Retry with the same eventId; the event is recorded once.",
    async run(ctx, i) {
      if (PAGE_EVENTS.has(i.event)) throw new ContractError("invalid_input", "page events are not accepted here");
      return once(ctx, "record_provider_event", i.eventId, async () => {
        const a = await resolveAccount(ctx.store, i);
        const { _source: _ignored, ...properties } = i.properties;
        const r = await recordEngagement(ctx.store, ctx.providers, a, { eventType: i.event, properties: { ...properties, eventId: i.eventId, personRef: i.personRef, reportedBy: ctx.actor.id }, visitorId: i.personRef ?? null, source: "provider" });
        if (r.activationTriggered) void runAgent("jerry");
        return { accountId: a.id, engagementScore: r.account.engagementScore, activationTriggered: r.activationTriggered };
      });
    },
  }),
  op({
    name: "log_outcome",
    title: "Log an outcome",
    description: "Record replied, meeting_booked, opportunity_created, deal_won, deal_lost, no_response or disqualified. Opportunity events share opportunityId (created then won is one opportunity). CRM write-back is durable.",
    scope: "outcomes:write",
    mutates: true,
    destructive: false,
    openWorld: true,
    input: z.object({ ...AccountRef, outcomeType: z.enum(["replied", "meeting_booked", "opportunity_created", "deal_won", "deal_lost", "no_response", "disqualified"]), value: z.number().nonnegative().optional(), notes: z.string().max(2000).optional(), opportunityId: z.string().min(1).max(120).optional().describe("CRM opportunity id; defaults to opp_<accountId>"), idempotencyKey: IdempotencyKey }),
    output: z.object({ outcomeId: z.string(), accountId: z.string(), opportunityId: z.string().nullable(), status: z.string(), fedBackToHistory: z.boolean() }),
    errors: [
      { code: "not_found", when: "no such account" },
      { code: "in_progress", when: "the same key is still running" },
    ],
    retry: "Retry with the same idempotencyKey; the outcome is recorded and synced once.",
    async run(ctx, i) {
      const a = await resolveAccount(ctx.store, i);
      return once(
        ctx,
        "log_outcome",
        i.idempotencyKey,
        async () => {
          const r = await recordOutcome(ctx.store, ctx.providers, a, { outcomeType: i.outcomeType, value: i.value, notes: i.notes, opportunityId: i.opportunityId, source: ctx.actor.id });
          if (r.fedBack) void runAgent("learning", { force: true });
          return { outcomeId: r.outcome.id, accountId: a.id, opportunityId: r.outcome.opportunityId ?? null, status: r.account.status, fedBackToHistory: r.fedBack };
        },
        a.id,
      );
    },
  }),
  op({
    name: "log_conversation",
    title: "Log a conversation",
    description: "Record a rep conversation; the engine summarizes it, drafts a follow-up for approval and sets the next action. wrong_contact holds outreach and reopens research.",
    scope: "conversations:write",
    mutates: true,
    destructive: false,
    openWorld: false,
    input: z.object({ ...AccountRef, channel: z.enum(["call", "email", "linkedin", "meeting"]), outcome: z.enum(["connected", "voicemail", "no_answer", "replied", "meeting_booked", "not_interested", "not_now", "wrong_contact"]), notes: z.string().max(5000).default(""), pauseDays: z.number().int().min(1).max(365).optional(), callbackAt: z.iso.datetime().optional(), idempotencyKey: IdempotencyKey }),
    output: z.object({ conversationId: z.string(), summary: z.string(), nextAction: z.object({ label: z.string(), dueAt: z.string() }).nullable(), followUpAwaitingApproval: z.boolean() }),
    errors: [{ code: "not_found", when: "no such account" }],
    retry: "Retry with the same idempotencyKey; the conversation is logged once.",
    async run(ctx, i) {
      const a = await resolveAccount(ctx.store, i);
      return once(
        ctx,
        "log_conversation",
        i.idempotencyKey,
        async () => {
          const c = await logConversation(ctx.store, ctx.providers, a, { channel: i.channel, outcome: i.outcome, notes: i.notes, pauseDays: i.pauseDays, callbackAt: i.callbackAt }, ctx.user);
          return { conversationId: c.id, summary: c.summary, nextAction: c.nextAction ? { label: c.nextAction.label, dueAt: c.nextAction.dueAt } : null, followUpAwaitingApproval: Boolean(c.followUpDraft && !c.approved) };
        },
        a.id,
      );
    },
  }),
  op({
    name: "mark_wrong_contact",
    title: "Mark the contact wrong",
    description: "Remove the account's contact and its verification, hold contact-specific outreach, and send the account back to research (the person is never re-selected).",
    scope: "contacts:write",
    mutates: true,
    destructive: true,
    openWorld: false,
    input: z.object({ ...AccountRef, reason: z.string().trim().min(3).max(300), idempotencyKey: IdempotencyKey }),
    output: z.object({ accountId: z.string(), status: z.string(), heldUntilNewContact: z.boolean() }),
    errors: [
      { code: "not_found", when: "no such account" },
      { code: "conflict", when: "the account has no contact" },
    ],
    retry: "Retry with the same idempotencyKey.",
    async run(ctx, i) {
      const a = await resolveAccount(ctx.store, i);
      if (!a.contact) throw new ContractError("conflict", "the account has no contact to reject");
      return once(
        ctx,
        "mark_wrong_contact",
        i.idempotencyKey,
        async () => {
          const u = await markWrongContact(ctx.store, ctx.providers, a.id, ctx.user.name, i.reason);
          return { accountId: a.id, status: u?.status ?? a.status, heldUntilNewContact: Boolean(u?.contactHold) };
        },
        a.id,
      );
    },
  }),
  op({
    name: "get_model_summary",
    title: "Get scoring model summary",
    description: "Current learned model: version, weights vs priors, strongest signal patterns, ICP buckets and playbook summary.",
    scope: "read",
    mutates: false,
    destructive: false,
    openWorld: false,
    input: z.object({}),
    output: z.object({ version: z.number().nullable(), trainedAt: z.string().nullable(), weights: z.record(z.string(), z.number()).nullable(), topPatterns: z.array(z.object({ key: z.string(), lift: z.number(), withWon: z.number(), withN: z.number() })), playbook: z.string().nullable() }),
    errors: [],
    retry: "Safe to retry (read-only).",
    async run({ store }) {
      const m = await store.getLatestModel();
      if (!m) return { version: null, trainedAt: null, weights: null, topPatterns: [], playbook: null };
      return { version: m.version, trainedAt: m.trainedAt, weights: m.weights as unknown as Record<string, number>, topPatterns: m.signalPatterns.filter((p) => p.withN >= 5).slice(0, 10).map((p) => ({ key: p.key, lift: p.lift, withWon: p.withWon, withN: p.withN })), playbook: m.playbook.summary };
    },
  }),
  op({
    name: "run_agent",
    title: "Run an agent",
    description: `Run one agent now (${AGENTS.map((a) => a.id).join(", ")}) or "tick" to run every agent whose cadence has elapsed. Agents may call external providers.`,
    scope: "agents:run",
    mutates: true,
    destructive: false,
    openWorld: true,
    input: z.object({ agentId: z.string().min(1).max(40), idempotencyKey: IdempotencyKey }),
    output: z.object({ runs: z.array(z.object({ agentId: z.string(), status: z.string(), processed: z.number(), summary: z.string() })) }),
    errors: [{ code: "not_found", when: "unknown agent" }],
    retry: "Retry with the same idempotencyKey; agent runs are also guarded by a per-agent lease.",
    async run(ctx, i) {
      return once(ctx, "run_agent", i.idempotencyKey, async () => {
        if (i.agentId === "tick") return { runs: (await tick()).map((r) => ({ agentId: r.agentId, status: r.status, processed: r.processed, summary: r.summary })) };
        const def = AGENTS.find((a) => a.id === i.agentId);
        if (!def) throw new ContractError("not_found", `unknown agent ${i.agentId}`);
        const r = await runAgent(def.id, { force: true });
        return { runs: [{ agentId: r.agentId, status: r.status, processed: r.processed, summary: r.summary }] };
      });
    },
  }),
] as const;

export type OperationName = (typeof OPERATIONS)[number]["name"];
export const OPERATION_BY_NAME = new Map<string, Operation>(OPERATIONS.map((o) => [o.name, o as unknown as Operation]));

/** Validate input, check scope, run, validate output. Shared by HTTP and MCP. */
export async function invoke(name: string, rawInput: unknown, ctx: OperationContext): Promise<unknown> {
  const o = OPERATION_BY_NAME.get(name);
  if (!o) throw new ContractError("not_found", `unknown operation ${name}`);
  if (!ctx.actor.scopes.includes(o.scope)) throw new ContractError("forbidden", `${name} requires the ${o.scope} scope`);
  const parsed = o.input.safeParse(rawInput ?? {});
  if (!parsed.success) throw new ContractError("invalid_input", parsed.error.issues.map((x) => `${x.path.join(".") || "input"}: ${x.message}`).join("; "));
  const out = await o.run(ctx, parsed.data);
  const checked = o.output.safeParse(out);
  if (!checked.success) throw new ContractError("internal", `output failed its contract: ${checked.error.issues.map((x) => x.path.join(".")).join(", ")}`);
  return checked.data;
}
