import { z } from "zod";
import { config } from "@/lib/config";
import { markAgentRun } from "@/lib/engine/accounts";
import { angleFor } from "@/lib/engine/campaign";
import { computeScores, priorityFrom } from "@/lib/engine/scoring";
import { generateStructured, llmAvailable } from "@/lib/llm";
import type { Account, ScoreBreakdown, ScoringModel } from "@/lib/types";
import { type AgentContext, type AgentDefinition, mapLimit, upstreamChangedSince } from "./base";

/**
 * Scoring Agent: combines everything into the prioritized list. The numbers
 * come from the deterministic model (lib/engine/scoring.ts); Claude writes the
 * explanation, pain hypothesis and messaging angle for the top accounts, and
 * explicitly separates verified signals from hypotheses and missing info.
 */

const ExplainSchema = z.object({
  explanation: z.string().describe("3-5 sentences explaining why the score is what it is, citing the strongest learned patterns and what is missing"),
  painHypothesis: z.string().describe("One sentence: the operational pain we believe exists, phrased as a hypothesis"),
  messagingAngle: z.string().describe("One sentence the rep can open with"),
  recommendedPersona: z.string().describe("Title of the persona to target"),
});

export function templateExplanation(account: Account, scores: ScoreBreakdown, model: ScoringModel): string {
  const byKey = new Map(model.signalPatterns.map((p) => [p.key, p]));
  const strong = account.signals
    .filter((s) => (byKey.get(s.key)?.lift ?? 1) >= 1.4 && s.status === "verified")
    .map((s) => `${s.label.toLowerCase()} (${byKey.get(s.key)!.lift.toFixed(1)}x historical conversion)`);
  const hyp = account.signals.filter((s) => s.status === "hypothesis").map((s) => s.label.toLowerCase());
  const ind = model.icp.industries.find((i) => i.name === account.industry);
  const w = model.weights;
  return (
    `Total ${scores.total}/100 = signals ${scores.signal} x ${w.signal} + ICP ${scores.icp} x ${w.icp} + pain ${scores.pain} x ${w.pain} + timing ${scores.timing} x ${w.timing} + access ${scores.access} x ${w.access} (model v${model.version}). ` +
    (strong.length ? `Strongest verified signals: ${strong.join("; ")}. ` : "No verified high-lift signals yet. ") +
    (ind && ind.n >= 5 ? `${account.industry} converts at ${ind.lift.toFixed(1)}x baseline (n=${ind.n}). ` : `Little history for ${account.industry}. `) +
    (hyp.length ? `Treated as hypotheses pending validation: ${hyp.join("; ")}. ` : "") +
    (account.missingInfo.length ? `Missing: ${account.missingInfo.join("; ")}.` : "")
  );
}

function templatePain(account: Account): string {
  const keys = new Set(account.signals.map((s) => s.key));
  if (keys.has("pain:manual_coordination") || keys.has("hiring:transportation_coordinator")) return "Increasing manual shipment coordination workload as volume grows";
  if (keys.has("expansion:new_facility")) return "A new site will add lanes and carriers faster than the current coordination process can absorb";
  if (keys.has("pain:carrier_issues")) return "Inconsistent carrier coverage is driving spot-market spend and service misses";
  if (keys.has("pain:late_shipments")) return "On-time delivery is slipping because exceptions are found after the fact";
  if (keys.has("technology:spreadsheet_ops") || keys.has("technology:no_tms")) return "Spreadsheet-driven tendering and tracking cannot scale with volume";
  return "Shipping coordination is consuming operations capacity that should go to customers";
}

