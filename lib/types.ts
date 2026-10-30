/**
 * Domain types for the outbound intelligence engine.
 *
 * Everything the engine stores or passes between layers is defined here so that
 * the store adapters (file / Supabase), the provider adapters (Clay, Tavus, Jerry,
 * Sequencer, Dialer, PostHog, Slack) and the agents all speak the same shapes.
 */

// ---------------------------------------------------------------------------
// Signals and evidence
// ---------------------------------------------------------------------------

export type SignalType =
  | "hiring"
  | "expansion"
  | "technology"
  | "pain"
  | "funding"
  | "leadership"
  | "intent";

export type SignalStatus = "verified" | "hypothesis";

export interface Evidence {
  title: string;
  url: string;
  source: string;
  snippet?: string;
  date?: string;
}

export interface Signal {
  /** Canonical key, e.g. "hiring:transportation_coordinator". Patterns are learned per key. */
  key: string;
  type: SignalType;
  label: string;
  status: SignalStatus;
  /** 0..1 */
  confidence: number;
  detectedAt: string;
  /** Which agent produced this signal. */
  agent: string;
  evidence: Evidence[];
  value?: string | number;
}

// ---------------------------------------------------------------------------
// Discovery output (what Clay / synthetic discovery hands to the agents)
// ---------------------------------------------------------------------------

export type Seniority = "c_level" | "vp" | "director" | "manager" | "ic";

export interface Person {
  name: string;
  title: string;
  seniority: Seniority;
  email?: string;
  linkedin?: string;
  phone?: string;
  phoneVerified?: boolean;
}

export interface JobPosting {
  title: string;
  department: string;
  postedAt: string;
  url: string;
  location?: string;
  description?: string;
}

export interface NewsItem {
  headline: string;
  kind: "facility" | "funding" | "acquisition" | "leadership" | "expansion" | "other";
  publishedAt: string;
  url: string;
  summary?: string;
}

export interface TechStackItem {
  name: string;
  category: "tms" | "erp" | "wms" | "spreadsheet" | "visibility" | "other";
  source: string;
}

export interface PainEvidence {
  text: string;
  theme: string;
  source: string;
  url: string;
  capturedAt: string;
}

