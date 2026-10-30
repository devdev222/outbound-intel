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
  /**
   * Who vouched for the contact data: a named enrichment provider, the rep, or
   * "synthetic" for demo data. Readiness in live mode never accepts synthetic.
   */
  verifiedBy?: string | null;
}

/** Enrichment status for the contact, so failures stay visible and retryable. */
export interface EnrichmentState {
  attempts: number;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  provider: string | null;
  /** Do not retry before this time (bounded exponential backoff). */
  nextAttemptAt: string | null;
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

/**
 * The campaign settings an account launches with: the team's defaults
 * (Playbook > Campaign defaults), overridden only by the Lab experiments the
 * account is enrolled in. Nothing is randomized outside an experiment.
 */
export interface ExperimentArms {
  /** landing_page: links point at the personalized page. direct_link: links point straight at the booking link. */
  contentFormat: "landing_page" | "direct_link";
  videoType: "ai" | "rep";
  personalization: "deep" | "conventional";
  /** A: your playbook / learned angle. B: the catalog alternative. */
  angleVariant: "A" | "B";
  gifting: "gift" | "control";
  /** matched: industry-matched customer story. generic: the general story. none: no customer claim. */
  proofMode?: "matched" | "generic" | "none";
  /** Invite the prospect to the freight assessment in the first email. */
  assessmentInvite?: boolean;
  /** A specific angle sentence that replaces the playbook/learned angle (angle experiments, rolled-out winners). */
  angleOverride?: string | null;
  /** Sequence to use instead of the matching/default one (sequence experiments). */
  sequenceId?: string | null;
  /** Replace one step's template (template experiments): step number (1-based) and template id. */
  templateStep?: number | null;
  templateId?: string | null;
}

export type CampaignDefaults = Required<Pick<ExperimentArms, "contentFormat" | "videoType" | "personalization" | "angleVariant" | "gifting" | "proofMode" | "assessmentInvite">> & { angleOverride: string | null };

// ---------------------------------------------------------------------------
// Playbook, sequences and message templates (the team's own content)
// ---------------------------------------------------------------------------

export type TemplateChannel = "email" | "linkedin" | "inmail" | "call";

export interface MessageTemplate {
  id: string;
  name: string;
  channel: TemplateChannel;
  /** Email only. */
  subject: string | null;
  body: string;
  tags: string[];
  /** Only approved templates go to prospects in live mode; uploads arrive as drafts. */
  status: "draft" | "approved" | "archived";
  source: "manual" | "upload";
  fileName?: string | null;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

export type SequenceChannel = "email" | "linkedin" | "inmail" | "call" | "gift";

export interface SequenceStep {
  id: string;
  /** Days after launch. */
  day: number;
  channel: SequenceChannel;
  title: string;
  /** null: the engine writes this step from the account's research and your playbook. */
  templateId: string | null;
  note?: string | null;
}

export interface Sequence {
  id: string;
  name: string;
  description: string;
  steps: SequenceStep[];
  status: "draft" | "active" | "archived";
  /** The one sequence used when no segment-specific sequence matches. */
  isDefault: boolean;
  /** Segment rule; empty lists match everyone. Higher priority wins among matches. */
  appliesTo: { industries: string[]; sizeBands: string[]; signalKeys: string[] };
  priority: number;
  builtIn?: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface PlaybookSignalAngle {
  signalKey: string;
  angle: string;
  talkingPoints: string[];
}

export interface PlaybookPersona {
  id: string;
  title: string;
  pains: string;
  angle: string;
}

export interface PlaybookObjection {
  id: string;
  objection: string;
  response: string;
}

/** The team's own playbook. Overrides the learned playbook wherever both have an answer. */
export interface CompanyPlaybook {
  id: "global";
  positioning: string;
  toneRules: string[];
  avoid: string[];
  signalAngles: PlaybookSignalAngle[];
  personas: PlaybookPersona[];
  objections: PlaybookObjection[];
  updatedAt: string;
  updatedBy: string;
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
  /**
   * Sequence launch state. "live" only after the outreach provider acknowledged
   * the launch; failures stay "failed" with the error and are retried.
   */
  launchState?: "pending" | "live" | "failed";
  launchError?: string | null;
  /** Remote sequence id returned by the provider (Sequencer). */
  sequenceId?: string | null;
  /** Approved proof story the copy cites, or null when none qualified. */
  proofStoryId?: string | null;
  /** The team sequence the tasks were built from. */
  sequence?: { id: string; name: string } | null;
}

// ---------------------------------------------------------------------------
// Account
// ---------------------------------------------------------------------------

export type AccountStatus =
  | "discovered"
  | "scored"
  | "needs_enrichment"
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
  /** When the current activation was flagged; with the account id it forms the activation (alert) id. */
  pendingActivationAt?: string | null;
  /** Explicit deferral: no outreach (local or external) until this time. */
  pausedUntil?: string | null;
  pauseReason?: string | null;
  enrichment?: EnrichmentState | null;
  /** Rep who owns the account in the queue (assigned when it becomes ready). */
  ownerRepId?: string | null;
  /** Latest readiness evaluation; accounts enter the BDR queue only when ready. */
  readiness?: ReadinessReport | null;
  nextAction?: NextAction | null;
  /** Experiment assignments: experimentId -> armKey */
  experiments?: Record<string, string>;
  /** Estimated pipeline value when qualified (from economics settings and size). */
  pipelineValue?: number | null;
  /** CRM ownership check result. */
  crmOwner?: string | null;
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
  /** Prospect asked for times; not an appointment. Creates a scheduling task. */
  | "meeting_requested"
  /** Confirmed appointment (calendar booking or rep-confirmed). */
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
  /**
   * Stable business identifier of the opportunity (CRM id when known, else
   * `opp_<accountId>`). Created → won transitions share it, so counting and
   * value never double.
   */
  opportunityId?: string | null;
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

export interface Delivery {
  destination: string;
  status: "pending" | "succeeded" | "failed";
  remoteId: string | null;
  error: string | null;
  attempts: number;
  at: string;
}

export interface Alert {
  id: string;
  accountId: string;
  kind: "hot_lead" | "engagement" | "meeting_booked";
  payload: HotLeadAlert;
  deliveredVia: string[];
  /** Per-destination delivery results (Slack, dialer, ...), tracked independently. */
  deliveries?: Delivery[];
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

// ---------------------------------------------------------------------------
// Tasks: the one authoritative record of work to do on an account
// ---------------------------------------------------------------------------

/** Message channels can be delivered by a provider; call / meeting / estimate are human work. */
export type OutreachChannel = "email" | "linkedin" | "inmail" | "gift" | "call" | "meeting" | "estimate";

/**
 * awaiting_approval  drafted; a person must review before anything is scheduled
 * scheduled          approved / planned; the scheduler delivers it when due (if the channel has a provider)
 * sending            claimed by a worker; provider request in flight
 * sent               provider acknowledged delivery, or a person recorded it as sent outside the platform
 * manual             due work a person must do (LinkedIn, InMail, gift, call, scheduling) — no provider
 * done               manual work completed (call made, meeting scheduled)
 * skipped / failed   terminal; failed keeps lastError and is retryable by a person
 */
export type OutreachStatus = "awaiting_approval" | "scheduled" | "sending" | "sent" | "manual" | "done" | "skipped" | "failed";

/** Where a task came from. Rep and conversation commitments are never overwritten by rescoring. */
export type TaskSource = "sequence" | "conversation" | "rep" | "prospect" | "agent" | "system";

export interface OutreachTouch {
  id: string;
  accountId: string;
  channel: OutreachChannel;
  step: number;
  subject?: string;
  body: string;
  status: OutreachStatus;
  /** Due date. */
  scheduledFor: string;
  sentAt?: string;
  provider: string;
  externalId?: string;
  /** Why it failed or was handed to a rep. */
  note?: string;
  /** Deep link for the rep task (LinkedIn profile, mailto, gifting vendor). */
  taskUrl?: string;
  /** Short human label, e.g. "Call back Nina", "Send times for a meeting". */
  title?: string;
  source?: TaskSource;
  assigneeRepId?: string | null;
  /** Delivery attempts; bounded retries stop at MAX_SEND_ATTEMPTS. */
  attempts?: number;
  lastError?: string | null;
  approvedBy?: string | null;
  approvedAt?: string | null;
  completedBy?: string | null;
  /** provider = delivered through an adapter; manual = a person recorded it. */
  completionMode?: "provider" | "manual" | null;
  conversationId?: string | null;
}

/** Tasks are the same records as outreach touches; the alias reads better in new code. */
export type Task = OutreachTouch;
export type TaskStatus = OutreachStatus;

// ---------------------------------------------------------------------------
// Durable operations (idempotent external side effects)
// ---------------------------------------------------------------------------

export type OperationKind = "sequence_launch" | "send" | "alert" | "dialer" | "sequence_pause" | "lease";

export interface Operation {
  /** Stable idempotency key, e.g. `send:<taskId>`, `alert:<activationId>:slack`. */
  id: string;
  kind: OperationKind;
  accountId: string | null;
  destination: string;
  status: "pending" | "running" | "succeeded" | "failed" | "dead";
  attempts: number;
  maxAttempts: number;
  leaseOwner: string | null;
  leaseUntil: string | null;
  nextAttemptAt: string | null;
  remoteId: string | null;
  lastError: string | null;
  result: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
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

// ---------------------------------------------------------------------------
// Users, roles, reps (Revenue Operating System)
// ---------------------------------------------------------------------------

export type Role = "exec" | "bdr" | "admin";

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  /** For BDRs: the rep record they execute as. */
  repId?: string;
}

export interface Rep {
  id: string;
  name: string;
  email: string;
  /** Conversations the rep can realistically start per working day. */
  capacityPerDay: number;
  active: boolean;
}

// ---------------------------------------------------------------------------
// Prospect readiness
// ---------------------------------------------------------------------------

export interface ReadinessCheck {
  key: "icp_fit" | "decision_maker" | "contact" | "evidence" | "hypothesis" | "crm" | "suppression" | "enrichment" | "next_action";
  label: string;
  pass: boolean;
  detail: string;
}

export interface ReadinessReport {
  ready: boolean;
  checks: ReadinessCheck[];
  blockers: string[];
  evaluatedAt: string;
}

export type NextActionType = "call" | "email" | "linkedin" | "wait" | "enrich" | "review" | "meeting_prep" | "close";

export interface NextAction {
  type: NextActionType;
  label: string;
  reason: string;
  dueAt: string;
}

// ---------------------------------------------------------------------------
// Conversation intelligence
// ---------------------------------------------------------------------------

export type ConversationChannel = "call" | "email" | "linkedin" | "meeting";
export type ConversationOutcome = "connected" | "voicemail" | "no_answer" | "replied" | "meeting_booked" | "not_interested" | "not_now" | "wrong_contact";

export interface Conversation {
  id: string;
  accountId: string;
  repId: string | null;
  channel: ConversationChannel;
  outcome: ConversationOutcome;
  /** Raw notes or transcript the rep logged. */
  notes: string;
  summary: string;
  objections: string[];
  signalsExtracted: string[];
  followUpDraft: { subject: string; body: string } | null;
  followUpTouchId: string | null;
  nextAction: NextAction | null;
  /** true once a human approved the follow-up / CRM update. */
  approved: boolean;
  generatedBy: "llm" | "template";
  at: string;
}

// ---------------------------------------------------------------------------
// Experiments
// ---------------------------------------------------------------------------

/** What an experiment changes. Each type owns a set of campaign settings; two running experiments may not change the same one. */
export type ExperimentType = "sequence" | "template" | "angle" | "video" | "landing_page" | "proof" | "assessment" | "gifting";
export type ExperimentMetric = "qualified_pipeline" | "meetings_held" | "opportunities" | "meetings_booked";

export interface ExperimentArm {
  key: string;
  name: string;
  /** Share of eligible accounts, 0..1; shares sum to 1. */
  share: number;
  /** Arm-specific configuration (e.g. { angleVariant: "B" }, { gift: true }, { testimonialId }). */
  config: Record<string, unknown>;
  control: boolean;
}

export interface ExperimentSegment {
  industries: string[];
  sizeBands: string[];
  signalKeys: string[];
  minScore: number;
}

export interface Experiment {
  id: string;
  name: string;
  hypothesis: string;
  type: ExperimentType;
  segment: ExperimentSegment;
  arms: ExperimentArm[];
  primaryMetric: ExperimentMetric;
  status: "draft" | "running" | "completed";
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
  createdBy: string;
  /** Arms per arm needed before reading results (default 30). */
  targetPerArm?: number;
  /** Set when a winner was rolled out as the new default. */
  rollout?: { armKey: string; at: string; by: string; applied: string } | null;
}

export interface ArmResult {
  armKey: string;
  name: string;
  control: boolean;
  accounts: number;
  meetingsBooked: number;
  meetingsHeld: number;
  opportunities: number;
  qualifiedPipeline: number;
  cost: number;
  conversionRate: number;
  costPerOpportunity: number | null;
  /** Funnel context (not success metrics): accounts whose first touch went out, and that engaged with anything. */
  touched?: number;
  engaged?: number;
}

export interface ExperimentResults {
  experimentId: string;
  arms: ArmResult[];
  comparisons: { armKey: string; lift: number; zScore: number; pValue: number; significant: boolean; sampleWarning: string | null }[];
  computedAt: string;
}

// ---------------------------------------------------------------------------
// Customer proof
// ---------------------------------------------------------------------------

export interface ProofOutcome {
  metric: string;
  value: string;
  verified: boolean;
  source: string;
}

export interface ProofStory {
  id: string;
  customer: string;
  industry: string;
  sizeBand: string;
  challenges: string[];
  capabilities: string[];
  outcomes: ProofOutcome[];
  quote?: string;
  quoteBy?: string;
  /** Marketing / legal sign-off. Unapproved stories never reach prospects. */
  approved: boolean;
  /** Synthetic placeholder: shown only in demo mode and always labelled. */
  placeholder: boolean;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Gifting
// ---------------------------------------------------------------------------

export interface GiftCampaign {
  id: string;
  name: string;
  budgetTotal: number;
  perGiftLimit: number;
  eligibility: { minScore: number; statuses: AccountStatus[]; requireEngagement: boolean };
  approvalRequired: boolean;
  status: "draft" | "active" | "paused" | "closed";
  experimentId: string | null;
  createdAt: string;
}

export type GiftStatus = "proposed" | "approved" | "rejected" | "ordered" | "delivered" | "canceled";

export interface Gift {
  id: string;
  campaignId: string;
  accountId: string;
  description: string;
  amount: number;
  status: GiftStatus;
  proposedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  deliveredAt: string | null;
  note: string | null;
}

// ---------------------------------------------------------------------------
// Freight operations assessment
// ---------------------------------------------------------------------------

export interface AssessmentInputs {
  shipmentsPerMonth: number;
  quotesPerWeek: number;
  minutesPerQuote: number;
  carriersContactedPerLoad: number;
  minutesPerCarrierContact: number;
  trackingChecksPerDay: number;
  minutesPerTrackingCheck: number;
  exceptionsPerWeek: number;
  minutesPerException: number;
  expectedGrowthPercent: number;
  hourlyCost: number;
}

export interface AssessmentArea {
  key: "quoting" | "carrier_communication" | "tracking" | "exceptions" | "scalability";
  label: string;
  hoursPerWeek: number;
  automationLow: number;
  automationHigh: number;
  note: string;
}

export interface AssessmentResults {
  areas: AssessmentArea[];
  totalHoursPerWeek: number;
  recoverableHoursLow: number;
  recoverableHoursHigh: number;
  annualValueLow: number;
  annualValueHigh: number;
  assumptions: string[];
}

export interface Assessment {
  id: string;
  accountId: string;
  inputs: AssessmentInputs;
  results: AssessmentResults;
  source: "prospect" | "rep";
  at: string;
}

// ---------------------------------------------------------------------------
// Governance
// ---------------------------------------------------------------------------

export interface AutomationSettings {
  autoSendEmail: boolean;
  autoLaunchCampaigns: boolean;
  autoProposeGifts: boolean;
  requireFollowUpApproval: boolean;
  /** Signals older than this are flagged stale and discounted. */
  signalFreshnessDays: number;
  qualificationThreshold: number;
  hotThreshold: number;
}

export interface Suppression {
  id: string;
  /** email address or @domain */
  target: string;
  reason: "opt_out" | "customer" | "competitor" | "do_not_contact" | "bounced" | "manual";
  note: string | null;
  createdBy: string;
  at: string;
}

export interface AuditEntry {
  id: string;
  userId: string;
  userName: string;
  role: Role;
  action: string;
  target: string;
  detail: string;
  at: string;
}

export interface EconomicsSettings {
  repFullyLoadedMonthly: number;
  toolingMonthly: number;
  videoCostPerRender: number;
  avgOpportunityValue: number;
  /** Fraction of booked meetings that are held. */
  meetingHoldRate: number;
}

export interface PlatformSettings {
  id: "global";
  automation: AutomationSettings;
  economics: EconomicsSettings;
  /** What every campaign launches with unless a Lab experiment changes it. */
  defaults: CampaignDefaults;
  updatedAt: string;
  updatedBy: string;
}
