import { z } from "zod";
import { config } from "@/lib/config";
import { markAgentRun } from "@/lib/engine/accounts";
import { generateStructured } from "@/lib/llm";
import type { Account, Person, Signal } from "@/lib/types";
import { type AgentContext, type AgentDefinition, mapLimit, upstreamChangedSince } from "./base";
import { pickContact } from "./signal-agents";

/**
 * Research Agent: validates the signal agents' findings, identifies the
 * decision-maker, builds the account brief and lists what is still unknown.
 * With an API key, Claude does the validation against the raw evidence; without
 * one, a deterministic pass produces the same fields from the facts.
 */

const ResearchSchema = z.object({
  brief: z.string().describe("3-4 sentence account brief a rep can read in 20 seconds: who they are, what is happening, why now"),
  decisionMaker: z
    .object({ name: z.string(), title: z.string(), why: z.string() })
    .nullable()
    .describe("Best person to approach from the people list, or null if none fits"),
  validations: z.array(
    z.object({
      signalKey: z.string(),
      verdict: z.enum(["verified", "hypothesis", "reject"]),
      reason: z.string(),
    }),
  ),
  missingInfo: z.array(z.string()).describe("Facts a rep would want that are not in the evidence"),
});

function templateMissing(account: Account): string[] {
  const m: string[] = [];
  if (!account.contact) m.push("No decision-maker identified");
  if (account.contact && !account.contact.email) m.push("Contact email not found");
  if (account.contact && !account.contact.phone) m.push("Contact phone not verified");
  if (!account.facts.estimatedShipmentsPerMonth) m.push("Monthly shipment volume unknown");
  if (!account.facts.techStack.some((t) => t.category === "tms")) m.push("TMS status unconfirmed");
  if (!account.signals.some((s) => s.type === "pain")) m.push("No direct evidence of operational pain");
  return m;
}

function templateBrief(account: Account, contact: Person | null): string {
  const f = account.facts;
  const sig = account.signals.filter((s) => s.status === "verified").map((s) => s.label.toLowerCase());
  const hyp = account.signals.filter((s) => s.status === "hypothesis").map((s) => s.label.toLowerCase());
  return (
    `${account.companyName} is a ${f.industry.toLowerCase()} company (${f.employeeCount.toLocaleString()} employees) based in ${f.hqCity}, ${f.hqState}` +
    `${f.estimatedShipmentsPerMonth ? `, shipping an estimated ${f.estimatedShipmentsPerMonth.toLocaleString()} loads a month` : ""}. ` +
    (sig.length ? `Verified: ${sig.join("; ")}. ` : "No verified buying signals yet. ") +
    (hyp.length ? `Hypotheses to confirm: ${hyp.join("; ")}. ` : "") +
    (contact ? `Best entry point: ${contact.name}, ${contact.title}.` : "No decision-maker identified yet.")
  );
}

