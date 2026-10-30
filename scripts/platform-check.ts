import "./_env";
import { runAgent } from "@/lib/agents/runtime";
import { answerQuestion } from "@/lib/engine/ask";
import { capacityReport } from "@/lib/engine/capacity";
import { logConversation } from "@/lib/engine/conversations";
import { execSummary } from "@/lib/engine/insights";
import { seed } from "@/lib/engine/seed";
import { buildWorkQueue } from "@/lib/engine/workqueue";
import { getProviders } from "@/lib/providers";
import { getStore } from "@/lib/store";
import { experiments, giftCampaigns, gifts, reps } from "@/lib/store/collections";

/** End-to-end smoke test of the platform modules on an in-memory store. */
async function main() {
  process.env.STORE_PROVIDER = process.env.STORE_PROVIDER || "memory";
  const store = getStore();
  const providers = getProviders();
  const t0 = Date.now();
  const seeded = await seed({ count: 60 });
  console.log(`seeded ${seeded.accounts} accounts in ${Math.round((Date.now() - t0) / 1000)}s`);

  const accounts = await store.listAccounts();
  const ready = accounts.filter((a) => a.readiness?.ready);
  const blocked = accounts.filter((a) => a.status === "needs_enrichment");
  console.log(`readiness: ${ready.length} ready, ${blocked.length} need enrichment; blockers sample: ${blocked[0]?.readiness?.blockers.join(" | ") ?? "-"}`);
  console.log(`reps: ${(await reps.list()).map((r) => r.name).join(", ")}; owners assigned: ${accounts.filter((a) => a.ownerRepId).length}`);

  const q = await buildWorkQueue(store, "rep_sam");
  console.log(`work queue (rep_sam): high-intent ${q.counts.highIntent}, calls ${q.counts.callsReady}, follow-ups ${q.counts.followUps}, meetings ${q.counts.meetings}, exceptions ${q.counts.exceptions}`);
  const item = q.callsReady[0] ?? q.highIntent[0];
  if (item) {
    console.log(`  first item: ${item.company} | why now: ${item.whyNow} | next: ${item.nextAction?.label} | proof: ${item.proof?.customer ?? "-"}`);
    const acct = (await store.getAccountBySlug(item.slug))!;
    const conv = await logConversation(store, providers, acct, { channel: "call", outcome: "connected", notes: "Talked to Nina; they run tendering in a spreadsheet, new facility opens in Q1, budget is a concern. Wants the case study." }, null);
    console.log(`  conversation: ${conv.summary} | objections: ${conv.objections.join(", ") || "none"} | signals: ${conv.signalsExtracted.join(", ") || "none"} | next: ${conv.nextAction?.label} | follow-up: "${conv.followUpDraft?.subject}" (${conv.approved ? "scheduled" : "awaiting approval"})`);
  }

  // Let the campaign agent pick up due touches / gifts and jerry enrich blocked accounts, then re-score.
  await runAgent("jerry", { force: true });
  const scoring = await runAgent("scoring", { force: true });
  console.log(`re-score after enrichment: ${scoring.summary}`);
  await runAgent("campaign", { force: true });

  const exps = await experiments.list();
  console.log(`experiments: ${exps.map((e) => `${e.name} [${e.status}]`).join("; ")}`);
  const camps = await giftCampaigns.list();
  const g = await gifts.list();
  console.log(`gifting: ${camps.length} campaign(s), ${g.length} gifts (${g.filter((x) => x.status === "proposed").length} awaiting approval)`);

  const summary = await execSummary(store);
  console.log("exec KPIs:", summary.kpis.map((k) => `${k.label}=${k.format === "currency" ? "$" + Math.round(k.value).toLocaleString() : k.format === "pct" ? Math.round(k.value * 100) + "%" : k.value}`).join(" | "));
  console.log("recommendations:", summary.recommendations.map((r) => `[${r.priority}] ${r.title}`).join(" | ") || "none");
  const cap = await capacityReport(store);
  console.log(`capacity: ${cap.recommendation.verdict} — ${cap.recommendation.headline}`);
  const ask = await answerQuestion(store, "Which buying signals are converting best and should we add a BDR?");
  console.log(`ask (${ask.source}): ${ask.answer.slice(0, 300)}`);
  console.log("done");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
