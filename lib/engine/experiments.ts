import { config } from "@/lib/config";
import type { Store } from "@/lib/store";
import { experiments as expCol, gifts as giftCol, getSettings, messageTemplates, sequences as seqCol, updateSettings } from "@/lib/store/collections";
import type { Account, ArmResult, CampaignDefaults, Experiment, ExperimentArm, ExperimentArms, ExperimentResults, ExperimentType, Outcome, PlatformSettings, Sequence, User } from "@/lib/types";
import { hash32, nowIso, uuid } from "@/lib/util";
import { canonicalOpportunities } from "./opportunities";
import { allSequences, BUILTIN_SEQUENCE, BUILTIN_SEQUENCE_ID, setDefaultSequence } from "./sequences";
import { sizeBandFor } from "./signal-catalog";

/**
 * Experimentation Lab.
 *
 * An experiment answers ONE question by changing ONE kind of campaign setting
 * for a randomized share of new campaigns, then compares business outcomes
 * (meetings, opportunities, pipeline; never opens or clicks).
 *
 *  - Every account launches with the team defaults (Playbook > Campaign
 *    defaults). An enrolled account gets its arm's settings on top, control
 *    arms included, so control = exactly what you do today.
 *  - Each experiment type owns specific settings; two experiments that change
 *    the same setting cannot run at once, so results are never confounded.
 *  - Accounts enroll when their campaign launches (deterministic per account),
 *    so results build up as the team works. Each arm needs a minimum sample
 *    before the Lab will call a direction.
 *  - "Roll out" makes the winning arm the new default: a sequence becomes the
 *    default sequence, a template replaces that step, anything else updates
 *    the campaign defaults.
 */

type DefaultsKey = keyof CampaignDefaults;

export interface ExperimentTypeInfo {
  type: ExperimentType;
  label: string;
  question: string;
  /** Settings this type changes; used for conflict checks. */
  owns: (keyof ExperimentArms)[];
  suggestedMetric: Experiment["primaryMetric"];
}

export const EXPERIMENT_TYPES: ExperimentTypeInfo[] = [
  { type: "sequence", label: "Sequence", question: "Which cadence books more meetings?", owns: ["sequenceId"], suggestedMetric: "meetings_booked" },
  { type: "template", label: "Message template", question: "Which version of one step works better?", owns: ["templateStep", "templateId"], suggestedMetric: "meetings_booked" },
  { type: "angle", label: "Messaging angle", question: "Which opening angle books more meetings?", owns: ["angleVariant", "angleOverride"], suggestedMetric: "meetings_booked" },
  { type: "proof", label: "Customer proof", question: "Does citing a matched customer story help?", owns: ["proofMode"], suggestedMetric: "meetings_booked" },
  { type: "landing_page", label: "Page vs direct link", question: "Does the personalized page beat a straight booking link?", owns: ["contentFormat"], suggestedMetric: "opportunities" },
  { type: "video", label: "Video", question: "Does a rep-recorded video beat the AI render?", owns: ["videoType"], suggestedMetric: "meetings_booked" },
  { type: "assessment", label: "Assessment invite", question: "Does inviting prospects to the freight assessment help?", owns: ["assessmentInvite"], suggestedMetric: "meetings_booked" },
  { type: "gifting", label: "Gift", question: "Does a small gift after engagement create more opportunities?", owns: ["gifting"], suggestedMetric: "opportunities" },
];

export const TYPE_INFO = new Map(EXPERIMENT_TYPES.map((t) => [t.type, t]));
export const DEFAULT_TARGET_PER_ARM = 30;

/** Older experiments used "email" and "testimonial"; read them as today's types. */
export function normalizeExperiment(e: Experiment): Experiment {
  const legacy = e.type as string;
  if (legacy === "email") return { ...e, type: "angle" };
  if (legacy === "testimonial") return { ...e, type: "proof", arms: e.arms.map((a) => ({ ...a, config: { proofMode: a.config.proofMode ?? "matched", ...a.config } })) };
  return e;
}

