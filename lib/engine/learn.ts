import { z } from "zod";
import { generateStructured } from "@/lib/llm";
import type { Store } from "@/lib/store";
import type { HistoricalRecord, IcpBucket, IcpProfile, Playbook, ScoringModel, SignalPattern, Weights } from "@/lib/types";
import { clamp, pointBiserial, round } from "@/lib/util";
import { PRIOR_WEIGHTS, computeScores, type ScoreInput } from "./scoring";
import { INDUSTRIES, PERSONAS, SIGNAL_CATALOG, SIZE_BANDS, signalLabel, signalType, sizeBandFor } from "./signal-catalog";

import { learnBuyingGroups } from "./learn-buying-group";
/**
 * LEARN step. Turns the historical book of business into a scoring model:
 *
 *  1. Signal patterns: for every buying-signal key, conversion rate with vs
 *     without the signal (Laplace-smoothed), lift, and a weight derived from
 *     log-lift and sample size. This is the "compare winners to non-converters"
 *     requirement: a signal that is common among customers but equally common
 *     among non-responders gets lift ~1 and weight ~0.
 *  2. ICP profile: conversion lift by industry, size band and persona.
 *  3. Category weights: start from the spec's priors (30/25/20/15/10) and blend
 *     toward the data-derived predictive power of each category (point-biserial
 *     correlation of the category sub-score with conversion), with the blend
 *     strength growing with sample size.
 *  4. Messaging playbook: angles that appear in converted deals, per signal.
 *     Claude writes the narrative version when a key is available; otherwise a
 *     template version is produced.
 *
 * "Conversion" = closed-won OR meeting booked (the MVP's own success metric).
 */

const MIN_HISTORY = 20;
const UNVALIDATED_WEIGHT = 0.2;

export function isConversion(r: HistoricalRecord): boolean {
  return r.outcome === "won" || r.outcome === "meeting";
}

function laplace(wins: number, n: number): number {
  return (wins + 1) / (n + 2);
}

function normalize(w: Weights): Weights {
  const total = w.signal + w.icp + w.pain + w.timing + w.access || 1;
  return {
    signal: w.signal / total,
    icp: w.icp / total,
    pain: w.pain / total,
    timing: w.timing / total,
    access: w.access / total,
  };
}

function roundWeights(w: Weights): Weights {
  const r: Weights = {
    signal: round(w.signal, 2),
    icp: round(w.icp, 2),
    pain: round(w.pain, 2),
    timing: round(w.timing, 2),
    access: round(w.access, 2),
  };
  const drift = round(1 - (r.signal + r.icp + r.pain + r.timing + r.access), 2);
  if (drift !== 0) {
    const largest = (Object.keys(r) as (keyof Weights)[]).sort((a, b) => r[b] - r[a])[0];
    r[largest] = round(r[largest] + drift, 2);
  }
  return r;
}

// --- Patterns -----------------------------------------------------------------

export function computeSignalPatterns(history: HistoricalRecord[]): SignalPattern[] {
  const keys = new Set<string>(SIGNAL_CATALOG.filter((s) => s.type !== "intent").map((s) => s.key));
  for (const r of history) for (const k of r.signalKeys) keys.add(k);

  const patterns: SignalPattern[] = [];
  for (const key of keys) {
    let withN = 0;
    let withWon = 0;
    let withoutN = 0;
    let withoutWon = 0;
    for (const r of history) {
      const conv = isConversion(r) ? 1 : 0;
      if (r.signalKeys.includes(key)) {
        withN++;
        withWon += conv;
      } else {
        withoutN++;
        withoutWon += conv;
      }
    }
    const rateWith = laplace(withWon, withN);
    const rateWithout = laplace(withoutWon, withoutN);
    const lift = rateWith / rateWithout;
    const confidence = withN >= 3 ? 1 - Math.exp(-withN / 12) : 0;
    const weight = withN >= 3 ? clamp(Math.log2(lift) * confidence, -0.5, 1.2) : UNVALIDATED_WEIGHT;
    patterns.push({
      key,
      label: signalLabel(key),
      type: signalType(key),
      withN,
      withWon,
      withoutN,
      withoutWon,
      rateWith: round(rateWith, 4),
      rateWithout: round(rateWithout, 4),
      lift: round(lift, 3),
      weight: round(weight, 3),
      confidence: round(confidence, 3),
    });
  }
  return patterns.sort((a, b) => b.lift - a.lift);
}

// --- ICP -----------------------------------------------------------------------

