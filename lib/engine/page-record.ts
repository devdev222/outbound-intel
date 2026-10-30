import { getOrBootstrapModel } from "@/lib/agents/runtime";
import { config } from "@/lib/config";
import { type PageIndustryTag, type PageWorkflowTag } from "@/lib/content/case-studies";
import { assignArms, roiDefaultsFor, templateCopy } from "@/lib/engine/campaign";
import { getStore } from "@/lib/store";
import type { Account, ScoringModel, Signal } from "@/lib/types";
import { pageTokenFor } from "@/lib/util";

/**
 * Prospect page record, in the exact schema of the cartage-pages Astro project
 * (accounts/*.json). One record per account; the engine's /for/[slug] route
 * renders from it directly, and the same object can be written to the Astro
 * project to build a static page:
 *
 *   GET /api/accounts/{slug}/record            -> { record }
 *   write record to  cartage-pages/accounts/{slug}.json
 *   cd cartage-pages && npm run check:records && ALLOW_PROVISIONAL=1 npm run build
 *   page lands at   /for/{slug}-{url_token}
 *
 * Only the keys the Astro template reads are rendered there; everything under
 * `engine`, `research_notes` and `personalization_sources` stays internal.
 */

export const PAGE_RECORD_VERSION = "cartage-pages/2026-10-27";

export type PageStatus = "draft" | "published" | "archived";

export interface PageCalcDefaults {
  shipments_per_month: number;
  minutes_per_shipment: number;
  automation_percent: number;
  hourly_cost: number;
  currency: string;
}

export interface PageWorkflowCard {
  work_today: string;
  cartage_handles: string;
  why_it_helps: string;
  confirmed: boolean;
}

export interface PageRecord {
  account_id: string;
  slug: string;
  url_token: string;
  campaign_id: string;
  company_name: string;
  industry: PageIndustryTag;
  headline: string;
  value_proposition: string;
  rep_message: string;
  workflow_cards: PageWorkflowCard[];
  workflow_tags: PageWorkflowTag[];
  personalization_sources: string[];
  testimonial_ids: string[];
  video_url: string | null;
  calculator_defaults: PageCalcDefaults;
  rep_name: string;
  booking_url: string;
  status: PageStatus;
  // Internal (never rendered by the template)
  research_notes: string;
  engine: {
    record_version: string;
    industry_label: string;
    account_status: Account["status"];
    score: number | null;
    priority: number;
    model_version: number | null;
    verified_signals: string[];
    hypotheses: string[];
    pain_hypothesis: string | null;
    messaging_angle: string | null;
    video_status: string | null;
    contact_name: string | null;
    contact_title: string | null;
    contact_email: string | null;
    page_url: string;
  };
}

// --- Industry taxonomy -----------------------------------------------------------

export function industryTagFor(engineIndustry: string): PageIndustryTag {
  const s = engineIndustry.toLowerCase();
  if (s.includes("furniture")) return "furniture";
  if (s.includes("food") || s.includes("beverage")) return "food-beverage";
  if (/steel|metal|building|paper|packaging|plastic|rubber|chemical|agricultur|lumber|wood|commodit/.test(s)) return "commodities";
  return "specialized";
}

// --- Workflow cards ---------------------------------------------------------------

interface CardTemplate extends PageWorkflowCard {
  tags: PageWorkflowTag[];
}

/**
 * One card per buying signal. Every `work_today` is phrased as a hypothesis
 * ("If ...") because public evidence is not the prospect confirming it; the
 * cartage-pages record checker enforces the same rule.
 */
