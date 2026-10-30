import { z } from "zod";
import { allowPlaceholders, config } from "@/lib/config";
import { generateStructured } from "@/lib/llm";
import type { Providers } from "@/lib/providers";
import type { Store } from "@/lib/store";
import { getSettings, proofStories, reps as repCol } from "@/lib/store/collections";
import type { Account, BuyingContact, Campaign, CampaignDefaults, CompanyPlaybook, ExperimentArms, MessageTemplate, OutreachTouch, ProofStory, RoiDefaults, ScoringModel, Sequence, Signal } from "@/lib/types";
import { nowIso, pageTokenFor, uuid } from "@/lib/util";
import { logActivity } from "./activity";
import { applyExperiments } from "./experiments";
import { runOperation } from "./operations";
import { getPlaybook, playbookAngle, playbookPrompt } from "./playbook";
import { ROLE_LABEL } from "./buying-group";
import { coordinateSchedule, personalizeForRole, renumber } from "./coordination";
import { BUILTIN_SEQUENCE, loadSequencePlan } from "./sequences";
import { taskUrlFor } from "./tasks";
import { assessmentUrlFor, bookingUrlFor, renderTemplate, templateContext } from "./templates";
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

/**
 * Campaign settings for one account: the team's defaults (Playbook > Campaign
 * defaults), then the configuration of every Lab arm the account is enrolled
 * in. Nothing is randomized outside an experiment, so experiments never
 * confound each other or the baseline.
 */
export function campaignArms(defaults: CampaignDefaults, overrides: Partial<ExperimentArms>): ExperimentArms {
  return { ...defaults, ...overrides };
}

// --- Content ---------------------------------------------------------------------

export function topSignal(account: Account): Signal | null {
  const order = (s: Signal) => (s.status === "verified" ? 1 : 0) * 10 + s.confidence;
  return [...account.signals].filter((s) => s.type !== "intent").sort((a, b) => order(b) - order(a))[0] ?? null;
}

/**
 * Messaging angle. An explicit override (angle experiment arm or a rolled-out
 * winner) wins; variant A is your playbook's angle for the top signal, then the
 * learned one, then the catalog's; variant B is the catalog alternative.
 */
