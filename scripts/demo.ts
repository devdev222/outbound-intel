import "./_env";
import { runAgent, runAgentUntilDrained } from "@/lib/agents/runtime";
import { recordEngagement } from "@/lib/engine/engagement";
import { recordOutcome } from "@/lib/engine/outcomes";
import { seed } from "@/lib/engine/seed";
import { getProviders } from "@/lib/providers";
import { getStore } from "@/lib/store";
import type { Weights } from "@/lib/types";

/**
 * End-to-end demo in the terminal: LEARN -> DISCOVER -> SCORE -> PERSONALIZE ->
 * (simulated) ENGAGE -> ACTIVATE -> OUTCOME -> LEARN AGAIN, printing the weight
 * shift at the end. Everything the dashboard does, without the browser.
 */
function fmtWeights(w: Weights) {
  return (Object.keys(w) as (keyof Weights)[]).map((k) => `${k} ${w[k].toFixed(2)}`).join("  ");
}

async function main() {
  const store = getStore();
  const providers = getProviders();
  const count = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 80);

  console.log(`\n== 1. LEARN + 2. DISCOVER + 3. SCORE + 4. PERSONALIZE (seed ${count} companies, run the team once)`);
  const seeded = await seed({ count });
  console.log(`history: ${seeded.historical} records -> model v${seeded.model.version}`);
  console.log(`weights: ${fmtWeights(seeded.model.weights)}`);
  for (const r of seeded.runs) console.log(`  [${r.agentId.padEnd(10)}] ${r.summary}`);

  const live = (await store.listAccounts()).filter((a) => a.status === "campaign_live");
  if (!live.length) {
    console.log("no campaigns launched (lower QUALIFICATION_THRESHOLD or seed more companies)");
    return;
  }
  const target = live[0];
  console.log(`\n== account under test: ${target.companyName} (score ${target.scores?.total}, ${target.verifiedSignals.join("; ")})`);
  console.log(`page: ${target.campaign?.pageUrl}\nheadline: ${target.campaign?.headline}\nvideo script: ${target.campaign?.videoScript}`);

  console.log(`\n== 5/6. ENGAGE (simulated visitor on the personalized page)`);
  const visitorId = "demo-visitor";
  let acct = target;
  for (const ev of [
    { eventType: "page_view", properties: { referrer: "email step 1" } },
    { eventType: "video_play", properties: {} },
    { eventType: "video_75", properties: { percent: 85 } },
    { eventType: "calculator_completed", properties: { shipmentsPerMonth: 500, hoursSaved: 42 } },
    { eventType: "case_study_viewed", properties: { title: "Steel Fabrication Freight" } },
  ]) {
    const r = await recordEngagement(store, providers, acct, { ...ev, visitorId });
    acct = r.account;
    console.log(`  ${ev.eventType.padEnd(22)} engagement ${String(acct.engagementScore).padStart(3)}  priority ${acct.priority}${r.activationTriggered ? "  -> activation flagged" : ""}`);
  }

  console.log(`\n== 7. ACTIVATE (Jerry enriches, writes the talk track, alerts the rep)`);
  // The console alert provider prints the full Hot Lead Alert above; just confirm delivery here.
  const jerry = await runAgent("jerry", { force: true });
  console.log(`  [jerry] ${jerry.summary}`);
  const alert = (await store.listAlerts({ accountId: acct.id, limit: 1 }))[0];
  if (alert) console.log(`  alert stored (delivered via ${alert.deliveredVia.join(", ") || "none"}); talk track: "${alert.payload.talkTrack}"`);

  console.log(`\n== 8. OUTCOME -> LEARN AGAIN`);
  const before = (await store.getLatestModel())!;
  const outcome = await recordOutcome(store, providers, acct, { outcomeType: "meeting_booked", notes: "demo", source: "demo" });
  console.log(`  outcome logged: ${outcome.outcome.outcomeType} (fed back to history: ${outcome.fedBack})`);
  const learning = await runAgent("learning", { force: true });
  console.log(`  [learning] ${learning.summary}`);
  const after = (await store.getLatestModel())!;
  console.log(`  weights v${before.version}: ${fmtWeights(before.weights)}`);
  console.log(`  weights v${after.version}: ${fmtWeights(after.weights)}`);
  for (const n of after.notes) console.log(`    - ${n}`);
  const scoringRuns = await runAgentUntilDrained("scoring");
  console.log(`  [scoring] ${scoringRuns.reduce((n, r) => n + r.processed, 0)} accounts re-scored with model v${after.version} in ${scoringRuns.length - 1} batch(es)`);
  const rescored = await store.getAccountById(acct.id);
  console.log(`  ${acct.companyName}: score ${acct.scores?.total} (v${acct.modelVersion}) -> ${rescored?.scores?.total} (v${rescored?.modelVersion}), status ${rescored?.status}`);
  console.log("\ndone. Open the dashboard with `npm run dev`.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
