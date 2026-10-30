import type { Person, ScoreBreakdown, ScoringModel, Signal, Weights } from "@/lib/types";
import { isPhoneVerified } from "./contact";
import { clamp, round } from "@/lib/util";
import { sizeBandFor } from "./signal-catalog";

/**
 * Deterministic scoring. Given an account's signals, firmographics and contact,
 * plus the current learned model, produce the five category sub-scores and the
 * weighted total. Reproducible and auditable; the LLM layer explains the score,
 * it does not produce it.
 */

export const PRIOR_WEIGHTS: Weights = { signal: 0.3, icp: 0.25, pain: 0.2, timing: 0.15, access: 0.1 };

/** Map a conversion lift (ratio vs baseline) to 0..100. lift 1 -> 50, 2 -> ~82, 0.5 -> ~18. */
export function liftToScore(lift: number): number {
  const l = Math.log(Math.max(0.05, lift));
  return 100 / (1 + Math.exp(-2.2 * l));
}

export interface ScoreInput {
  signals: Pick<Signal, "key" | "status" | "confidence" | "detectedAt" | "type">[];
  industry: string;
  employeeCount: number;
  contact: Person | null;
  peopleCount: number;
  painEvidenceCount: number;
  now?: Date;
}

function statusFactor(s: ScoreInput["signals"][number]): number {
  return (s.status === "verified" ? 1 : 0.5) * clamp(s.confidence, 0.2, 1);
}

export function signalScore(input: ScoreInput, model: ScoringModel): number {
  const byKey = new Map(model.signalPatterns.map((p) => [p.key, p]));
  let sum = 0;
  for (const s of input.signals) {
    const p = byKey.get(s.key);
    if (!p) continue;
    if (p.weight <= 0) {
      sum += p.weight * 0.5 * statusFactor(s); // negative evidence counts half
      continue;
    }
    sum += p.weight * statusFactor(s);
  }
  // Saturating: ~one strong verified signal (weight ~0.8) lands around 50; three land near 85.
  return clamp(100 * (1 - Math.exp(-Math.max(0, sum) / 1.15)));
}

export function icpScore(input: ScoreInput, model: ScoringModel): number {
  const ind = model.icp.industries.find((b) => b.name === input.industry);
  const band = sizeBandFor(input.employeeCount);
  const size = model.icp.sizeBands.find((b) => b.name === band);
  const persona = input.contact ? model.icp.personas.find((b) => b.name === input.contact!.title) : undefined;
  const indScore = ind && ind.n >= 5 ? liftToScore(ind.lift) : 50;
  const sizeScore = size && size.n >= 5 ? liftToScore(size.lift) : 50;
  const personaScore = persona && persona.n >= 5 ? liftToScore(persona.lift) : input.contact ? 50 : 40;
  return clamp(0.5 * indScore + 0.3 * sizeScore + 0.2 * personaScore);
}

export function painScore(input: ScoreInput, model: ScoringModel): number {
  const byKey = new Map(model.signalPatterns.map((p) => [p.key, p]));
  let sum = 0;
  for (const s of input.signals) {
    if (s.type !== "pain" && s.type !== "technology") continue;
    const p = byKey.get(s.key);
    const w = p ? Math.max(0.15, p.weight) : 0.25; // unvalidated pain still counts a little
    sum += (s.type === "pain" ? w : w * 0.5) * statusFactor(s);
  }
  sum += Math.min(0.4, input.painEvidenceCount * 0.1);
  return clamp(100 * (1 - Math.exp(-sum / 0.9)));
}

export function timingScore(input: ScoreInput): number {
  const now = (input.now ?? new Date()).getTime();
  let sum = 0;
  for (const s of input.signals) {
    const days = Math.max(0, (now - new Date(s.detectedAt).getTime()) / 86_400_000);
    const recency = Math.exp(-days / 45);
    const urgency = s.type === "expansion" || s.type === "hiring" || s.type === "leadership" ? 1 : s.type === "intent" ? 1.3 : 0.5;
    sum += recency * urgency * statusFactor(s);
  }
  return clamp(100 * (1 - Math.exp(-sum / 1.6)));
}

export function accessScore(input: ScoreInput, model: ScoringModel): number {
  if (!input.contact) return input.peopleCount > 0 ? 25 : 5;
  let score = 40;
  const topPersonas = [...model.icp.personas].filter((p) => p.n >= 5).sort((a, b) => b.lift - a.lift).slice(0, 3);
  if (topPersonas.some((p) => p.name === input.contact!.title)) score += 20;
  else if (input.contact.seniority === "vp" || input.contact.seniority === "director") score += 12;
  if (input.contact.email) score += 10;
  if (input.contact.linkedin) score += 10;
  if (input.contact.phone) score += isPhoneVerified(input.contact) ? 20 : 8;
  return clamp(score);
}

export function totalScore(parts: Omit<ScoreBreakdown, "total">, weights: Weights): number {
  return clamp(
    parts.signal * weights.signal + parts.icp * weights.icp + parts.pain * weights.pain + parts.timing * weights.timing + parts.access * weights.access,
  );
}

export function computeScores(input: ScoreInput, model: ScoringModel): ScoreBreakdown {
  const parts = {
    signal: round(signalScore(input, model)),
    icp: round(icpScore(input, model)),
    pain: round(painScore(input, model)),
    timing: round(timingScore(input)),
    access: round(accessScore(input, model)),
  };
  return { ...parts, total: round(totalScore(parts, model.weights)) };
}

/** Engagement raises priority above the static score, capped at 100. */
export function priorityFrom(total: number, engagementScore: number): number {
  return round(clamp(total + Math.min(30, engagementScore * 0.35)));
}
