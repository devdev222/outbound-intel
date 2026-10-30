import { z } from "zod";
import { AGENTS } from "@/lib/agents";
import { runAgent, tick } from "@/lib/agents/runtime";
import type { Actor, Scope } from "@/lib/auth/machine";
import { markWrongContact } from "@/lib/engine/contact";
import { addContact, ContactError, contactNextAction, coverageView, loadContact, pauseContactCmd, replaceContactCmd, researchContacts, resumeContactCmd } from "@/lib/engine/contact-commands";
import { ROLE_LABEL } from "@/lib/engine/buying-group";
import { isPhoneVerified } from "@/lib/engine/contact-fields";
import { logConversation } from "@/lib/engine/conversations";
import { PAGE_EVENTS, recordEngagement } from "@/lib/engine/engagement";
import { idempotent } from "@/lib/engine/idempotency";
import { recordOutcome } from "@/lib/engine/outcomes";
import { approveTask, completeManually, createTask, isOpen, OPEN_STATUSES, skipTask, TaskError } from "@/lib/engine/tasks";
import type { Providers } from "@/lib/providers";
import type { Store } from "@/lib/store";
import type { Account, BuyingContact, Task, User } from "@/lib/types";

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
  primaryContactId: z.string().nullable(),
  coverage: z.string().nullable().describe("Buying-group coverage summary"),
});

const TaskOut = z.object({ taskId: z.string(), accountId: z.string(), contactId: z.string().nullable(), channel: z.string(), status: z.string(), title: z.string().nullable(), step: z.number(), dueAt: z.string(), subject: z.string().nullable(), body: z.string(), source: z.string().nullable(), assigneeRepId: z.string().nullable(), lastError: z.string().nullable() });

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
    primaryContactId: a.primaryContactId ?? null,
    coverage: a.buyingGroup?.summary ?? null,
  };
}

const taskOut = (t: Task): z.infer<typeof TaskOut> => ({ taskId: t.id, accountId: t.accountId, contactId: t.contactId ?? null, channel: t.channel, status: t.status, title: t.title ?? null, step: t.step, dueAt: t.scheduledFor, subject: t.subject ?? null, body: t.body, source: t.source ?? null, assigneeRepId: t.assigneeRepId ?? null, lastError: t.lastError ?? null });

const Check = z.object({ ok: z.boolean(), source: z.string(), at: z.string(), detail: z.string() }).nullable();
const ContactOut = z.object({
  contactId: z.string().describe("Stable contact id used by tasks, events, conversations, outcomes and CRM sync"),
  accountId: z.string(),
  name: z.string(),
  title: z.string(),
  email: z.string().nullable(),
  linkedin: z.string().nullable(),
  phoneVerified: z.boolean(),
  role: z.enum(["economic_buyer", "operational_owner", "champion", "supporting"]),
  roleLabel: z.string(),
  roleConfidence: z.number(),
  roleEvidence: z.array(z.string()),
  status: z.enum(["candidate", "selected", "paused", "rejected", "replaced", "opted_out"]),
  ready: z.boolean(),
  blockers: z.array(z.string()),
  selectedReason: z.string().nullable(),
  source: z.string(),
  verification: z.object({ employment: Check, email: Check, phone: Check, fresh: z.boolean(), duplicateOf: z.string().nullable(), suppressed: z.boolean(), checkedAt: z.string().nullable(), attempts: z.number(), lastError: z.string().nullable() }),
  outreach: z.object({ order: z.number().nullable(), startDay: z.number().nullable(), touchesSent: z.number(), lastTouchAt: z.string().nullable(), heldReason: z.string().nullable() }),
  engagement: z.object({ score: z.number(), lastEventAt: z.string().nullable(), replied: z.boolean(), meeting: z.boolean(), optedOut: z.boolean() }),
  replaces: z.string().nullable(),
  replacedBy: z.string().nullable(),
  referredBy: z.string().nullable(),
  nextAction: z.string(),
});

