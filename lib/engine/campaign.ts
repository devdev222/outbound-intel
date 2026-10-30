import { z } from "zod";
import { allowPlaceholders, config } from "@/lib/config";
import { generateStructured } from "@/lib/llm";
import type { Providers } from "@/lib/providers";
import type { Store } from "@/lib/store";
import { proofStories } from "@/lib/store/collections";
import type { Account, Campaign, ExperimentArms, OutreachTouch, ProofStory, RoiDefaults, ScoringModel, Signal } from "@/lib/types";
import { hash32, nowIso, pageTokenFor, uuid } from "@/lib/util";
import { logActivity } from "./activity";
import { applyExperiments } from "./experiments";
import { runOperation } from "./operations";
import { ensureProofSeeded, rankProof } from "./proof";
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

/**
 * The one customer claim campaign content may make. Live mode: only an approved
 * story's verified outcome. Demo mode may use a labelled placeholder story.
 * When nothing qualifies the claim is omitted from every channel.
 */
export interface ProofLine {
  storyId: string;
  customer: string;
  title: string;
  metric: string;
  value: string;
  sentence: string;
  placeholder: boolean;
}

export function proofLineFor(account: Account, stories: ProofStory[]): ProofLine | null {
  for (const match of rankProof(account, stories, { allowPlaceholders: allowPlaceholders() })) {
    const story = match.story;
    const outcome = story.approved && !story.placeholder ? story.outcomes.find((o) => o.verified) : allowPlaceholders() && story.placeholder ? story.outcomes[0] : undefined;
    if (!outcome) continue;
    const who = story.industry === "General" ? "A manufacturer at similar volume" : `A ${story.industry.toLowerCase()} customer`;
    return {
      storyId: story.id,
      customer: story.customer,
      title: story.customer,
      metric: outcome.metric,
      value: outcome.value,
      sentence: `${who} got ${outcome.value} ${outcome.metric.toLowerCase()} with us.`,
      placeholder: story.placeholder,
    };
  }
  return null;
}

export async function loadProofLine(account: Account): Promise<ProofLine | null> {
  const stories = await ensureProofSeeded();
  return proofLineFor(account, stories.length ? stories : await proofStories.list());
}

/** Back-compat for callers that only need the sentence. */
export function proofPoint(proof: ProofLine | null): string {
  return proof ? proof.sentence : "";
}

export interface CampaignCopy {
  headline: string;
  subheadline: string;
  videoScript: string;
  emailSubject: string;
  emailBody: string;
  generatedBy: "llm" | "template";
}