const CARD_LIBRARY: Record<string, (a: Account, s?: Signal) => CardTemplate> = {
  "hiring:transportation_coordinator": (a, s) => ({
    work_today: `If the ${Number(s?.value) > 1 ? `${s?.value} coordinators` : "coordinator"} you're hiring will spend the day tendering loads and chasing carriers by phone and email,`,
    cartage_handles: "Wilson can take the quoting, booking and tracking off their plate from day one, working from an email address on your domain like a teammate.",
    why_it_helps: "New hires start on exceptions and customers, not on data entry.",
    confirmed: false,
    tags: ["quoting", "booking", "tracking"],
  }),
  "hiring:logistics_manager": () => ({
    work_today: "If your incoming logistics manager inherits a process that runs on phone calls and spreadsheets,",
    cartage_handles: "Wilson can run the daily tendering, tracking and carrier follow-ups so the new leader starts with a system instead of a backlog.",
    why_it_helps: "The first 90 days go to improving the operation, not keeping it afloat.",
    confirmed: false,
    tags: ["booking", "tracking", "follow-ups"],
  }),
  "leadership:new_ops_leader": () => ({
    work_today: "If new operations leadership is looking for an early win in transportation,",
    cartage_handles: "Wilson can take over quoting and booking on your busiest lanes within weeks and report what changed.",
    why_it_helps: "A measurable result in the first quarter without a systems project.",
    confirmed: false,
    tags: ["quoting", "booking"],
  }),
  "hiring:dispatcher": () => ({
    work_today: "If dispatch is a full-time phone job on your busiest lanes,",
    cartage_handles: "Wilson can request quotes, book the carrier your rules prefer and confirm pickups without a person on the line.",
    why_it_helps: "Fewer calls per load, same on-time rate.",
    confirmed: false,
    tags: ["quoting", "booking"],
  }),
  "hiring:supply_chain_analyst": () => ({
    work_today: "If your analysts spend their week reconciling freight data instead of analyzing it,",
    cartage_handles: "Wilson can keep every quote, booking and invoice in one record that matches the agreed rate.",
    why_it_helps: "Clean freight data arrives without anyone building a pipeline.",
    confirmed: false,
    tags: ["quoting", "follow-ups"],
  }),
  "hiring:warehouse_associate": () => ({
    work_today: "If outbound volume is growing faster than the team that books and tracks it,",
    cartage_handles: "Wilson can match carrier capacity to warehouse throughput and keep every shipment tracked as volume climbs.",
    why_it_helps: "Freight stops being the bottleneck on heavy ship days.",
    confirmed: false,
    tags: ["booking", "tracking"],
  }),
  "expansion:new_facility": (a) => ({
    work_today: `If the new facility will add lanes and carriers faster than ${a.companyName}'s coordination process can absorb,`,
    cartage_handles: "Wilson can stand up the new site's freight with your carrier rules already in place and track every load from the first week.",
    why_it_helps: "The site launches without a second coordination team.",
    confirmed: false,
    tags: ["booking", "tracking"],
  }),
  "expansion:new_market": () => ({
    work_today: "If entering a new region means onboarding carriers you have never worked with,",
    cartage_handles: "Wilson can quote and book across Cartage's carrier network in the new lanes and benchmark every rate against what you pay today.",
    why_it_helps: "Coverage on day one, with rates you can compare.",
    confirmed: false,
    tags: ["quoting", "booking"],
  }),
  "expansion:acquisition": () => ({
    work_today: "If two freight operations now need to run as one,",
    cartage_handles: "Wilson can take both sites' quoting, booking and tracking into one inbox-driven process without a systems migration.",
    why_it_helps: "Integration happens in the workflow, not in a project plan.",
    confirmed: false,
    tags: ["quoting", "booking", "tracking"],
  }),
  "funding:raised_round": () => ({
    work_today: "If growth capital is meant for product and sales rather than freight administration,",
    cartage_handles: "Wilson can absorb the coordination work that scales with volume so headcount does not have to.",
    why_it_helps: "Shipping scales with volume instead of with hires.",
    confirmed: false,
    tags: ["booking", "tracking"],
  }),
  "technology:spreadsheet_ops": () => ({
    work_today: "If load planning and tracking live in a spreadsheet someone updates by hand,",
    cartage_handles: "Wilson can keep that sheet current from carrier updates and post exceptions where your team already works.",
    why_it_helps: "The spreadsheet stays true without anyone updating it.",
    confirmed: false,
    tags: ["tracking", "booking"],
  }),
  "technology:no_tms": () => ({
    work_today: "If shipments are tendered and tracked without a TMS,",
    cartage_handles: "Wilson can quote, book and track from email, so you get TMS outcomes without a TMS project.",
    why_it_helps: "Visibility and control arrive in weeks, not quarters.",
    confirmed: false,
    tags: ["quoting", "booking", "tracking"],
  }),
  "technology:legacy_tms": () => ({
    work_today: "If the TMS is still surrounded by manual work: re-keying, phone tendering, chasing updates,",
    cartage_handles: "Wilson can do the work around the system, keeping it as the record while handling the carrier conversations.",
    why_it_helps: "Keep the TMS, remove the manual layer.",
    confirmed: false,
    tags: ["booking", "follow-ups"],
  }),
  "technology:modern_tms": () => ({
    work_today: "If the TMS still leaves hard lanes and exceptions to people,",
    cartage_handles: "Wilson can cover the lanes the TMS cannot and chase the exceptions it only reports.",
    why_it_helps: "The system shows the problem; Wilson resolves it.",
    confirmed: false,
    tags: ["follow-ups", "booking"],
  }),
  "technology:erp_sap": () => ({
    work_today: "If freight data has to be reconciled back into SAP by hand,",
    cartage_handles: "Wilson can keep quotes, bookings and invoices matched to the order so finance reconciles once.",
    why_it_helps: "Freight that reconciles with the ERP.",
    confirmed: false,
    tags: ["quoting", "follow-ups"],
  }),
  "pain:manual_coordination": () => ({
    work_today: "If your team spends a good part of the day on the phone with carriers and re-keying orders,",
    cartage_handles: "Wilson can send the quote requests, book the load and chase the POD, escalating only what needs a human.",
    why_it_helps: "Your coordinators hear about the exceptions, not every routine check-in.",
    confirmed: false,
    tags: ["quoting", "booking", "follow-ups"],
  }),
  "pain:carrier_issues": () => ({
    work_today: "If tender rejections and coverage gaps keep pushing loads to the spot market,",
    cartage_handles: "Wilson can tender to your preferred carriers in order, watch acceptance and line up backups before a load is at risk.",
    why_it_helps: "Fewer fire drills, less spot-market spend.",
    confirmed: false,
    tags: ["booking", "follow-ups"],
  }),
  "pain:late_shipments": () => ({
    work_today: "If customers find out about late deliveries before you do,",
    cartage_handles: "Wilson can track every shipment, send status and ETA updates as they move and flag the ones that slip.",
    why_it_helps: "Your team works the late load, not the twenty that are on time.",
    confirmed: false,
    tags: ["tracking", "follow-ups"],
  }),
  "pain:freight_cost_pressure": () => ({
    work_today: "If freight is the fastest-growing cost line this year,",
    cartage_handles: "Wilson can benchmark every quote against your lane history and flag invoices that do not match the agreed rate.",
    why_it_helps: "Savings show up this quarter, without renegotiating every carrier.",
    confirmed: false,
    tags: ["quoting", "follow-ups"],
  }),
};