function contactOut(c: BuyingContact, openTasks: Task[] = []): z.infer<typeof ContactOut> {
  const v = c.verification;
  return {
    contactId: c.id,
    accountId: c.accountId,
    name: c.person.name,
    title: c.person.title,
    email: c.person.email ?? null,
    linkedin: c.person.linkedin ?? null,
    phoneVerified: isPhoneVerified(c.person),
    role: c.role,
    roleLabel: ROLE_LABEL[c.role],
    roleConfidence: c.roleConfidence,
    roleEvidence: c.roleEvidence,
    status: c.status,
    ready: c.ready,
    blockers: c.blockers,
    selectedReason: c.selectedReason,
    source: c.source,
    verification: { employment: v.employment, email: v.email, phone: v.phone, fresh: v.fresh, duplicateOf: v.duplicateOf, suppressed: v.suppressed, checkedAt: v.checkedAt, attempts: v.attempts, lastError: v.lastError },
    outreach: { order: c.outreach.order, startDay: c.outreach.startDay, touchesSent: c.outreach.touchesSent, lastTouchAt: c.outreach.lastTouchAt, heldReason: c.outreach.heldReason },
    engagement: c.engagement,
    replaces: c.replaces ?? null,
    replacedBy: c.replacedBy ?? null,
    referredBy: c.referredBy ?? null,
    nextAction: contactNextAction(c, openTasks),
  };
}

const ContactRef = { contactId: z.string().min(1).max(200).describe("Stable buying-group contact id") };

async function contactFor(store: Store, contactId: string, accountId?: string): Promise<BuyingContact> {
  try {
    const { contact } = await loadContact(store, contactId);
    if (accountId && contact.accountId !== accountId) throw new ContractError("invalid_input", `contact ${contactId} is not on account ${accountId}`);
    return contact;
  } catch (err) {
    if (err instanceof ContactError) throw new ContractError(err.status === 404 ? "not_found" : "conflict", err.message);
    throw err;
  }
}

