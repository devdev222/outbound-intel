import { createHash } from "node:crypto";
import { jerryMcp } from "@/lib/agents/jerry-mcp";
import { descriptor, effective, type ProviderKind, type Slot } from "@/lib/capabilities";
import { config, hasLlm, isSupabaseConfigured } from "@/lib/config";
import type { Store } from "@/lib/store";
import type { Operation } from "@/lib/types";

/**
 * Integration status for the Integrations page, organised by capability:
 *
 *   Import accounts -> Verify contacts -> Prepare content -> Deliver outreach -> Sync outcomes  (+ Platform)
 *
 * Each connection names the ACTUAL active adapter (provider + transport) and a
 * truthful status:
 *   mock            a mock/test/synthetic adapter is active; nothing real happens
 *   not_configured  a real adapter is selected but required settings are missing
 *   configured      settings are present but nothing has proven they work yet
 *   verified        a connection test passed for THIS provider and THIS configuration,
 *                   or the adapter has succeeded in production since
 *   degraded        the latest real call or test failed after the last success
 * Credentials alone are only ever "configured". A mock adapter can never be
 * "verified". Values are never exposed, only whether a variable is set.
 */

export type Capability = "import" | "verify" | "content" | "deliver" | "sync" | "platform";
export const CAPABILITIES: { key: Capability; label: string; blurb: string }[] = [
  { key: "import", label: "Import accounts", blurb: "Where target accounts and website visitors come from." },
  { key: "verify", label: "Verify contacts", blurb: "Direct phones, LinkedIn and email verification before a rep sees the account." },
  { key: "content", label: "Prepare content", blurb: "Copy, talk tracks and video for each account." },
  { key: "deliver", label: "Deliver outreach", blurb: "Email/sequence delivery, rep alerts and the dialer." },
  { key: "sync", label: "Sync outcomes", blurb: "Meetings, CRM outcomes and analytics flowing back into the model." },
  { key: "platform", label: "Platform", blurb: "Storage shared by the web app and the workers." },
];

export type ConnectionStatus = "mock" | "not_configured" | "configured" | "verified" | "degraded";

export interface IntegrationTestRecord {
  id: string; // connection id
  provider: string;
  fingerprint: string;
  ok: boolean;
  /** True only when a real provider proved it works. A mock "ok" is never verified. */
  verified: boolean;
  message: string;
  at: string;
  by: string;
}

export interface Connection {
  id: string;
  name: string;
  capability: Capability;
  provider: string;
  /** mock | test | builtin | bridge (contract proposed by this repo) | vendor (public vendor API). */
  kind: ProviderKind;
  /** Operations this adapter supports, from the capability registry. */
  actions: string[];
  transport: string;
  status: ConnectionStatus;
  /** One line describing what this adapter is doing right now. */
  mode: string;
  unlocks: string;
  envVars: { name: string; set: boolean; secret: boolean }[];
  steps: string[];
  docsUrl?: string;
  /** null when no test exists. */
  test: { available: boolean; sideEffect: string | null; needsRecipient?: boolean } | null;
  lastSuccessAt: string | null;
  lastError: { at: string; message: string } | null;
  lastTest: IntegrationTestRecord | null;
  nextAction: string;
}

const isSet = (name: string) => Boolean(process.env[name]);
const v = (name: string, secret = false) => ({ name, set: isSet(name), secret });

/** A fingerprint of the settings that matter for a connection, so a test result goes stale when they change. Never reversible. */
export function fingerprint(names: string[], provider: string): string {
  const h = createHash("sha256");
  h.update(provider);
  for (const n of names) h.update(`\0${n}=${process.env[n] ?? ""}`);
  return h.digest("hex").slice(0, 16);
}

interface Spec {
  id: string;
  name: string;
  capability: Capability;
  provider: string;
  transport: string;
  /** mock/synthetic adapter active */
  mock: boolean;
  /** missing settings for the selected real adapter (empty when complete) */
  missing: string[];
  mode: string;
  unlocks: string;
  envVars: { name: string; set: boolean; secret: boolean }[];
  steps: string[];
  docsUrl?: string;
  test: Connection["test"];
  /** Operations whose destination is this connection's adapter (runtime health). */
  ops?: { kinds: Operation["kind"][]; destination: string };
}

