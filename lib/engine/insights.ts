import type { Store } from "@/lib/store";
import { experiments as expCol, getSettings } from "@/lib/store/collections";
import type { Account, ExperimentResults, PlatformSettings, ScoringModel } from "@/lib/types";
import { capacityReport, type CapacityReport } from "./capacity";
import { computeResults } from "./experiments";
import { getOrBootstrapModel } from "@/lib/agents/runtime";

/**
 * Executive insights: outcomes first. Everything is computed from the store;
 * recommendations are rule-based and cite the numbers they rest on.
 */

export interface Kpi {
  key: string;
  label: string;
  value: number;
  format: "currency" | "int" | "pct" | "ratio";
  hint: string;
  estimate?: boolean;
}

export interface Recommendation {
  title: string;
  why: string;
  action: string;
  evidence: string[];
  priority: "high" | "medium" | "low";
}

export interface ExecSummary {
  windowDays: number;
  kpis: Kpi[];
  flow: { stage: string; count: number }[];
  topSignals: { key: string; label: string; lift: number; n: number; conversions: string }[];
  bestIndustries: { name: string; lift: number; n: number }[];
  bestPersonas: { name: string; lift: number; n: number }[];
  experiments: { experimentId: string; name: string; status: string; primaryMetric: string; results: ExperimentResults }[];
  capacity: CapacityReport;
  recommendations: Recommendation[];
  model: { version: number; trainedAt: string; n: number };
  syntheticData: boolean;
  generatedAt: string;
}

export async function execSummary(store: Store, windowDays = 30): Promise<ExecSummary> {
  const settings: PlatformSettings = await getSettings();
  const [accounts, outcomes, model, capacity, exps] = await Promise.all([store.listAccounts(), store.listOutcomes(), getOrBootstrapModel(store), capacityReport(store, undefined, windowDays), expCol.list()]);
  const since = new Date(Date.now() - windowDays * 86_400_000).toISOString();
  const recent = outcomes.filter((o) => o.createdAt >= since);
  const byAccount = new Map(accounts.map((a) => [a.id, a]));

  const meetingsBooked = recent.filter((o) => o.outcomeType === "meeting_booked").length;
  const meetingsHeld = Math.round(meetingsBooked * settings.economics.meetingHoldRate);
  const oppOutcomes = recent.filter((o) => o.outcomeType === "opportunity_created" || o.outcomeType === "deal_won");
  const opportunities = oppOutcomes.length;
  const qualifiedPipeline = oppOutcomes.reduce((s, o) => s + (o.value ?? byAccount.get(o.accountId)?.pipelineValue ?? settings.economics.avgOpportunityValue), 0);
  const reps = Math.max(1, capacity.reps.length);
  const won = recent.filter((o) => o.outcomeType === "deal_won");

  const kpis: Kpi[] = [
    { key: "pipeline", label: "Qualified pipeline", value: qualifiedPipeline, format: "currency", hint: `${opportunities} opportunities in ${windowDays} days`, estimate: oppOutcomes.some((o) => o.value == null) },
    { key: "meetings", label: "Meetings booked / held", value: meetingsBooked, format: "int", hint: `~${meetingsHeld} held at ${Math.round(settings.economics.meetingHoldRate * 100)}% hold rate`, estimate: true },
    { key: "opps", label: "Qualified opportunities", value: opportunities, format: "int", hint: `${won.length} won` },
    { key: "pipeline_per_bdr", label: "Pipeline per BDR", value: Math.round(qualifiedPipeline / reps), format: "currency", hint: `${reps} active reps`, estimate: true },
    { key: "cost_per_opp", label: "Cost per qualified opportunity", value: capacity.team.costPerOpportunity ?? 0, format: "currency", hint: capacity.team.costPerOpportunity ? `on ${capacity.team.monthlyCost.toLocaleString()} monthly team cost` : "no opportunities yet", estimate: true },
    { key: "utilization", label: "BDR utilization", value: capacity.team.utilization, format: "pct", hint: `${capacity.team.conversationsPerDay}/${capacity.team.capacityPerDay} conversations per day` },
  ];

  const stages: Account["status"][] = ["discovered", "scored", "needs_enrichment", "qualified", "campaign_live", "engaged", "hot", "meeting_booked", "won", "lost"];
  const flow = stages.map((s) => ({ stage: s, count: accounts.filter((a) => a.status === s).length }));

  const topSignals = model.signalPatterns
    .filter((p) => p.withN >= 5 && p.lift > 1)
    .slice(0, 6)
    .map((p) => ({ key: p.key, label: p.label, lift: p.lift, n: p.withN, conversions: `${p.withWon}/${p.withN}` }));
  const bestIndustries = model.icp.industries.filter((b) => b.n >= 5).slice(0, 5).map((b) => ({ name: b.name, lift: b.lift, n: b.n }));
  const bestPersonas = model.icp.personas.filter((b) => b.n >= 5).slice(0, 5).map((b) => ({ name: b.name, lift: b.lift, n: b.n }));

  const experiments = await Promise.all(exps.filter((e) => e.status !== "draft").map(async (e) => ({ experimentId: e.id, name: e.name, status: e.status, primaryMetric: e.primaryMetric, results: await computeResults(store, e, settings) })));

  const recommendations = buildRecommendations({ accounts, model, capacity, experiments, settings, meetingsBooked, opportunities });

  return {
    windowDays,
    kpis,
    flow,
    topSignals,
    bestIndustries,
    bestPersonas,
    experiments,
    capacity,
    recommendations,
    model: { version: model.version, trainedAt: model.trainedAt, n: model.baseline.n },
    syntheticData: accounts.some((a) => a.facts.source === "synthetic"),
    generatedAt: new Date().toISOString(),
  };
}

