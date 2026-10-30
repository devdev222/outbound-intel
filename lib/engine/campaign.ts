import { z } from "zod";
import { config } from "@/lib/config";
import { caseStudyFor } from "@/lib/content/case-studies";
import { generateStructured } from "@/lib/llm";
import type { Providers } from "@/lib/providers";
import type { Store } from "@/lib/store";
import type { Account, Campaign, ExperimentArms, OutreachTouch, RoiDefaults, ScoringModel, Signal } from "@/lib/types";
import { hash32, nowIso, pageTokenFor, uuid } from "@/lib/util";
import { applyExperiments } from "./experiments";
import { SIGNAL_BY_KEY, signalLabel } from "./signal-catalog";

/** Canonical personalized page URL: /for/{slug}-{token}. The token is derived from the account id. */
export function pageUrlFor(account: Pick<Account, "id" | "slug">): string {
  return `${config.appUrl}/for/${account.slug}-${pageTokenFor(account.id)}`;
}

/**
 * Campaign generation (spec Phase 2): once an account qualifies, build the
 * personalized landing page content, the video script, the ROI defaults and
 * the multi-touch outreach, assign A/B arms, and hand the pieces to the video
 * and outreach providers.
 */

// --- Experiments ---------------------------------------------------------------

export function assignArms(accountId: string): ExperimentArms {
  const h = hash32(accountId);
  return {
    contentFormat: h & 1 ? "landing_page" : "direct_link",
    videoType: (h >>> 1) & 1 ? "ai" : "rep",
    personalization: (h >>> 2) & 1 ? "deep" : "conventional",
    angleVariant: (h >>> 3) & 1 ? "A" : "B",
    gifting: (h >>> 4) % 4 === 0 ? "gift" : "control",
  };
}

// --- Content ---------------------------------------------------------------------

export function topSignal(account: Account): Signal | null {
  const order = (s: Signal) => (s.status === "verified" ? 1 : 0) * 10 + s.confidence;
  return [...account.signals].filter((s) => s.type !== "intent").sort((a, b) => order(b) - order(a))[0] ?? null;
}

export function angleFor(account: Account, model: ScoringModel, variant: "A" | "B"): string {
  const sig = topSignal(account);
  if (!sig) return "Scale shipping operations without scaling coordination headcount";
  const learned = model.playbook.angles.find((a) => a.signalKey === sig.key)?.angle;
  const def = SIGNAL_BY_KEY[sig.key]?.angles;
  if (variant === "A") return learned ?? def?.[0] ?? `Lead with ${sig.label.toLowerCase()}`;
  return def?.[1] ?? learned ?? `Lead with ${sig.label.toLowerCase()}`;
}

export function roiDefaultsFor(account: Account): RoiDefaults {
  const shipments = account.facts.estimatedShipmentsPerMonth ?? Math.round(account.employeeCount * 0.8);
  const minutesPerShipment = 25;
  const hourlyCost = 38;
  const coordinators = Math.max(1, Math.round((shipments * minutesPerShipment) / 60 / 140));
  return { shipmentsPerMonth: shipments, minutesPerShipment, hourlyCost, coordinators };
}

export function firstName(account: Account): string {
  return account.contact?.name.split(" ")[0] ?? "there";
}

export function signalPhrase(sig: Signal | null, account: Account): string {
  if (!sig) return "your shipping volume";
  switch (sig.key) {
    case "hiring:transportation_coordinator":
      return `the ${sig.value ?? ""} transportation coordinator role${Number(sig.value) > 1 ? "s" : ""} you're hiring for`.replace("  ", " ");
    case "hiring:logistics_manager":
      return "the logistics manager role you're hiring for";
    case "hiring:dispatcher":
      return "the dispatcher roles you're hiring for";
    case "hiring:supply_chain_analyst":
      return "the supply chain analyst role you're hiring for";
    case "hiring:warehouse_associate":
      return "the warehouse hiring wave";
    case "expansion:acquisition":
      return "the acquisition you just closed";
    case "funding:raised_round":
      return "the growth capital you just raised";
    case "technology:legacy_tms":
      return "the manual work around your current TMS";
    case "technology:modern_tms":
      return "the lanes your TMS still can't cover";
    case "technology:erp_sap":
      return "freight data that doesn't reconcile with SAP";
    case "expansion:new_facility":
      return "the new facility you're bringing online";
    case "expansion:new_market":
      return "your move into a new region";
    case "technology:spreadsheet_ops":
      return "the spreadsheet still running your load planning";
    case "technology:no_tms":
      return "shipping without a TMS";
    case "pain:manual_coordination":
      return "the manual coordination load on your team";
    case "pain:carrier_issues":
      return "the carrier coverage problems on your lanes";
    case "pain:late_shipments":
      return "the late-delivery escalations";
    case "pain:freight_cost_pressure":
      return "the pressure on freight cost this year";
    case "leadership:new_ops_leader":
      return "the new operations leadership";
    default:
      return signalLabel(sig.key).toLowerCase();
  }
}

