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

export interface OutreachProvider {
  readonly name: string;
  /** Launch a multi-touch sequence. Returns the touches with provider status / external ids filled in. */
  launchSequence(account: Account, touches: OutreachTouch[]): Promise<OutreachTouch[]>;
  /** Adapt the remaining touches after an engagement signal (e.g. reference the video they watched). */
  adaptSequence(account: Account, reason: string): Promise<{ adapted: boolean; note: string }>;
}

// Dialer ---------------------------------------------------------------------

export interface DialerProvider {
  readonly name: string;
  queueCall(input: { account: Account; contact: Person; context: string }): Promise<{ queued: boolean; externalId?: string; note: string }>;
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
  sendHotLead(alert: HotLeadAlert): Promise<{ delivered: boolean; via: string; note?: string }>;
}

// CRM ------------------------------------------------------------------------

export interface CrmProvider {
  readonly name: string;
  /** Historical prospects with outcomes: the training set for the LEARN step. */
  exportHistorical(): Promise<HistoricalRecord[]>;
  /** Write an outcome back (meeting booked, deal won, ...). */
  logOutcome(account: Account, outcome: Outcome): Promise<void>;
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
