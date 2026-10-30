import type { Store } from "@/lib/store";
import { conversations as convCol, getSettings, reps as repCol } from "@/lib/store/collections";
import type { Account, Conversation, Outcome, PlatformSettings, Rep } from "@/lib/types";

/**
 * Revenue Capacity Intelligence: account supply vs rep capacity, utilization,
 * meetings and opportunities per rep, pipeline generation, cost per
 * opportunity, and the economics of adding a BDR. All figures derive from the
 * store plus the economics settings; the recommendation states its evidence.
 */

export interface RepStats {
  rep: Rep;
  openAccounts: number;
  readyAccounts: number;
  conversations30d: number;
  conversationsPerDay: number;
  utilization: number;
  meetingsBooked30d: number;
  opportunities30d: number;
  pipeline30d: number;
}

export interface CapacityReport {
  windowDays: number;
  supply: { ready: number; unassignedReady: number; needsEnrichment: number; qualifiedTotal: number; weeklyInflow: number };
  reps: RepStats[];
  team: {
    capacityPerDay: number;
    conversationsPerDay: number;
    utilization: number;
    meetingsBooked: number;
    meetingsHeld: number;
    opportunities: number;
    pipeline: number;
    monthlyCost: number;
    costPerMeetingHeld: number | null;
    costPerOpportunity: number | null;
  };
  incremental: {
    extraRepMonthlyCost: number;
    conversationsAdded: number;
    meetingsAdded: number;
    opportunitiesAdded: number;
    pipelineAdded: number;
    paybackMonths: number | null;
    supplyLimited: boolean;
  };
  recommendation: { verdict: "add_capacity" | "hold" | "increase_supply"; headline: string; evidence: string[] };
  generatedAt: string;
}

const WORKDAYS_30 = 21;

