import { z } from "zod";
import { config } from "@/lib/config";
import { generateStructured, llmAvailable } from "@/lib/llm";
import type { Store } from "@/lib/store";
import { capacityReport } from "./capacity";
import { execSummary, type ExecSummary } from "./insights";

/**
 * Conversational revenue intelligence: leadership asks a question in plain
 * language and gets an answer grounded in the store, with the evidence rows
 * that produced it. With Claude the question is answered from a compact data
 * pack; without a key an intent matcher serves the same analyses.
 */

export interface AskAnswer {
  question: string;
  answer: string;
  evidence: { label: string; value: string }[];
  caveats: string[];
  source: "llm" | "rules";
}

function fmtMoney(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}

function dataPack(s: ExecSummary) {
  return {
    window_days: s.windowDays,
    kpis: s.kpis.map((k) => ({ label: k.label, value: k.value, hint: k.hint, estimate: Boolean(k.estimate) })),
    pipeline_flow: s.flow,
    top_signals: s.topSignals,
    best_industries: s.bestIndustries,
    best_personas: s.bestPersonas,
    experiments: s.experiments.map((e) => ({ name: e.name, status: e.status, metric: e.primaryMetric, arms: e.results.arms.map((a) => ({ name: a.name, accounts: a.accounts, meetings_held: a.meetingsHeld, opportunities: a.opportunities, pipeline: a.qualifiedPipeline, cost: a.cost })), comparisons: e.results.comparisons })),
    capacity: { team: s.capacity.team, supply: s.capacity.supply, reps: s.capacity.reps.map((r) => ({ name: r.rep.name, conversations_per_day: r.conversationsPerDay, utilization: r.utilization, meetings: r.meetingsBooked30d, opportunities: r.opportunities30d, pipeline: r.pipeline30d })), recommendation: s.capacity.recommendation },
    recommendations: s.recommendations,
    model: s.model,
    synthetic_data: s.syntheticData,
  };
}

