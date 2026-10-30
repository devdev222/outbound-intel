import type {
  Account,
  CompanyFacts,
  HistoricalRecord,
  HotLeadAlert,
  Outcome,
  OutreachTouch,
  Person,
  SignalType,
  VideoStatus,
} from "@/lib/types";

/**
 * Provider interfaces. Each external system sits behind one of these. The
 * engine and the agents only import the interfaces; lib/providers/index.ts
 * picks the implementation from configuration.
 */

// Discovery ------------------------------------------------------------------

export interface DiscoveryProvider {
  readonly name: string;
  /** Pull up to `limit` new companies worth evaluating. Push-based sources (Clay webhook) return []. */
  discover(limit: number): Promise<CompanyFacts[]>;
  /** Re-collect facts for a known company. May return the input unchanged for async sources. */
  refresh(facts: CompanyFacts): Promise<CompanyFacts>;
  /** Hand a company to the source for structured enrichment (e.g. push a row into a Clay table). */
  submit(facts: CompanyFacts): Promise<{ accepted: boolean; note: string }>;
  /** Optional: forget pagination state (called when the store is reset so demo batches are reproducible). */
  reset?(): void;
}

/** A collector for one signal type. Used by the signal-source router. */
export interface SignalCollector {
  readonly name: string;
  collect(facts: CompanyFacts, type: SignalType): Promise<Partial<CompanyFacts>>;
}

// Enrichment (a data tool Jerry calls) ---------------------------------------

export interface EnrichmentResult {
  contact: Person;
  phoneVerified: boolean;
  linkedinMatched: boolean;
  recentNews: string[];
  techStack: string[];
  notes: string[];
  /** false when the provider works asynchronously and will call back later. */
  complete: boolean;
  provider: string;
  /** "synthetic" for the mock provider; readiness never accepts synthetic contacts in live mode. */
  provenance?: "provider" | "synthetic";
}

export interface EnrichmentProvider {
  readonly name: string;
  enrichContact(person: Person, account: Account): Promise<EnrichmentResult>;
}

// Video ----------------------------------------------------------------------

export interface VideoCreateRequest {
  script: string;
  name: string;
  callbackUrl?: string;
  /** Used by mocks / fast paths; ignored by real providers. */
  accountSlug: string;
}

export interface VideoRecord {
  videoId: string;
  status: VideoStatus;
  hostedUrl?: string;
  streamUrl?: string;
  downloadUrl?: string;
  thumbnailUrl?: string;
  statusDetails?: string;
}

export interface VideoProvider {
  readonly name: string;
  createVideo(req: VideoCreateRequest): Promise<VideoRecord>;
  getVideo(videoId: string): Promise<VideoRecord>;
}

// Outreach -------------------------------------------------------------------

export interface SendResult {
  status: "sent" | "failed";
  externalId?: string;
  note?: string;
  /** For failures: false when retrying cannot help (bad address, suppressed, invalid payload). */
  retryable?: boolean;
}

export interface LaunchResult {
  /** Remote sequence id; persisted on the campaign and used for adapt / pause / resume. */
  sequenceId: string | null;
  touches: OutreachTouch[];
}

export interface OutreachProvider {
  readonly name: string;
  /** Channels this provider can send by itself. Due touches on other channels become rep tasks. */
  readonly channels: OutreachTouch["channel"][];
  /**
   * true when the provider runs the whole cadence itself (Cartage Sequencer):
   * launchSequence hands over all touches and the engine never calls sendTouch.
   * false for simple senders (Resend, mock): the engine's scheduler sends each
   * touch when it is due.
   */
  readonly ownsScheduling: boolean;
  /**
   * Register a sequence. Must throw on failure (the campaign then stays pending/failed,
   * never live). `idempotencyKey` is stable across retries of the same launch.
   */
  launchSequence(account: Account, touches: OutreachTouch[], idempotencyKey: string): Promise<LaunchResult>;
  /** Send one due touch now (only for channels in `channels`). Same key on every retry of this touch. */
  sendTouch(account: Account, touch: OutreachTouch, idempotencyKey: string): Promise<SendResult>;
  /** Adapt the remaining touches after an engagement signal (providers that own scheduling). */
  adaptSequence(account: Account, reason: string): Promise<{ adapted: boolean; note: string }>;
  /** Stop all sends for the account until `until` (providers that own scheduling). */
  pauseSequence?(account: Account, until: string, reason: string, idempotencyKey: string): Promise<void>;
  resumeSequence?(account: Account, idempotencyKey: string): Promise<void>;
}

// Dialer ---------------------------------------------------------------------

export interface DialerProvider {
  readonly name: string;
  queueCall(input: { account: Account; contact: Person; context: string; idempotencyKey: string }): Promise<{ queued: boolean; externalId?: string; note: string }>;
}

// Analytics ------------------------------------------------------------------

export interface AnalyticsEvent {
  event: string;
  distinctId: string;
  properties: Record<string, unknown>;
  timestamp?: string;
}

export interface AnalyticsProvider {
  readonly name: string;
  capture(event: AnalyticsEvent): Promise<void>;
}

// Alerts ---------------------------------------------------------------------

export interface AlertProvider {
  readonly name: string;
  sendHotLead(alert: HotLeadAlert, idempotencyKey?: string): Promise<{ delivered: boolean; via: string; note?: string; remoteId?: string }>;
}

// CRM ------------------------------------------------------------------------

export interface CrmProvider {
  readonly name: string;
  /** Historical prospects with outcomes: the training set for the LEARN step. */
  exportHistorical(): Promise<HistoricalRecord[]>;
  /** Write an outcome back (meeting booked, deal won, ...). */
  /**
   * Write one outcome to the CRM. `idempotencyKey` (crm:<outcome id>) must be
   * honored so retries never duplicate; outcome.id is the stable external id.
   */
  logOutcome(account: Account, outcome: Outcome, idempotencyKey?: string): Promise<{ remoteId?: string | null } | void>;
}

// Bundle ---------------------------------------------------------------------

export interface Providers {
  discovery: DiscoveryProvider;
  collectors: Record<Extract<SignalType, "hiring" | "expansion" | "technology" | "pain">, SignalCollector | null>;
  enrichment: EnrichmentProvider;
  video: VideoProvider;
  outreach: OutreachProvider;
  dialer: DialerProvider;
  analytics: AnalyticsProvider;
  alerts: AlertProvider;
  crm: CrmProvider;
}