export function angleFor(account: Account, model: ScoringModel, variant: "A" | "B", playbook: CompanyPlaybook | null = null, override: string | null = null): string {
  if (override?.trim()) return override.trim();
  const sig = topSignal(account);
  if (!sig) return "Scale shipping operations without scaling coordination headcount";
  const mine = playbookAngle(playbook, sig.key);
  const learned = model.playbook.angles.find((a) => a.signalKey === sig.key)?.angle;
  const def = SIGNAL_BY_KEY[sig.key]?.angles;
  if (variant === "A") return mine ?? learned ?? def?.[0] ?? `Lead with ${sig.label.toLowerCase()}`;
  return def?.[1] ?? learned ?? mine ?? `Lead with ${sig.label.toLowerCase()}`;
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

export function proofLineFor(account: Account, stories: ProofStory[], mode: "matched" | "generic" | "none" = "matched"): ProofLine | null {
  if (mode === "none") return null;
  const pool = mode === "generic" ? stories.filter((st) => st.industry === "General") : stories;
  for (const match of rankProof(account, pool, { allowPlaceholders: allowPlaceholders() })) {
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

export async function loadProofLine(account: Account, mode: "matched" | "generic" | "none" = account.campaign?.arms.proofMode ?? "matched"): Promise<ProofLine | null> {
  const stories = await ensureProofSeeded();
  return proofLineFor(account, stories.length ? stories : await proofStories.list(), mode);
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

export function templateCopy(account: Account, model: ScoringModel, arms: ExperimentArms, proof: ProofLine | null = null, playbook: CompanyPlaybook | null = null): CampaignCopy {
  const sig = topSignal(account);
  const angle = angleFor(account, model, arms.angleVariant, playbook, arms.angleOverride ?? null);
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

export async function generateCopy(account: Account, model: ScoringModel, arms: ExperimentArms, proof: ProofLine | null = null, playbook: CompanyPlaybook | null = null): Promise<CampaignCopy> {
  const template = templateCopy(account, model, arms, proof, playbook);
  if (arms.personalization !== "deep") return template;
  const sig = topSignal(account);
  const result = await generateStructured({
    schema: CopySchema,
    effort: "low",
    system:
      `You are the campaign agent for ${config.brandName}, a managed transportation provider for shippers. ` +
      "You write short, specific, non-hypey outbound copy grounded only in the evidence provided. Never invent facts about the prospect. " +
      "Cite a customer result ONLY if one is provided below, exactly as given; otherwise make no customer claims or numbers. " +
      "Tone: a sharp operator writing to a peer. No exclamation marks." +
      (playbookPrompt(playbook, { signalKey: sig?.key, contactTitle: account.contact?.title }) ? `\n\n${playbookPrompt(playbook, { signalKey: sig?.key, contactTitle: account.contact?.title })}` : ""),
    user:
      `Account: ${account.companyName} (${account.industry}, ${account.employeeCount} employees, ${account.hqCity}, ${account.hqState}).\n` +
      `Contact: ${account.contact ? `${account.contact.name}, ${account.contact.title}` : "unknown"}.\n` +
      `Top signal: ${sig ? `${sig.label} (${sig.status}); evidence: ${sig.evidence.map((e) => e.title).join("; ")}` : "none"}.\n` +
      `Other signals: ${account.signals.filter((s) => s !== sig).map((s) => s.label).join("; ") || "none"}.\n` +
      `Messaging angle to use: ${angleFor(account, model, arms.angleVariant, playbook, arms.angleOverride ?? null)}.\n` +
      `Pain hypothesis: ${account.painHypothesis ?? "n/a"}.\n` +
      `ROI defaults: ${JSON.stringify(roiDefaultsFor(account))}.\n` +
      `Customer proof you may cite (verbatim, or omit): ${proof ? `"${proof.title}": ${proof.value} ${proof.metric}` : "NONE - do not mention any customer result"}.\n` +
      `Template draft (improve, keep the facts): ${JSON.stringify(template)}`,
  });
  if (!result) return template;
  return { ...result, generatedBy: "llm" };
}

// --- Outreach sequence -------------------------------------------------------------

export interface TouchPlan {
  sequence: Sequence;
  templates: Map<string, MessageTemplate>;
  skipped: { step: number; reason: string }[];
  repName?: string | null;
}

/** Engine-written content for a step, by channel and position among the sequence's emails. */
function engineStep(
  channel: Sequence["steps"][number]["channel"],
  emailIndex: number,
  emailCount: number,
  c: { account: Account; campaign: Campaign; copy: CampaignCopy; proof: ProofLine | null; link: string; direct: boolean },
): { subject?: string; body: string } {
  const name = firstName(c.account);
  const phrase = signalPhrase(topSignal(c.account), c.account);
  const sub = c.copy.emailSubject;
  switch (channel) {
    case "email":
      if (emailIndex === 0) {
        if (c.direct) return { subject: sub, body: `${name},\n\nSaw ${phrase} at ${c.account.companyName}. ${c.campaign.angle}.\n\nIf it is worth 15 minutes, pick a time here: ${c.link}` };
        return { subject: sub, body: c.copy.emailBody.split("{{page_url}}").join(c.link) };
      }
      if (emailIndex === emailCount - 1 && emailCount > 1) return { subject: `Closing the loop, ${c.account.companyName}`, body: `${name}, I will stop here. If ${phrase} becomes a priority, ${c.direct ? "my calendar stays open" : "the page stays live"}: ${c.link}` };
      return {
        subject: `Re: ${sub}`,
        body: c.proof
          ? `${name}, one more data point: "${c.proof.title}" (${c.proof.value} ${c.proof.metric.toLowerCase()}).\n\n${c.direct ? "Happy to walk through it" : "The page has the full story and your ROI estimate"}: ${c.link}`
          : `${name}, ${c.direct ? "happy to walk through the numbers we could see publicly" : "the page has your ROI estimate, built from the numbers we could see publicly"}: ${c.link}\n\nHappy to walk through the assumptions on a short call.`,
      };
    case "linkedin":
      return { body: `${name}, sent you a short note on ${phrase}. Would value connecting either way.` };
    case "inmail":
      return { body: `${name}, in case email is noisy: ${c.direct ? "15 minutes on" : "20-second note and your numbers on"} ${phrase} here: ${c.link}. Happy to send a calendar link.` };
    case "call":
      return { body: `Call ${name} about ${phrase}. Open with: ${c.campaign.angle}.${c.proof ? `\nProof to cite: ${c.proof.sentence}` : ""}\nPage: ${c.campaign.pageUrl}` };
    case "gift":
      return { body: "Send the gift after the first meaningful engagement (tracked separately for ROI)." };
    default:
      return { body: "" };
  }
}

/**
 * Turn the resolved sequence into tasks. Steps with one of your templates are
 * rendered with the account's variables; steps without one (or whose template
 * cannot be used) are written by the engine. Day offsets start after any pause.
 */
export function buildTouches(account: Account, campaign: Campaign, copy: CampaignCopy, proof: ProofLine | null = null, plan?: TouchPlan): OutreachTouch[] {
  const base = Date.now();
  // A paused account's sequence starts when the pause ends.
  const start = account.pausedUntil && account.pausedUntil > new Date(base).toISOString() ? new Date(account.pausedUntil).getTime() : base;
  const at = (days: number) => new Date(start + days * 86_400_000).toISOString();
  const arms = campaign.arms;
  const direct = arms.contentFormat === "direct_link";
  const link = direct ? bookingUrlFor(account) : campaign.pageUrl;
  const sequence = plan?.sequence ?? BUILTIN_SEQUENCE;
  const emailSteps = sequence.steps.map((st, i) => (st.channel === "email" ? i : -1)).filter((i) => i >= 0);
  const firstEmail = emailSteps[0] ?? -1;
  const ctx = templateContext({ account, signal: signalPhrase(topSignal(account), account), angle: campaign.angle, proof: proof?.sentence ?? "", pageUrl: link, repName: plan?.repName, shipmentsPerMonth: campaign.roiDefaults.shipmentsPerMonth });
  const skipped = new Map((plan?.skipped ?? []).map((x) => [x.step, x.reason]));

  const touches: OutreachTouch[] = sequence.steps.map((step, i) => {
    const n = i + 1;
    const tpl = step.templateId ? plan?.templates.get(step.templateId) : undefined;
    let subject: string | undefined;
    let body: string;
    let note: string | undefined;
    if (tpl) {
      const r = renderTemplate(tpl, ctx);
      subject = r.subject ?? undefined;
      body = r.body;
      note = `from template "${tpl.name}"`;
    } else {
      const e = engineStep(step.channel, emailSteps.indexOf(i), emailSteps.length, { account, campaign, copy, proof, link, direct });
      subject = e.subject;
      body = e.body;
      if (skipped.has(n)) note = `${skipped.get(n)}; the engine wrote this step`;
    }
    if (i === firstEmail) {
      if (arms.assessmentInvite && !body.includes("/assess/")) body += `\n\nIf it helps to see the numbers first, here is a 3-minute freight operations assessment for ${account.companyName}: ${assessmentUrlFor(account)}`;
      if (!direct && campaign.videoThumbnailUrl) body += `\n\n[video thumbnail -> ${campaign.pageUrl}#video]`;
    }
    return {
      id: uuid(),
      accountId: account.id,
      channel: step.channel,
      step: n,
      subject,
      body,
      status: "scheduled",
      scheduledFor: at(step.day),
      provider: "pending",
      note,
      source: "sequence",
      title: step.title,
      assigneeRepId: account.ownerRepId ?? null,
      attempts: 0,
    };
  });
  if (arms.gifting === "gift" && !sequence.steps.some((st) => st.channel === "gift")) {
    touches.push({
      id: uuid(),
      accountId: account.id,
      channel: "gift",
      step: touches.length + 1,
      body: "Gift experiment: send after the first meaningful engagement (tracked separately for ROI).",
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
  opts: { revision?: number } = {},
): Promise<Account> {
  // Team defaults, then the configuration of whichever Lab arms (control or treatment) the account is in.
  const [{ assignments, overrides }, settings, playbook] = await Promise.all([applyExperiments(account), getSettings(), getPlaybook()]);
  const arms = campaignArms(settings.defaults, overrides as Partial<ExperimentArms>);
  account = { ...account, experiments: assignments };
  const proof = await loadProofLine(account, arms.proofMode ?? "matched");
  const copy = await generateCopy(account, ctx.model, arms, proof, playbook);
  const plan = await loadSequencePlan(account, arms);
  const repName = account.ownerRepId ? ((await repCol.get(account.ownerRepId))?.name ?? null) : null;
  const pageUrl = pageUrlFor(account);
  const roi = roiDefaultsFor(account);

  // The Video Agent owns the script, the render and the rep brief from here on.
  const campaign: Campaign = {
    headline: copy.headline,
    subheadline: copy.subheadline,
    angle: angleFor(account, ctx.model, arms.angleVariant, playbook, arms.angleOverride ?? null),
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
    sequence: { id: plan.sequence.id, name: plan.sequence.name },
    revision: opts.revision ?? 0,
  };

  // Buying group: one coordinated sequence per selected person (staggered, spaced, personalized by role).
  const group = await ctx.store.listContacts({ accountId: account.id, status: "selected" });
  const touches = group.length
    ? groupTouches(account, campaign, ctx.model, arms, proof, playbook, copy, { ...plan, repName }, group, [])
    : buildTouches(account, campaign, copy, proof, { ...plan, repName }).map((t) => ({ ...t, contactId: account.primaryContactId ?? null }));
  await ctx.store.insertOutreach(touches);
  await logActivity(ctx.store, account.id, "campaign", "sequence_selected", `Sequence "${plan.sequence.name}" (${plan.reason})${group.length > 1 ? ` for ${group.length} people` : ""}`, [
    ...group.map((c) => `${c.outreach.order}. ${c.person.name}, ${c.person.title} (${ROLE_LABEL[c.role].toLowerCase()}) from day ${c.outreach.startDay ?? 0}`),
    ...plan.skipped.map((x) => `step ${x.step}: ${x.reason}; the engine wrote it instead`),
    ...Object.entries(assignments).map(([exp, arm]) => `Lab: experiment ${exp.slice(0, 8)} arm ${arm}`),
  ]);
  const prepared: Account = { ...account, campaign, messagingAngle: account.messagingAngle ?? campaign.angle };
  return attemptLaunch(ctx.store, ctx.providers, prepared, ctx.log);
}

/**
 * Touches for several people at one account. The primary person gets the
 * campaign copy; the others get the template copy written for them. Each
 * sequence starts on its stagger day, is personalized by role, and the whole
 * set is spaced under the account-wide limits.
 */
export function groupTouches(
  account: Account,
  campaign: Campaign,
  model: ScoringModel,
  arms: ExperimentArms,
  proof: ProofLine | null,
  playbook: CompanyPlaybook | null,
  primaryCopy: CampaignCopy,
  plan: TouchPlan,
  group: BuyingContact[],
  existing: OutreachTouch[],
  startFrom = 1,
): OutreachTouch[] {
  const DAY = 86_400_000;
  const baseDay = group.reduce((m, c) => Math.min(m, c.outreach.startDay ?? 0), Infinity);
  const per = group.map((c, i) => {
    const view: Account = { ...account, contact: c.person };
    const copy = i === 0 && c.id === (account.primaryContactId ?? group[0].id) ? primaryCopy : templateCopy(view, model, arms, proof, playbook);
    const offset = ((c.outreach.startDay ?? 0) - (Number.isFinite(baseDay) ? baseDay : 0)) * DAY;
    const touches = buildTouches(view, campaign, copy, proof, plan).map((t) => ({ ...t, scheduledFor: new Date(new Date(t.scheduledFor).getTime() + offset).toISOString(), taskUrl: taskUrlFor(view, t.channel) }));
    return { contactId: c.id, touches: personalizeForRole(touches, c) };
  });
  return renumber(coordinateSchedule(per, existing), startFrom);
}

/**
 * Selected people with no sequence yet (a replacement, a referral, or a
 * contact verified after launch) get theirs, spaced around what is already
 * scheduled, under a per-person durable launch `launch:<accountId>:c:<contactId>`.
 */
export async function extendGroupOutreach(account: Account, ctx: { store: Store; providers: Providers; model: ScoringModel; log?: (s: string) => void }): Promise<number> {
  if (!account.campaign || account.campaign.launchState !== "live" || ["won", "lost", "disqualified", "meeting_booked"].includes(account.status)) return 0;
  const tasks = await ctx.store.listOutreach({ accountId: account.id });
  const group = (await ctx.store.listContacts({ accountId: account.id, status: "selected" })).filter((c) => !tasks.some((t) => t.contactId === c.id && (t.source === "sequence" || t.source === undefined)));
  if (!group.length) return 0;
  const [settings, playbook] = await Promise.all([getSettings(), getPlaybook()]);
  const arms = account.campaign.arms ?? campaignArms(settings.defaults, {});
  const proof = await loadProofLine(account, arms.proofMode ?? "matched");
  const plan = await loadSequencePlan(account, arms);
  const repName = account.ownerRepId ? ((await repCol.get(account.ownerRepId))?.name ?? null) : null;
  const now = Date.now();
  const staged = group.map((c, i) => ({ ...c, outreach: { ...c.outreach, startDay: i * 2 } }));
  const fresh = groupTouches(account, account.campaign, ctx.model, arms, proof, playbook, templateCopy(account, ctx.model, arms, proof, playbook), { ...plan, repName }, staged, tasks.filter((t) => t.scheduledFor >= new Date(now - 7 * 86_400_000).toISOString()), Math.max(0, ...tasks.map((t) => (t.step < 90 ? t.step : 0))) + 1);
  await ctx.store.insertOutreach(fresh);
  for (const c of group) await logActivity(ctx.store, account.id, "campaign", "sequence_extended", `${c.person.name} (${ROLE_LABEL[c.role].toLowerCase()}) added to outreach: ${fresh.filter((t) => t.contactId === c.id).length} steps`, [c.selectedReason ?? ""]);
  await launchContactSequences(ctx.store, ctx.providers, account);
  return group.length;
}

/**
 * Launch each non-primary person's sequence under their own durable operation
 * `launch:<accountId>:c:<contactId>`; the Sequencer receives that person as
 * the contact. Replays of finished launches are no-ops, so this is safe to
 * call on every tick.
 */
export async function launchContactSequences(store: Store, providers: Providers, account: Account): Promise<number> {
  // Not yet handed to the outreach provider (the account-level launch already took the primary person's steps).
  const tasks = (await store.listOutreach({ accountId: account.id })).filter((t) => t.contactId && t.provider === "pending" && ["scheduled", "awaiting_approval"].includes(t.status) && (t.source === "sequence" || t.source === undefined));
  let launched = 0;
  for (const id of [...new Set(tasks.map((t) => t.contactId!))]) {
    const c = await store.getContact(id);
    if (!c || !["selected", "paused"].includes(c.status)) continue;
    const mine = tasks.filter((t) => t.contactId === id);
    const outcome = await runOperation(store, { id: `launch:${account.id}:c:${id}`, kind: "sequence_launch", accountId: account.id, destination: providers.outreach.name, maxAttempts: 5 }, async (key) => {
      const r = await providers.outreach.launchSequence({ ...account, contact: c.person }, mine, key);
      for (const t of r.touches) await store.updateOutreach(t);
      return { remoteId: r.sequenceId, result: { touches: r.touches.length } };
    });
    if (outcome.state === "succeeded" && !outcome.replayed) launched++;
    if (outcome.state === "failed") await logActivity(store, account.id, "campaign", "sequence_launch_failed", `Sequence for ${c.person.name} could not be launched${outcome.retryable ? "; retrying automatically" : "; needs attention"}`, [outcome.error]);
  }
  return launched;
}

/** Launch (or retry launching) the sequence under the durable operation `launch:<accountId>`. */
export async function attemptLaunch(store: Store, providers: Providers, account: Account, log?: (s: string) => void): Promise<Account> {
  if (!account.campaign) return account;
  // The account-level launch carries the primary person; everyone else launches under their own operation.
  const touches = (await store.listOutreach({ accountId: account.id })).filter((t) => (t.source === "sequence" || t.source === undefined) && (!t.contactId || t.contactId === account.primaryContactId));
  const rev = account.campaign.revision ?? 0;
  const outcome = await runOperation(store, { id: rev ? `launch:${account.id}:r${rev}` : `launch:${account.id}`, kind: "sequence_launch", accountId: account.id, destination: providers.outreach.name, maxAttempts: 5 }, async (key) => {
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
    await launchContactSequences(store, providers, account);
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

// --- Preview (no side effects) --------------------------------------------------------

export interface PreviewStep {
  step: number;
  day: number;
  channel: OutreachTouch["channel"];
  title: string;
  subject: string | null;
  body: string;
  source: string;
}

/**
 * Render a sequence for one account exactly as a launch would (minus Claude,
 * so it is instant and free), without writing anything. Draft templates are
 * shown so the team can review them before approving.
 */
export async function previewSequence(account: Account, sequence: Sequence, model: ScoringModel): Promise<PreviewStep[]> {
  const [settings, playbook, all] = await Promise.all([getSettings(), getPlaybook(), import("@/lib/store/collections").then((m) => m.messageTemplates.list())]);
  const arms = campaignArms(settings.defaults, {});
  const proof = await loadProofLine(account, arms.proofMode ?? "matched");
  const copy = templateCopy(account, model, arms, proof, playbook);
  const templates = new Map(all.filter((t) => t.status !== "archived").map((t) => [t.id, t]));
  const campaign: Campaign = {
    headline: copy.headline,
    subheadline: copy.subheadline,
    angle: angleFor(account, model, arms.angleVariant, playbook, arms.angleOverride ?? null),
    persona: account.contact?.title ?? "",
    videoScript: copy.videoScript,
    videoStatus: "pending",
    roiDefaults: roiDefaultsFor(account),
    caseStudyId: proof?.storyId ?? "none",
    pageUrl: pageUrlFor(account),
    arms,
    launchedAt: nowIso(),
  };
  const repName = account.ownerRepId ? ((await repCol.get(account.ownerRepId))?.name ?? null) : null;
  const touches = buildTouches({ ...account, pausedUntil: null }, campaign, copy, proof, { sequence, templates, skipped: [], repName });
  return touches.map((t, i) => {
    const st = sequence.steps[i];
    const tpl = st?.templateId ? templates.get(st.templateId) : undefined;
    return {
      step: t.step,
      day: st?.day ?? 3,
      channel: t.channel,
      title: t.title ?? `Step ${t.step}`,
      subject: t.subject ?? null,
      body: t.body,
      source: tpl ? `template "${tpl.name}"${tpl.status === "approved" ? "" : " (draft)"}` : st?.templateId ? "template missing: engine copy" : "engine-written",
    };
  });
}

/**
 * After a wrong contact: once research and enrichment put a different, verified
 * contact on file and the account is ready again, rebuild the sequence for that
 * person (new tasks, new launch key) and clear the hold. History is kept.
 */
export async function rebuildForNewContact(account: Account, ctx: { store: Store; providers: Providers; model: ScoringModel; log?: (s: string) => void }): Promise<Account> {
  const revision = (account.campaign?.revision ?? 0) + 1;
  const rebuilt = await launchCampaign({ ...account, contactHold: null }, ctx, { revision });
  const saved = await ctx.store.patchAccount(account.id, (cur) => ({ ...cur, campaign: rebuilt.campaign, status: rebuilt.status, contactHold: null, experiments: rebuilt.experiments }));
  await logActivity(ctx.store, account.id, "campaign", "sequence_rebuilt", `Sequence rebuilt for ${account.contact?.name ?? "the new contact"} (revision ${revision}); outreach hold cleared`);
  return saved ?? rebuilt;
}