function signalOrder(s: Signal): number {
  return (s.status === "verified" ? 10 : 0) + s.confidence;
}

export function workflowCardsFor(account: Account): { cards: PageWorkflowCard[]; tags: PageWorkflowTag[] } {
  const candidates = [...account.signals]
    .filter((s) => s.type !== "intent" && CARD_LIBRARY[s.key])
    .sort((a, b) => signalOrder(b) - signalOrder(a));
  const seen = new Set<string>();
  const built: CardTemplate[] = [];
  for (const s of candidates) {
    if (built.length === 3) break;
    const card = CARD_LIBRARY[s.key](account, s);
    if (seen.has(card.work_today)) continue;
    seen.add(card.work_today);
    built.push(card);
  }
  if (built.length === 0) {
    const pain = account.painHypothesis ? account.painHypothesis.charAt(0).toLowerCase() + account.painHypothesis.slice(1).replace(/\.$/, "") : "shipment coordination is taking time from the people who should be serving customers";
    built.push({
      work_today: `If ${pain},`,
      cartage_handles: "Wilson can take on the quoting, booking, tracking and carrier follow-ups that fill a coordinator's day, from an email address on your domain.",
      why_it_helps: "Your team keeps the decisions and loses the busywork.",
      confirmed: false,
      tags: ["quoting", "booking", "tracking", "follow-ups"],
    });
  }
  const tags: PageWorkflowTag[] = [];
  for (const c of built) for (const t of c.tags) if (!tags.includes(t)) tags.push(t);
  return { cards: built.map(({ tags: _tags, ...card }) => card), tags };
}

// --- Booking URL --------------------------------------------------------------------

/** Tags the scheduler link so a confirmed meeting can be reconciled from the scheduler's records (mirrors records.ts bookingHref). */
export function bookingHrefFor(base: string, campaignId: string, accountId: string): string {
  try {
    const url = new URL(base);
    if (!url.searchParams.has("utm_source")) url.searchParams.set("utm_source", "cartage-pages");
    if (!url.searchParams.has("utm_campaign") && campaignId) url.searchParams.set("utm_campaign", campaignId);
    if (!url.searchParams.has("utm_content")) url.searchParams.set("utm_content", accountId);
    return url.toString();
  } catch {
    return base;
  }
}