export interface CompanyFacts {
  companyName: string;
  domain: string;
  industry: string;
  employeeCount: number;
  hqCity: string;
  hqState: string;
  founded?: number;
  description?: string;
  jobPostings: JobPosting[];
  news: NewsItem[];
  techStack: TechStackItem[];
  painEvidence: PainEvidence[];
  people: Person[];
  estimatedShipmentsPerMonth?: number;
  /** Where the facts came from: "synthetic", "clay", "crm", ... */
  source: string;
  externalId?: string;
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export interface Weights {
  signal: number;
  icp: number;
  pain: number;
  timing: number;
  access: number;
}

export interface ScoreBreakdown {
  icp: number;
  signal: number;
  pain: number;
  timing: number;
  access: number;
  total: number;
}

export type ScoreCategory = keyof Weights;

// ---------------------------------------------------------------------------
// Campaign
// ---------------------------------------------------------------------------

export interface ExperimentArms {
  contentFormat: "landing_page" | "direct_link";
  videoType: "ai" | "rep";
  personalization: "deep" | "conventional";
  angleVariant: "A" | "B";
  gifting: "gift" | "control";
}

/**
 * pending: campaign exists, Video Agent has not run yet
 * script_ready: beats + script written, not yet submitted (AI arm) / brief issued (rep arm)
 * awaiting_recording: rep arm, waiting for a human to record and attach the clip
 * rendering: submitted to the video provider
 * ready / failed: terminal (failed is retried up to 3 times)
 */
export type VideoStatus = "pending" | "script_ready" | "awaiting_recording" | "rendering" | "ready" | "failed";

export interface VideoBeats {
  /** Opens on the top verified signal, says the contact's name. */
  hook: string;
  /** One proof point: case study metric or peer outcome. */
  proof: string;
  /** One ask: the page link and a 15-minute slot. */
  ask: string;
}

export interface RoiDefaults {
  shipmentsPerMonth: number;
  minutesPerShipment: number;
  hourlyCost: number;
  coordinators: number;
}

export interface Campaign {
  headline: string;
  subheadline: string;
  angle: string;
  persona: string;
  videoScript: string;
  videoStatus: VideoStatus;
  videoId?: string;
  videoUrl?: string;
  videoThumbnailUrl?: string;
  /** Structured beats the Video Agent wrote the script from. */
  videoBeats?: VideoBeats;
  /** Rep-arm recording brief (who, what to say, where to upload). */
  videoBrief?: string;
  /** "ai" (provider render) or "rep" (human recording attached). */
  videoSource?: "ai" | "rep";
  /** Bumped every time the Video Agent rewrites the script (e.g. after Research changes a signal). */
  scriptVersion?: number;
  /** Provider submission attempts, for bounded retries. */
  videoAttempts?: number;
  videoStatusDetails?: string;
  roiDefaults: RoiDefaults;
  caseStudyId: string;
  pageUrl: string;
  arms: ExperimentArms;
  launchedAt: string;
}

// ---------------------------------------------------------------------------
// Account
// ---------------------------------------------------------------------------

export type AccountStatus =
  | "discovered"
  | "scored"
  | "qualified"
  | "campaign_live"
  | "engaged"
  | "hot"
  | "meeting_booked"
  | "won"
  | "lost"
  | "disqualified";

export interface Account {
  id: string;
  slug: string;
  companyName: string;
  domain: string;
  industry: string;
  employeeCount: number;
  hqCity: string;
  hqState: string;
  facts: CompanyFacts;
  /** Bumped only when facts change (new Clay row, native collector result), so agents know when to re-run. */
  factsUpdatedAt: string;
  signals: Signal[];
  scores: ScoreBreakdown | null;
  scoreExplanation: string | null;
  verifiedSignals: string[];
  hypotheses: string[];
  missingInfo: string[];
  painHypothesis: string | null;
  messagingAngle: string | null;
  recommendedPersona: string | null;
  brief: string | null;
  contact: Person | null;
  campaign: Campaign | null;
  engagementScore: number;
  /** total score adjusted by engagement, 0..100 */
  priority: number;
  status: AccountStatus;
  modelVersion: number | null;
  lastAlertAt: string | null;
  /** When engagement crosses a threshold the monitor sets this; Jerry clears it when the rep is activated. */
  pendingActivation: string | null;
  /** agentId -> ISO timestamp of the last time that agent processed this account. */
  agentRuns: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Agent team runtime
// ---------------------------------------------------------------------------

export type AgentId =
  | "icp"
  | "hiring"
  | "expansion"
  | "technology"
  | "pain_point"
  | "research"
  | "scoring"
  | "campaign"
  | "video"
  | "jerry"
  | "learning";

/**
 * Per-account audit trail: what the team (and reps) did to an account and why.
 * Every agent writes entries through ctx.activity(); the account page renders
 * them as the "team" lane next to the prospect's engagement lane.
 */
export interface ActivityEntry {
  id: string;
  accountId: string;
  actor: AgentId | "system" | "rep" | "webhook";
  /** Short machine-friendly verb, e.g. "signals_found", "score_updated", "video_submitted". */
  action: string;
  summary: string;
  details?: string[];
  at: string;
}

export interface AgentRun {
  id: string;
  agentId: AgentId;
  startedAt: string;
  finishedAt: string | null;
  status: "running" | "ok" | "error" | "skipped";
  processed: number;
  summary: string;
  details: string[];
  error?: string;
}

export interface AgentState {
  agentId: AgentId;
  enabled: boolean;
  lastRunAt: string | null;
  lastStatus: AgentRun["status"] | null;
  totalRuns: number;
  totalProcessed: number;
}

// ---------------------------------------------------------------------------
// Historical data (what the LEARN step trains on)
// ---------------------------------------------------------------------------

export type HistoricalOutcome = "won" | "lost" | "meeting" | "no_response";

export interface HistoricalRecord {
  id: string;
  companyName: string;
  industry: string;
  employeeCount: number;
  signalKeys: string[];
  persona: string;
  seniority: Seniority;
  messagingAngle?: string;
  outcome: HistoricalOutcome;
  dealValue?: number;
  firstTouchAt: string;
  outcomeAt: string;
  /** "crm_export" for the seed, "loop" for records fed back by the engine. */
  source: "crm_export" | "loop";
}

// ---------------------------------------------------------------------------
// Learned model
// ---------------------------------------------------------------------------

export interface SignalPattern {
  key: string;
  label: string;
  type: SignalType;
  withN: number;
  withWon: number;
  withoutN: number;
  withoutWon: number;
  rateWith: number;
  rateWithout: number;
  /** rateWith / rateWithout, Laplace-smoothed. >1 means the signal predicts conversion. */
  lift: number;
  /** Contribution to the signal score, 0..1, derived from lift and sample size. */
  weight: number;
  /** 0..1 confidence from sample size. */
  confidence: number;
}

export interface IcpBucket {
  name: string;
  n: number;
  winRate: number;
  lift: number;
}

export interface IcpProfile {
  industries: IcpBucket[];
  sizeBands: (IcpBucket & { min: number; max: number })[];
  personas: (IcpBucket & { seniority: Seniority })[];
}

export interface PlaybookAngle {
  signalKey: string;
  angle: string;
  sampleSize: number;
  winRate: number;
}

export interface Playbook {
  summary: string;
  angles: PlaybookAngle[];
  personaNotes: string[];
  generatedBy: "llm" | "template";
}

export interface ScoringModel {
  version: number;
  trainedAt: string;
  weights: Weights;
  priorWeights: Weights;
  /** Univariate point-biserial correlation of each category sub-score with "won". */
  categoryCorrelations: Weights;
  signalPatterns: SignalPattern[];
  icp: IcpProfile;
  playbook: Playbook;
  /** "Conversion" = won deal or booked meeting; wins counts closed-won only. */
  baseline: { n: number; wins: number; meetings: number; conversionRate: number };
  notes: string[];
}

// ---------------------------------------------------------------------------
// Engagement, outcomes, activation
// ---------------------------------------------------------------------------

export type EventType =
  | "page_view"
  | "section_view"
  | "scroll_depth"
  | "video_play"
  | "video_25"
  | "video_50"
  | "video_75"
  | "video_complete"
  | "video_rewatch"
  | "calculator_input"
  | "calculator_completed"
  | "case_study_viewed"
  | "pricing_viewed"
  | "booking_clicked"
  | "return_visit_24h"
  | "email_sent"
  | "email_delivered"
  | "email_open"
  | "email_click"
  | "email_reply"
  | "email_bounced"
  | "linkedin_sent"
  | "linkedin_accept"
  | "linkedin_reply"
  | "gift_sent"
  | "visitor_identified"
  | "estimate_submitted"
  | "meeting_canceled";

export interface EngagementEvent {
  id: string;
  accountId: string;
  eventType: EventType | string;
  properties: Record<string, unknown>;
  visitorId: string | null;
  createdAt: string;
}

export type OutcomeType =
  | "replied"
  | "meeting_booked"
  | "opportunity_created"
  | "deal_won"
  | "deal_lost"
  | "no_response"
  | "disqualified";

export interface Outcome {
  id: string;
  accountId: string;
  outcomeType: OutcomeType;
  value: number | null;
  notes: string | null;
  source: string;
  createdAt: string;
}

export interface HotLeadAlert {
  accountId: string;
  slug: string;
  companyName: string;
  contact: Person | null;
  originalSignals: string[];
  engagement: string[];
  priorityBefore: number;
  priorityAfter: number;
  enrichment: string[];
  talkTrack: string;
  action: string;
  pageUrl: string;
  triggeredBy: string;
}

export interface Alert {
  id: string;
  accountId: string;
  kind: "hot_lead" | "engagement" | "meeting_booked";
  payload: HotLeadAlert;
  deliveredVia: string[];
  createdAt: string;
}

export interface CallQueueItem {
  id: string;
  accountId: string;
  contactName: string;
  phone: string | null;
  context: string;
  status: "queued" | "called" | "skipped";
  createdAt: string;
}

export type OutreachChannel = "email" | "linkedin" | "inmail" | "gift";

/**
 * scheduled: waiting for its send time
 * awaiting_rep: due, but the active provider cannot send this channel; shown as a rep task
 * sent / skipped / failed: terminal
 */
export type OutreachStatus = "scheduled" | "awaiting_rep" | "sent" | "skipped" | "failed";

export interface OutreachTouch {
  id: string;
  accountId: string;
  channel: OutreachChannel;
  step: number;
  subject?: string;
  body: string;
  status: OutreachStatus;
  scheduledFor: string;
  sentAt?: string;
  provider: string;
  externalId?: string;
  /** Why it failed or was handed to a rep. */
  note?: string;
  /** Deep link for the rep task (LinkedIn profile, gifting vendor). */
  taskUrl?: string;
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

export interface PipelineSummary {
  accounts: number;
  scored: number;
  qualified: number;
  campaignsLive: number;
  engaged: number;
  hot: number;
  meetings: number;
  won: number;
  lost: number;
  alerts: number;
  events: number;
  modelVersion: number | null;
}