const SLOT_FOR: Record<string, Slot> = { enrichment: "enrichment", outreach: "outreach", dialer: "dialer", alerts: "alerts", crm: "crm", video: "video", analytics: "analytics" };
const OTHER_KIND: Record<string, (provider: string) => ProviderKind> = {
  discovery: (p) => (p === "clay" ? "vendor" : "mock"),
  rb2b: (p) => (p === "rb2b" ? "vendor" : "builtin"),
  anthropic: (p) => (p === "anthropic" ? "vendor" : "builtin"),
  jerry: (p) => (p === "jerry-mcp" ? "bridge" : "builtin"),
  calendly: (p) => (p === "calendly" ? "vendor" : "builtin"),
  store: (p) => (p === "supabase" ? "vendor" : p === "memory" ? "mock" : "builtin"),
};

/** Attach kind and supported actions from the capability registry (the single source). */
function withRegistry(s: Spec): Spec & { kind: ProviderKind; actions: string[] } {
  const slot = SLOT_FOR[s.id];
  if (slot) {
    const e = effective(slot);
    const desc = e.id === "jerry-mcp" ? null : descriptor(slot, e.id);
    return { ...s, kind: e.kind, actions: desc?.actions ?? ["enrichContact (enrich_contact tool)"] };
  }
  return { ...s, kind: (OTHER_KIND[s.id] ?? (() => "builtin" as ProviderKind))(s.provider), actions: [] };
}