export async function listExperiments(): Promise<Experiment[]> {
  return (await expCol.list()).map(normalizeExperiment);
}

export async function getExperiment(id: string): Promise<Experiment | null> {
  const e = await expCol.get(id);
  return e ? normalizeExperiment(e) : null;
}

export function ownedKeys(exp: Experiment): string[] {
  return (TYPE_INFO.get(exp.type)?.owns ?? []) as string[];
}

/** A running experiment that changes the same settings, if any. */
export function conflictFor(exp: Experiment, all: Experiment[]): Experiment | null {
  const mine = new Set(ownedKeys(exp));
  return all.find((o) => o.id !== exp.id && o.status === "running" && ownedKeys(o).some((k) => mine.has(k))) ?? null;
}

export function eligible(exp: Experiment, account: Account): boolean {
  const s = exp.segment;
  if (s.industries.length && !s.industries.includes(account.industry)) return false;
  if (s.sizeBands.length && !s.sizeBands.includes(sizeBandFor(account.employeeCount))) return false;
  if (s.signalKeys.length && !account.signals.some((x) => s.signalKeys.includes(x.key) && x.status === "verified")) return false;
  if ((account.scores?.total ?? 0) < s.minScore) return false;
  return true;
}

export function assignArm(exp: Experiment, accountId: string): ExperimentArm {
  const r = (hash32(`${exp.id}:${accountId}`) % 10_000) / 10_000;
  let acc = 0;
  for (const arm of exp.arms) {
    acc += arm.share;
    if (r < acc) return arm;
  }
  return exp.arms[exp.arms.length - 1];
}

/** Assign the account to every running experiment it is eligible for; returns merged arm settings (controls included). */
export async function applyExperiments(account: Account): Promise<{ assignments: Record<string, string>; overrides: Partial<ExperimentArms> }> {
  const running = (await listExperiments()).filter((e) => e.status === "running");
  const assignments: Record<string, string> = { ...(account.experiments ?? {}) };
  const overrides: Partial<ExperimentArms> = {};
  for (const exp of running) {
    if (!eligible(exp, account)) continue;
    const arm = assignments[exp.id] ? (exp.arms.find((a) => a.key === assignments[exp.id]) ?? assignArm(exp, account.id)) : assignArm(exp, account.id);
    assignments[exp.id] = arm.key;
    // Controls apply their config too: control = exactly what the team does today.
    Object.assign(overrides, arm.config);
  }
  return { assignments, overrides };
}

// --- Building experiments from choices ------------------------------------------------------

export interface ExperimentChoices {
  /** sequence: sequence ids to compare against the current default (1-2). */
  sequenceIds?: string[];
  /** template: which step of the default sequence, and challenger template ids (1-2). */
  templateStep?: number;
  templateIds?: string[];
  /** angle: challenger angle sentence, or "catalog" to test the catalog alternative. */
  angle?: string;
  /** proof: include a no-proof arm in addition to generic. */
  includeNoProof?: boolean;
}

export class ExperimentError extends Error {}

async function currentDefaultSequence(): Promise<Sequence> {
  return (await allSequences()).find((s) => s.isDefault && s.status === "active") ?? BUILTIN_SEQUENCE;
}

const arm = (key: string, name: string, cfg: Partial<ExperimentArms>, control = false, share = 0.5): ExperimentArm => ({ key, name, share, config: cfg as Record<string, unknown>, control });

