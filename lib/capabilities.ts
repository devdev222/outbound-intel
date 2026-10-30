import { config } from "@/lib/config";
import { ConsoleAlertProvider, SlackAlertProvider } from "@/lib/providers/alerts";
import { NoopAnalyticsProvider, PostHogAnalyticsProvider } from "@/lib/providers/analytics";
import { HttpCrmProvider, MockCrmProvider, TestCrmProvider } from "@/lib/providers/crm";
import { ClayEnrichmentProvider, HttpEnrichmentProvider, MockEnrichmentProvider } from "@/lib/providers/enrichment";
import { CartageDialerProvider, CartageSequencerProvider, MockDialerProvider, MockOutreachProvider, ResendOutreachProvider } from "@/lib/providers/outreach";
import { TestAlertProvider, TestDialerProvider, TestEnrichmentProvider, TestOutreachProvider } from "@/lib/providers/testing";
import type { AlertProvider, AnalyticsProvider, CrmProvider, DialerProvider, EnrichmentProvider, OutreachProvider, VideoProvider } from "@/lib/providers/types";
import { MockVideoProvider, TavusVideoProvider } from "@/lib/providers/video";

/**
 * Capability registry: the single description of every provider the engine
 * can use. Provider selection (lib/providers), configuration checks
 * (configProblems), readiness and the Integrations page all read it.
 *
 * kind:
 *   mock     synthetic or no-op; demo only, never verified
 *   test     controllable adapter for automated tests; refused in live mode
 *   builtin  handled inside this app (console alerts, request form, local queue)
 *   bridge   a contract THIS repo proposes for a Cartage-side service (Sequencer,
 *            Dialer, CRM bridge, HTTP enrichment, Jerry's MCP tools). Unverified
 *            until the real service passes a test or a real call succeeds.
 *   vendor   a third-party API implemented from the vendor's public docs
 */

export type ProviderKind = "mock" | "test" | "builtin" | "bridge" | "vendor";
export type Slot = "enrichment" | "outreach" | "dialer" | "alerts" | "crm" | "video" | "analytics";

export interface ProviderDescriptor<T = unknown> {
  id: string;
  label: string;
  kind: ProviderKind;
  transport: string;
  /** Each entry is required; "A|B" means either A or B. */
  requiredEnv: string[];
  actions: string[];
  /** What a successful call changes outside this app. */
  sideEffects: string;
  docs?: string;
  create: () => T;
}

const d = <T>(x: ProviderDescriptor<T>) => x;