export function connectionSpecs(): Spec[] {
  const appUrl = config.appUrl;
  const p = config.providers;
  const jerryEnrich = config.jerry.mode === "mcp";
  const enrichProvider = jerryEnrich ? "jerry-mcp" : p.enrichment;
  return [
    {
      id: "discovery",
      name: "Account discovery",
      capability: "import",
      provider: p.discovery === "clay" ? "clay" : "synthetic",
      transport: p.discovery === "clay" ? "Clay table webhook (outbound) + HTTP callback" : "in-process generator",
      mock: p.discovery !== "clay",
      missing: p.discovery === "clay" ? [!config.clay.discoveryWebhookUrl && "CLAY_DISCOVERY_WEBHOOK_URL", !config.clay.inboundSecret && "CLAY_WEBHOOK_SECRET"].filter(Boolean) as string[] : [],
      mode: p.discovery === "clay" ? "Clay tables via webhooks" : "synthetic companies for the demo",
      unlocks: "Structured discovery: companies, job postings, news, technographics, people.",
      envVars: [v("DISCOVERY_PROVIDER"), v("CLAY_DISCOVERY_WEBHOOK_URL", true), v("CLAY_WEBHOOK_TOKEN", true), v("CLAY_WEBHOOK_SECRET", true)],
      steps: [
        "Create a Clay table with a Monitor webhook source; paste its URL into CLAY_DISCOVERY_WEBHOOK_URL.",
        `Add an HTTP API column posting the enriched row to ${appUrl}/api/webhooks/clay with header x-webhook-secret (body mapping in docs/WIRING.md).`,
        "Set DISCOVERY_PROVIDER=clay.",
      ],
      docsUrl: "https://university.clay.com/docs/http-api-integration-overview",
      test: p.discovery === "clay" ? { available: Boolean(config.clay.discoveryWebhookUrl), sideEffect: "adds a row named Integration Test Co to the Clay discovery table" } : null,
    },
    {
      id: "rb2b",
      name: "Website visitor identification",
      capability: "import",
      provider: config.rb2b.webhookSecret ? "rb2b" : "none",
      transport: "inbound webhook",
      mock: false,
      missing: config.rb2b.webhookSecret ? [] : ["RB2B_WEBHOOK_SECRET"],
      mode: config.rb2b.webhookSecret ? "webhook secured by URL token" : "not connected",
      unlocks: "De-anonymized website visitors become engagement on known accounts or newly discovered ones.",
      envVars: [v("RB2B_WEBHOOK_SECRET", true)],
      steps: [`Paste ${appUrl}/api/webhooks/rb2b?token=RB2B_WEBHOOK_SECRET into RB2B's webhook integration and send a test event.`],
      docsUrl: "https://support.rb2b.com/en/articles/8976614-setup-guide-webhook",
      test: null,
    },
    {
      id: "enrichment",
      name: "Contact verification",
      capability: "verify",
      provider: enrichProvider,
      transport: jerryEnrich ? (config.jerry.mcpUrl ? "MCP over HTTP" : "MCP over stdio") : p.enrichment === "clay" ? "Clay table webhook + callback" : p.enrichment === "http" ? "HTTP API" : "in-process",
      mock: !jerryEnrich && (p.enrichment === "mock" || p.enrichment === "test"),
      missing: jerryEnrich
        ? config.jerry.mcpUrl || config.jerry.mcpCommand
          ? []
          : ["JERRY_MCP_URL or JERRY_MCP_COMMAND"]
        : p.enrichment === "clay"
          ? config.clay.enrichmentWebhookUrl
            ? []
            : ["CLAY_ENRICHMENT_WEBHOOK_URL"]
          : p.enrichment === "http"
            ? config.enrichmentHttp.apiUrl
              ? []
              : ["ENRICHMENT_API_URL"]
            : [],
      mode: jerryEnrich ? "Jerry enrich_contact tool" : p.enrichment === "mock" ? "synthetic contacts (never counted as verified in live mode)" : p.enrichment,
      unlocks: "Verified direct phone, LinkedIn match and recent context before an account enters a rep's queue.",
      envVars: [v("ENRICHMENT_PROVIDER"), v("ENRICHMENT_API_URL"), v("ENRICHMENT_API_KEY", true), v("CLAY_ENRICHMENT_WEBHOOK_URL", true), v("JERRY_MODE")],
      steps: ["Use Jerry over MCP (JERRY_MODE=mcp), Clay (ENRICHMENT_PROVIDER=clay) or an in-house service (ENRICHMENT_PROVIDER=http: POST {name,title,email,linkedin,company,domain}).", "Failures are shown on each account as a blocker with the retry time."],
      test: jerryEnrich ? { available: Boolean(config.jerry.mcpUrl || config.jerry.mcpCommand), sideEffect: null } : null,
    },
    {
      id: "anthropic",
      name: "Claude (copy, research, explanations)",
      capability: "content",
      provider: hasLlm() ? "anthropic" : "templates",
      transport: hasLlm() ? "HTTP API" : "in-process",
      mock: !hasLlm(),
      missing: [],
      mode: hasLlm() ? `${config.llm.model}, effort ${config.llm.effort}` : "deterministic templates",
      unlocks: "Claude-written score explanations, research verdicts, campaign copy, video beats and talk tracks.",
      envVars: [v("ANTHROPIC_API_KEY", true), v("LLM_MODEL"), v("LLM_EFFORT"), v("LLM_EXPLAIN_TOP_N")],
      steps: ["Create an API key in the Anthropic Console.", "Set ANTHROPIC_API_KEY in the server environment.", "Optionally cap LLM_EXPLAIN_TOP_N to control spend per scoring run."],
      docsUrl: "https://platform.claude.com/docs",
      test: hasLlm() ? { available: true, sideEffect: null } : null,
    },
    {
      id: "jerry",
      name: "Jerry (talk tracks, rep activation)",
      capability: "content",
      provider: config.jerry.mode === "mcp" ? "jerry-mcp" : hasLlm() ? "jerry-local+claude" : "jerry-local-templates",
      transport: config.jerry.mode === "mcp" ? (config.jerry.mcpUrl ? "MCP over HTTP" : "MCP over stdio") : "in-process",
      mock: config.jerry.mode !== "mcp" && !hasLlm(),
      missing: config.jerry.mode === "mcp" && !config.jerry.mcpUrl && !config.jerry.mcpCommand ? ["JERRY_MCP_URL or JERRY_MCP_COMMAND"] : [],
      mode: config.jerry.mode === "mcp" ? `remote Jerry (${config.jerry.mcpUrl ? "HTTP" : "stdio"})` : `local agent + ${config.jerry.knowledgeDir}`,
      unlocks: "Talk tracks in Cartage's voice, rep alerts and call queueing when engagement spikes.",
      envVars: [v("JERRY_MODE"), v("JERRY_KNOWLEDGE_DIR"), v("JERRY_MCP_URL"), v("JERRY_MCP_COMMAND"), v("JERRY_MCP_ARGS"), v("JERRY_MCP_TOKEN", true)],
      steps: ["Local: replace knowledge/jerry/*.md with Jerry's real training material.", "Remote: expose Jerry over MCP with tools enrich_contact and talk_track; set JERRY_MODE=mcp and JERRY_MCP_URL (or JERRY_MCP_COMMAND + JERRY_MCP_ARGS as a JSON array)."],
      test: config.jerry.mode === "mcp" ? { available: Boolean(config.jerry.mcpUrl || config.jerry.mcpCommand), sideEffect: null } : null,
    },
    {
      id: "video",
      name: "Personalized video",
      capability: "content",
      provider: p.video,
      transport: p.video === "tavus" ? "HTTP API + callback" : "in-process",
      mock: p.video !== "tavus",
      missing: p.video === "tavus" ? ([!config.tavus.apiKey && "TAVUS_API_KEY", !config.tavus.replicaId && "TAVUS_REPLICA_ID"].filter(Boolean) as string[]) : [],
      mode: p.video === "tavus" ? "Phoenix face render" : "scripted caption player",
      unlocks: "15-25s videos rendered from the Video Agent's script, with completion callbacks.",
      envVars: [v("VIDEO_PROVIDER"), v("TAVUS_API_KEY", true), v("TAVUS_REPLICA_ID"), v("TAVUS_WEBHOOK_SECRET", true)],
      steps: ["Train a face once (POST /v2/faces); put its id in TAVUS_REPLICA_ID.", "Set TAVUS_API_KEY and VIDEO_PROVIDER=tavus.", `Callbacks arrive at ${appUrl}/api/webhooks/tavus?token=TAVUS_WEBHOOK_SECRET.`],
      docsUrl: "https://docs.tavus.io/api-reference/video-request/create-video",
      test: p.video === "tavus" ? { available: Boolean(config.tavus.apiKey), sideEffect: null } : null,
    },
    {
      id: "outreach",
      name: "Email and sequence delivery",
      capability: "deliver",
      provider: p.outreach,
      transport: p.outreach === "resend" ? "HTTP API (idempotency keys) + signed webhooks" : p.outreach === "sequencer" ? "HTTP API" : "in-process",
      mock: p.outreach === "mock" || p.outreach === "test",
      missing:
        p.outreach === "resend"
          ? ([!config.resend.apiKey && "RESEND_API_KEY", !config.resend.from && "RESEND_FROM"].filter(Boolean) as string[])
          : p.outreach === "sequencer"
            ? config.sequencer.apiUrl
              ? []
              : ["SEQUENCER_API_URL"]
            : [],
      mode: p.outreach === "resend" ? `sending as ${config.resend.from || "(RESEND_FROM unset)"}; LinkedIn, InMail and gifts are rep tasks` : p.outreach === "sequencer" ? "the Sequencer owns scheduling" : "nothing is sent; tasks complete only when marked sent",
      unlocks: "Real delivery of approved email touches; opens/clicks flow back into engagement scoring.",
      envVars: [v("OUTREACH_PROVIDER"), v("RESEND_API_KEY", true), v("RESEND_FROM"), v("RESEND_REPLY_TO"), v("RESEND_WEBHOOK_SECRET", true), v("RESEND_TEST_TO"), v("SEQUENCER_API_URL"), v("SEQUENCER_API_KEY", true)],
      steps: ["Resend: verify a sending domain, create an API key, set OUTREACH_PROVIDER=resend, RESEND_API_KEY, RESEND_FROM.", `Add a webhook for email.delivered/opened/clicked/bounced at ${appUrl}/api/webhooks/resend and set RESEND_WEBHOOK_SECRET.`, "Sequencer: set OUTREACH_PROVIDER=sequencer and SEQUENCER_API_URL (contract in lib/providers/outreach.ts)."],
      docsUrl: p.outreach === "resend" ? "https://resend.com/docs/api-reference/emails/send-email" : undefined,
      test: p.outreach === "resend" ? { available: Boolean(config.resend.apiKey && config.resend.from), sideEffect: "sends a real test email to the address you enter", needsRecipient: true } : null,
      ops: { kinds: ["send", "sequence_launch", "sequence_pause"], destination: p.outreach },
    },
    {
      id: "alerts",
      name: "Rep alerts",
      capability: "deliver",
      provider: p.alerts,
      transport: p.alerts === "slack" ? (config.slack.webhookUrl ? "Slack incoming webhook" : "Slack Web API") : "in-process",
      mock: p.alerts !== "slack",
      missing: p.alerts === "slack" && !config.slack.webhookUrl && !(config.slack.botToken && config.slack.channel) ? ["SLACK_WEBHOOK_URL or SLACK_BOT_TOKEN + SLACK_CHANNEL"] : [],
      mode: p.alerts === "slack" ? "Hot Lead Alerts posted to Slack" : "printed to the server log",
      unlocks: "Hot Lead Alerts with full context delivered to the rep channel in real time.",
      envVars: [v("ALERT_PROVIDER"), v("SLACK_WEBHOOK_URL", true), v("SLACK_BOT_TOKEN", true), v("SLACK_CHANNEL")],
      steps: ["Create an incoming webhook in Slack (or a bot with chat:write).", "Set ALERT_PROVIDER=slack and SLACK_WEBHOOK_URL."],
      docsUrl: "https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks",
      test: p.alerts === "slack" ? { available: true, sideEffect: "posts a visible test alert in the Slack channel" } : null,
      ops: { kinds: ["alert"], destination: p.alerts },
    },
    {
      id: "dialer",
      name: "Dialer",
      capability: "deliver",
      provider: p.dialer,
      transport: p.dialer === "cartage" ? "HTTP API (idempotency keys)" : "in-process call queue",
      mock: p.dialer !== "cartage",
      missing: p.dialer === "cartage" && !config.dialer.apiUrl ? ["DIALER_API_URL"] : [],
      mode: p.dialer === "cartage" ? "calls queued in the Cartage Dialer" : "local call queue only",
      unlocks: "Calls queued for reps with the talk track attached.",
      envVars: [v("DIALER_PROVIDER"), v("DIALER_API_URL"), v("DIALER_API_KEY", true)],
      steps: ["Implement POST {DIALER_API_URL}/queue (proposed contract) or share the real API.", "Set DIALER_PROVIDER=cartage."],
      test: null,
      ops: { kinds: ["dialer"], destination: p.dialer },
    },
    {
      id: "crm",
      name: "CRM history and outcomes",
      capability: "sync",
      provider: p.crm,
      transport: p.crm === "http" ? "HTTP API" : "in-process",
      mock: p.crm !== "http",
      missing: p.crm === "http" && !config.crm.exportUrl ? ["CRM_EXPORT_URL"] : [],
      mode: p.crm === "http" ? "historical export + outcome write-back" : "synthetic book of business",
      unlocks: "Real historical conversions for the learning loop and outcome write-back.",
      envVars: [v("CRM_PROVIDER"), v("CRM_EXPORT_URL"), v("CRM_API_KEY", true)],
      steps: ["Expose an export endpoint returning historical prospects (signalKeys, persona, outcome, messagingAngle).", "Accept POST {CRM_EXPORT_URL}/outcomes for write-back.", "Set CRM_PROVIDER=http and re-run Learn."],
      test: p.crm === "http" ? { available: Boolean(config.crm.exportUrl), sideEffect: null } : null,
      ops: { kinds: ["crm_sync"], destination: p.crm },
    },
    {
      id: "calendly",
      name: "Meeting booking",
      capability: "sync",
      provider: config.calendly.url ? "calendly" : "request-form",
      transport: config.calendly.url ? "scheduling link + signed webhook" : "built-in request form",
      // Without Calendly nothing external confirms bookings; a rep confirms them by hand.
      mock: !config.calendly.url,
      missing: config.calendly.url && !config.calendly.signingKey ? ["CALENDLY_WEBHOOK_SIGNING_KEY"] : [],
      mode: config.calendly.url ? "bookings confirmed by Calendly webhooks" : "prospects request times; a rep confirms the booking",
      unlocks: "Confirmed bookings (invitee.created) become meeting_booked outcomes; requests stay meeting_requested.",
      envVars: [v("NEXT_PUBLIC_CALENDLY_URL"), v("CALENDLY_WEBHOOK_SIGNING_KEY", true)],
      steps: ["Set NEXT_PUBLIC_CALENDLY_URL to the scheduling link.", `Create a webhook subscription for invitee.created/canceled to ${appUrl}/api/webhooks/calendly with a signing key.`],
      docsUrl: "https://developer.calendly.com/api-docs/calendly-api/webhooks/create-webhook-subscription.md",
      test: null,
    },
    {
      id: "analytics",
      name: "Analytics mirror",
      capability: "sync",
      provider: p.analytics,
      transport: p.analytics === "posthog" ? "HTTP capture API" : "first-party only",
      mock: p.analytics !== "posthog",
      missing: p.analytics === "posthog" && !config.posthog.apiKey ? ["POSTHOG_API_KEY"] : [],
      mode: p.analytics === "posthog" ? config.posthog.host : "first-party events only",
      unlocks: "Funnels and replay on the same events that drive scoring.",
      envVars: [v("ANALYTICS_PROVIDER"), v("POSTHOG_API_KEY", true), v("POSTHOG_HOST")],
      steps: ["Set ANALYTICS_PROVIDER=posthog and POSTHOG_API_KEY (project token)."],
      docsUrl: "https://posthog.com/docs/api/capture",
      test: p.analytics === "posthog" ? { available: Boolean(config.posthog.apiKey), sideEffect: "records an integration_test event in PostHog" } : null,
    },
    {
      id: "store",
      name: "Database",
      capability: "platform",
      provider: config.store,
      transport: config.store === "supabase" ? "Postgres via PostgREST" : config.store === "memory" ? "process memory" : "JSON files",
      mock: config.store !== "supabase",
      missing: config.store === "supabase" && !isSupabaseConfigured() ? ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SECRET_KEY"] : [],
      mode: config.store === "supabase" ? "durable, shared by web and workers" : config.store === "memory" ? "in-memory (ephemeral demo)" : "local JSON files in .data/",
      unlocks: "Durable, shared state for several workers and the web app.",
      envVars: [v("STORE_PROVIDER"), v("NEXT_PUBLIC_SUPABASE_URL"), v("SUPABASE_SECRET_KEY", true)],
      steps: ["Create a project; apply supabase/migrations/0001..0005 in order.", "Set STORE_PROVIDER=supabase, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY (server only)."],
      test: { available: true, sideEffect: null },
    },
  ];
}