// --- Record -----------------------------------------------------------------------------

export function campaignIdFor(account: Account): string {
  return account.campaign?.launchedAt ?? "preview";
}

export function pageStatusFor(account: Account): PageStatus {
  if (account.status === "disqualified" || account.status === "lost") return "archived";
  return account.campaign ? "published" : "draft";
}

/** Whether a stored video URL is a real asset (not the engine's own captions player). */
export function realVideoUrl(account: Account): string | null {
  const c = account.campaign;
  if (!c?.videoUrl || c.videoUrl.includes("/for/")) return null;
  if (c.videoStatus !== "ready") return null;
  return c.videoUrl;
}

/** Rep name shown on the page. The engine has no rep concept yet; set NEXT_PUBLIC_REP_NAME until it does. */
export function repNameFor(): string {
  return process.env.NEXT_PUBLIC_REP_NAME?.trim() ?? "";
}

export async function pageRecordFor(account: Account, opts: { model?: ScoringModel } = {}): Promise<PageRecord> {
  let headline = account.campaign?.headline;
  let valueProposition = account.campaign?.subheadline;
  let repMessage = account.campaign?.videoScript;
  let calc = account.campaign?.roiDefaults;

  if (!account.campaign) {
    const model = opts.model ?? (await getOrBootstrapModel(getStore()));
    const copy = templateCopy(account, model, assignArms(account.id));
    headline = copy.headline;
    valueProposition = copy.subheadline;
    repMessage = copy.videoScript;
    calc = roiDefaultsFor(account);
  }

  const token = pageTokenFor(account.id);
  const campaignId = campaignIdFor(account);
  const { cards, tags } = workflowCardsFor(account);
  const verified = account.signals.filter((s) => s.type !== "intent" && s.status === "verified");

  return {
    account_id: account.id,
    slug: account.slug,
    url_token: token,
    campaign_id: campaignId,
    company_name: account.companyName,
    industry: industryTagFor(account.industry),
    headline: headline ?? `Give ${account.companyName}'s logistics team more time back`,
    value_proposition:
      valueProposition ??
      "Wilson is Cartage's AI logistics coordinator. He works from an email address on your domain, like a teammate, and takes on the quoting, booking, tracking and carrier follow-ups that fill a coordinator's day.",
    rep_message: repMessage ?? "",
    workflow_cards: cards,
    workflow_tags: tags,
    personalization_sources: verified.flatMap((s) => s.evidence.slice(0, 2).map((e) => (e.url ? `${e.title} <${e.url}>` : e.title))),
    testimonial_ids: [],
    video_url: realVideoUrl(account),
    calculator_defaults: {
      shipments_per_month: Math.min(100_000, Math.max(0, Math.round(calc?.shipmentsPerMonth ?? account.facts.estimatedShipmentsPerMonth ?? 400))),
      minutes_per_shipment: Math.min(480, Math.max(0, Math.round(calc?.minutesPerShipment ?? 15))),
      automation_percent: 40,
      hourly_cost: Math.min(500, Math.max(0, Math.round(calc?.hourlyCost ?? 35))),
      currency: "USD",
    },
    rep_name: repNameFor(),
    booking_url: bookingHrefFor(config.calendly.url || "https://www.cartage.ai/contact", campaignId, account.id),
    status: pageStatusFor(account),
    research_notes: account.brief ?? "",
    engine: {
      record_version: PAGE_RECORD_VERSION,
      industry_label: account.industry,
      account_status: account.status,
      score: account.scores?.total ?? null,
      priority: account.priority,
      model_version: account.modelVersion,
      verified_signals: account.verifiedSignals,
      hypotheses: account.hypotheses,
      pain_hypothesis: account.painHypothesis,
      messaging_angle: account.messagingAngle ?? account.campaign?.angle ?? null,
      video_status: account.campaign?.videoStatus ?? null,
      contact_name: account.contact?.name ?? null,
      contact_title: account.contact?.title ?? null,
      contact_email: account.contact?.email ?? null,
      page_url: `${config.appUrl}/for/${account.slug}-${token}`,
    },
  };
}