/** Build control + treatment arms for a type from the user's choices. Control always pins today's setting explicitly. */
export async function buildArms(type: ExperimentType, choices: ExperimentChoices, defaults: CampaignDefaults): Promise<{ arms: ExperimentArm[]; name: string; hypothesis: string }> {
  switch (type) {
    case "sequence": {
      const control = await currentDefaultSequence();
      const all = await allSequences();
      const picks = (choices.sequenceIds ?? []).filter((id) => id !== control.id).slice(0, 2);
      if (!picks.length) throw new ExperimentError("pick at least one sequence to compare with the current default");
      const chosen = picks.map((id) => {
        const s = all.find((x) => x.id === id);
        if (!s || s.status === "archived") throw new ExperimentError("a chosen sequence no longer exists");
        return s;
      });
      return {
        arms: [arm("control", `${control.name} (current default)`, { sequenceId: control.id }, true), ...chosen.map((s, i) => arm(`seq_${i + 1}`, s.name, { sequenceId: s.id }))],
        name: `Sequence: ${chosen.map((s) => s.name).join(" / ")} vs ${control.name}`,
        hypothesis: `${chosen.map((s) => `"${s.name}"`).join(" or ")} books more meetings than the current default "${control.name}".`,
      };
    }
    case "template": {
      const seq = await currentDefaultSequence();
      const step = choices.templateStep ?? 1;
      const st = seq.steps[step - 1];
      if (!st) throw new ExperimentError(`the default sequence has no step ${step}`);
      if (st.channel === "gift") throw new ExperimentError("gift steps have no message to test");
      const templates = new Map((await messageTemplates.list()).map((t) => [t.id, t]));
      const picks = (choices.templateIds ?? []).filter((id) => id !== st.templateId).slice(0, 2);
      if (!picks.length) throw new ExperimentError("pick at least one template to compare");
      const chosen = picks.map((id) => {
        const t = templates.get(id);
        if (!t || t.status === "archived") throw new ExperimentError("a chosen template no longer exists");
        if (t.channel !== st.channel) throw new ExperimentError(`"${t.name}" is a ${t.channel} template; step ${step} is ${st.channel}`);
        if (config.mode === "live" && t.status !== "approved") throw new ExperimentError(`approve "${t.name}" first`);
        return t;
      });
      const current = st.templateId ? (templates.get(st.templateId)?.name ?? "current template") : "engine-written copy";
      return {
        arms: [arm("control", `${current} (current)`, { templateStep: step, templateId: st.templateId }, true), ...chosen.map((t, i) => arm(`tpl_${i + 1}`, t.name, { templateStep: step, templateId: t.id }))],
        name: `Step ${step} (${st.title}): ${chosen.map((t) => t.name).join(" / ")} vs ${current}`,
        hypothesis: `For step ${step} of "${seq.name}", ${chosen.map((t) => `"${t.name}"`).join(" or ")} books more meetings than ${current}.`,
      };
    }
    case "angle": {
      const challenger = choices.angle?.trim();
      if (!challenger) throw new ExperimentError("write the challenger angle, or choose the catalog alternative");
      const catalog = challenger === "catalog";
      return {
        arms: [arm("control", "Current angle (your playbook, then learned)", { angleVariant: defaults.angleVariant, angleOverride: defaults.angleOverride }, true), arm("challenger", catalog ? "Catalog alternative angle" : `"${challenger.slice(0, 60)}"`, catalog ? { angleVariant: "B", angleOverride: null } : { angleOverride: challenger })],
        name: catalog ? "Angle: catalog alternative vs current" : `Angle: "${challenger.slice(0, 50)}" vs current`,
        hypothesis: catalog ? "The catalog's alternative angle for each signal books more meetings than our current angle." : `Opening with "${challenger}" books more meetings than our current angle.`,
      };
    }
    case "proof": {
      const arms = [arm("control", "Industry-matched story", { proofMode: "matched" }, true), arm("generic", "General story", { proofMode: "generic" })];
      if (choices.includeNoProof) arms.push(arm("none", "No customer claim", { proofMode: "none" }));
      return { arms, name: "Proof: matched vs general story", hypothesis: "An industry-matched customer story books more meetings than a general one." };
    }
    case "landing_page":
      if (!config.calendly.url) throw new ExperimentError("set NEXT_PUBLIC_CALENDLY_URL first: without a booking link, the direct-link arm would send prospects to the same page");
      return { arms: [arm("control", "Personalized page", { contentFormat: "landing_page" }, true), arm("direct", "Direct booking link", { contentFormat: "direct_link" })], name: "Personalized page vs direct booking link", hypothesis: "Linking to the personalized page creates more opportunities than linking straight to the calendar." };
    case "video":
      return { arms: [arm("control", "AI video", { videoType: "ai" }, true), arm("rep", "Rep-recorded video", { videoType: "rep" })], name: "AI video vs rep-recorded video", hypothesis: "A rep-recorded clip books more meetings than the AI render of the same script." };
    case "assessment":
      return { arms: [arm("control", "No assessment invite", { assessmentInvite: false }, true), arm("invite", "Assessment invite in the first email", { assessmentInvite: true })], name: "Assessment invite in the first email", hypothesis: "Inviting prospects to the freight assessment books more meetings." };
    case "gifting":
      return { arms: [arm("control", "No gift", { gifting: "control" }, true), arm("gift", "Gift after first engagement", { gifting: "gift" })], name: "Gift after first engagement", hypothesis: "A small compliant gift after engagement creates more opportunities." };
  }
}