async function researchAccount(account: Account, ctx: AgentContext): Promise<Account> {
  const fallbackContact = account.contact ?? pickContact(account.facts.people, ctx.model, account);
  const result = await generateStructured({
    schema: ResearchSchema,
    effort: "low",
    system:
      `You are the Research Agent in an outbound intelligence system for ${config.brandName}, a managed transportation provider selling to shippers. ` +
      "You validate buying signals strictly against the evidence provided: 'verified' needs a concrete source (posting, article, quote); 'hypothesis' is a reasonable inference; 'reject' when the evidence does not support the signal. " +
      "Pick the decision-maker from the people list only. Be concrete and brief.",
    user:
      `Company: ${account.companyName} | ${account.industry} | ${account.employeeCount} employees | ${account.hqCity}, ${account.hqState}\n` +
      `Description: ${account.facts.description ?? "n/a"}\n` +
      `Estimated shipments/month: ${account.facts.estimatedShipmentsPerMonth ?? "unknown"}\n\n` +
      `Signals proposed by the signal agents:\n` +
      account.signals
        .map((s) => `- ${s.key} [${s.status}, conf ${s.confidence}] evidence: ${s.evidence.map((e) => `${e.title}${e.url ? ` <${e.url}>` : ""}`).join(" | ")}`)
        .join("\n") +
      `\n\nPeople:\n${account.facts.people.map((p) => `- ${p.name}, ${p.title} (${p.seniority})${p.email ? ", email known" : ""}${p.linkedin ? ", linkedin known" : ""}`).join("\n") || "- none"}` +
      `\n\nTech stack: ${account.facts.techStack.map((t) => `${t.name} (${t.category}, ${t.source})`).join("; ") || "none observed"}` +
      `\nLearned ICP personas (lift): ${ctx.model.icp.personas
        .filter((p) => p.n >= 5)
        .slice(0, 5)
        .map((p) => `${p.name} ${p.lift}x`)
        .join(", ")}`,
  });

  let signals: Signal[] = account.signals;
  let contact = fallbackContact;
  let brief: string;
  let missingInfo: string[];
  const details: string[] = [];

  if (result) {
    for (const v of result.validations) details.push(`${v.verdict}: ${v.signalKey} (${v.reason})`);
    if (result.decisionMaker) details.push(`decision-maker: ${result.decisionMaker.name}, ${result.decisionMaker.title}: ${result.decisionMaker.why}`);
    const verdicts = new Map(result.validations.map((v) => [v.signalKey, v]));
    signals = account.signals
      .filter((s) => verdicts.get(s.key)?.verdict !== "reject")
      .map((s) => {
        const v = verdicts.get(s.key);
        if (!v || v.verdict === s.status) return s;
        return { ...s, status: v.verdict as Signal["status"], evidence: [...s.evidence, { title: `Research: ${v.reason}`, url: "", source: "research agent" }] };
      });
    if (result.decisionMaker) {
      const match = account.facts.people.find((p) => p.name.toLowerCase() === result.decisionMaker!.name.toLowerCase());
      if (match) contact = match;
    }
    brief = result.brief;
    missingInfo = result.missingInfo.length ? result.missingInfo : templateMissing({ ...account, contact });
  } else {
    brief = templateBrief(account, contact);
    missingInfo = templateMissing({ ...account, contact });
    details.push(`deterministic pass: ${signals.filter((s) => s.status === "verified").length} verified, ${signals.filter((s) => s.status === "hypothesis").length} hypotheses kept`);
    if (contact) details.push(`decision-maker: ${contact.name}, ${contact.title} (best persona match)`);
  }
  if (missingInfo.length) details.push(`missing: ${missingInfo.join("; ")}`);
  ctx.activity(account.id, "research_completed", result ? "Research validated signals and picked the decision-maker (Claude)" : "Research built the brief from facts (template)", details);

  return markAgentRun(
    {
      ...account,
      signals,
      contact,
      brief,
      missingInfo,
      verifiedSignals: signals.filter((s) => s.status === "verified").map((s) => s.label),
      hypotheses: signals.filter((s) => s.status === "hypothesis").map((s) => s.label),
    },
    "research",
  );
}

export const researchAgent: AgentDefinition = {
  id: "research",
  name: "Research Agent",
  role: "validation + decision-makers",
  description: "Validates each proposed signal against its evidence, picks the decision-maker, writes the account brief and lists missing information.",
  cadenceSeconds: 45,
  step: 2,
  async run(ctx) {
    const all = await ctx.store.listAccounts();
    const ready = all.filter(
      (a) =>
        a.status !== "disqualified" &&
        ["hiring", "expansion", "technology", "pain_point"].every((id) => a.agentRuns[id]) &&
        (!a.brief || upstreamChangedSince(a, "research", ["hiring", "expansion", "technology", "pain_point"])),
    );
    const batch = ready.slice(0, ctx.batchSize);
    const results = await mapLimit(batch, config.agents.llmConcurrency, async (a) => {
      const updated = await researchAccount(a, ctx);
      await ctx.store.upsertAccount(updated);
      return updated.contact ? 1 : 0;
    });
    const withContact = results.reduce<number>((x, y) => x + y, 0);
    return { processed: batch.length, summary: `${batch.length} accounts researched, ${withContact} with a decision-maker, ${ready.length - batch.length} waiting` };
  },
};
