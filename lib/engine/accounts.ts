import type { Account, CompanyFacts } from "@/lib/types";
import { deterministicUuid, nowIso, slugify, uuid } from "@/lib/util";

/**
 * Create a fresh account from discovery output. Synthetic companies get a
 * deterministic id (from their domain) so page tokens are stable across
 * ephemeral instances; real discoveries get a random id.
 */
export function accountFromFacts(facts: CompanyFacts, existingSlugs: Set<string> = new Set()): Account {
  let slug = slugify(facts.companyName);
  let i = 2;
  while (existingSlugs.has(slug)) slug = `${slugify(facts.companyName)}-${i++}`;
  const ts = nowIso();
  return {
    id: facts.source === "synthetic" ? deterministicUuid(`synthetic:${facts.domain}`) : uuid(),
    slug,
    companyName: facts.companyName,
    domain: facts.domain,
    industry: facts.industry,
    employeeCount: facts.employeeCount,
    hqCity: facts.hqCity,
    hqState: facts.hqState,
    facts,
    factsUpdatedAt: ts,
    signals: [],
    scores: null,
    scoreExplanation: null,
    verifiedSignals: [],
    hypotheses: [],
    missingInfo: [],
    painHypothesis: null,
    messagingAngle: null,
    recommendedPersona: null,
    brief: null,
    contact: null,
    campaign: null,
    engagementScore: 0,
    priority: 0,
    status: "discovered",
    modelVersion: null,
    lastAlertAt: null,
    pendingActivation: null,
    agentRuns: {},
    createdAt: ts,
    updatedAt: ts,
  };
}

/** Merge newly collected facts into an account (used by Clay webhooks and native collectors). */
export function mergeFacts(account: Account, incoming: Partial<CompanyFacts>): Account {
  const f = account.facts;
  const dedupe = <T>(arr: T[], keyOf: (t: T) => string) => {
    const seen = new Set<string>();
    return arr.filter((x) => {
      const k = keyOf(x);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  };
  const merged: CompanyFacts = {
    ...f,
    ...Object.fromEntries(Object.entries(incoming).filter(([, v]) => v !== undefined && !Array.isArray(v))),
    jobPostings: dedupe([...(incoming.jobPostings ?? []), ...f.jobPostings], (j) => `${j.title}|${j.url}`),
    news: dedupe([...(incoming.news ?? []), ...f.news], (n) => `${n.headline}|${n.url}`),
    techStack: dedupe([...(incoming.techStack ?? []), ...f.techStack], (t) => t.name.toLowerCase()),
    painEvidence: dedupe([...(incoming.painEvidence ?? []), ...f.painEvidence], (p) => p.text),
    people: dedupe([...(incoming.people ?? []), ...f.people], (p) => p.name.toLowerCase()),
  };
  return {
    ...account,
    facts: merged,
    factsUpdatedAt: nowIso(),
    industry: merged.industry || account.industry,
    employeeCount: merged.employeeCount || account.employeeCount,
    hqCity: merged.hqCity || account.hqCity,
    hqState: merged.hqState || account.hqState,
    updatedAt: nowIso(),
  };
}

export function markAgentRun(account: Account, agentId: string): Account {
  return { ...account, agentRuns: { ...account.agentRuns, [agentId]: nowIso() } };
}