export function newExperiment(input: Omit<Experiment, "id" | "createdAt" | "startedAt" | "endedAt" | "status"> & { status?: Experiment["status"] }): Experiment {
  const shares = input.arms.reduce((s, a) => s + a.share, 0) || 1;
  return {
    ...input,
    arms: input.arms.map((a) => ({ ...a, share: a.share / shares })),
    id: uuid(),
    status: input.status ?? "draft",
    createdAt: nowIso(),
    startedAt: input.status === "running" ? nowIso() : null,
    endedAt: null,
    targetPerArm: input.targetPerArm ?? DEFAULT_TARGET_PER_ARM,
    rollout: null,
  };
}

// --- Results --------------------------------------------------------------------------------

function erf(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : -y;
}

function twoProportionZ(x1: number, n1: number, x2: number, n2: number): { z: number; p: number } {
  if (n1 === 0 || n2 === 0) return { z: 0, p: 1 };
  const p1 = x1 / n1;
  const p2 = x2 / n2;
  const p = (x1 + x2) / (n1 + n2);
  const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));
  if (se === 0) return { z: 0, p: 1 };
  const z = (p1 - p2) / se;
  const pv = 2 * (1 - 0.5 * (1 + erf(Math.abs(z) / Math.SQRT2)));
  return { z, p: pv };
}

const ENGAGEMENT = new Set(["page_view", "video_play", "video_75", "video_complete", "calculator_completed", "pricing_viewed", "booking_clicked", "email_click", "email_reply", "linkedin_accept", "linkedin_reply", "estimate_submitted"]);

