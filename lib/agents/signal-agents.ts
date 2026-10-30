import { markAgentRun, mergeFacts } from "@/lib/engine/accounts";
import { icpScore } from "@/lib/engine/scoring";
import { SIGNAL_BY_KEY } from "@/lib/engine/signal-catalog";
import type { Account, AgentId, CompanyFacts, Evidence, Person, Signal, SignalType } from "@/lib/types";
import { nowIso } from "@/lib/util";
import { type AgentContext, type AgentDefinition, needsRun } from "./base";

/**
 * The four signal agents (Hiring, Expansion, Technology, Pain-Point) and the
 * ICP agent. Each signal agent:
 *   1. asks its configured collector (Clay, native Claude+web, or the facts
 *      already on the account) for fresh evidence of its signal type,
 *   2. interprets that evidence into canonical signal keys with status
 *      (verified vs hypothesis), confidence and evidence links,
 *   3. replaces the account's signals of that type.
 *
 * Interpretation rules are deterministic and reviewable; the Research agent
 * later validates or rejects them with the LLM.
 */

type SignalAgentType = Extract<SignalType, "hiring" | "expansion" | "technology" | "pain">;

function mk(key: string, status: Signal["status"], confidence: number, detectedAt: string, agent: AgentId, evidence: Evidence[], value?: string | number): Signal {
  const def = SIGNAL_BY_KEY[key];
  return { key, type: def?.type ?? "intent", label: def?.label ?? key, status, confidence, detectedAt, agent, evidence, value };
}

const latest = (dates: string[]) => dates.sort().at(-1) ?? nowIso();

// --- Hiring ----------------------------------------------------------------------

const HIRING_RULES: { key: string; test: RegExp }[] = [
  { key: "hiring:transportation_coordinator", test: /\b(transportation|shipping|logistics|freight)\s+coordinator\b/i },
  { key: "hiring:logistics_manager", test: /\b(logistics|transportation|outbound logistics)\s+manager\b|manager,\s*(outbound )?logistics/i },
  { key: "hiring:dispatcher", test: /\bdispatcher\b/i },
  { key: "hiring:supply_chain_analyst", test: /\b(supply chain|logistics|freight)\s+analyst\b/i },
  { key: "hiring:warehouse_associate", test: /\b(warehouse associate|forklift|shipping & receiving|shipping and receiving)\b/i },
];

export function extractHiring(facts: CompanyFacts): Signal[] {
  const out: Signal[] = [];
  for (const rule of HIRING_RULES) {
    const matches = facts.jobPostings.filter((j) => rule.test.test(j.title));
    if (!matches.length) continue;
    out.push(
      mk(
        rule.key,
        matches.every((m) => m.url) ? "verified" : "hypothesis",
        0.9,
        latest(matches.map((m) => m.postedAt)),
        "hiring",
        matches.map((m) => ({ title: `Job posting: ${m.title}${m.location ? ` (${m.location})` : ""}`, url: m.url, source: "careers page", date: m.postedAt, snippet: m.description })),
        matches.length,
      ),
    );
  }
  return out;
}

// --- Expansion -------------------------------------------------------------------

export function extractExpansion(facts: CompanyFacts): Signal[] {
  const out: Signal[] = [];
  const by = (key: string, items: typeof facts.news) => {
    if (!items.length) return;
    out.push(
      mk(
        key,
        items.every((n) => n.url) ? "verified" : "hypothesis",
        0.85,
        latest(items.map((n) => n.publishedAt)),
        "expansion",
        items.map((n) => ({ title: n.headline, url: n.url, source: "news", date: n.publishedAt, snippet: n.summary })),
      ),
    );
  };
  by("expansion:new_facility", facts.news.filter((n) => n.kind === "facility" || /\b(distribution center|plant|warehouse|facility)\b/i.test(n.headline) && /\b(open|break ground|new)\b/i.test(n.headline)));
  by("expansion:new_market", facts.news.filter((n) => n.kind === "expansion" || /\bexpan(d|sion)\b.*\b(into|region|coast|southeast|west|east|market)\b/i.test(n.headline)));
  by("expansion:acquisition", facts.news.filter((n) => n.kind === "acquisition" || /\b(acqui(re|sition)|merger)\b/i.test(n.headline)));
  by("funding:raised_round", facts.news.filter((n) => n.kind === "funding" || /\b(raises|secures|funding|investment)\b/i.test(n.headline)));
  by("leadership:new_ops_leader", facts.news.filter((n) => n.kind === "leadership" && /\b(operations|supply chain|logistics|coo)\b/i.test(n.headline)));
  return out;
}

// --- Technology ------------------------------------------------------------------

