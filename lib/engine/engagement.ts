import { config } from "@/lib/config";
import type { Providers } from "@/lib/providers";
import type { Store } from "@/lib/store";
import type { Account, EngagementEvent, Signal } from "@/lib/types";
import { clamp, nowIso, uuid } from "@/lib/util";
import { logActivity } from "./activity";
import { priorityFrom } from "./scoring";

/**
 * MONITOR step (spec Phase 3). Every meaningful interaction with personalized
 * content lands here: it is stored, mirrored to the analytics provider, folded
 * into the account's engagement score and priority, converted into intent
 * signals where appropriate, and checked against the activation threshold.
 * When the threshold is crossed the account is flagged for Jerry.
 */

export const EVENT_WEIGHTS: Record<string, number> = {
  page_view: 3,
  section_view: 2,
  scroll_depth: 1,
  video_play: 5,
  video_25: 3,
  video_50: 5,
  video_75: 10,
  video_complete: 8,
  video_rewatch: 8,
  calculator_input: 4,
  calculator_completed: 12,
  case_study_viewed: 8,
  pricing_viewed: 10,
  booking_clicked: 20,
  return_visit_24h: 12,
  email_sent: 0,
  email_delivered: 0,
  email_open: 2,
  email_click: 5,
  email_reply: 15,
  email_bounced: 0,
  linkedin_sent: 0,
  linkedin_accept: 4,
  linkedin_reply: 12,
  gift_sent: 0,
  visitor_identified: 6,
  estimate_submitted: 18,
  meeting_canceled: 0,
};

export const HIGH_INTENT_EVENTS = new Set([
  "video_75",
  "video_complete",
  "calculator_completed",
  "pricing_viewed",
  "case_study_viewed",
  "return_visit_24h",
  "booking_clicked",
  "email_reply",
  "linkedin_reply",
  "estimate_submitted",
]);

export function isHighIntentEvent(eventType: string): boolean {
  return HIGH_INTENT_EVENTS.has(eventType);
}

export function describeEvent(e: Pick<EngagementEvent, "eventType" | "properties">): string {
  const p = e.properties ?? {};
  switch (e.eventType) {
    case "page_view":
      return `Viewed personalized page${p.referrer ? ` (from ${String(p.referrer)})` : ""}`;
    case "section_view":
      return `Viewed section: ${String(p.section ?? "unknown")}`;
    case "scroll_depth":
      return `Scrolled ${String(p.percent ?? "")}% of page`;
    case "video_play":
      return "Started the video";
    case "video_25":
      return "Watched 25% of video";
    case "video_50":
      return "Watched 50% of video";
    case "video_75":
      return `Watched ${String(p.percent ?? 75)}% of video`;
    case "video_complete":
      return "Watched the full video";
    case "video_rewatch":
      return `Rewatched the video${p.section ? ` (${String(p.section)})` : ""}`;
    case "calculator_input":
      return `Changed ROI calculator input: ${String(p.field ?? "")} = ${String(p.value ?? "")}`;
    case "calculator_completed":
      return `Used ROI calculator (entered ${String(p.shipmentsPerMonth ?? "?")} shipments/mo, saw ${String(p.hoursSaved ?? "?")} hrs/week saved)`;
    case "case_study_viewed":
      return `Viewed case study: "${String(p.title ?? p.caseStudyId ?? "")}"`;
    case "pricing_viewed":
      return "Viewed pricing / ROI results";
    case "booking_clicked":
      return "Clicked to book a meeting";
    case "return_visit_24h":
      return `${String(p.visitNumber ?? "Repeat")} visit in 24 hours`;
    case "email_sent":
      return `Email step ${String(p.step ?? "")} sent${p.provider ? ` via ${String(p.provider)}` : ""}`;
    case "email_delivered":
      return `Email step ${String(p.step ?? "")} delivered`;
    case "email_open":
      return `Opened email step ${String(p.step ?? "")}`;
    case "email_click":
      return `Clicked link in email step ${String(p.step ?? "")}${p.link ? ` (${String(p.link)})` : ""}`;
    case "email_reply":
      return "Replied to email";
    case "email_bounced":
      return `Email step ${String(p.step ?? "")} bounced`;
    case "linkedin_sent":
      return `${p.channel === "inmail" ? "InMail" : "LinkedIn message"} sent by rep`;
    case "linkedin_accept":
      return "Accepted LinkedIn connection";
    case "linkedin_reply":
      return "Replied on LinkedIn";
    case "gift_sent":
      return "Gift sent by rep";
    case "estimate_submitted":
      return `Requested their estimate by email${p.email ? ` (${String(p.email)})` : ""}`;
    case "meeting_canceled":
      return "Meeting canceled";
    case "visitor_identified":
      return `Website visitor identified: ${String(p.name ?? "")}${p.title ? `, ${String(p.title)}` : ""}`;
    default:
      return e.eventType;
  }
}

