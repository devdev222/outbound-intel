import type { Store } from "@/lib/store";
import { experiments as expCol, gifts as giftCol, getSettings } from "@/lib/store/collections";
import type { Account, ArmResult, Experiment, ExperimentResults, ExperimentArm, Outcome, PlatformSettings } from "@/lib/types";
import { hash32, nowIso, uuid } from "@/lib/util";
import { sizeBandFor } from "./signal-catalog";

/**
 * Experimentation Lab. Experiments define a segment, randomized arms (one
 * control) and a primary business metric. Assignment is deterministic per
 * account and experiment, applied when the campaign launches (arm config
 * overrides angle, video type, page format, testimonial, gifting, assessment
 * invitation). Results are measured on meetings held, opportunities and
 * qualified pipeline, never on opens or clicks.
 */

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

/** Assign the account to every running experiment it is eligible for; returns merged arm config overrides. */
export async function applyExperiments(account: Account): Promise<{ assignments: Record<string, string>; overrides: Record<string, unknown> }> {
  const running = (await expCol.list()).filter((e) => e.status === "running");
  const assignments: Record<string, string> = { ...(account.experiments ?? {}) };
  const overrides: Record<string, unknown> = {};
  for (const exp of running) {
    if (!eligible(exp, account)) continue;
    const arm = assignments[exp.id] ? exp.arms.find((a) => a.key === assignments[exp.id]) ?? assignArm(exp, account.id) : assignArm(exp, account.id);
    assignments[exp.id] = arm.key;
    if (!arm.control) Object.assign(overrides, arm.config);
  }
  return { assignments, overrides };
}

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

export async function computeResults(store: Store, exp: Experiment, settingsIn?: PlatformSettings): Promise<ExperimentResults> {
  const settings = settingsIn ?? (await getSettings());
  const accounts = (await store.listAccounts()).filter((a) => a.experiments?.[exp.id]);
  const outcomes = await store.listOutcomes();
  const gifts = (await giftCol.list()).filter((g) => g.status === "delivered" || g.status === "ordered");
  const byAccount = new Map<string, Outcome[]>();
  for (const o of outcomes) byAccount.set(o.accountId, [...(byAccount.get(o.accountId) ?? []), o]);

  const arms: ArmResult[] = exp.arms.map((arm) => {
    const members = accounts.filter((a) => a.experiments?.[exp.id] === arm.key);
    let meetingsBooked = 0;
    let opportunities = 0;
    let pipeline = 0;
    let cost = 0;
    for (const a of members) {
      const os = byAccount.get(a.id) ?? [];
      if (os.some((o) => o.outcomeType === "meeting_booked")) meetingsBooked++;
      if (os.some((o) => o.outcomeType === "opportunity_created" || o.outcomeType === "deal_won")) {
        opportunities++;
        pipeline += a.pipelineValue ?? settings.economics.avgOpportunityValue;
      }
      if (a.campaign?.videoSource === "ai" && a.campaign.videoStatus === "ready") cost += settings.economics.videoCostPerRender;
      cost += gifts.filter((g) => g.accountId === a.id).reduce((s, g) => s + g.amount, 0);
    }
    const meetingsHeld = Math.round(meetingsBooked * settings.economics.meetingHoldRate);
    const numerator = exp.primaryMetric === "meetings_booked" ? meetingsBooked : exp.primaryMetric === "meetings_held" ? meetingsHeld : exp.primaryMetric === "opportunities" ? opportunities : pipeline;
    return {
      armKey: arm.key,
      name: arm.name,
      control: arm.control,
      accounts: members.length,
      meetingsBooked,
      meetingsHeld,
      opportunities,
      qualifiedPipeline: pipeline,
      cost: Math.round(cost),
      conversionRate: members.length ? (exp.primaryMetric === "qualified_pipeline" ? pipeline / members.length : numerator / members.length) : 0,
      costPerOpportunity: opportunities ? Math.round(cost / opportunities) : null,
    };
  });

  const control = arms.find((a) => a.control) ?? arms[0];
  const count = (a: ArmResult) => (exp.primaryMetric === "meetings_booked" ? a.meetingsBooked : exp.primaryMetric === "meetings_held" ? a.meetingsHeld : a.opportunities);
  const comparisons = arms
    .filter((a) => a.armKey !== control.armKey)
    .map((a) => {
      const { z, p } = twoProportionZ(count(a), a.accounts, count(control), control.accounts);
      const base = control.conversionRate || 0;
      const lift = base ? (a.conversionRate - base) / base : a.conversionRate > 0 ? 1 : 0;
      const minN = 30;
      return {
        armKey: a.armKey,
        lift,
        zScore: Math.round(z * 100) / 100,
        pValue: Math.round(p * 1000) / 1000,
        significant: p < 0.05 && a.accounts >= minN && control.accounts >= minN,
        sampleWarning: a.accounts < minN || control.accounts < minN ? `fewer than ${minN} accounts per arm; directional only` : null,
      };
    });
  return { experimentId: exp.id, arms, comparisons, computedAt: nowIso() };
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
  };
}