async function scoreAccount(account: Account, ctx: AgentContext, explainWithLlm: boolean): Promise<Account> {
  const scores = computeScores(
    {
      signals: account.signals,
      industry: account.industry,
      employeeCount: account.employeeCount,
      contact: account.contact,
      peopleCount: account.facts.people.length,
      painEvidenceCount: account.facts.painEvidence.length,
    },
    ctx.model,
  );
  const priority = priorityFrom(scores.total, account.engagementScore);
  const verified = account.signals.filter((s) => s.status === "verified").map((s) => s.label);
  const hypotheses = account.signals.filter((s) => s.status === "hypothesis").map((s) => s.label);
  const defaultAngle = angleFor(account, ctx.model, "A");

  let explanation = templateExplanation(account, scores, ctx.model);
  let painHypothesis = account.painHypothesis ?? templatePain(account);
  let messagingAngle = defaultAngle;
  let recommendedPersona = account.recommendedPersona ?? account.contact?.title ?? "VP of Transportation";

  if (explainWithLlm) {
    const r = await generateStructured({
      schema: ExplainSchema,
      effort: "low",
      system:
        `You are the Scoring Agent for ${config.brandName}'s outbound intelligence engine. You explain scores produced by a learned model; you never change them. ` +
        "Distinguish verified signals from hypotheses, cite the learned lifts you are given, name what is missing, and keep it tight. No marketing language.",
      user:
        `Account: ${account.companyName} (${account.industry}, ${account.employeeCount} employees, ${account.hqCity}, ${account.hqState}).\n` +
        `Scores: ${JSON.stringify(scores)} with weights ${JSON.stringify(ctx.model.weights)} (model v${ctx.model.version}, trained on ${ctx.model.baseline.n} records).\n` +
        `Verified signals: ${verified.join("; ") || "none"}.\nHypotheses: ${hypotheses.join("; ") || "none"}.\nMissing info: ${account.missingInfo.join("; ") || "none"}.\n` +
        `Learned lifts for this account's signals: ${account.signals
          .map((s) => {
            const p = ctx.model.signalPatterns.find((x) => x.key === s.key);
            return `${s.key}=${p ? `${p.lift}x (n=${p.withN})` : "unvalidated"}`;
          })
          .join(", ")}.\n` +
        `Industry lift: ${ctx.model.icp.industries.find((i) => i.name === account.industry)?.lift ?? "n/a"}. Contact: ${account.contact ? `${account.contact.name}, ${account.contact.title}` : "none"}.\n` +
        `Playbook angle for the top signal: ${defaultAngle}. Brief: ${account.brief ?? "n/a"}`,
    });
    if (r) {
      explanation = r.explanation;
      painHypothesis = r.painHypothesis;
      messagingAngle = r.messagingAngle;
      recommendedPersona = r.recommendedPersona;
    }
  }

  const qualifies = scores.total >= config.engine.qualificationThreshold;
  let status = account.status;
  if (status === "discovered" || status === "scored" || status === "qualified") status = qualifies ? "qualified" : "scored";

  return markAgentRun(
    {
      ...account,
      scores,
      priority,
      scoreExplanation: explanation,
      verifiedSignals: verified,
      hypotheses,
      painHypothesis,
      messagingAngle,
      recommendedPersona,
      status,
      modelVersion: ctx.model.version,
    },
    "scoring",
  );
}

export const scoringAgent: AgentDefinition = {
  id: "scoring",
  name: "Scoring Agent",
  role: "prioritization",
  description: "Combines signals, ICP fit, pain, timing and access into a 0-100 score with learned weights; explains every score and separates verified from hypothesized.",
  cadenceSeconds: 30,
  step: 3,
  async run(ctx) {
    const all = await ctx.store.listAccounts();
    const due = all.filter(
      (a) =>
        a.status !== "disqualified" &&
        a.agentRuns.research &&
        (a.scores === null || (a.modelVersion ?? 0) < ctx.model.version || upstreamChangedSince(a, "scoring", ["research", "icp"])),
    );
    const batch = due.slice(0, ctx.batchSize);
    // Deterministic pass first so we know who the top accounts are, then LLM explanations for the top N only.
    const prelim = batch.map((a) => ({
      a,
      total: computeScores(
        { signals: a.signals, industry: a.industry, employeeCount: a.employeeCount, contact: a.contact, peopleCount: a.facts.people.length, painEvidenceCount: a.facts.painEvidence.length },
        ctx.model,
      ).total,
    }));
    const cutoff = [...prelim].sort((x, y) => y.total - x.total)[Math.min(config.llm.explainTopN, prelim.length) - 1]?.total ?? Infinity;
    let qualified = 0;
    let explained = 0;
    await mapLimit(prelim, config.agents.llmConcurrency, async ({ a, total }) => {
      const useLlm = llmAvailable() && total >= cutoff && total >= config.engine.qualificationThreshold - 10;
      const updated = await scoreAccount(a, ctx, useLlm);
      if (useLlm) explained++;
      if (updated.status === "qualified") qualified++;
      await ctx.store.upsertAccount(updated);
    });
    return {
      processed: batch.length,
      summary: `${batch.length} accounts scored with model v${ctx.model.version}, ${qualified} qualified (>= ${config.engine.qualificationThreshold}), ${explained} explained by Claude, ${due.length - batch.length} waiting`,
    };
  },
};