function bucketize<T>(history: HistoricalRecord[], keyOf: (r: HistoricalRecord) => string, names: string[], baseline: number): (IcpBucket & T)[] {
  const all = new Set<string>(names);
  for (const r of history) all.add(keyOf(r));
  return [...all]
    .map((name) => {
      const rows = history.filter((r) => keyOf(r) === name);
      const conv = rows.filter(isConversion).length;
      const rate = rows.length ? laplace(conv, rows.length) : baseline;
      return { name, n: rows.length, winRate: round(rate, 4), lift: round(rate / baseline, 3) } as IcpBucket & T;
    })
    .sort((a, b) => b.lift - a.lift);
}

export function computeIcpProfile(history: HistoricalRecord[], baselineRate: number): IcpProfile {
  const industries = bucketize<Record<string, never>>(history, (r) => r.industry, [...INDUSTRIES], baselineRate);
  const sizeBands = bucketize<{ min: number; max: number }>(history, (r) => sizeBandFor(r.employeeCount), SIZE_BANDS.map((b) => b.band), baselineRate).map((b) => {
    const def = SIZE_BANDS.find((s) => s.band === b.name);
    return { ...b, min: def?.min ?? 0, max: def?.max ?? 0 };
  });
  const personas = bucketize<{ seniority: HistoricalRecord["seniority"] }>(history, (r) => r.persona, PERSONAS.map((p) => p.title), baselineRate).map((b) => ({
    ...b,
    seniority: PERSONAS.find((p) => p.title === b.name)?.seniority ?? history.find((r) => r.persona === b.name)?.seniority ?? "manager",
  }));
  return { industries, sizeBands, personas };
}

// --- Category weights ---------------------------------------------------------

function historicalToScoreInput(r: HistoricalRecord): ScoreInput {
  const detectedAt = new Date(new Date(r.firstTouchAt).getTime() - 15 * 86_400_000).toISOString();
  return {
    signals: r.signalKeys.map((key) => ({ key, type: signalType(key), status: "verified", confidence: 1, detectedAt })),
    industry: r.industry,
    employeeCount: r.employeeCount,
    contact: { name: "", title: r.persona, seniority: r.seniority, email: "known" },
    peopleCount: 1,
    painEvidenceCount: r.signalKeys.filter((k) => k.startsWith("pain:")).length,
    now: new Date(r.firstTouchAt),
  };
}

export function computeCategoryCorrelations(history: HistoricalRecord[], provisional: ScoringModel): Weights {
  const ys = history.map((r) => (isConversion(r) ? 1 : 0));
  const parts = history.map((r) => computeScores(historicalToScoreInput(r), provisional));
  return {
    signal: round(pointBiserial(parts.map((p) => p.signal), ys), 3),
    icp: round(pointBiserial(parts.map((p) => p.icp), ys), 3),
    pain: round(pointBiserial(parts.map((p) => p.pain), ys), 3),
    timing: round(pointBiserial(parts.map((p) => p.timing), ys), 3),
    access: round(pointBiserial(parts.map((p) => p.access), ys), 3),
  };
}

export function blendWeights(prior: Weights, correlations: Weights, n: number): Weights {
  const data = normalize({
    signal: Math.max(0.03, correlations.signal),
    icp: Math.max(0.03, correlations.icp),
    pain: Math.max(0.03, correlations.pain),
    timing: Math.max(0.03, correlations.timing),
    access: Math.max(0.03, correlations.access),
  });
  const alpha = Math.min(0.85, n / 400);
  return roundWeights(
    normalize({
      signal: prior.signal * (1 - alpha) + data.signal * alpha,
      icp: prior.icp * (1 - alpha) + data.icp * alpha,
      pain: prior.pain * (1 - alpha) + data.pain * alpha,
      timing: prior.timing * (1 - alpha) + data.timing * alpha,
      access: prior.access * (1 - alpha) + data.access * alpha,
    }),
  );
}

// --- Playbook -----------------------------------------------------------------

