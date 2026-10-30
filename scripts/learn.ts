import "./_env";
import { learn } from "@/lib/engine/learn";
import { getStore } from "@/lib/store";

async function main() {
  const store = getStore();
  const before = await store.getLatestModel();
  const model = await learn(store);
  console.log(`trained model v${model.version} on ${model.baseline.n} records`);
  console.log("weights:", model.weights, before ? `(was ${JSON.stringify(before.weights)})` : "");
  console.log("top patterns:");
  for (const p of model.signalPatterns.filter((p) => p.withN >= 5).slice(0, 8)) {
    console.log(`  ${p.lift.toFixed(2)}x  ${p.key.padEnd(38)} ${p.withWon}/${p.withN} vs ${p.withoutWon}/${p.withoutN}  weight ${p.weight}`);
  }
  console.log("notes:");
  for (const n of model.notes) console.log(`  - ${n}`);
  console.log(`\nplaybook (${model.playbook.generatedBy}): ${model.playbook.summary}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