/** Built-in experiment templates for the Lab's "new experiment" screen. */
export const EXPERIMENT_TEMPLATES: { type: Experiment["type"]; name: string; hypothesis: string; arms: ExperimentArm[]; primaryMetric: Experiment["primaryMetric"] }[] = [
  {
    type: "email",
    name: "Messaging angle A vs B",
    hypothesis: "Opening on the hiring signal books more meetings than opening on cost pressure.",
    arms: [
      { key: "control", name: "Angle A (learned playbook)", share: 0.5, config: {}, control: true },
      { key: "angle_b", name: "Angle B (catalog alternative)", share: 0.5, config: { angleVariant: "B" }, control: false },
    ],
    primaryMetric: "meetings_held",
  },
  {
    type: "video",
    name: "AI video vs rep-recorded video",
    hypothesis: "A rep-recorded clip converts better than the AI render at the same script.",
    arms: [
      { key: "control", name: "AI video", share: 0.5, config: { videoType: "ai" }, control: true },
      { key: "rep", name: "Rep-recorded", share: 0.5, config: { videoType: "rep" }, control: false },
    ],
    primaryMetric: "meetings_held",
  },
  {
    type: "landing_page",
    name: "Personalized page vs direct link",
    hypothesis: "The personalized page lifts qualified pipeline over linking straight to a calendar.",
    arms: [
      { key: "control", name: "Direct link", share: 0.5, config: { contentFormat: "direct_link" }, control: true },
      { key: "page", name: "Personalized page", share: 0.5, config: { contentFormat: "landing_page" }, control: false },
    ],
    primaryMetric: "qualified_pipeline",
  },
  {
    type: "assessment",
    name: "Assessment-led outreach",
    hypothesis: "Inviting prospects to the freight operations assessment produces more held meetings than the standard sequence.",
    arms: [
      { key: "control", name: "Standard sequence", share: 0.5, config: {}, control: true },
      { key: "assessment", name: "Assessment invitation", share: 0.5, config: { assessmentInvite: true }, control: false },
    ],
    primaryMetric: "meetings_held",
  },
  {
    type: "gifting",
    name: "Gift after first engagement",
    hypothesis: "A small compliant gift after engagement increases opportunities created.",
    arms: [
      { key: "control", name: "No gift", share: 0.5, config: { gifting: "control" }, control: true },
      { key: "gift", name: "Gift", share: 0.5, config: { gifting: "gift" }, control: false },
    ],
    primaryMetric: "opportunities",
  },
  {
    type: "testimonial",
    name: "Industry-matched testimonial",
    hypothesis: "An industry-matched customer story on the page beats the generic one.",
    arms: [
      { key: "control", name: "Generic proof", share: 0.5, config: { proofMode: "generic" }, control: true },
      { key: "matched", name: "Matched proof", share: 0.5, config: { proofMode: "matched" }, control: false },
    ],
    primaryMetric: "meetings_held",
  },
];
