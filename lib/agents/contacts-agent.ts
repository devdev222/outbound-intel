import { markAgentRun } from "@/lib/engine/accounts";
import { buildBuyingGroup, ROLE_LABEL, verifyDue } from "@/lib/engine/buying-group";
import type { Account } from "@/lib/types";
import { nowIso } from "@/lib/util";
import { type AgentDefinition, upstreamChangedSince } from "./base";

/**
 * Contact research team (one agent, four responsibilities; see
 * lib/engine/buying-group.ts): the account mapper lists likely members of the
 * buying group, the contact researcher records why each person fits a role,
 * the verification agent checks employment, details, freshness, duplicates
 * and suppression for each person independently, and the coverage
 * coordinator selects the group for the plan (default four roles, or what
 * history recommends for the segment) and names every gap.
 */

const GAP_RECHECK_MS = 60 * 60_000;

function due(a: Account): boolean {
  if (a.status === "disqualified" || ["won", "lost"].includes(a.status)) return false;
  if (!a.agentRuns.research) return false;
  if (!a.buyingGroup) return true;
  if (upstreamChangedSince(a, "contacts", ["research"]) || (a.factsUpdatedAt ?? "") > (a.agentRuns.contacts ?? "")) return true;
  // Gaps and pending verifications are retried on a slower clock.
  return Boolean(a.buyingGroup.gaps.length && Date.now() - new Date(a.buyingGroup.updatedAt).getTime() > GAP_RECHECK_MS);
}

export const contactsAgent: AgentDefinition = {
  id: "contacts",
  name: "Contact Research Team",
  role: "buying group: mapping, verification, coverage",
  description: "Maps each account's buying group, verifies every person independently (employment, details, freshness, duplicates, suppression), selects the initial group for the plan and names the gaps.",
  cadenceSeconds: 45,
  step: 2,
  async run(ctx) {
    const all = await ctx.store.listAccounts();
    const ready = all.filter(due);
    const batch = ready.slice(0, ctx.batchSize);
    let covered = 0;
    let gaps = 0;
    for (const a of batch) {
      const r = await buildBuyingGroup(ctx.store, ctx.providers, a, ctx.model);
      const pendingRetries = (await ctx.store.listContacts({ accountId: a.id })).filter((c) => verifyDue(c, nowIso()) && c.verification.lastError).length;
      ctx.activity(a.id, "buying_group_updated", `Buying group: ${r.coverage.summary}`, [
        ...r.selected.map((c) => `${c.outreach.order}. ${c.person.name}, ${c.person.title} as ${ROLE_LABEL[c.role].toLowerCase()} (confidence ${Math.round(c.roleConfidence * 100)}%)`),
        ...r.coverage.gaps.map((g) => `gap: ${ROLE_LABEL[g.role]}: ${g.reason}`),
        `plan: ${r.coverage.plan.source === "learned" ? `learned for ${r.coverage.plan.segment}` : "default four roles"}`,
        ...(pendingRetries ? [`${pendingRetries} verification${pendingRetries === 1 ? "" : "s"} will retry`] : []),
      ]);
      await ctx.store.patchAccount(a.id, (cur) => markAgentRun(cur, "contacts"));
      if (r.coverage.gaps.length) gaps++;
      else covered++;
    }
    return { processed: batch.length, summary: `${batch.length} buying groups updated (${covered} fully covered, ${gaps} with gaps), ${ready.length - batch.length} waiting` };
  },
};