export async function computeResults(store: Store, exp: Experiment, settingsIn?: PlatformSettings): Promise<ExperimentResults> {
  const settings = settingsIn ?? (await getSettings());
  const target = exp.targetPerArm ?? DEFAULT_TARGET_PER_ARM;
  const accounts = (await store.listAccounts()).filter((a) => a.experiments?.[exp.id]);
  const ids = new Set(accounts.map((a) => a.id));
  const [outcomes, events, touches] = await Promise.all([store.listOutcomes(), store.listEvents(), store.listOutreach({ status: ["sent", "done"] })]);
  const gifts = (await giftCol.list()).filter((g) => g.status === "delivered" || g.status === "ordered");
  const byAccount = new Map<string, Outcome[]>();
  for (const o of outcomes) byAccount.set(o.accountId, [...(byAccount.get(o.accountId) ?? []), o]);
  const oppsByAccount = new Map<string, ReturnType<typeof canonicalOpportunities>>();
  for (const o of canonicalOpportunities(outcomes)) oppsByAccount.set(o.accountId, [...(oppsByAccount.get(o.accountId) ?? []), o]);
  const engaged = new Set(events.filter((e) => ids.has(e.accountId) && ENGAGEMENT.has(e.eventType)).map((e) => e.accountId));
  const touched = new Set(touches.filter((t) => ids.has(t.accountId) && t.source === "sequence").map((t) => t.accountId));

  const arms: ArmResult[] = exp.arms.map((a) => {
    const members = accounts.filter((x) => x.experiments?.[exp.id] === a.key);
    let meetingsBooked = 0;
    let opportunities = 0;
    let pipeline = 0;
    let cost = 0;
    for (const m of members) {
      const os = byAccount.get(m.id) ?? [];
      if (os.some((o) => o.outcomeType === "meeting_booked")) meetingsBooked++;
      for (const opp of (oppsByAccount.get(m.id) ?? []).filter((o) => o.stage !== "lost")) {
        opportunities++;
        pipeline += opp.value ?? m.pipelineValue ?? settings.economics.avgOpportunityValue;
      }
      if (m.campaign?.videoSource === "ai" && m.campaign.videoStatus === "ready") cost += settings.economics.videoCostPerRender;
      cost += gifts.filter((g) => g.accountId === m.id).reduce((s, g) => s + g.amount, 0);
    }
    const meetingsHeld = Math.round(meetingsBooked * settings.economics.meetingHoldRate);
    const numerator = exp.primaryMetric === "meetings_booked" ? meetingsBooked : exp.primaryMetric === "meetings_held" ? meetingsHeld : exp.primaryMetric === "opportunities" ? opportunities : pipeline;
    return {
      armKey: a.key,
      name: a.name,
      control: a.control,
      accounts: members.length,
      meetingsBooked,
      meetingsHeld,
      opportunities,
      qualifiedPipeline: pipeline,
      cost: Math.round(cost),
      conversionRate: members.length ? numerator / members.length : 0,
      costPerOpportunity: opportunities ? Math.round(cost / opportunities) : null,
      touched: members.filter((m) => touched.has(m.id)).length,
      engaged: members.filter((m) => engaged.has(m.id)).length,
    };
  });

  const control = arms.find((a) => a.control) ?? arms[0];
  const count = (a: ArmResult) => (exp.primaryMetric === "meetings_booked" ? a.meetingsBooked : exp.primaryMetric === "meetings_held" ? a.meetingsHeld : a.opportunities);
  const comparisons = arms
    .filter((a) => a.armKey !== control.armKey)
    .map((a) => {
      const base = control.conversionRate || 0;
      const lift = base ? (a.conversionRate - base) / base : a.conversionRate > 0 ? 1 : 0;
      // The z-test compares proportions of accounts; it does not fit pipeline value, and meetings held are estimated.
      const testable = exp.primaryMetric === "meetings_booked" || exp.primaryMetric === "opportunities";
      if (!testable) {
        return {
          armKey: a.armKey,
          lift,
          zScore: 0,
          pValue: 1,
          significant: false,
          sampleWarning: exp.primaryMetric === "qualified_pipeline" ? "significance not computed: pipeline value is not a proportion; read the lift as directional" : "significance not computed: meetings held is estimated from bookings; read the lift as directional",
        };
      }
      const { z, p } = twoProportionZ(count(a), a.accounts, count(control), control.accounts);
      return {
        armKey: a.armKey,
        lift,
        zScore: Math.round(z * 100) / 100,
        pValue: Math.round(p * 1000) / 1000,
        significant: p < 0.05 && a.accounts >= target && control.accounts >= target,
        sampleWarning: a.accounts < target || control.accounts < target ? `fewer than ${target} accounts per arm; directional only` : null,
      };
    });
  return { experimentId: exp.id, arms, comparisons, computedAt: nowIso() };
}

export type VerdictState = "not_started" | "collecting" | "no_signal" | "directional" | "significant" | "rolled_out";

export interface Verdict {
  state: VerdictState;
  headline: string;
  detail: string;
  /** Arm currently ahead on the primary metric (or the significant winner). */
  leader: string | null;
  enrolled: number;
  needed: number;
}