export function templateCopy(account: Account, model: ScoringModel, arms: ExperimentArms, proof: ProofLine | null = null): CampaignCopy {
  const sig = topSignal(account);
  const angle = angleFor(account, model, arms.angleVariant);
  const roi = roiDefaultsFor(account);
  const brand = config.brandName;
  const deep = arms.personalization === "deep";
  const phrase = signalPhrase(sig, account);
  const name = firstName(account);
  const headline = deep ? `${account.companyName}: ${angle.toLowerCase()}` : `Managed transportation for ${account.industry.toLowerCase()} shippers`;
  const subheadline = deep
    ? `We noticed ${phrase}. Here is how teams shipping ~${roi.shipmentsPerMonth.toLocaleString()} loads a month handled the same moment.`
    : `Capacity, tracking and exception handling, run by a dedicated team on one platform.`;
  const videoScript = deep
    ? `Hi ${name}, this is ${brand}. I noticed ${phrase} at ${account.companyName}. Teams at your volume, around ${roi.shipmentsPerMonth.toLocaleString()} loads a month, usually hit a wall where every new shipment means another phone call.${proof ? ` ${proof.sentence}` : ""} I put together a page with your numbers; the link is below. Worth fifteen minutes?`
    : `Hi ${name}, this is ${brand}. We help ${account.industry.toLowerCase()} companies run shipping with a dedicated team instead of more coordinators. I put together a short page with an ROI estimate for a company your size. Worth fifteen minutes?`;
  const emailSubject = deep ? `${account.companyName} + ${phrase.replace(/^the /, "")}` : `Shipping operations that scale, for ${account.companyName}`;
  const emailBody = deep
    ? `${name},\n\nSaw ${phrase} at ${account.companyName}. ${angle}.\n\nI recorded a 20-second note and built a page with your numbers (about ${roi.shipmentsPerMonth.toLocaleString()} loads/month): {{page_url}}${proof ? `\n\nRelevant: "${proof.title}" (${proof.value} ${proof.metric.toLowerCase()}).` : ""}\n\nOpen to 15 minutes next week?`
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

export async function generateCopy(account: Account, model: ScoringModel, arms: ExperimentArms, proof: ProofLine | null = null): Promise<CampaignCopy> {
  const template = templateCopy(account, model, arms, proof);
  if (arms.personalization !== "deep") return template;
  const sig = topSignal(account);
  const result = await generateStructured({
    schema: CopySchema,
    effort: "low",
    system:
      `You are the campaign agent for ${config.brandName}, a managed transportation provider for shippers. ` +
      "You write short, specific, non-hypey outbound copy grounded only in the evidence provided. Never invent facts about the prospect. " +
      "Cite a customer result ONLY if one is provided below, exactly as given; otherwise make no customer claims or numbers. " +
      "Tone: a sharp operator writing to a peer. No exclamation marks.",
    user:
      `Account: ${account.companyName} (${account.industry}, ${account.employeeCount} employees, ${account.hqCity}, ${account.hqState}).\n` +
      `Contact: ${account.contact ? `${account.contact.name}, ${account.contact.title}` : "unknown"}.\n` +
      `Top signal: ${sig ? `${sig.label} (${sig.status}); evidence: ${sig.evidence.map((e) => e.title).join("; ")}` : "none"}.\n` +
      `Other signals: ${account.signals.filter((s) => s !== sig).map((s) => s.label).join("; ") || "none"}.\n` +
      `Messaging angle to use: ${angleFor(account, model, arms.angleVariant)}.\n` +
      `Pain hypothesis: ${account.painHypothesis ?? "n/a"}.\n` +
      `ROI defaults: ${JSON.stringify(roiDefaultsFor(account))}.\n` +
      `Customer proof you may cite (verbatim, or omit): ${proof ? `"${proof.title}": ${proof.value} ${proof.metric}` : "NONE - do not mention any customer result"}.\n` +
      `Template draft (improve, keep the facts): ${JSON.stringify(template)}`,
  });
  if (!result) return template;
  return { ...result, generatedBy: "llm" };
}

// --- Outreach sequence -------------------------------------------------------------

export function buildTouches(account: Account, campaign: Campaign, copy: CampaignCopy, proof: ProofLine | null = null): OutreachTouch[] {
  const base = Date.now();
  // A paused account's sequence starts when the pause ends.
  const start = account.pausedUntil && account.pausedUntil > new Date(base).toISOString() ? new Date(account.pausedUntil).getTime() : base;
  const at = (days: number) => new Date(start + days * 86_400_000).toISOString();
  const page = campaign.pageUrl;
  const name = firstName(account);
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
      body: proof
        ? `${name}, one more data point: "${proof.title}" (${proof.value} ${proof.metric.toLowerCase()}).\n\nThe page has the full story and your ROI estimate: ${page}`
        : `${name}, the page has your ROI estimate, built from the numbers we could see publicly: ${page}\n\nHappy to walk through the assumptions on a short call.`,
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
  const titles: Record<number, string> = { 1: "Intro email", 2: "LinkedIn connection note", 3: "Follow-up email", 4: "InMail", 5: "Break-up email", 6: "Gift" };
  for (const t of touches) {
    t.source = "sequence";
    t.title = titles[t.step] ?? `Step ${t.step}`;
    t.assigneeRepId = account.ownerRepId ?? null;
    t.attempts = 0;
  }
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
      source: "sequence",
      title: "Gift",
      assigneeRepId: account.ownerRepId ?? null,
      attempts: 0,
    });
  }
  return touches;
}

