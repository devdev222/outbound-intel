import { config, hasLlm, isSupabaseConfigured } from "@/lib/config";

/**
 * Integration registry for the Integrations page: what each connection is,
 * whether it is configured, which environment variables drive it, the
 * vendor-side steps, and whether it can be tested from the dashboard.
 * Values are never exposed, only whether a variable is set.
 */
export interface IntegrationStatus {
  id: string;
  name: string;
  category: "Intelligence" | "Data" | "Content" | "Outreach" | "Activation" | "Analytics" | "Storage";
  status: "connected" | "mock" | "not_configured" | "manual";
  mode: string;
  unlocks: string;
  envVars: { name: string; set: boolean; secret: boolean }[];
  steps: string[];
  docsUrl?: string;
  testable: boolean;
}

const isSet = (name: string) => Boolean(process.env[name]);
const v = (name: string, secret = false) => ({ name, set: isSet(name), secret });

export function getIntegrations(): IntegrationStatus[] {
  const appUrl = config.appUrl;
  return [
    {
      id: "anthropic",
      name: "Claude (Anthropic)",
      category: "Intelligence",
      status: hasLlm() ? "connected" : "not_configured",
      mode: hasLlm() ? `${config.llm.model}, effort ${config.llm.effort}` : "templates (deterministic text)",
      unlocks: "Claude-written score explanations, research verdicts, playbook, campaign copy, video beats and Jerry's talk tracks.",
      envVars: [v("ANTHROPIC_API_KEY", true), v("LLM_MODEL"), v("LLM_EFFORT"), v("LLM_EXPLAIN_TOP_N")],
      steps: ["Create an API key in the Anthropic Console.", "Set ANTHROPIC_API_KEY in the server environment.", "Optionally cap LLM_EXPLAIN_TOP_N to control spend per scoring run."],
      docsUrl: "https://platform.claude.com/docs",
      testable: true,
    },
    {
      id: "jerry",
      name: "Jerry (sales-intelligence agent)",
      category: "Intelligence",
      status: config.jerry.mode === "mcp" ? (config.jerry.mcpUrl || config.jerry.mcpCommand ? "connected" : "not_configured") : hasLlm() ? "connected" : "mock",
      mode: config.jerry.mode === "mcp" ? `remote over MCP (${config.jerry.mcpUrl || config.jerry.mcpCommand || "unset"})` : `local agent + ${config.jerry.knowledgeDir}`,
      unlocks: "Real-time enrichment, talk tracks in Cartage's voice, rep alerts and call queueing when engagement spikes.",
      envVars: [v("JERRY_MODE"), v("JERRY_KNOWLEDGE_DIR"), v("JERRY_MCP_URL"), v("JERRY_MCP_COMMAND"), v("JERRY_MCP_TOKEN", true)],
      steps: ["Local: replace knowledge/jerry/*.md with Jerry's real training material.", "Remote: expose Jerry over MCP with tools enrich_contact and talk_track, set JERRY_MODE=mcp and JERRY_MCP_URL."],
      testable: false,
    },
    {
      id: "clay",
      name: "Clay",
      category: "Data",
      status: config.providers.discovery === "clay" ? (config.clay.discoveryWebhookUrl ? "connected" : "not_configured") : "mock",
      mode: config.providers.discovery === "clay" ? "Clay tables via webhooks" : "synthetic discovery",
      unlocks: "Structured discovery and enrichment: companies, job postings, news, technographics, people, phone/LinkedIn waterfalls.",
      envVars: [v("DISCOVERY_PROVIDER"), v("CLAY_DISCOVERY_WEBHOOK_URL", true), v("CLAY_ENRICHMENT_WEBHOOK_URL", true), v("CLAY_WEBHOOK_TOKEN", true), v("CLAY_WEBHOOK_SECRET", true)],
      steps: [
        "Create a Clay table with a Monitor webhook source; paste its URL into CLAY_DISCOVERY_WEBHOOK_URL.",
        `Add an HTTP API column posting the enriched row to ${appUrl}/api/webhooks/clay with header x-webhook-secret (body mapping in docs/WIRING.md).`,
        "Repeat for a contact-enrichment table (CLAY_ENRICHMENT_WEBHOOK_URL).",
        "Set DISCOVERY_PROVIDER=clay and ENRICHMENT_PROVIDER=clay.",
      ],
      docsUrl: "https://university.clay.com/docs/http-api-integration-overview",
      testable: Boolean(config.clay.discoveryWebhookUrl),
    },
    {
      id: "native_collectors",
      name: "Native collectors (Claude + web search)",
      category: "Data",
      status: Object.values(config.signalSources).some((s) => s === "native") ? (hasLlm() ? "connected" : "not_configured") : "manual",
      mode: `hiring=${config.signalSources.hiring}, expansion=${config.signalSources.expansion}, technology=${config.signalSources.technology}, pain=${config.signalSources.pain}`,
      unlocks: "Replacing Clay one signal type at a time with in-house collection.",
      envVars: [v("SIGNAL_SOURCE_HIRING"), v("SIGNAL_SOURCE_EXPANSION"), v("SIGNAL_SOURCE_TECHNOLOGY"), v("SIGNAL_SOURCE_PAIN")],
      steps: ["Requires ANTHROPIC_API_KEY.", "Set SIGNAL_SOURCE_<TYPE>=native for one type, compare precision against Clay, then flip the next."],
      testable: false,
    },
    {
      id: "enrichment",
      name: "Contact enrichment source",
      category: "Data",
      status: config.providers.enrichment === "mock" ? "mock" : config.providers.enrichment === "clay" ? (config.clay.enrichmentWebhookUrl ? "connected" : "not_configured") : config.enrichmentHttp.apiUrl ? "connected" : "not_configured",
      mode: config.providers.enrichment,
      unlocks: "Verified direct phone, LinkedIn match and recent context when Jerry activates a rep.",
      envVars: [v("ENRICHMENT_PROVIDER"), v("ENRICHMENT_API_URL"), v("ENRICHMENT_API_KEY", true)],
      steps: ["Use clay (webhook table) or http (in-house service: POST {name,title,email,linkedin,company,domain})."],
      testable: false,
    },
    {
      id: "crm",
      name: "CRM (history + outcomes)",
      category: "Data",
      status: config.providers.crm === "http" ? (config.crm.exportUrl ? "connected" : "not_configured") : "mock",
      mode: config.providers.crm === "http" ? config.crm.exportUrl : "synthetic book of business",
      unlocks: "Real historical conversions for the learning loop and outcome write-back.",
      envVars: [v("CRM_PROVIDER"), v("CRM_EXPORT_URL"), v("CRM_API_KEY", true)],
      steps: ["Expose an export endpoint returning historical prospects (signalKeys, persona, outcome, messagingAngle).", "Accept POST {CRM_EXPORT_URL}/outcomes for write-back.", "Set CRM_PROVIDER=http and re-run Learn."],
      testable: config.providers.crm === "http" && Boolean(config.crm.exportUrl),
    },
    {
      id: "tavus",
      name: "Tavus (AI video)",
      category: "Content",
      status: config.providers.video === "tavus" ? (config.tavus.apiKey && config.tavus.replicaId ? "connected" : "not_configured") : "mock",
      mode: config.providers.video === "tavus" ? "Phoenix face render" : "scripted caption player",
      unlocks: "Hyper-realistic 15-25s videos rendered from the Video Agent's script, with completion callbacks.",
      envVars: [v("VIDEO_PROVIDER"), v("TAVUS_API_KEY", true), v("TAVUS_REPLICA_ID"), v("TAVUS_WEBHOOK_SECRET", true)],
      steps: ["Train a face once (POST /v2/faces, model phoenix-4.5); put its id in TAVUS_REPLICA_ID.", "Set TAVUS_API_KEY and VIDEO_PROVIDER=tavus.", `Callbacks arrive at ${appUrl}/api/webhooks/tavus?token=TAVUS_WEBHOOK_SECRET.`],
      docsUrl: "https://docs.tavus.io/api-reference/video-request/create-video",
      testable: config.providers.video === "tavus" && Boolean(config.tavus.apiKey),
    },
    {
      id: "resend",
      name: "Resend (email sending)",
      category: "Outreach",
      status: config.providers.outreach === "resend" ? (config.resend.apiKey && config.resend.from ? "connected" : "not_configured") : config.providers.outreach === "sequencer" ? "manual" : "mock",
      mode: config.providers.outreach === "resend" ? `sending as ${config.resend.from || "(RESEND_FROM unset)"}` : `outreach provider is ${config.providers.outreach}`,
      unlocks: "Real delivery of the email touches with open/click tracking back into engagement scoring.",
      envVars: [v("OUTREACH_PROVIDER"), v("RESEND_API_KEY", true), v("RESEND_FROM"), v("RESEND_REPLY_TO"), v("RESEND_WEBHOOK_SECRET", true), v("RESEND_TEST_TO")],
      steps: ["Verify a sending domain in Resend; create an API key.", "Set OUTREACH_PROVIDER=resend, RESEND_API_KEY, RESEND_FROM.", `Add a webhook for email.delivered/opened/clicked/bounced pointing at ${appUrl}/api/webhooks/resend and set RESEND_WEBHOOK_SECRET.`],
      docsUrl: "https://resend.com/docs/api-reference/emails/send-email",
      testable: config.providers.outreach === "resend" && Boolean(config.resend.apiKey && config.resend.from),
    },
    {
      id: "sequencer",
      name: "Cartage Sequencer",
      category: "Outreach",
      status: config.providers.outreach === "sequencer" ? (config.sequencer.apiUrl ? "connected" : "not_configured") : "manual",
      mode: config.providers.outreach === "sequencer" ? config.sequencer.apiUrl : "not active (email via mock/Resend; LinkedIn, InMail and gifts as rep tasks)",
      unlocks: "Email + InMail cadences in parallel with AI reply handling; replaces rep tasks for LinkedIn and InMail.",
      envVars: [v("OUTREACH_PROVIDER"), v("SEQUENCER_API_URL"), v("SEQUENCER_API_KEY", true)],
      steps: ["Implement the proposed contract in lib/providers/outreach.ts (or share the real API and the adapter is adjusted).", `Relay email/InMail events to ${appUrl}/api/track.`, "Set OUTREACH_PROVIDER=sequencer."],
      testable: false,
    },
    {
      id: "slack",
      name: "Slack (rep alerts)",
      category: "Activation",
      status: config.providers.alerts === "slack" ? (config.slack.webhookUrl || (config.slack.botToken && config.slack.channel) ? "connected" : "not_configured") : "mock",
      mode: config.providers.alerts === "slack" ? (config.slack.webhookUrl ? "incoming webhook" : "chat.postMessage") : "console",
      unlocks: "Hot Lead Alerts with full context delivered to the rep channel in real time.",
      envVars: [v("ALERT_PROVIDER"), v("SLACK_WEBHOOK_URL", true), v("SLACK_BOT_TOKEN", true), v("SLACK_CHANNEL")],
      steps: ["Create an incoming webhook in Slack (or a bot with chat:write).", "Set ALERT_PROVIDER=slack and SLACK_WEBHOOK_URL."],
      docsUrl: "https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks",
      testable: config.providers.alerts === "slack",
    },
    {
      id: "dialer",
      name: "Cartage Dialer",
      category: "Activation",
      status: config.providers.dialer === "cartage" ? (config.dialer.apiUrl ? "connected" : "not_configured") : "mock",
      mode: config.providers.dialer === "cartage" ? config.dialer.apiUrl : "local call queue",
      unlocks: "Calls queued for reps with the talk track attached; outcomes flow back automatically.",
      envVars: [v("DIALER_PROVIDER"), v("DIALER_API_URL"), v("DIALER_API_KEY", true)],
      steps: ["Implement POST {DIALER_API_URL}/queue (proposed contract) or share the real API.", "Set DIALER_PROVIDER=cartage."],
      testable: false,
    },
    {
      id: "calendly",
      name: "Calendly (booking)",
      category: "Activation",
      status: config.calendly.url ? (config.calendly.signingKey ? "connected" : "manual") : "mock",
      mode: config.calendly.url ? "inline embed on the page" : "built-in request form",
      unlocks: "Real bookings from the page; invitee.created becomes a meeting_booked outcome that retrains the model.",
      envVars: [v("NEXT_PUBLIC_CALENDLY_URL"), v("CALENDLY_WEBHOOK_SIGNING_KEY", true)],
      steps: ["Set NEXT_PUBLIC_CALENDLY_URL to the scheduling link.", `Create a webhook subscription for invitee.created/canceled to ${appUrl}/api/webhooks/calendly with a signing key.`],
      docsUrl: "https://developer.calendly.com/api-docs/calendly-api/webhooks/create-webhook-subscription.md",
      testable: false,
    },
    {
      id: "posthog",
      name: "PostHog (analytics mirror)",
      category: "Analytics",
      status: config.providers.analytics === "posthog" ? (config.posthog.apiKey ? "connected" : "not_configured") : "mock",
      mode: config.providers.analytics === "posthog" ? config.posthog.host : "first-party events only",
      unlocks: "Funnels, retention and session replay on the same events that drive scoring.",
      envVars: [v("ANALYTICS_PROVIDER"), v("POSTHOG_API_KEY", true), v("POSTHOG_HOST")],
      steps: ["Set ANALYTICS_PROVIDER=posthog and POSTHOG_API_KEY (project token).", "Optionally add posthog-js on the page for replay."],
      docsUrl: "https://posthog.com/docs/api/capture",
      testable: config.providers.analytics === "posthog" && Boolean(config.posthog.apiKey),
    },
    {
      id: "rb2b",
      name: "RB2B (visitor identification)",
      category: "Analytics",
      status: config.rb2b.webhookSecret ? "connected" : "manual",
      mode: config.rb2b.webhookSecret ? "webhook secured by URL token" : "webhook open (set a secret before going live)",
      unlocks: "De-anonymized website visitors become engagement on known accounts or new discovered accounts.",
      envVars: [v("RB2B_WEBHOOK_SECRET", true)],
      steps: [`Paste ${appUrl}/api/webhooks/rb2b?token=RB2B_WEBHOOK_SECRET into RB2B's webhook integration and send a test event.`],
      docsUrl: "https://support.rb2b.com/en/articles/8976614-setup-guide-webhook",
      testable: false,
    },
    {
      id: "supabase",
      name: "Supabase (database)",
      category: "Storage",
      status: config.store === "supabase" ? (isSupabaseConfigured() ? "connected" : "not_configured") : config.store === "memory" ? "mock" : "manual",
      mode: config.store === "supabase" ? config.supabase.url : config.store === "memory" ? "in-memory (ephemeral demo)" : "JSON files in .data/",
      unlocks: "Durable, shared state for several workers and the web app; the spec's schema with RLS.",
      envVars: [v("STORE_PROVIDER"), v("NEXT_PUBLIC_SUPABASE_URL"), v("SUPABASE_SECRET_KEY", true)],
      steps: ["Create a project; run supabase/migrations/*.sql.", "Set STORE_PROVIDER=supabase, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY (server only)."],
      testable: true,
    },
  ];
}