export async function capacityReport(store: Store, settingsIn?: PlatformSettings, windowDays = 30): Promise<CapacityReport> {
  const settings = settingsIn ?? (await getSettings());
  const since = new Date(Date.now() - windowDays * 86_400_000).toISOString();
  const [accounts, outcomes, reps, convs] = await Promise.all([store.listAccounts(), store.listOutcomes(), repCol.list(), convCol.list()]);
  const activeReps = reps.filter((r) => r.active);
  const recentOutcomes = outcomes.filter((o) => o.createdAt >= since);
  const recentConvs = convs.filter((c) => c.at >= since);

  const ready = accounts.filter((a) => a.readiness?.ready && !["won", "lost", "disqualified", "meeting_booked"].includes(a.status));
  const needsEnrichment = accounts.filter((a) => a.status === "needs_enrichment").length;
  const weeklyInflow = accounts.filter((a) => a.createdAt >= new Date(Date.now() - 7 * 86_400_000).toISOString()).length;

  const perRep: RepStats[] = activeReps.map((rep) => {
    const own = accounts.filter((a) => a.ownerRepId === rep.id);
    const rc = recentConvs.filter((c: Conversation) => c.repId === rep.id);
    const ownIds = new Set(own.map((a) => a.id));
    const ro = recentOutcomes.filter((o: Outcome) => ownIds.has(o.accountId));
    const meetings = ro.filter((o) => o.outcomeType === "meeting_booked").length;
    const opps = ro.filter((o) => o.outcomeType === "opportunity_created" || o.outcomeType === "deal_won").length;
    const pipeline = ro.filter((o) => o.outcomeType === "opportunity_created" || o.outcomeType === "deal_won").reduce((s, o) => s + (o.value ?? accounts.find((a) => a.id === o.accountId)?.pipelineValue ?? settings.economics.avgOpportunityValue), 0);
    const perDay = rc.length / WORKDAYS_30;
    return {
      rep,
      openAccounts: own.filter((a) => !["won", "lost", "disqualified"].includes(a.status)).length,
      readyAccounts: own.filter((a) => a.readiness?.ready).length,
      conversations30d: rc.length,
      conversationsPerDay: Math.round(perDay * 10) / 10,
      utilization: rep.capacityPerDay ? Math.min(1.5, perDay / rep.capacityPerDay) : 0,
      meetingsBooked30d: meetings,
      opportunities30d: opps,
      pipeline30d: pipeline,
    };
  });

  const capacityPerDay = activeReps.reduce((s, r) => s + r.capacityPerDay, 0);
  const conversationsPerDay = perRep.reduce((s, r) => s + r.conversationsPerDay, 0);
  const meetingsBooked = recentOutcomes.filter((o) => o.outcomeType === "meeting_booked").length;
  const meetingsHeld = Math.round(meetingsBooked * settings.economics.meetingHoldRate);
  const opportunities = recentOutcomes.filter((o) => o.outcomeType === "opportunity_created" || o.outcomeType === "deal_won").length;
  const pipeline = perRep.reduce((s, r) => s + r.pipeline30d, 0);
  const monthlyCost = activeReps.length * settings.economics.repFullyLoadedMonthly + settings.economics.toolingMonthly;
  const utilization = capacityPerDay ? conversationsPerDay / capacityPerDay : 0;

  // Incremental rep: assume the team's conversion rates, bounded by available supply.
  const convPerRepDay = activeReps.length ? conversationsPerDay / activeReps.length : 0;
  const meetingsPerConv = recentConvs.length ? meetingsBooked / recentConvs.length : 0.06;
  const oppsPerMeeting = meetingsBooked ? opportunities / meetingsBooked : 0.4;
  const avgCap = activeReps.length ? capacityPerDay / activeReps.length : 30;
  const addedConvMonthly = Math.max(convPerRepDay, avgCap * 0.7) * WORKDAYS_30;
  const supplyNeeded = addedConvMonthly;
  const unassignedReady = ready.filter((a) => !a.ownerRepId).length;
  const supplyLimited = unassignedReady + weeklyInflow * 4 < supplyNeeded;
  const meetingsAdded = Math.round(addedConvMonthly * meetingsPerConv);
  const oppsAdded = Math.round(meetingsAdded * settings.economics.meetingHoldRate * oppsPerMeeting);
  const pipelineAdded = oppsAdded * settings.economics.avgOpportunityValue;
  const paybackMonths = pipelineAdded > 0 ? Math.round((settings.economics.repFullyLoadedMonthly / (pipelineAdded * 0.25)) * 10) / 10 : null;

  let verdict: CapacityReport["recommendation"]["verdict"] = "hold";
  const evidence: string[] = [
    `${ready.length} accounts ready (${unassignedReady} unassigned); ${needsEnrichment} back in enrichment`,
    `team runs ${conversationsPerDay.toFixed(1)} conversations/day against ${capacityPerDay} capacity (${Math.round(utilization * 100)}% utilization)`,
    `${meetingsBooked} meetings booked, ~${meetingsHeld} held, ${opportunities} opportunities in ${windowDays} days`,
  ];
  let headline = "Hold headcount; utilization has room.";
  if (utilization >= 0.85 && !supplyLimited) {
    verdict = "add_capacity";
    headline = `Add a BDR: reps are at ${Math.round(utilization * 100)}% of capacity and ready supply exceeds what they can work.`;
    evidence.push(`an extra rep would add ~${meetingsAdded} meetings and ~${oppsAdded} opportunities a month (${Math.round(pipelineAdded).toLocaleString()} pipeline)`);
  } else if (utilization >= 0.85 && supplyLimited) {
    verdict = "increase_supply";
    headline = "Increase account supply before adding reps: capacity is tight but ready accounts would run out within a month.";
  } else if (unassignedReady > capacityPerDay * 5) {
    verdict = "add_capacity";
    headline = `Ready accounts are piling up (${unassignedReady} unassigned); current reps cannot work them within a week.`;
  }

  return {
    windowDays,
    supply: { ready: ready.length, unassignedReady, needsEnrichment, qualifiedTotal: accounts.filter((a) => (a.scores?.total ?? 0) >= settings.automation.qualificationThreshold).length, weeklyInflow },
    reps: perRep,
    team: {
      capacityPerDay,
      conversationsPerDay: Math.round(conversationsPerDay * 10) / 10,
      utilization: Math.round(utilization * 100) / 100,
      meetingsBooked,
      meetingsHeld,
      opportunities,
      pipeline,
      monthlyCost,
      costPerMeetingHeld: meetingsHeld ? Math.round(monthlyCost / meetingsHeld) : null,
      costPerOpportunity: opportunities ? Math.round(monthlyCost / opportunities) : null,
    },
    incremental: { extraRepMonthlyCost: settings.economics.repFullyLoadedMonthly, conversationsAdded: Math.round(addedConvMonthly), meetingsAdded, opportunitiesAdded: oppsAdded, pipelineAdded, paybackMonths, supplyLimited },
    recommendation: { verdict, headline, evidence },
    generatedAt: new Date().toISOString(),
  };
}

export function accountPipelineValue(account: Account, settings: PlatformSettings): number {
  // Size-scaled estimate of annual contract value; labelled as an estimate everywhere it is shown.
  const base = settings.economics.avgOpportunityValue;
  const factor = account.employeeCount < 200 ? 0.5 : account.employeeCount < 1000 ? 1 : account.employeeCount < 5000 ? 1.6 : 2.2;
  return Math.round(base * factor);
}
