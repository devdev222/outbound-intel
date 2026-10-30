/**
 * Central configuration. Every external system is selected by an environment
 * variable so the engine runs end to end on mock adapters and switches to the
 * real integration without code changes. See .env.example and docs/WIRING.md.
 */

function env(name: string, fallback = ""): string {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
}

function envNumber(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && process.env[name] !== undefined && process.env[name] !== "" ? v : fallback;
}

function pick<T extends string>(name: string, allowed: readonly T[], fallback: T): T {
  const v = env(name, fallback) as T;
  return allowed.includes(v) ? v : fallback;
}

const onVercel = Boolean(process.env.VERCEL);
const vercelUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;

export const config = {
  /** Public base URL. Falls back to Vercel's system URL so a first deploy needs no manual setting. */
  appUrl: env("NEXT_PUBLIC_APP_URL") || (vercelUrl ? `https://${vercelUrl}` : "http://localhost:3000"),
  brandName: env("NEXT_PUBLIC_BRAND_NAME", "Cartage"),
  demoBanner: env("NEXT_PUBLIC_DEMO_BANNER", "true") !== "false",

  /** file (JSON on disk) | memory (ephemeral, for serverless demos) | supabase (production). */
  store: pick("STORE_PROVIDER", ["file", "memory", "supabase"] as const, onVercel ? "memory" : "file"),
  dataDir: env("DATA_DIR", onVercel ? "/tmp/outbound-intel" : ".data"),
  /** Seed the synthetic dataset on boot when the store is empty (default on for ephemeral hosts). */
  autoSeed: env("AUTO_SEED", onVercel ? "true" : "false") === "true",
  autoSeedCount: envNumber("AUTO_SEED_COUNT", 60),

  supabase: {
    url: env("NEXT_PUBLIC_SUPABASE_URL") || env("SUPABASE_URL"),
    /** Server-side only. Service role (legacy) or secret key (sb_secret_...). Never exposed to the browser. */
    secretKey: env("SUPABASE_SECRET_KEY") || env("SUPABASE_SERVICE_ROLE_KEY"),
  },

  llm: {
    apiKey: env("ANTHROPIC_API_KEY"),
    model: env("LLM_MODEL", "claude-opus-5-5"),
    effort: pick("LLM_EFFORT", ["low", "medium", "high"] as const, "medium"),
    /** Only the top N accounts by deterministic score get LLM-written explanations; the rest use templates. */
    explainTopN: envNumber("LLM_EXPLAIN_TOP_N", 25),
  },

  providers: {
    discovery: pick("DISCOVERY_PROVIDER", ["mock", "clay"] as const, "mock"),
    /** Data source Jerry uses as a tool to verify phones / match LinkedIn. Jerry itself is an agent, not a provider. */
    enrichment: pick("ENRICHMENT_PROVIDER", ["mock", "clay", "http"] as const, "mock"),
    video: pick("VIDEO_PROVIDER", ["mock", "tavus"] as const, "mock"),
    outreach: pick("OUTREACH_PROVIDER", ["mock", "sequencer"] as const, "mock"),
    dialer: pick("DIALER_PROVIDER", ["mock", "cartage"] as const, "mock"),
    analytics: pick("ANALYTICS_PROVIDER", ["none", "posthog"] as const, "none"),
    alerts: pick("ALERT_PROVIDER", ["console", "slack"] as const, "console"),
    crm: pick("CRM_PROVIDER", ["mock", "http"] as const, "mock"),
  },

  /**
   * Per-signal-type source routing. Clay is the default collector today; flip a
   * signal type to "native" (our own Claude + web search collector) when the
   * in-house collector for that type is good enough. This is the Clay
   * replacement path: one signal type at a time, measured against Clay.
   */
  signalSources: {
    hiring: pick("SIGNAL_SOURCE_HIRING", ["discovery", "clay", "native"] as const, "discovery"),
    expansion: pick("SIGNAL_SOURCE_EXPANSION", ["discovery", "clay", "native"] as const, "discovery"),
    technology: pick("SIGNAL_SOURCE_TECHNOLOGY", ["discovery", "clay", "native"] as const, "discovery"),
    pain: pick("SIGNAL_SOURCE_PAIN", ["discovery", "clay", "native"] as const, "discovery"),
  },

  clay: {
    /** Clay table "Monitor webhook" source URL. We POST company rows here so Clay enriches them. */
    discoveryWebhookUrl: env("CLAY_DISCOVERY_WEBHOOK_URL") || env("CLAY_WEBHOOK_URL"),
    /** Clay table webhook URL for contact enrichment requests (phone / LinkedIn / email). */
    enrichmentWebhookUrl: env("CLAY_ENRICHMENT_WEBHOOK_URL"),
    /** Optional auth token Clay shows once when you create the webhook source; sent as a header. */
    outboundToken: env("CLAY_WEBHOOK_TOKEN"),
    /** Shared secret we expect in the x-webhook-secret header when Clay's HTTP API column calls us back. */
    inboundSecret: env("CLAY_WEBHOOK_SECRET"),
  },
  /**
   * Jerry is Cartage's trained sales-intelligence agent. Two ways to run it:
   *  - "local": our Jerry agent (lib/agents/jerry.ts) with the knowledge base in knowledge/jerry/*.md.
   *    Replace those files with the real training material / client notes.
   *  - "mcp": connect to the real Jerry over MCP (stdio command or streamable HTTP URL) and
   *    delegate enrichment, context and talk tracks to it.
   */
  jerry: {
    mode: pick("JERRY_MODE", ["local", "mcp"] as const, "local"),
    knowledgeDir: env("JERRY_KNOWLEDGE_DIR", "knowledge/jerry"),
    mcpUrl: env("JERRY_MCP_URL"),
    mcpCommand: env("JERRY_MCP_COMMAND"),
    mcpToken: env("JERRY_MCP_TOKEN"),
  },
  enrichmentHttp: { apiUrl: env("ENRICHMENT_API_URL"), apiKey: env("ENRICHMENT_API_KEY") },
  clayEnrichment: { apiKey: env("CLAY_API_KEY") },

  agents: {
    /** Seconds between runtime ticks when running `npm run worker`. */
    tickSeconds: envNumber("AGENT_TICK_SECONDS", 20),
    /** Max accounts an agent processes per run. */
    batchSize: envNumber("AGENT_BATCH_SIZE", 25),
    /** Max concurrent LLM calls inside one agent run. */
    llmConcurrency: envNumber("AGENT_LLM_CONCURRENCY", 3),
  },
  tavus: {
    apiKey: env("TAVUS_API_KEY"),
    replicaId: env("TAVUS_REPLICA_ID"),
    webhookSecret: env("TAVUS_WEBHOOK_SECRET"),
  },
  sequencer: { apiUrl: env("SEQUENCER_API_URL"), apiKey: env("SEQUENCER_API_KEY") },
  dialer: { apiUrl: env("DIALER_API_URL"), apiKey: env("DIALER_API_KEY") },
  posthog: {
    apiKey: env("POSTHOG_API_KEY") || env("NEXT_PUBLIC_POSTHOG_KEY"),
    host: env("POSTHOG_HOST") || env("NEXT_PUBLIC_POSTHOG_HOST", "https://us.i.posthog.com"),
  },
  slack: { webhookUrl: env("SLACK_WEBHOOK_URL"), botToken: env("SLACK_BOT_TOKEN"), channel: env("SLACK_CHANNEL") },
  crm: { exportUrl: env("CRM_EXPORT_URL"), apiKey: env("CRM_API_KEY") },
  rb2b: { webhookSecret: env("RB2B_WEBHOOK_SECRET") },
  calendly: {
    url: env("NEXT_PUBLIC_CALENDLY_URL"),
    signingKey: env("CALENDLY_WEBHOOK_SIGNING_KEY"),
  },

  engine: {
    /** Accounts at or above this total score get a campaign. */
    qualificationThreshold: envNumber("QUALIFICATION_THRESHOLD", 70),
    /** Engagement score at or above this fires a rep alert. */
    hotThreshold: envNumber("HOT_THRESHOLD", 60),
    /** Minimum minutes between alerts for the same account. */
    alertCooldownMinutes: envNumber("ALERT_COOLDOWN_MINUTES", 240),
    /** Re-score all accounts automatically after each learn pass. */
    rescoreAfterLearn: env("RESCORE_AFTER_LEARN", "true") !== "false",
  },
} as const;

export type Config = typeof config;

export function hasLlm(): boolean {
  return Boolean(config.llm.apiKey);
}

export function isSupabaseConfigured(): boolean {
  return Boolean(config.supabase.url && config.supabase.secretKey);
}

/** A compact description of which adapters are active, for the dashboard and logs. */
export function describeProviders(): Record<string, string> {
  return {
    store: config.store === "supabase" && isSupabaseConfigured() ? "supabase" : config.store === "memory" ? "memory (ephemeral)" : "file",
    llm: hasLlm() ? config.llm.model : "templates (no ANTHROPIC_API_KEY)",
    discovery: config.providers.discovery,
    enrichment: config.providers.enrichment,
    video: config.providers.video,
    outreach: config.providers.outreach,
    dialer: config.providers.dialer,
    analytics: config.providers.analytics,
    alerts: config.providers.alerts,
    crm: config.providers.crm,
    jerry: config.jerry.mode === "mcp" ? `mcp (${config.jerry.mcpUrl || config.jerry.mcpCommand})` : "local agent + knowledge/jerry",
  };
}