const asContractError = (err: unknown): never => {
  if (err instanceof ContactError) throw new ContractError(err.status === 404 ? "not_found" : err.status === 409 ? "conflict" : "invalid_input", err.message);
  throw err;
};

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
    input: z.object({ accountId: z.string().max(64).optional(), contactId: z.string().max(200).optional().describe("Only this buying-group person's tasks"), assigneeRepId: z.string().max(64).optional(), status: z.array(z.string()).max(8).optional().describe("Defaults to open statuses"), limit: z.number().int().min(1).max(100).default(25), cursor: Cursor }),
    output: z.object({ items: z.array(TaskOut), nextCursor: z.string().nullable() }),
    errors: [{ code: "invalid_input", when: "bad cursor" }],
    pagination: { cursor: "nextCursor", maxLimit: 100 },
    retry: "Safe to retry (read-only).",
    async run({ store }, i) {
      const rows = (await store.listOutreach({ accountId: i.accountId, status: (i.status as Task["status"][] | undefined) ?? OPEN_STATUSES }))
        .filter((t) => (!i.assigneeRepId || t.assigneeRepId === i.assigneeRepId) && (!i.contactId || t.contactId === i.contactId))
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
    input: z.object({ ...AccountRef, eventId: z.string().min(4).max(200).describe("Sender's delivery id; also the idempotency key"), event: z.enum(["email_open", "email_click", "email_reply", "email_bounced", "linkedin_accept", "linkedin_reply", "visitor_identified", "meeting_canceled"]), properties: z.record(z.string(), z.unknown()).default({}), personRef: z.string().max(300).optional().describe("Email or LinkedIn URL of the person; used to attribute the event when contactId is absent"), contactId: z.string().max(200).optional() }),
    output: z.object({ accountId: z.string(), contactId: z.string().nullable().describe("The person the event was attributed to"), engagementScore: z.number(), activationTriggered: z.boolean() }),
    errors: [{ code: "not_found", when: "no such account" }],
    retry: "Retry with the same eventId; the event is recorded once.",
    async run(ctx, i) {
      if (PAGE_EVENTS.has(i.event)) throw new ContractError("invalid_input", "page events are not accepted here");
      return once(ctx, "record_provider_event", i.eventId, async () => {
        const a = await resolveAccount(ctx.store, i);
        const { _source: _ignored, ...properties } = i.properties;
        if (i.contactId) await contactFor(ctx.store, i.contactId, a.id);
        const r = await recordEngagement(ctx.store, ctx.providers, a, { eventType: i.event, properties: { ...properties, eventId: i.eventId, personRef: i.personRef, reportedBy: ctx.actor.id }, visitorId: i.personRef ?? null, source: "provider", contactId: i.contactId ?? null });
        if (r.activationTriggered) void runAgent("jerry");
        return { accountId: a.id, contactId: (r.events[0]?.properties.contactId as string | undefined) ?? null, engagementScore: r.account.engagementScore, activationTriggered: r.activationTriggered };
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
    input: z.object({ ...AccountRef, outcomeType: z.enum(["replied", "meeting_booked", "opportunity_created", "deal_won", "deal_lost", "no_response", "disqualified"]), value: z.number().nonnegative().optional(), notes: z.string().max(2000).optional(), opportunityId: z.string().min(1).max(120).optional().describe("CRM opportunity id; defaults to opp_<accountId>"), contactId: z.string().max(200).optional().describe("The buying-group person; defaults to the primary contact"), idempotencyKey: IdempotencyKey }),
    output: z.object({ outcomeId: z.string(), accountId: z.string(), contactId: z.string().nullable(), opportunityId: z.string().nullable(), status: z.string(), fedBackToHistory: z.boolean() }),
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
          if (i.contactId) await contactFor(ctx.store, i.contactId, a.id);
          const r = await recordOutcome(ctx.store, ctx.providers, a, { outcomeType: i.outcomeType, value: i.value, notes: i.notes, opportunityId: i.opportunityId, source: ctx.actor.id, contactId: i.contactId });
          if (r.fedBack) void runAgent("learning", { force: true });
          return { outcomeId: r.outcome.id, accountId: a.id, contactId: r.outcome.contactId ?? null, opportunityId: r.outcome.opportunityId ?? null, status: r.account.status, fedBackToHistory: r.fedBack };
        },
        a.id,
      );
    },
  }),
  op({
    name: "log_conversation",
    title: "Log a conversation",
    description: "Record a rep conversation with one person (contactId; defaults to the primary contact). The engine summarizes it, drafts a follow-up for approval and sets the next action. In a buying group: replied/connected holds the others, meeting_booked stops the group sequence, opted_out stops only that person, wrong_contact replaces them (history kept), referred adds the referral as a candidate.",
    scope: "conversations:write",
    mutates: true,
    destructive: false,
    openWorld: false,
    input: z.object({ ...AccountRef, channel: z.enum(["call", "email", "linkedin", "meeting"]), outcome: z.enum(["connected", "voicemail", "no_answer", "replied", "meeting_booked", "not_interested", "not_now", "wrong_contact", "referred", "opted_out"]), notes: z.string().max(5000).default(""), pauseDays: z.number().int().min(1).max(365).optional(), callbackAt: z.iso.datetime().optional(), contactId: z.string().max(200).optional(), referral: z.object({ name: z.string().min(1).max(200), title: z.string().min(1).max(200), email: z.email().optional(), linkedin: z.string().max(400).optional() }).optional().describe("Required for outcome referred"), idempotencyKey: IdempotencyKey }),
    output: z.object({ conversationId: z.string(), contactId: z.string().nullable(), summary: z.string(), nextAction: z.object({ label: z.string(), dueAt: z.string() }).nullable(), followUpAwaitingApproval: z.boolean() }),
    errors: [{ code: "not_found", when: "no such account" }],
    retry: "Retry with the same idempotencyKey; the conversation is logged once.",
    async run(ctx, i) {
      const a = await resolveAccount(ctx.store, i);
      return once(
        ctx,
        "log_conversation",
        i.idempotencyKey,
        async () => {
          if (i.outcome === "referred" && !i.referral) throw new ContractError("invalid_input", "referral is required for outcome referred");
          if (i.contactId) await contactFor(ctx.store, i.contactId, a.id);
          const c = await logConversation(ctx.store, ctx.providers, a, { channel: i.channel, outcome: i.outcome, notes: i.notes, pauseDays: i.pauseDays, callbackAt: i.callbackAt, contactId: i.contactId ?? null, referral: i.referral ?? null }, ctx.user);
          return { conversationId: c.id, contactId: c.contactId ?? null, summary: c.summary, nextAction: c.nextAction ? { label: c.nextAction.label, dueAt: c.nextAction.dueAt } : null, followUpAwaitingApproval: Boolean(c.followUpDraft && !c.approved) };
        },
        a.id,
      );
    },
  }),
  op({
    name: "mark_wrong_contact",
    title: "Mark the contact wrong",
    description: "The account's (primary) contact is the wrong person. In a buying group this replaces that person (history kept) like replace_contact; on a single-contact account it removes the contact, holds outreach and reopens research. The person is never re-selected.",
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
          if (a.buyingGroup && a.primaryContactId) {
            const r = await replaceContactCmd(ctx.store, ctx.providers, a.primaryContactId, i.reason, ctx.user.name, await ctx.store.getLatestModel()).catch(asContractError);
            return { accountId: a.id, status: r.account?.status ?? a.status, heldUntilNewContact: false };
          }
          const u = await markWrongContact(ctx.store, ctx.providers, a.id, ctx.user.name, i.reason);
          return { accountId: a.id, status: u?.status ?? a.status, heldUntilNewContact: Boolean(u?.contactHold) };
        },
        a.id,
      );
    },
  }),
  op({
    name: "get_coverage",
    title: "Get buying-group coverage",
    description: "The account's buying group: the plan (roles, size, order and why), who fills each role, gaps with reasons, candidates, replaced/opted-out people (history kept) and one next action.",
    scope: "read",
    mutates: false,
    destructive: false,
    openWorld: false,
    input: z.object(AccountRef),
    output: z.object({
      accountId: z.string(),
      plan: z.object({ targetSize: z.number(), roles: z.array(z.string()), stagger: z.array(z.number()), source: z.enum(["default", "learned"]), segment: z.string(), evidence: z.array(z.string()) }).nullable(),
      summary: z.string().nullable(),
      gaps: z.array(z.object({ role: z.string(), reason: z.string() })),
      group: z.array(ContactOut),
      candidates: z.array(ContactOut),
      history: z.array(ContactOut),
      nextAction: z.string(),
    }),
    errors: [{ code: "not_found", when: "no such account" }],
    retry: "Safe to retry (read-only).",
    async run({ store }, i) {
      const a = await resolveAccount(store, i);
      const v = await coverageView(store, a);
      const out = (x: (typeof v.group)[number]) => contactOut(x.contact, x.openTasks);
      return { accountId: a.id, plan: v.coverage?.plan ?? null, summary: v.coverage?.summary ?? null, gaps: v.coverage?.gaps ?? [], group: v.group.map(out), candidates: v.candidates.map(out), history: v.history.map(out), nextAction: v.nextAction };
    },
  }),
  op({
    name: "list_contacts",
    title: "List contacts",
    description: "Buying-group people for one account or across accounts, filtered by status or role.",
    scope: "read",
    mutates: false,
    destructive: false,
    openWorld: false,
    input: z.object({ ...AccountRef, status: z.array(z.enum(["candidate", "selected", "paused", "rejected", "replaced", "opted_out"])).max(6).optional(), role: z.enum(["economic_buyer", "operational_owner", "champion", "supporting"]).optional(), limit: z.number().int().min(1).max(100).default(50), cursor: Cursor }),
    output: z.object({ items: z.array(ContactOut), nextCursor: z.string().nullable() }),
    errors: [{ code: "not_found", when: "no such account" }],
    pagination: { cursor: "nextCursor", maxLimit: 100 },
    retry: "Safe to retry (read-only).",
    async run({ store }, i) {
      const accountId = i.accountId || i.slug ? (await resolveAccount(store, i)).id : undefined;
      const [rows, tasks] = await Promise.all([store.listContacts({ accountId, status: i.status }), store.listOutreach({ accountId, status: OPEN_STATUSES })]);
      const items = rows.filter((c) => !i.role || c.role === i.role).sort((a, b) => a.accountId.localeCompare(b.accountId) || (a.outreach.order ?? 99) - (b.outreach.order ?? 99) || a.id.localeCompare(b.id));
      return page(items.map((c) => contactOut(c, tasks.filter((t) => t.contactId === c.id && isOpen(t)))), i.cursor, i.limit);
    },
  }),
  op({
    name: "research_contacts",
    title: "Research contacts",
    description: "Run the contact research team on one account now: map new people, verify each one (enrichment provider or Jerry), refill the plan and report gaps.",
    scope: "contacts:write",
    mutates: true,
    destructive: false,
    openWorld: true,
    input: z.object({ ...AccountRef, idempotencyKey: IdempotencyKey }),
    output: z.object({ accountId: z.string(), summary: z.string(), verifiedNow: z.number(), gaps: z.array(z.object({ role: z.string(), reason: z.string() })) }),
    errors: [{ code: "not_found", when: "no such account" }],
    retry: "Retry with the same idempotencyKey; a new key runs research again (verification itself retries with backoff).",
    async run(ctx, i) {
      const a = await resolveAccount(ctx.store, i);
      return once(ctx, "research_contacts", i.idempotencyKey, async () => {
        const r = await researchContacts(ctx.store, ctx.providers, a, await ctx.store.getLatestModel(), ctx.user.name);
        return { accountId: a.id, summary: r.coverage.summary, verifiedNow: r.verified, gaps: r.coverage.gaps };
      }, a.id);
    },
  }),
  op({
    name: "add_contact",
    title: "Add a contact",
    description: "Add a person to an account's buying group (e.g. one the rep knows). They are verified like anyone else; the coverage coordinator decides whether they fill a role.",
    scope: "contacts:write",
    mutates: true,
    destructive: false,
    openWorld: true,
    input: z.object({ ...AccountRef, name: z.string().min(1).max(200), title: z.string().min(1).max(200), email: z.email().optional(), phone: z.string().max(40).optional(), linkedin: z.string().max(400).optional(), idempotencyKey: IdempotencyKey }),
    output: z.object({ contact: ContactOut }),
    errors: [
      { code: "not_found", when: "no such account" },
      { code: "conflict", when: "the person was marked wrong for this account" },
    ],
    retry: "Retry with the same idempotencyKey; the same person is never added twice.",
    async run(ctx, i) {
      const a = await resolveAccount(ctx.store, i);
      return once(ctx, "add_contact", i.idempotencyKey, async () => {
        const c = await addContact(ctx.store, ctx.providers, a, { name: i.name, title: i.title, email: i.email, phone: i.phone, linkedin: i.linkedin }, ctx.user.name, await ctx.store.getLatestModel()).catch(asContractError);
        return { contact: contactOut(c) };
      }, a.id);
    },
  }),
  op({
    name: "replace_contact",
    title: "Replace a contact",
    description: "This person is wrong for the account. They are marked rejected (record, tasks, events and outcomes kept), their open tasks are held, they are never re-selected, and the next verified person takes the role (or the gap is reported).",
    scope: "contacts:write",
    mutates: true,
    destructive: true,
    openWorld: false,
    input: z.object({ ...ContactRef, reason: z.string().trim().min(3).max(300), idempotencyKey: IdempotencyKey }),
    output: z.object({ contactId: z.string(), status: z.string(), replacement: ContactOut.nullable(), coverage: z.string().nullable() }),
    errors: [
      { code: "not_found", when: "no such contact" },
      { code: "conflict", when: "the person is already replaced, rejected or opted out" },
    ],
    retry: "Retry with the same idempotencyKey.",
    async run(ctx, i) {
      const c = await contactFor(ctx.store, i.contactId);
      return once(ctx, "replace_contact", i.idempotencyKey, async () => {
        const r = await replaceContactCmd(ctx.store, ctx.providers, c.id, i.reason, ctx.user.name, await ctx.store.getLatestModel()).catch(asContractError);
        const now = await ctx.store.getContact(c.id);
        return { contactId: c.id, status: now?.status ?? "rejected", replacement: r.replacement ? contactOut(r.replacement) : null, coverage: r.account?.buyingGroup?.summary ?? null };
      }, c.accountId);
    },
  }),
  op({
    name: "set_contact_hold",
    title: "Pause or resume a contact",
    description: "pause holds one person's outreach (the rest of the group continues); resume releases a hold (including the automatic hold after a colleague replied).",
    scope: "contacts:write",
    mutates: true,
    destructive: false,
    openWorld: false,
    input: z.object({ ...ContactRef, action: z.enum(["pause", "resume"]), reason: z.string().max(300).optional(), idempotencyKey: IdempotencyKey }),
    output: z.object({ contact: ContactOut }),
    errors: [
      { code: "not_found", when: "no such contact" },
      { code: "conflict", when: "the person is not in a state that allows it" },
    ],
    retry: "Retry with the same idempotencyKey.",
    async run(ctx, i) {
      const c = await contactFor(ctx.store, i.contactId);
      return once(ctx, "set_contact_hold", i.idempotencyKey, async () => {
        const u = i.action === "pause" ? await pauseContactCmd(ctx.store, c.id, i.reason ?? "rep decision", ctx.user.name).catch(asContractError) : await resumeContactCmd(ctx.store, c.id, ctx.user.name).catch(asContractError);
        return { contact: contactOut(u) };
      }, c.accountId);
    },
  }),
  op({
    name: "create_contact_task",
    title: "Create a task for a contact",
    description: "A rep task for one person in the buying group (call, email, LinkedIn, meeting prep). It is attributed to that person and counts as a commitment (rescoring never replaces it). Use act_on_task to complete or skip it.",
    scope: "tasks:write",
    mutates: true,
    destructive: false,
    openWorld: false,
    input: z.object({ ...ContactRef, channel: z.enum(["call", "email", "linkedin", "meeting"]), title: z.string().min(1).max(200), body: z.string().max(5000).default(""), subject: z.string().max(300).optional(), dueAt: z.iso.datetime().optional(), idempotencyKey: IdempotencyKey }),
    output: z.object({ task: TaskOut }),
    errors: [
      { code: "not_found", when: "no such contact" },
      { code: "conflict", when: "the person opted out, was replaced or rejected" },
    ],
    retry: "Retry with the same idempotencyKey; the task is created once.",
    async run(ctx, i) {
      const c = await contactFor(ctx.store, i.contactId);
      if (["opted_out", "rejected", "replaced"].includes(c.status)) throw new ContractError("conflict", `${c.person.name} is ${c.status.replace("_", " ")}; no new tasks`);
      const a = await resolveAccount(ctx.store, { accountId: c.accountId });
      return once(ctx, "create_contact_task", i.idempotencyKey, async () => {
        const t = await createTask(ctx.store, { account: { ...a, contact: c.person }, channel: i.channel, title: i.title, body: i.body, subject: i.subject, dueAt: i.dueAt, status: "manual", source: "rep", contactId: c.id });
        return { task: taskOut(t) };
      }, a.id);
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
