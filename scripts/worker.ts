import "./_env";
import { drain, loopStatus, startLoop } from "@/lib/agents/runtime";
import { config, describeProviders } from "@/lib/config";

/**
 * 24/7 worker. Runs the agent team on a loop until stopped. Deploy as a
 * long-running process (Railway / Fly / ECS / a VM) next to the web app; both
 * share the same store. For serverless-only deployments use POST /api/agents/tick
 * from a scheduler instead.
 */
console.log("outbound-intel worker starting");
console.log("providers:", describeProviders());
const { intervalSeconds } = startLoop(config.agents.tickSeconds);
console.log(`agent loop running every ${intervalSeconds}s (AGENT_TICK_SECONDS). Ctrl+C to stop.`);

setInterval(() => {
  const s = loopStatus();
  console.log(`[worker] ticks=${s.ticks} lastTick=${s.lastTickAt ?? "-"} inFlight=${s.inFlight.join(",") || "-"}`);
}, 60_000).unref();

let stopping = false;
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  console.log("worker draining in-flight agent runs…");
  const r = await drain(30_000);
  console.log(`worker stopped (${r.finished} runs finished${r.abandoned.length ? `, abandoned: ${r.abandoned.join(", ")}; their leases expire on their own` : ""})`);
  process.exit(0);
};
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