export function proofPoint(industry: string): string {
  const study = caseStudyFor(industry);
  const m = study.metrics[0];
  const who = study.industry === "General" ? "A manufacturer at similar volume" : `A ${study.industry.toLowerCase()} customer`;
  return `${who} got ${m.value} ${m.label.toLowerCase()} back with us.`;
}

export interface CampaignCopy {
  headline: string;
  subheadline: string;
  videoScript: string;
  emailSubject: string;
  emailBody: string;
  generatedBy: "llm" | "template";
}

export function templateCopy(account: Account, model: ScoringModel, arms: ExperimentArms): CampaignCopy {
  const sig = topSignal(account);
  const angle = angleFor(account, model, arms.angleVariant);
  const roi = roiDefaultsFor(account);
  const study = caseStudyFor(account.industry);
  const brand = config.brandName;
  const deep = arms.personalization === "deep";
  const phrase = signalPhrase(sig, account);
  const name = firstName(account);
  const headline = deep ? `${account.companyName}: ${angle.toLowerCase()}` : `Managed transportation for ${account.industry.toLowerCase()} shippers`;
  const subheadline = deep
    ? `We noticed ${phrase}. Here is how teams shipping ~${roi.shipmentsPerMonth.toLocaleString()} loads a month handled the same moment.`
    : `Capacity, tracking and exception handling, run by a dedicated team on one platform.`;
  const videoScript = deep
    ? `Hi ${name}, this is ${brand}. I noticed ${phrase} at ${account.companyName}. Teams at your volume, around ${roi.shipmentsPerMonth.toLocaleString()} loads a month, usually hit a wall where every new shipment means another phone call. ${proofPoint(account.industry)} I put together a page with your numbers; the link is below. Worth fifteen minutes?`
    : `Hi ${name}, this is ${brand}. We help ${account.industry.toLowerCase()} companies run shipping with a dedicated team instead of more coordinators. I put together a short page with an ROI estimate for a company your size. Worth fifteen minutes?`;
  const emailSubject = deep ? `${account.companyName} + ${phrase.replace(/^the /, "")}` : `Shipping operations that scale, for ${account.companyName}`;
  const emailBody = deep
    ? `${name},\n\nSaw ${phrase} at ${account.companyName}. ${angle}.\n\nI recorded a 20-second note and built a page with your numbers (about ${roi.shipmentsPerMonth.toLocaleString()} loads/month): {{page_url}}\n\nRelevant: "${study.title}" (${study.metrics[0].value} ${study.metrics[0].label.toLowerCase()}).\n\nOpen to 15 minutes next week?`
    : `${name},\n\n${brand} runs shipping operations for ${account.industry.toLowerCase()} companies so the team stops coordinating and starts managing.\n\nShort overview and an ROI estimate here: {{page_url}}\n\nOpen to 15 minutes next week?`;
  return { headline, subheadline, videoScript, emailSubject, emailBody, generatedBy: "template" };
}

const CopySchema = z.object({
  headline: z.string().describe("Landing page headline, <= 12 words, names the company or its situation"),
  subheadline: z.string().describe("One sentence under the headline referencing the specific signal"),
  videoScript: z.string().describe("Spoken script, 45-65 words (15-25 seconds), says the contact's first name, references the signal, mentions the page link"),
  emailSubject: z.string().describe("<= 8 words, no clickbait"),
  emailBody: z.string().describe("4-6 short lines, plain text, includes the literal token {{page_url}} once"),
});

export async function generateCopy(account: Account, model: ScoringModel, arms: ExperimentArms): Promise<CampaignCopy> {
  const template = templateCopy(account, model, arms);
  if (arms.personalization !== "deep") return template;
  const sig = topSignal(account);
  const result = await generateStructured({
    schema: CopySchema,
    effort: "low",
    system:
      `You are the campaign agent for ${config.brandName}, a managed transportation provider for shippers. ` +
      "You write short, specific, non-hypey outbound copy grounded only in the evidence provided. Never invent facts about the prospect. " +
      "Tone: a sharp operator writing to a peer. No exclamation marks.",
    user:
      `Account: ${account.companyName} (${account.industry}, ${account.employeeCount} employees, ${account.hqCity}, ${account.hqState}).\n` +
      `Contact: ${account.contact ? `${account.contact.name}, ${account.contact.title}` : "unknown"}.\n` +
      `Top signal: ${sig ? `${sig.label} (${sig.status}); evidence: ${sig.evidence.map((e) => e.title).join("; ")}` : "none"}.\n` +
      `Other signals: ${account.signals.filter((s) => s !== sig).map((s) => s.label).join("; ") || "none"}.\n` +
      `Messaging angle to use: ${angleFor(account, model, arms.angleVariant)}.\n` +
      `Pain hypothesis: ${account.painHypothesis ?? "n/a"}.\n` +
      `ROI defaults: ${JSON.stringify(roiDefaultsFor(account))}.\n` +
      `Case study to reference: ${caseStudyFor(account.industry).title}.\n` +
      `Template draft (improve, keep the facts): ${JSON.stringify(template)}`,
  });
  if (!result) return template;
  return { ...result, generatedBy: "llm" };
}