/** Plain-language reading of where an experiment stands. */
export function verdictFor(exp: Experiment, results: ExperimentResults | null): Verdict {
  const target = exp.targetPerArm ?? DEFAULT_TARGET_PER_ARM;
  const needed = target * exp.arms.length;
  if (exp.rollout) {
    const a = exp.arms.find((x) => x.key === exp.rollout!.armKey);
    return { state: "rolled_out", headline: `Rolled out: ${a?.name ?? exp.rollout.armKey}`, detail: exp.rollout.applied, leader: exp.rollout.armKey, enrolled: results?.arms.reduce((s, x) => s + x.accounts, 0) ?? 0, needed };
  }
  if (!results || exp.status === "draft") return { state: "not_started", headline: "Not started", detail: "Start it to enroll accounts as their campaigns launch.", leader: null, enrolled: 0, needed };
  const enrolled = results.arms.reduce((s, x) => s + x.accounts, 0);
  const smallest = Math.min(...results.arms.map((x) => x.accounts));
  const sig = results.comparisons.find((c) => c.significant && c.lift > 0);
  if (sig) {
    const a = results.arms.find((x) => x.armKey === sig.armKey)!;
    return { state: "significant", headline: `${a.name} wins`, detail: `+${Math.round(sig.lift * 100)}% on the primary metric (p=${sig.pValue}) with ${smallest}+ accounts per arm. Roll it out to make it the default.`, leader: a.armKey, enrolled, needed };
  }
  const best = [...results.arms].sort((x, y) => y.conversionRate - x.conversionRate)[0];
  const anyOutcome = results.arms.some((x) => x.conversionRate > 0);
  if (smallest < target) {
    return {
      state: "collecting",
      headline: `Collecting: ${enrolled} of ${needed} accounts enrolled`,
      detail: anyOutcome ? `${best.name} is ahead so far, but ${smallest} accounts in the smallest arm is too few to call.` : "No meetings or opportunities in any arm yet.",
      leader: anyOutcome ? best.armKey : null,
      enrolled,
      needed,
    };
  }
  if (!anyOutcome) return { state: "no_signal", headline: "No outcomes yet", detail: "Enough accounts are enrolled, but none has reached the primary metric. Keep it running or pick a metric earlier in the funnel.", leader: null, enrolled, needed };
  const controlArm = results.arms.find((x) => x.control);
  return {
    state: "directional",
    headline: best.control ? "Control is ahead" : `${best.name} is ahead, not yet significant`,
    detail: best.control ? `Nothing beats ${controlArm?.name ?? "the control"} so far. Stop the experiment if that holds.` : "The difference could still be chance. Keep it running, or roll it out if the team accepts the risk.",
    leader: best.armKey,
    enrolled,
    needed,
  };
}

/** How fast an experiment can fill: eligible accounts waiting to launch, and launches per week recently. */
export async function forecast(store: Store, exp: Pick<Experiment, "segment" | "arms" | "targetPerArm">): Promise<{ waiting: number; launchesPerWeek: number; weeksToTarget: number | null }> {
  const accounts = await store.listAccounts();
  const probe = { ...exp, id: "probe", name: "", hypothesis: "", type: "angle", primaryMetric: "meetings_booked", status: "running", createdAt: "", startedAt: null, endedAt: null, createdBy: "" } as Experiment;
  const waiting = accounts.filter((a) => !a.campaign && ["qualified", "scored", "needs_enrichment"].includes(a.status) && eligible(probe, a)).length;
  const twoWeeks = new Date(Date.now() - 14 * 86_400_000).toISOString();
  const launches = accounts.filter((a) => a.campaign && a.campaign.launchedAt >= twoWeeks && eligible(probe, a)).length;
  const launchesPerWeek = Math.round((launches / 2) * 10) / 10;
  const needed = (exp.targetPerArm ?? DEFAULT_TARGET_PER_ARM) * exp.arms.length;
  return { waiting, launchesPerWeek, weeksToTarget: launchesPerWeek > 0 ? Math.ceil(needed / launchesPerWeek) : null };
}

// --- Roll-out -------------------------------------------------------------------------------