export const REGISTRY = {
  enrichment: [
    d<EnrichmentProvider>({ id: "mock", label: "Synthetic contacts", kind: "mock", transport: "in-process", requiredEnv: [], actions: ["enrichContact"], sideEffects: "none; invents data (refused in live mode)", create: () => new MockEnrichmentProvider() }),
    d<EnrichmentProvider>({ id: "test", label: "Test enrichment", kind: "test", transport: "in-process", requiredEnv: [], actions: ["enrichContact"], sideEffects: "none", create: () => new TestEnrichmentProvider() }),
    d<EnrichmentProvider>({ id: "clay", label: "Clay enrichment table", kind: "vendor", transport: "Clay table webhook (outbound) + HTTP callback", requiredEnv: ["CLAY_ENRICHMENT_WEBHOOK_URL", "CLAY_WEBHOOK_SECRET"], actions: ["enrichContact (async; result arrives on /api/webhooks/clay)"], sideEffects: "adds a row to the Clay table (consumes Clay credits)", docs: "https://university.clay.com/docs/http-api-integration-overview", create: () => new ClayEnrichmentProvider() }),
    d<EnrichmentProvider>({ id: "http", label: "In-house enrichment service", kind: "bridge", transport: "HTTP API (proposed contract)", requiredEnv: ["ENRICHMENT_API_URL"], actions: ["enrichContact"], sideEffects: "depends on the service (may consume paid lookups)", create: () => new HttpEnrichmentProvider() }),
  ],
  outreach: [
    d<OutreachProvider>({ id: "mock", label: "No sending", kind: "mock", transport: "in-process", requiredEnv: [], actions: ["sendTouch (no-op)"], sideEffects: "none", create: () => new MockOutreachProvider() }),
    d<OutreachProvider>({ id: "test", label: "Test outreach", kind: "test", transport: "in-process", requiredEnv: [], actions: ["sendTouch", "launchSequence", "pauseSequence", "resumeSequence"], sideEffects: "none", create: () => new TestOutreachProvider() }),
    d<OutreachProvider>({ id: "resend", label: "Resend", kind: "vendor", transport: "HTTP API (Idempotency-Key) + signed webhooks", requiredEnv: ["RESEND_API_KEY", "RESEND_FROM", "RESEND_WEBHOOK_SECRET"], actions: ["sendTouch (email)"], sideEffects: "sends real email", docs: "https://resend.com/docs/api-reference/emails/send-email", create: () => new ResendOutreachProvider() }),
    d<OutreachProvider>({ id: "sequencer", label: "Cartage Sequencer", kind: "bridge", transport: "HTTP API (proposed contract)", requiredEnv: ["SEQUENCER_API_URL", "SEQUENCER_API_KEY"], actions: ["launchSequence", "adaptSequence", "pauseSequence", "resumeSequence"], sideEffects: "schedules real email/InMail in the Sequencer", create: () => new CartageSequencerProvider() }),
  ],
  dialer: [
    d<DialerProvider>({ id: "mock", label: "Local call queue", kind: "builtin", transport: "in-process", requiredEnv: [], actions: ["queueCall (local list)"], sideEffects: "none outside this app", create: () => new MockDialerProvider() }),
    d<DialerProvider>({ id: "test", label: "Test dialer", kind: "test", transport: "in-process", requiredEnv: [], actions: ["queueCall"], sideEffects: "none", create: () => new TestDialerProvider() }),
    d<DialerProvider>({ id: "cartage", label: "Cartage Dialer", kind: "bridge", transport: "HTTP API (proposed contract)", requiredEnv: ["DIALER_API_URL", "DIALER_API_KEY"], actions: ["queueCall"], sideEffects: "puts a call in a rep's dialer", create: () => new CartageDialerProvider() }),
  ],
  alerts: [
    d<AlertProvider>({ id: "console", label: "Server log", kind: "builtin", transport: "in-process", requiredEnv: [], actions: ["sendHotLead (log line)"], sideEffects: "none", create: () => new ConsoleAlertProvider() }),
    d<AlertProvider>({ id: "test", label: "Test alerts", kind: "test", transport: "in-process", requiredEnv: [], actions: ["sendHotLead"], sideEffects: "none", create: () => new TestAlertProvider() }),
    d<AlertProvider>({ id: "slack", label: "Slack", kind: "vendor", transport: "Incoming webhook or Web API chat.postMessage", requiredEnv: ["SLACK_WEBHOOK_URL|SLACK_BOT_TOKEN"], actions: ["sendHotLead"], sideEffects: "posts a visible message in Slack", docs: "https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks", create: () => new SlackAlertProvider() }),
  ],
  crm: [
    d<CrmProvider>({ id: "mock", label: "Synthetic history", kind: "mock", transport: "in-process", requiredEnv: [], actions: ["exportHistorical", "logOutcome (no-op)"], sideEffects: "none", create: () => new MockCrmProvider() }),
    d<CrmProvider>({ id: "test", label: "Test CRM", kind: "test", transport: "in-process", requiredEnv: [], actions: ["exportHistorical", "logOutcome"], sideEffects: "none", create: () => new TestCrmProvider() }),
    d<CrmProvider>({ id: "http", label: "CRM bridge", kind: "bridge", transport: "HTTP API (proposed contract in front of HubSpot/Salesforce)", requiredEnv: ["CRM_EXPORT_URL", "CRM_API_KEY"], actions: ["exportHistorical", "logOutcome (Idempotency-Key, outcome_id, opportunity_id)"], sideEffects: "writes outcome records to the CRM", create: () => new HttpCrmProvider() }),
  ],
  video: [
    d<VideoProvider>({ id: "mock", label: "Scripted caption player", kind: "mock", transport: "in-process", requiredEnv: [], actions: ["render (placeholder)"], sideEffects: "none", create: () => new MockVideoProvider() }),
    d<VideoProvider>({ id: "tavus", label: "Tavus", kind: "vendor", transport: "HTTP API + callback", requiredEnv: ["TAVUS_API_KEY", "TAVUS_REPLICA_ID", "TAVUS_WEBHOOK_SECRET"], actions: ["render", "status"], sideEffects: "renders a video (billed per render)", docs: "https://docs.tavus.io/api-reference/video-request/create-video", create: () => new TavusVideoProvider() }),
  ],
  analytics: [
    d<AnalyticsProvider>({ id: "none", label: "First-party events only", kind: "builtin", transport: "in-process", requiredEnv: [], actions: ["capture (no-op)"], sideEffects: "none", create: () => new NoopAnalyticsProvider() }),
    d<AnalyticsProvider>({ id: "posthog", label: "PostHog", kind: "vendor", transport: "HTTP capture API", requiredEnv: ["POSTHOG_API_KEY"], actions: ["capture"], sideEffects: "records analytics events", docs: "https://posthog.com/docs/api/capture", create: () => new PostHogAnalyticsProvider() }),
  ],
} satisfies Record<Slot, ProviderDescriptor[]>;

export function selectedId(slot: Slot): string {
  return (config.providers as Record<string, string>)[slot];
}

export function descriptor(slot: Slot, id = selectedId(slot)): ProviderDescriptor {
  const list = REGISTRY[slot] as ProviderDescriptor[];
  return list.find((p) => p.id === id) ?? list[0];
}

export function create<S extends Slot>(slot: S): ReturnType<(typeof REGISTRY)[S][number]["create"]> {
  return descriptor(slot).create() as ReturnType<(typeof REGISTRY)[S][number]["create"]>;
}

const isSet = (name: string) => name.split("|").some((n) => Boolean(process.env[n]));

export function missingEnv(desc: ProviderDescriptor): string[] {
  return desc.requiredEnv.filter((n) => !isSet(n)).map((n) => n.replace("|", " or "));
}

/**
 * The adapter that actually does the work for a capability. Contact
 * verification is done by Jerry over MCP when JERRY_MODE=mcp, regardless of
 * ENRICHMENT_PROVIDER, so readiness must evaluate that, not the env default.
 */
export function effective(slot: Slot): { id: string; label: string; kind: ProviderKind; missing: string[] } {
  if (slot === "enrichment" && config.jerry.mode === "mcp") {
    const missing = config.jerry.mcpUrl || config.jerry.mcpCommand ? [] : ["JERRY_MCP_URL or JERRY_MCP_COMMAND"];
    return { id: "jerry-mcp", label: "Jerry over MCP (enrich_contact)", kind: "bridge", missing };
  }
  const desc = descriptor(slot);
  return { id: desc.id, label: desc.label, kind: desc.kind, missing: missingEnv(desc) };
}