export function templatePlaybook(history: HistoricalRecord[], patterns: SignalPattern[], icp: IcpProfile): Playbook {
  const converted = history.filter(isConversion);
  const angles = patterns
    .filter((p) => p.lift >= 1.3 && p.withN >= 5)
    .map((p) => {
      const counts = new Map<string, number>();
      for (const r of converted) {
        if (!r.signalKeys.includes(p.key) || !r.messagingAngle) continue;
        counts.set(r.messagingAngle, (counts.get(r.messagingAngle) ?? 0) + 1);
      }
      const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
      const fallback = SIGNAL_CATALOG.find((s) => s.key === p.key)?.angles[0] ?? `Lead with ${p.label.toLowerCase()}`;
      return { signalKey: p.key, angle: best?.[0] ?? fallback, sampleSize: p.withN, winRate: p.rateWith };
    });
  const topPersonas = icp.personas.filter((p) => p.n >= 5).slice(0, 3);
  const topIndustries = icp.industries.filter((p) => p.n >= 5).slice(0, 3);
  return {
    summary:
      `Best-converting profile: ${topIndustries.map((i) => i.name).join(", ") || "n/a"} companies, ` +
      `${icp.sizeBands.filter((b) => b.n >= 5)[0]?.name ?? "mid-size"} employees, reached through ${topPersonas.map((p) => p.name).join(" / ") || "operations leaders"}. ` +
      `Strongest signals: ${patterns
        .filter((p) => p.withN >= 5)
        .slice(0, 3)
        .map((p) => `${p.label.toLowerCase()} (${p.lift.toFixed(1)}x)`)
        .join(", ")}.`,
    angles,
    personaNotes: topPersonas.map((p) => `${p.name}: ${(p.winRate * 100).toFixed(0)}% conversion (${p.lift.toFixed(1)}x baseline, n=${p.n})`),
    generatedBy: "template",
  };
}

const PlaybookSchema = z.object({
  summary: z.string().describe("3-5 sentences describing the ideal customer and why they buy, grounded in the numbers provided"),
  angles: z.array(z.object({ signalKey: z.string(), angle: z.string().describe("one sentence, how to open with a prospect showing this signal") })),
  personaNotes: z.array(z.string()).describe("one line per persona: who to target and how to talk to them"),
});

export async function llmPlaybook(history: HistoricalRecord[], patterns: SignalPattern[], icp: IcpProfile, template: Playbook): Promise<Playbook> {
  const converted = history.filter(isConversion);
  const anglesSeen = [...new Set(converted.map((r) => r.messagingAngle).filter(Boolean))].slice(0, 40);
  const result = await generateStructured({
    schema: PlaybookSchema,
    effort: "medium",
    system:
      "You are the learning agent of an outbound sales intelligence system for a managed transportation / freight provider. " +
      "You write the messaging playbook strictly from the evidence you are given: signal lifts, ICP buckets, and the angles that appeared in converted deals. " +
      "Do not invent statistics. Keep every angle to one sentence a sales rep could say out loud.",
    user:
      `Signal patterns (key, lift vs baseline, conversions/with, n with):\n` +
      patterns
        .filter((p) => p.withN >= 3)
        .map((p) => `- ${p.key}: lift ${p.lift}, ${p.withWon}/${p.withN}`)
        .join("\n") +
      `\n\nICP buckets (name: lift, n):\nIndustries: ${icp.industries
        .filter((b) => b.n >= 3)
        .map((b) => `${b.name}: ${b.lift} (${b.n})`)
        .join("; ")}\nSize bands: ${icp.sizeBands.map((b) => `${b.name}: ${b.lift} (${b.n})`).join("; ")}\nPersonas: ${icp.personas
        .filter((b) => b.n >= 3)
        .map((b) => `${b.name}: ${b.lift} (${b.n})`)
        .join("; ")}` +
      `\n\nAngles used in converted deals:\n${anglesSeen.map((a) => `- ${a}`).join("\n")}` +
      `\n\nProduce angles for these signal keys: ${template.angles.map((a) => a.signalKey).join(", ")}`,
  });
  if (!result) return template;
  const byKey = new Map(template.angles.map((a) => [a.signalKey, a]));
  return {
    summary: result.summary,
    angles: result.angles
      .filter((a) => byKey.has(a.signalKey))
      .map((a) => ({ ...byKey.get(a.signalKey)!, angle: a.angle })),
    personaNotes: result.personaNotes,
    generatedBy: "llm",
  };
}

// --- Model assembly -----------------------------------------------------------

export function bootstrapModel(version = 1): ScoringModel {
  const patterns = computeSignalPatterns([]);
  return {
    version,
    trainedAt: new Date().toISOString(),
    weights: PRIOR_WEIGHTS,
    priorWeights: PRIOR_WEIGHTS,
    categoryCorrelations: { signal: 0, icp: 0, pain: 0, timing: 0, access: 0 },
    signalPatterns: patterns,
    icp: computeIcpProfile([], 0.1),
    playbook: {
      summary: "No historical data yet. Scoring uses the spec's prior weights and unvalidated signal defaults until outcomes arrive.",
      angles: SIGNAL_CATALOG.filter((s) => s.type !== "intent").map((s) => ({ signalKey: s.key, angle: s.angles[0], sampleSize: 0, winRate: 0 })),
      personaNotes: [],
      generatedBy: "template",
    },
    baseline: { n: 0, wins: 0, meetings: 0, conversionRate: 0 },
    notes: ["bootstrap model: prior weights, no history"],
  };
}

