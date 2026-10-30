import "./_env";
import { seed } from "@/lib/engine/seed";
import { getStore } from "@/lib/store";
import { describeProviders } from "@/lib/config";

const count = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 120);
const noRun = process.argv.includes("--no-run");

async function main() {
  console.log("providers:", describeProviders());
  console.log(`seeding ${count} companies...`);
  const result = await seed({ count, runPipeline: !noRun });
  console.log(`historical records: ${result.historical}`);
  console.log(`model v${result.model.version}: weights`, result.model.weights);
  for (const n of result.model.notes) console.log(`  - ${n}`);
  console.log(`accounts created: ${result.accounts}`);
  for (const r of result.runs) console.log(`  [${r.agentId}] ${r.status}: ${r.summary}`);

  const top = (await getStore().listAccounts()).slice(0, 10);
  console.log("\ntop accounts:");
  for (const a of top) {
    console.log(`  ${String(a.scores?.total ?? 0).padStart(3)}  ${a.companyName.padEnd(36)} ${a.status.padEnd(14)} ${a.verifiedSignals.slice(0, 2).join("; ")}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