// --- Outreach sequence -------------------------------------------------------------

export function buildTouches(account: Account, campaign: Campaign, copy: CampaignCopy): OutreachTouch[] {
  const base = Date.now();
  const at = (days: number) => new Date(base + days * 86_400_000).toISOString();
  const page = campaign.pageUrl;
  const name = firstName(account);
  const study = caseStudyFor(account.industry);
  const touches: OutreachTouch[] = [
    {
      id: uuid(),
      accountId: account.id,
      channel: "email",
      step: 1,
      subject: copy.emailSubject,
      body: copy.emailBody.replace("{{page_url}}", page) + (campaign.videoThumbnailUrl ? `\n\n[video thumbnail -> ${page}#video]` : ""),
      status: "scheduled",
      scheduledFor: at(0),
      provider: "pending",
    },
    {
      id: uuid(),
      accountId: account.id,
      channel: "linkedin",
      step: 2,
      body: `${name}, sent you a short note on ${signalPhrase(topSignal(account), account)}. Would value connecting either way.`,
      status: "scheduled",
      scheduledFor: at(1),
      provider: "pending",
    },
    {
      id: uuid(),
      accountId: account.id,
      channel: "email",
      step: 3,
      subject: `Re: ${copy.emailSubject}`,
      body: `${name}, one more data point: "${study.title}" (${study.metrics.map((m) => `${m.value} ${m.label.toLowerCase()}`).join(", ")}).\n\nThe page has the full story and your ROI estimate: ${page}#case-study`,
      status: "scheduled",
      scheduledFor: at(4),
      provider: "pending",
    },
    {
      id: uuid(),
      accountId: account.id,
      channel: "inmail",
      step: 4,
      body: `${name}, in case email is noisy: 20-second note and your numbers here: ${page}. Happy to send a calendar link.`,
      status: "scheduled",
      scheduledFor: at(6),
      provider: "pending",
    },
    {
      id: uuid(),
      accountId: account.id,
      channel: "email",
      step: 5,
      subject: `Closing the loop, ${account.companyName}`,
      body: `${name}, I will stop here. If ${signalPhrase(topSignal(account), account)} becomes a priority, the page stays live: ${page}`,
      status: "scheduled",
      scheduledFor: at(10),
      provider: "pending",
    },
  ];
  if (campaign.arms.gifting === "gift") {
    touches.push({
      id: uuid(),
      accountId: account.id,
      channel: "gift",
      step: 6,
      body: `Gift experiment: send after first meaningful engagement (tracked separately for ROI).`,
      status: "scheduled",
      scheduledFor: at(3),
      provider: "pending",
    });
  }
  return touches;
}

// --- Launch -------------------------------------------------------------------------

export async function launchCampaign(
  account: Account,
  ctx: { store: Store; providers: Providers; model: ScoringModel; log?: (s: string) => void },
): Promise<Account> {
  // Default arms, then overrides from any running Lab experiment the account is eligible for.
  const { assignments, overrides } = await applyExperiments(account);
  const arms: ExperimentArms = { ...assignArms(account.id), ...(overrides as Partial<ExperimentArms>) };
  account = { ...account, experiments: assignments };
  const copy = await generateCopy(account, ctx.model, arms);
  const pageUrl = pageUrlFor(account);
  const roi = roiDefaultsFor(account);

  // The Video Agent owns the script, the render and the rep brief from here on.
  const campaign: Campaign = {
    headline: copy.headline,
    subheadline: copy.subheadline,
    angle: angleFor(account, ctx.model, arms.angleVariant),
    persona: account.recommendedPersona ?? account.contact?.title ?? "VP of Transportation",
    videoScript: copy.videoScript,
    videoStatus: "pending",
    videoSource: arms.videoType,
    scriptVersion: 0,
    videoAttempts: 0,
    roiDefaults: roi,
    caseStudyId: caseStudyFor(account.industry).id,
    pageUrl,
    arms,
    launchedAt: nowIso(),
  };

  // Outreach sequence: registered with the provider; the engine sends due touches unless the provider owns scheduling.
  const touches = buildTouches(account, campaign, copy);
  let launched: OutreachTouch[] = touches;
  try {
    launched = await ctx.providers.outreach.launchSequence({ ...account, campaign }, touches);
  } catch (err) {
    ctx.log?.(`outreach provider failed for ${account.slug}: ${(err as Error).message}`);
  }
  await ctx.store.insertOutreach(launched);

  return {
    ...account,
    campaign,
    messagingAngle: account.messagingAngle ?? campaign.angle,
    status: "campaign_live",
  };
}