export function extractTechnology(facts: CompanyFacts): Signal[] {
  const out: Signal[] = [];
  const now = nowIso();
  const ev = (t: CompanyFacts["techStack"][number]): Evidence => ({ title: `${t.name} (${t.category})`, url: "", source: t.source });
  const tms = facts.techStack.filter((t) => t.category === "tms");
  const spreadsheet = facts.techStack.filter((t) => t.category === "spreadsheet");
  const erp = facts.techStack.filter((t) => t.category === "erp");

  if (tms.some((t) => /no tms/i.test(t.name))) {
    out.push(mk("technology:no_tms", "hypothesis", 0.7, now, "technology", tms.filter((t) => /no tms/i.test(t.name)).map(ev)));
  } else if (tms.length === 0 && facts.techStack.length > 0) {
    out.push(mk("technology:no_tms", "hypothesis", 0.45, now, "technology", [{ title: "No TMS found in observed stack", url: "", source: "absence of evidence" }]));
  }
  const legacy = tms.filter((t) => /legacy|on-prem|as400|mainframe/i.test(t.name));
  if (legacy.length) out.push(mk("technology:legacy_tms", "verified", 0.75, now, "technology", legacy.map(ev)));
  const modern = tms.filter((t) => /cloud|mercurygate|oracle otm|blue yonder|e2open|manhattan|descartes|uber freight tms/i.test(t.name));
  if (modern.length) out.push(mk("technology:modern_tms", "verified", 0.8, now, "technology", modern.map(ev)));
  if (spreadsheet.length) out.push(mk("technology:spreadsheet_ops", "verified", 0.85, now, "technology", spreadsheet.map(ev)));
  if (erp.some((t) => /sap/i.test(t.name))) out.push(mk("technology:erp_sap", "verified", 0.8, now, "technology", erp.filter((t) => /sap/i.test(t.name)).map(ev)));
  return out;
}

// --- Pain -------------------------------------------------------------------------

const PAIN_THEMES: Record<string, string> = {
  manual_coordination: "pain:manual_coordination",
  carrier_issues: "pain:carrier_issues",
  late_shipments: "pain:late_shipments",
  freight_cost_pressure: "pain:freight_cost_pressure",
};
const PAIN_TEXT_RULES: { key: string; test: RegExp }[] = [
  { key: "pain:manual_coordination", test: /\b(spreadsheet|manual|re-?key|phone|chasing|fire drill)\b/i },
  { key: "pain:carrier_issues", test: /\b(tender rejection|carrier|coverage|capacity)\b/i },
  { key: "pain:late_shipments", test: /\b(late|on-time|escalat)/i },
  { key: "pain:freight_cost_pressure", test: /\b(freight (cost|spend)|transportation spend|cut .* spend)\b/i },
];

export function extractPain(facts: CompanyFacts, hiringSignals: Signal[]): Signal[] {
  const out = new Map<string, Signal>();
  for (const p of facts.painEvidence) {
    const key = PAIN_THEMES[p.theme] ?? PAIN_TEXT_RULES.find((r) => r.test.test(p.text))?.key;
    if (!key) continue;
    const evidence: Evidence = { title: `${p.source}: "${p.text.slice(0, 90)}${p.text.length > 90 ? "…" : ""}"`, url: p.url, source: p.source, date: p.capturedAt, snippet: p.text };
    const existing = out.get(key);
    if (existing) {
      existing.evidence.push(evidence);
      existing.confidence = Math.min(0.95, existing.confidence + 0.05);
    } else {
      out.set(key, mk(key, p.url ? "verified" : "hypothesis", 0.8, p.capturedAt, "pain_point", [evidence]));
    }
  }
  // Hypothesis: heavy coordinator hiring implies manual coordination load even without a quote.
  const coord = hiringSignals.find((s) => s.key === "hiring:transportation_coordinator");
  if (coord && Number(coord.value ?? 0) >= 2 && !out.has("pain:manual_coordination")) {
    out.set(
      "pain:manual_coordination",
      mk("pain:manual_coordination", "hypothesis", 0.5, coord.detectedAt, "pain_point", [
        { title: `Inferred from ${coord.value} open coordinator roles`, url: coord.evidence[0]?.url ?? "", source: "inference from hiring signal" },
      ]),
    );
  }
  return [...out.values()];
}

// --- Factory ---------------------------------------------------------------------