function intentSignalFor(eventType: string, now: string): Signal | null {
  if (eventType === "pricing_viewed" || eventType === "calculator_completed") {
    return {
      key: "intent:visited_pricing",
      type: "intent",
      label: "Visited pricing / ROI content",
      status: "verified",
      confidence: 1,
      detectedAt: now,
      agent: "monitor",
      evidence: [{ title: "First-party engagement event", url: "", source: "engagement" }],
    };
  }
  if (eventType === "video_75" || eventType === "video_complete") {
    return {
      key: "intent:watched_video",
      type: "intent",
      label: "Watched most of the personalized video",
      status: "verified",
      confidence: 1,
      detectedAt: now,
      agent: "monitor",
      evidence: [{ title: "First-party engagement event", url: "", source: "engagement" }],
    };
  }
  return null;
}

export interface RecordEngagementInput {
  eventType: string;
  properties?: Record<string, unknown>;
  visitorId?: string | null;
}

export interface RecordEngagementResult {
  account: Account;
  events: EngagementEvent[];
  activationTriggered: boolean;
  reason: string | null;
}

export async function recordEngagement(
  store: Store,
  providers: Providers,
  account: Account,
  input: RecordEngagementInput,
): Promise<RecordEngagementResult> {
  const now = nowIso();
  const events: EngagementEvent[] = [];
  const base: EngagementEvent = {
    id: uuid(),
    accountId: account.id,
    eventType: input.eventType,
    properties: input.properties ?? {},
    visitorId: input.visitorId ?? null,
    createdAt: now,
  };
  await store.insertEvent(base);
  events.push(base);

  // Return-visit detection: same visitor, a page_view more than 30 minutes ago within 24h.
  if (input.eventType === "page_view" && input.visitorId) {
    const since = new Date(Date.now() - 24 * 3_600_000).toISOString();
    const prior = (await store.listEvents({ accountId: account.id, sinceIso: since })).filter(
      (e) => e.eventType === "page_view" && e.visitorId === input.visitorId && e.id !== base.id && Date.now() - new Date(e.createdAt).getTime() > 30 * 60_000,
    );
    if (prior.length > 0) {
      const rv: EngagementEvent = {
        id: uuid(),
        accountId: account.id,
        eventType: "return_visit_24h",
        properties: { visitNumber: `${prior.length + 1}${prior.length + 1 === 2 ? "nd" : prior.length + 1 === 3 ? "rd" : "th"}` },
        visitorId: input.visitorId,
        createdAt: now,
      };
      await store.insertEvent(rv);
      events.push(rv);
    }
  }

  // Mirror to analytics (PostHog) without blocking the request.
  for (const e of events) {
    providers.analytics
      .capture({ event: e.eventType, distinctId: e.visitorId ?? account.slug, properties: { ...e.properties, account: account.slug, company: account.companyName }, timestamp: e.createdAt })
      .catch((err) => console.warn(`[analytics] ${(err as Error).message}`));
  }

  // Fold into the account.
  let next: Account = { ...account };
  let delta = 0;
  for (const e of events) delta += EVENT_WEIGHTS[e.eventType] ?? 1;
  next.engagementScore = clamp(Math.round(next.engagementScore + delta));
  for (const e of events) {
    const sig = intentSignalFor(e.eventType, now);
    if (sig && !next.signals.some((s) => s.key === sig.key)) next.signals = [...next.signals, sig];
  }
  const total = next.scores?.total ?? 0;
  next.priority = priorityFrom(total, next.engagementScore);
  if (next.status === "campaign_live" || next.status === "qualified") next.status = "engaged";

  // Threshold check -> flag for Jerry.
  let reason: string | null = null;
  const highIntent = events.find((e) => isHighIntentEvent(e.eventType));
  if (highIntent) reason = describeEvent(highIntent);
  else if (next.engagementScore >= config.engine.hotThreshold) reason = `engagement score reached ${next.engagementScore}`;

  const cooldownOk = !next.lastAlertAt || Date.now() - new Date(next.lastAlertAt).getTime() > config.engine.alertCooldownMinutes * 60_000;
  const alreadyPending = Boolean(next.pendingActivation);
  const terminal = next.status === "won" || next.status === "lost" || next.status === "disqualified";
  let activationTriggered = false;
  if (reason && cooldownOk && !alreadyPending && !terminal) {
    next.pendingActivation = reason;
    next.status = next.status === "meeting_booked" ? next.status : "hot";
    activationTriggered = true;
  }

  next = await store.upsertAccount(next);
  if (activationTriggered) {
    await logActivity(store, next.id, "system", "activation_flagged", `Engagement crossed the threshold: ${reason}`, [
      `engagement ${account.engagementScore} -> ${next.engagementScore}, priority ${account.priority} -> ${next.priority}`,
      "handed to Jerry",
    ]);
  }
  return { account: next, events, activationTriggered, reason };
}
