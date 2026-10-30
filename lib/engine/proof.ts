import { CASE_STUDIES } from "@/lib/content/case-studies";
import { proofStories as proofCol } from "@/lib/store/collections";
import type { Account, ProofStory } from "@/lib/types";
import { nowIso } from "@/lib/util";
import { sizeBandFor } from "./signal-catalog";

/**
 * Customer Proof Library. Stories are tagged by industry, size, challenge and
 * capability; every outcome carries verified=true/false with its source. The
 * seeded stories are synthetic placeholders (placeholder=true, approved=false):
 * they appear only in demo mode and are always labelled as such. Nothing here
 * ever invents a customer result.
 */

const CHALLENGE_BY_SIGNAL: Record<string, string> = {
  "hiring:transportation_coordinator": "manual coordination load",
  "hiring:logistics_manager": "scaling the logistics team",
  "hiring:dispatcher": "dispatch load",
  "expansion:new_facility": "new facility launch",
  "expansion:new_market": "new market coverage",
  "expansion:acquisition": "post-acquisition consolidation",
  "technology:no_tms": "no TMS",
  "technology:legacy_tms": "legacy TMS",
  "technology:spreadsheet_ops": "spreadsheet operations",
  "pain:manual_coordination": "manual coordination load",
  "pain:carrier_issues": "carrier coverage",
  "pain:late_shipments": "on-time delivery",
  "pain:freight_cost_pressure": "freight cost",
};

const CHALLENGE_BY_STUDY: Record<string, string[]> = {
  "steel-fabrication-freight": ["new facility launch", "manual coordination load", "freight cost"],
  "food-distribution-cold-chain": ["carrier coverage", "spreadsheet operations", "manual coordination load"],
  "building-materials-regional-growth": ["new market coverage", "freight cost", "manual coordination load"],
  "industrial-equipment-project-freight": ["on-time delivery", "manual coordination load"],
  "general-manufacturing-coordination": ["spreadsheet operations", "manual coordination load", "freight cost"],
};

export function seedStoriesFromCaseStudies(): ProofStory[] {
  return CASE_STUDIES.map((c) => ({
    id: c.id,
    customer: c.title,
    industry: c.industry,
    sizeBand: "200-999",
    challenges: CHALLENGE_BY_STUDY[c.id] ?? ["manual coordination load"],
    capabilities: ["managed capacity", "tendering and tracking", "exception handling", "freight audit"],
    outcomes: c.metrics.map((m) => ({ metric: m.label, value: m.value, verified: false, source: "placeholder (synthetic)" })),
    quote: c.quote,
    quoteBy: c.quoteBy,
    approved: false,
    placeholder: true,
    updatedAt: nowIso(),
  }));
}

export async function ensureProofSeeded(): Promise<ProofStory[]> {
  const existing = await proofCol.list();
  if (existing.length) return existing;
  const seeded = seedStoriesFromCaseStudies();
  for (const s of seeded) await proofCol.put(s);
  return seeded;
}

export function challengesFor(account: Account): string[] {
  return [...new Set(account.signals.map((s) => CHALLENGE_BY_SIGNAL[s.key]).filter((x): x is string => Boolean(x)))];
}

export interface ProofMatch {
  story: ProofStory;
  score: number;
  reasons: string[];
}

/** Rank stories for an account: industry, size band and challenge overlap; approved first; placeholders only in demo mode. */
export function rankProof(account: Account, stories: ProofStory[], opts: { allowPlaceholders: boolean }): ProofMatch[] {
  const challenges = challengesFor(account);
  const band = sizeBandFor(account.employeeCount);
  return stories
    .filter((s) => (s.approved || (opts.allowPlaceholders && s.placeholder)) && (opts.allowPlaceholders || !s.placeholder))
    .map((s) => {
      let score = 0;
      const reasons: string[] = [];
      if (s.industry === account.industry) {
        score += 3;
        reasons.push("same industry");
      }
      if (s.sizeBand === band) {
        score += 1;
        reasons.push("similar size");
      }
      const overlap = s.challenges.filter((c) => challenges.includes(c));
      score += overlap.length * 2;
      if (overlap.length) reasons.push(`same challenge: ${overlap.join(", ")}`);
      if (s.approved) score += 1;
      return { story: s, score, reasons };
    })
    .sort((a, b) => b.score - a.score);
}

export function verifiedOutcomes(story: ProofStory) {
  return story.outcomes.filter((o) => o.verified);
}