export function buildRecommendations(input: { accounts: Account[]; model: ScoringModel; capacity: CapacityReport; experiments: ExecSummary["experiments"]; settings: PlatformSettings; meetingsBooked: number; opportunities: number }): Recommendation[] {
  const { accounts, model, capacity, experiments } = input;
  const recs: Recommendation[] = [];

  // Capacity
  if (capacity.recommendation.verdict !== "hold") {
    recs.push({ title: capacity.recommendation.verdict === "add_capacity" ? "Add BDR capacity" : "Grow account supply before hiring", why: capacity.recommendation.headline, action: capacity.recommendation.verdict === "add_capacity" ? "Open a BDR requisition; the incremental rep pays back on current conversion rates." : "Raise discovery volume (Clay lists, native collectors) and lower enrichment blockers.", evidence: capacity.recommendation.evidence, priority: "high" });
  }

  // Enrichment backlog
  const blocked = accounts.filter((a) => a.status === "needs_enrichment");
  if (blocked.length >= 5) {
    const reasons = new Map<string, number>();
    for (const a of blocked) for (const b of a.readiness?.blockers ?? []) reasons.set(b.split(":")[0], (reasons.get(b.split(":")[0]) ?? 0) + 1);
    const top = [...reasons.entries()].sort((x, y) => y[1] - x[1])[0];
    recs.push({ title: `${blocked.length} qualified accounts are stuck in enrichment`, why: top ? `Most common blocker: ${top[0]} (${top[1]} accounts).` : "Readiness checks are failing.", action: top?.[0]?.includes("contact") ? "Connect a contact-enrichment source (Clay waterfall) so verified phones and emails fill automatically." : "Review the blockers on the enrichment queue.", evidence: [...reasons.entries()].map(([k, v]) => `${k}: ${v}`), priority: "high" });
  }

  // Signals worth more discovery
  const strong = model.signalPatterns.filter((p) => p.withN >= 8 && p.lift >= 1.6).slice(0, 2);
  for (const p of strong) {
    const live = accounts.filter((a) => a.signals.some((s) => s.key === p.key && s.status === "verified")).length;
    recs.push({ title: `Prospect harder on "${p.label.toLowerCase()}"`, why: `This signal converts at ${p.lift.toFixed(1)}x baseline (${p.withWon}/${p.withN}) but only ${live} live accounts carry it.`, action: "Add a Clay search / native collector pass targeting this signal; prioritize matching accounts in the queue.", evidence: [`lift ${p.lift}`, `${live} current accounts with the signal`], priority: "medium" });
  }

  // Experiments
  for (const e of experiments) {
    const winner = e.results.comparisons.find((c) => c.significant && c.lift > 0);
    const underpowered = e.results.comparisons.find((c) => c.sampleWarning);
    if (winner) {
      const arm = e.results.arms.find((a) => a.armKey === winner.armKey);
      recs.push({ title: `Roll out "${arm?.name}" from ${e.name}`, why: `+${Math.round(winner.lift * 100)}% on ${e.primaryMetric.replace(/_/g, " ")} (p=${winner.pValue}).`, action: "Promote the treatment to the default and close the experiment.", evidence: e.results.arms.map((a) => `${a.name}: ${a.accounts} accounts, ${a.meetingsHeld} held, ${a.opportunities} opps`), priority: "medium" });
    } else if (underpowered && e.status === "running") {
      recs.push({ title: `Keep "${e.name}" running`, why: underpowered.sampleWarning ?? "Not enough accounts per arm yet.", action: "Do not read into the direction until each arm has 30+ accounts.", evidence: e.results.arms.map((a) => `${a.name}: ${a.accounts} accounts`), priority: "low" });
    }
  }

  // Persona
  const persona = model.icp.personas.filter((b) => b.n >= 8).sort((a, b) => b.lift - a.lift)[0];
  const weak = model.icp.personas.filter((b) => b.n >= 8).sort((a, b) => a.lift - b.lift)[0];
  if (persona && weak && persona.lift > 1.3 && weak.lift < 0.8) {
    recs.push({ title: `Route outreach to ${persona.name}, not ${weak.name}`, why: `${persona.name} converts at ${persona.lift.toFixed(1)}x baseline; ${weak.name} at ${weak.lift.toFixed(1)}x.`, action: "Make the ICP agent prefer this persona when several contacts exist.", evidence: [`${persona.name}: n=${persona.n}`, `${weak.name}: n=${weak.n}`], priority: "medium" });
  }

  return recs.slice(0, 6);
}