function makeSignalAgent(def: {
  id: AgentId;
  name: string;
  type: SignalAgentType;
  description: string;
  cadenceSeconds: number;
  extract: (facts: CompanyFacts, account: Account) => Signal[];
}): AgentDefinition {
  return {
    id: def.id,
    name: def.name,
    role: `${def.type} signals`,
    description: def.description,
    cadenceSeconds: def.cadenceSeconds,
    step: 2,
    async run(ctx: AgentContext) {
      const accounts = (await ctx.store.listAccounts()).filter((a) => needsRun(a, def.id) && a.status !== "disqualified").slice(0, ctx.batchSize);
      let changed = 0;
      let total = 0;
      for (let account of accounts) {
        const collector = ctx.providers.collectors[def.type];
        if (collector && collector.name !== "mock") {
          try {
            const fresh = await collector.collect(account.facts, def.type);
            if (Object.keys(fresh).length) account = mergeFacts(account, fresh);
          } catch (err) {
            ctx.log(`${def.name}: collector ${collector.name} failed for ${account.slug}: ${(err as Error).message}`);
          }
        }
        const fresh = def.extract(account.facts, account);
        const others = account.signals.filter((s) => s.type !== def.type && !(def.type === "expansion" && (s.type === "funding" || s.type === "leadership")));
        const before = account.signals.filter((s) => !others.includes(s)).map((s) => s.key).sort().join(",");
        const after = fresh.map((s) => s.key).sort().join(",");
        if (before !== after) changed++;
        total += fresh.length;
        await ctx.store.upsertAccount(markAgentRun({ ...account, signals: [...others, ...fresh] }, def.id));
      }
      return { processed: accounts.length, summary: `${accounts.length} accounts scanned, ${total} ${def.type} signals, ${changed} accounts changed` };
    },
  };
}

export const hiringAgent = makeSignalAgent({
  id: "hiring",
  name: "Hiring Agent",
  type: "hiring",
  description: "Monitors job postings for coordination, dispatch and logistics roles and turns them into hiring signals with evidence links.",
  cadenceSeconds: 60,
  extract: (facts) => extractHiring(facts),
});

export const expansionAgent = makeSignalAgent({
  id: "expansion",
  name: "Expansion Agent",
  type: "expansion",
  description: "Tracks facility openings, new markets, acquisitions, funding and leadership changes.",
  cadenceSeconds: 60,
  extract: (facts) => extractExpansion(facts),
});

export const technologyAgent = makeSignalAgent({
  id: "technology",
  name: "Technology Agent",
  type: "technology",
  description: "Investigates TMS / ERP / spreadsheet footprint and flags inferred states as hypotheses rather than facts.",
  cadenceSeconds: 90,
  extract: (facts) => extractTechnology(facts),
});

export const painPointAgent = makeSignalAgent({
  id: "pain_point",
  name: "Pain-Point Agent",
  type: "pain",
  description: "Finds public evidence of coordination load, carrier problems, late shipments and freight cost pressure; infers pain from hiring volume when no quote exists.",
  cadenceSeconds: 90,
  extract: (facts, account) => extractPain(facts, account.signals.filter((s) => s.type === "hiring")),
});

// --- ICP agent -------------------------------------------------------------------

export function pickContact(people: Person[], model: AgentContext["model"]): Person | null {
  if (!people.length) return null;
  const liftOf = (title: string) => model.icp.personas.find((p) => p.name === title && p.n >= 5)?.lift ?? 1;
  const seniorityRank: Record<Person["seniority"], number> = { vp: 5, director: 4, c_level: 3, manager: 2, ic: 1 };
  return [...people].sort((a, b) => liftOf(b.title) - liftOf(a.title) || seniorityRank[b.seniority] - seniorityRank[a.seniority])[0];
}

export const icpAgent: AgentDefinition = {
  id: "icp",
  name: "ICP Agent",
  role: "profile match",
  description: "Matches each company against the learned ideal customer profile, picks the best-fit persona to pursue, and parks clear non-fits.",
  cadenceSeconds: 60,
  step: 2,
  async run(ctx) {
    const accounts = (await ctx.store.listAccounts()).filter((a) => needsRun(a, "icp") || (a.agentRuns.icp ?? "") < ctx.model.trainedAt).slice(0, ctx.batchSize);
    let parked = 0;
    for (const account of accounts) {
      const contact = account.contact ?? pickContact(account.facts.people, ctx.model);
      const topPersona = ctx.model.icp.personas.filter((p) => p.n >= 5)[0]?.name ?? "VP of Transportation";
      const fit = icpScore(
        { signals: [], industry: account.industry, employeeCount: account.employeeCount, contact, peopleCount: account.facts.people.length, painEvidenceCount: 0 },
        ctx.model,
      );
      const trained = ctx.model.baseline.n >= 20;
      let status = account.status;
      if (trained && fit < 20 && (status === "discovered" || status === "scored")) {
        status = "disqualified";
        parked++;
      }
      await ctx.store.upsertAccount(
        markAgentRun(
          {
            ...account,
            contact,
            recommendedPersona: contact && ctx.model.icp.personas.some((p) => p.name === contact.title && p.lift >= 1) ? contact.title : topPersona,
            status,
            missingInfo: status === "disqualified" ? [...new Set([...account.missingInfo, `ICP fit ${Math.round(fit)}/100: outside the historically converting profile`])] : account.missingInfo,
          },
          "icp",
        ),
      );
    }
    return { processed: accounts.length, summary: `${accounts.length} accounts profiled against model v${ctx.model.version}, ${parked} parked as non-fit` };
  },
};