// --- Launch -------------------------------------------------------------------------

/**
 * Build the campaign and its tasks, then attempt the sequence launch. The
 * campaign is "live" only after the outreach provider acknowledges the launch;
 * otherwise it stays "pending" (retried with backoff by the Campaign Agent) or
 * "failed" (needs a person), and the account is not marked campaign_live.
 */
export async function launchCampaign(
  account: Account,
  ctx: { store: Store; providers: Providers; model: ScoringModel; log?: (s: string) => void },
): Promise<Account> {
  // Default arms, then the configuration of whichever Lab arm (control or treatment) the account is in.
  const { assignments, overrides } = await applyExperiments(account);
  const arms: ExperimentArms = { ...assignArms(account.id), ...(overrides as Partial<ExperimentArms>) };
  account = { ...account, experiments: assignments };
  const proof = await loadProofLine(account);
  const copy = await generateCopy(account, ctx.model, arms, proof);
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
    caseStudyId: proof?.storyId ?? "none",
    proofStoryId: proof?.storyId ?? null,
    pageUrl,
    arms,
    launchedAt: nowIso(),
    launchState: "pending",
    launchError: null,
    sequenceId: null,
  };

  await ctx.store.insertOutreach(buildTouches(account, campaign, copy, proof));
  const prepared: Account = { ...account, campaign, messagingAngle: account.messagingAngle ?? campaign.angle };
  return attemptLaunch(ctx.store, ctx.providers, prepared, ctx.log);
}

/** Launch (or retry launching) the sequence under the durable operation `launch:<accountId>`. */
export async function attemptLaunch(store: Store, providers: Providers, account: Account, log?: (s: string) => void): Promise<Account> {
  if (!account.campaign) return account;
  const touches = (await store.listOutreach({ accountId: account.id })).filter((t) => t.source === "sequence" || t.source === undefined);
  const outcome = await runOperation(store, { id: `launch:${account.id}`, kind: "sequence_launch", accountId: account.id, destination: providers.outreach.name, maxAttempts: 5 }, async (key) => {
    const r = await providers.outreach.launchSequence(account, touches, key);
    for (const t of r.touches) await store.updateOutreach(t);
    return { remoteId: r.sequenceId, result: { touches: r.touches.length } };
  });

  if (outcome.state === "succeeded") {
    const live: Account = {
      ...account,
      campaign: { ...account.campaign, launchState: "live", launchError: null, sequenceId: outcome.remoteId ?? account.campaign.sequenceId ?? null },
      status: ["qualified", "scored", "needs_enrichment"].includes(account.status) ? "campaign_live" : account.status,
    };
    if (!outcome.replayed) await logActivity(store, account.id, "campaign", "sequence_live", `Sequence acknowledged by ${providers.outreach.name}${outcome.remoteId ? ` (${outcome.remoteId})` : ""}`);
    return live;
  }
  if (outcome.state === "busy" || outcome.state === "not_due") return account;

  log?.(`sequence launch failed for ${account.slug}: ${outcome.error}`);
  await logActivity(store, account.id, "campaign", "sequence_launch_failed", `Sequence launch failed (attempt ${outcome.attempts})${outcome.retryable ? "; retrying automatically" : "; needs attention"}`, [outcome.error]);
  return {
    ...account,
    campaign: { ...account.campaign, launchState: outcome.retryable ? "pending" : "failed", launchError: outcome.error },
    // Never "campaign_live" without an acknowledged launch.
    status: account.status === "campaign_live" ? "qualified" : account.status,
  };
}
