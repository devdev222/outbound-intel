import "./_env";
import { runAgent } from "@/lib/agents/runtime";
import { getStore } from "@/lib/store";

async function main() {
  const run = await runAgent("scoring", { force: true });
  console.log(`[scoring] ${run.status}: ${run.summary}`);
  const top = (await getStore().listAccounts()).filter((a) => a.scores).slice(0, 15);
  for (const a of top) {
    const s = a.scores!;
    console.log(`${String(s.total).padStart(3)} (sig ${s.signal} icp ${s.icp} pain ${s.pain} tim ${s.timing} acc ${s.access})  ${a.companyName} [${a.status}]`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