const TESTS = "integration_tests";

export async function saveTestResult(store: Store, rec: IntegrationTestRecord): Promise<void> {
  await store.putDoc<IntegrationTestRecord>(TESTS, rec);
}

export function specFor(id: string): Spec | undefined {
  return connectionSpecs().find((s) => s.id === id);
}

export function fingerprintFor(spec: Spec): string {
  return fingerprint(
    spec.envVars.map((e) => e.name),
    spec.provider,
  );
}

function latest<T>(rows: T[], at: (r: T) => string | null | undefined): T | null {
  let best: T | null = null;
  for (const r of rows) if (at(r) && (!best || at(r)! > at(best)!)) best = r;
  return best;
}

export async function getConnections(store: Store): Promise<Connection[]> {
  const [tests, ops, accounts] = await Promise.all([store.listDocs<IntegrationTestRecord>(TESTS), store.listOperations({ limit: 2000 }), store.listAccounts()]);
  const testById = new Map(tests.map((t) => [t.id, t]));
  const mcp = jerryMcp.status();

  const specs = connectionSpecs().map(withRegistry);
  return specs.map((s): Connection => {
    const fp = fingerprintFor(s);
    const rawTest = testById.get(s.id) ?? null;
    // A test only counts for the provider and settings it was run against.
    const lastTest = rawTest && rawTest.provider === s.provider && rawTest.fingerprint === fp ? rawTest : null;

    let lastSuccessAt: string | null = lastTest?.verified ? lastTest.at : null;
    let lastError: Connection["lastError"] = lastTest && !lastTest.ok ? { at: lastTest.at, message: lastTest.message } : null;

    if (s.ops) {
      const mine = ops.filter((o) => s.ops!.kinds.includes(o.kind) && o.destination === s.ops!.destination);
      const ok = latest(
        mine.filter((o) => o.status === "succeeded"),
        (o) => o.updatedAt,
      );
      const bad = latest(
        mine.filter((o) => (o.status === "failed" || o.status === "dead") && o.lastError),
        (o) => o.updatedAt,
      );
      if (ok && (!lastSuccessAt || ok.updatedAt > lastSuccessAt)) lastSuccessAt = ok.updatedAt;
      if (bad && (!lastError || bad.updatedAt > lastError.at)) lastError = { at: bad.updatedAt, message: bad.lastError ?? "failed" };
    }
    if (s.id === "enrichment") {
      const ok = latest(accounts, (a) => (a.enrichment?.provider === s.provider ? a.enrichment?.lastSuccessAt : null));
      const bad = latest(accounts, (a) => (a.enrichment?.provider === s.provider && a.enrichment?.lastError ? a.enrichment.lastAttemptAt : null));
      if (ok?.enrichment?.lastSuccessAt && (!lastSuccessAt || ok.enrichment.lastSuccessAt > lastSuccessAt)) lastSuccessAt = ok.enrichment.lastSuccessAt;
      if (bad?.enrichment?.lastError && bad.enrichment.lastAttemptAt && (!lastError || bad.enrichment.lastAttemptAt > lastError.at)) lastError = { at: bad.enrichment.lastAttemptAt, message: bad.enrichment.lastError };
    }
    if ((s.id === "jerry" || (s.id === "enrichment" && s.provider === "jerry-mcp")) && config.jerry.mode === "mcp") {
      if (mcp.lastSuccessAt && (!lastSuccessAt || mcp.lastSuccessAt > lastSuccessAt)) lastSuccessAt = mcp.lastSuccessAt;
      if (mcp.lastError && !mcp.connected) lastError = { at: lastError?.at ?? new Date().toISOString(), message: `${mcp.lastError}${mcp.nextRetryAt ? ` (reconnect after ${mcp.nextRetryAt.slice(11, 19)} UTC)` : ""}` };
    }

    let status: ConnectionStatus;
    if (s.mock) status = "mock";
    else if (s.missing.length) status = "not_configured";
    else if (lastError && (!lastSuccessAt || lastError.at > lastSuccessAt)) status = "degraded";
    else if (lastSuccessAt) status = "verified";
    else status = "configured";
    if (s.mock) {
      // A mock can never be verified; keep its runtime errors visible but do not claim success.
      lastSuccessAt = null;
    }

    const nextAction =
      status === "mock"
        ? s.id === "store"
          ? "Set STORE_PROVIDER=supabase for durable storage"
          : `Select a real provider to replace ${s.provider}`
        : status === "not_configured"
          ? `Set ${s.missing.join(", ")}`
          : status === "degraded"
            ? `Fix the error, then ${s.test?.available ? "run the test" : "wait for the next retry"}`
            : status === "configured"
              ? s.test?.available
                ? "Run the connection test"
                : "Verified on the first successful real call"
              : "No action needed";

    return {
      id: s.id,
      name: s.name,
      capability: s.capability,
      provider: s.provider,
      transport: s.transport,
      status,
      mode: s.mode,
      unlocks: s.unlocks,
      envVars: s.envVars,
      steps: s.steps,
      docsUrl: s.docsUrl,
      test: s.test,
      lastSuccessAt,
      lastError,
      lastTest,
      nextAction: s.kind === "bridge" && status !== "verified" && status !== "mock" ? `${nextAction}. This is a contract proposed by this app: Cartage must implement or confirm it before it can be called production-ready.` : nextAction,
      kind: s.kind,
      actions: s.actions,
    };
  });
}