export function computeModel(history: HistoricalRecord[], previous: ScoringModel | null): ScoringModel {
  const version = (previous?.version ?? 0) + 1;
  if (history.length < MIN_HISTORY) {
    const m = bootstrapModel(version);
    m.notes.push(`only ${history.length} historical records (< ${MIN_HISTORY}); priors kept`);
    return m;
  }

  const n = history.length;
  const wins = history.filter((r) => r.outcome === "won").length;
  const meetings = history.filter((r) => r.outcome === "meeting").length;
  const conversionRate = (wins + meetings) / n;

  const signalPatterns = computeSignalPatterns(history);
  const icp = computeIcpProfile(history, Math.max(0.01, conversionRate));
  const provisional: ScoringModel = {
    ...bootstrapModel(version),
    signalPatterns,
    icp,
    weights: PRIOR_WEIGHTS,
  };
  const categoryCorrelations = computeCategoryCorrelations(history, provisional);
  const weights = blendWeights(PRIOR_WEIGHTS, categoryCorrelations, n);
  const playbook = templatePlaybook(history, signalPatterns, icp);
  const buyingGroup = learnBuyingGroups(history);

  const notes: string[] = [
    `trained on ${n} historical records: ${wins} won, ${meetings} meetings, ${history.filter((r) => r.outcome === "lost").length} lost, ${history.filter((r) => r.outcome === "no_response").length} no response`,
    `category predictive power (in-sample correlation with conversion): ${(Object.keys(categoryCorrelations) as (keyof Weights)[])
      .map((k) => `${k} ${categoryCorrelations[k].toFixed(2)}`)
      .join(", ")}`,
  ];
  if (previous && previous.baseline.n > 0) {
    const deltas = (Object.keys(weights) as (keyof Weights)[])
      .map((k) => ({ k, d: round(weights[k] - previous.weights[k], 2) }))
      .filter((x) => Math.abs(x.d) >= 0.01);
    notes.push(deltas.length ? `weights moved: ${deltas.map((x) => `${x.k} ${x.d > 0 ? "+" : ""}${x.d}`).join(", ")}` : "weights unchanged vs previous version");
    const prevLift = new Map(previous.signalPatterns.map((p) => [p.key, p.lift]));
    const newStrong = signalPatterns.filter((p) => p.lift >= 1.5 && p.withN >= 5 && (prevLift.get(p.key) ?? 0) < 1.5);
    if (newStrong.length) notes.push(`new strong patterns: ${newStrong.map((p) => `${p.key} (${p.lift}x)`).join(", ")}`);
    const fed = history.filter((r) => r.source === "loop").length;
    if (fed) notes.push(`${fed} records came from the engine's own outcomes (closed loop)`);
  } else {
    notes.push(`weights vs spec priors: ${(Object.keys(weights) as (keyof Weights)[]).map((k) => `${k} ${PRIOR_WEIGHTS[k]}→${weights[k]}`).join(", ")}`);
  }

  return {
    version,
    trainedAt: new Date().toISOString(),
    weights,
    priorWeights: PRIOR_WEIGHTS,
    categoryCorrelations,
    signalPatterns,
    icp,
    playbook,
    baseline: { n, wins, meetings, conversionRate: round(conversionRate, 4) },
    notes: buyingGroup ? [...notes, `buying groups: ${buyingGroup.overall.n} deals with a recorded group; recommended ${buyingGroup.overall.recommended.size} people overall, ${buyingGroup.segments.length} segments with enough data (associations, not causes)`] : notes,
    buyingGroup,
  };
}

/** Full learn pass: read history, fit, (optionally) have Claude write the playbook, persist. */
export async function learn(store: Store, opts: { useLlm?: boolean } = {}): Promise<ScoringModel> {
  const history = await store.listHistorical();
  const previous = await store.getLatestModel();
  const model = computeModel(history, previous);
  if (opts.useLlm !== false && history.length >= MIN_HISTORY) {
    model.playbook = await llmPlaybook(history, model.signalPatterns, model.icp, model.playbook);
  }
  await store.saveModel(model);
  return model;
}