const DEFAULT_KEYS: DefaultsKey[] = ["contentFormat", "videoType", "personalization", "angleVariant", "gifting", "proofMode", "assessmentInvite", "angleOverride"];

/** Make an arm the new default and close the experiment. Returns what changed, in words. */
export async function rolloutArm(exp: Experiment, armKey: string, user: Pick<User, "name">): Promise<{ experiment: Experiment; applied: string }> {
  const a = exp.arms.find((x) => x.key === armKey);
  if (!a) throw new ExperimentError("unknown arm");
  const cfg = a.config as Partial<ExperimentArms>;
  let applied: string;
  if (exp.type === "sequence" && cfg.sequenceId) {
    await setDefaultSequence(cfg.sequenceId === BUILTIN_SEQUENCE_ID ? "" : cfg.sequenceId);
    applied = `"${a.name}" is now the default sequence.`;
  } else if (exp.type === "template" && cfg.templateStep) {
    const def = await currentDefaultSequence();
    const steps = def.steps.map((s, i) => (i + 1 === cfg.templateStep ? { ...s, templateId: cfg.templateId ?? null } : s));
    if (def.builtIn) {
      const now = nowIso();
      const copy: Sequence = { ...def, id: uuid(), name: "Default (from Lab roll-out)", builtIn: false, isDefault: false, steps, status: "active", createdBy: user.name, createdAt: now, updatedAt: now };
      await seqCol.put(copy);
      await setDefaultSequence(copy.id);
      applied = `Created "${copy.name}" with "${a.name}" at step ${cfg.templateStep} and made it the default sequence.`;
    } else {
      await seqCol.put({ ...def, steps, updatedAt: nowIso() });
      applied = `Step ${cfg.templateStep} of "${def.name}" now uses "${a.name}".`;
    }
  } else {
    const patch: Partial<CampaignDefaults> = {};
    for (const k of DEFAULT_KEYS) if (k in cfg) (patch as Record<string, unknown>)[k] = (cfg as Record<string, unknown>)[k];
    await updateSettings({ defaults: patch as CampaignDefaults }, user.name);
    applied = `Campaign defaults updated: ${Object.entries(patch)
      .map(([k, v]) => `${k} = ${v === null ? "none" : String(v)}`)
      .join(", ")}.`;
  }
  const next: Experiment = { ...exp, status: "completed", endedAt: exp.endedAt ?? nowIso(), rollout: { armKey, at: nowIso(), by: user.name, applied } };
  await expCol.put(next);
  return { experiment: next, applied };
}

/** Describe what an arm changes, in words, for the UI. */
export function describeArm(exp: Experiment, a: ExperimentArm, ctx: { sequences: Sequence[]; templates: Map<string, { name: string }> }): string {
  const c = a.config as Partial<ExperimentArms>;
  switch (exp.type) {
    case "sequence":
      return `Uses sequence "${ctx.sequences.find((s) => s.id === c.sequenceId)?.name ?? c.sequenceId}"`;
    case "template":
      return `Step ${c.templateStep}: ${c.templateId ? `template "${ctx.templates.get(c.templateId)?.name ?? "missing"}"` : "engine-written copy"}`;
    case "angle":
      return c.angleOverride ? `Opens with "${c.angleOverride}"` : c.angleVariant === "B" ? "Catalog alternative angle per signal" : "Your playbook angle, then learned";
    case "proof":
      return c.proofMode === "none" ? "No customer claim" : c.proofMode === "generic" ? "General customer story" : "Industry-matched customer story";
    case "landing_page":
      return c.contentFormat === "direct_link" ? "Links go straight to the booking page" : "Links go to the personalized page";
    case "video":
      return c.videoType === "rep" ? "Rep records the video from the brief" : "AI renders the video";
    case "assessment":
      return c.assessmentInvite ? "First email invites them to the assessment" : "No assessment invite";
    case "gifting":
      return c.gifting === "gift" ? "Gift task after first engagement" : "No gift";
  }
}