function rulesAnswer(q: string, s: ExecSummary): AskAnswer {
  const t = q.toLowerCase();
  const ev = (label: string, value: string) => ({ label, value });
  const caveats = s.syntheticData ? ["Figures come from the synthetic demo dataset, not production data."] : [];
  const kpi = (key: string) => s.kpis.find((k) => k.key === key)!;

  if (/signal|why.*convert|what works|buying/.test(t)) {
    const top = s.topSignals.slice(0, 3);
    return { question: q, answer: top.length ? `The strongest buying signals right now are ${top.map((x) => `${x.label.toLowerCase()} (${x.lift.toFixed(1)}x baseline, ${x.conversions} converted)`).join("; ")}. Weight them in prospecting and lead with them in messaging.` : "The model has no signal with enough history yet.", evidence: top.map((x) => ev(x.label, `${x.lift.toFixed(2)}x, n=${x.n}`)), caveats, source: "rules" };
  }
  if (/industr|vertical|segment/.test(t)) {
    const top = s.bestIndustries.slice(0, 3);
    return { question: q, answer: top.length ? `Best-performing industries: ${top.map((x) => `${x.name} (${x.lift.toFixed(1)}x, n=${x.n})`).join(", ")}.` : "Not enough industry history yet.", evidence: top.map((x) => ev(x.name, `${x.lift.toFixed(2)}x, n=${x.n}`)), caveats, source: "rules" };
  }
  if (/persona|title|who should|decision/.test(t)) {
    const top = s.bestPersonas.slice(0, 3);
    return { question: q, answer: top.length ? `Highest-converting personas: ${top.map((x) => `${x.name} (${x.lift.toFixed(1)}x)`).join(", ")}.` : "Not enough persona history yet.", evidence: top.map((x) => ev(x.name, `${x.lift.toFixed(2)}x, n=${x.n}`)), caveats, source: "rules" };
  }
  if (/experiment|test|a\/b|variant/.test(t)) {
    const lines = s.experiments.map((e) => {
      const w = e.results.comparisons.find((c) => c.significant);
      return `${e.name}: ${w ? `${e.results.arms.find((a) => a.armKey === w.armKey)?.name} leads by ${Math.round(w.lift * 100)}% (p=${w.pValue})` : "no significant difference yet"} on ${e.primaryMetric.replace(/_/g, " ")}`;
    });
    return { question: q, answer: lines.length ? lines.join(". ") + "." : "No experiments have run yet.", evidence: s.experiments.flatMap((e) => e.results.arms.map((a) => ev(`${e.name} / ${a.name}`, `${a.accounts} accts, ${a.meetingsHeld} held, ${a.opportunities} opps`))), caveats, source: "rules" };
  }
  if (/capacity|hire|headcount|utiliz|rep /.test(t) || /bdr/.test(t)) {
    const c = s.capacity;
    return { question: q, answer: `${c.recommendation.headline} Team utilization is ${Math.round(c.team.utilization * 100)}% (${c.team.conversationsPerDay} of ${c.team.capacityPerDay} conversations per day); ${c.supply.ready} accounts are ready and ${c.supply.needsEnrichment} are back in enrichment. An extra rep would add roughly ${c.incremental.meetingsAdded} meetings and ${c.incremental.opportunitiesAdded} opportunities a month${c.incremental.paybackMonths ? `, paying back in about ${c.incremental.paybackMonths} months` : ""}.`, evidence: [...c.recommendation.evidence.map((e, i) => ev(`evidence ${i + 1}`, e)), ...c.reps.map((r) => ev(r.rep.name, `${r.conversationsPerDay}/day, ${Math.round(r.utilization * 100)}% util, ${r.meetingsBooked30d} meetings, ${r.opportunities30d} opps`))], caveats: [...caveats, "Incremental figures assume current conversion rates hold."], source: "rules" };
  }
  if (/cost|efficien|spend|cac/.test(t)) {
    const c = s.capacity.team;
    return { question: q, answer: c.costPerOpportunity ? `Cost per qualified opportunity is ${fmtMoney(c.costPerOpportunity)} on ${fmtMoney(c.monthlyCost)} monthly team cost; cost per held meeting is ${fmtMoney(c.costPerMeetingHeld ?? 0)}.` : `No opportunities in the window, so cost per opportunity is undefined; monthly team cost is ${fmtMoney(c.monthlyCost)}.`, evidence: [ev("monthly cost", fmtMoney(c.monthlyCost)), ev("meetings held", String(c.meetingsHeld)), ev("opportunities", String(c.opportunities))], caveats: [...caveats, "Team cost uses the economics settings (rep fully loaded cost, tooling)."], source: "rules" };
  }
  if (/pipeline|meeting|opportunit|how are we|performance|summary/.test(t)) {
    return { question: q, answer: `In the last ${s.windowDays} days: ${fmtMoney(kpi("pipeline").value)} qualified pipeline from ${kpi("opps").value} opportunities, ${kpi("meetings").value} meetings booked (${kpi("meetings").hint}), ${fmtMoney(kpi("pipeline_per_bdr").value)} pipeline per BDR.`, evidence: s.kpis.map((k) => ev(k.label, k.format === "currency" ? fmtMoney(k.value) : k.format === "pct" ? `${Math.round(k.value * 100)}%` : String(k.value))), caveats: [...caveats, "Pipeline values are size-based estimates until the CRM supplies opportunity amounts."], source: "rules" };
  }
  return { question: q, answer: `Try asking about pipeline, meetings, cost per opportunity, the strongest signals, best industries or personas, experiments, or BDR capacity. ${s.recommendations[0] ? `Top recommendation right now: ${s.recommendations[0].title}.` : ""}`, evidence: s.recommendations.slice(0, 3).map((r) => ev(r.title, r.why)), caveats, source: "rules" };
}

const AnswerSchema = z.object({
  answer: z.string().describe("3-6 sentences, specific numbers, no hedging filler"),
  evidence: z.array(z.object({ label: z.string(), value: z.string() })).describe("the data points the answer rests on"),
  caveats: z.array(z.string()),
});

export async function answerQuestion(store: Store, question: string): Promise<AskAnswer> {
  const summary = await execSummary(store);
  if (!llmAvailable()) return rulesAnswer(question, summary);
  const r = await generateStructured({
    schema: AnswerSchema,
    effort: "medium",
    system: `You answer revenue questions for ${config.brandName}'s leadership using ONLY the data pack provided. Quote the numbers you use. If the data cannot answer the question, say exactly what is missing. Flag estimates and synthetic data. Never invent figures.`,
    user: `Question: ${question}\n\nData pack (JSON):\n${JSON.stringify(dataPack(summary)).slice(0, 60_000)}`,
  });
  if (!r) return rulesAnswer(question, summary);
  return { question, answer: r.answer, evidence: r.evidence, caveats: [...r.caveats, ...(summary.syntheticData ? ["Synthetic demo dataset."] : [])], source: "llm" };
}

export { capacityReport };
