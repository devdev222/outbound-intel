/**
 * Next.js instrumentation hook: runs once per server instance start.
 * When AUTO_SEED is on (default on Vercel) and the store is empty, seed the
 * deterministic synthetic dataset and run the agent team once so an ephemeral
 * deployment is never blank. Template mode only (no LLM) to keep cold starts short.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { config } = await import("@/lib/config");
  if (!config.autoSeed) return;
  const { getStore } = await import("@/lib/store");
  const store = getStore();
  if ((await store.listAccounts()).length > 0) return;
  const { seed } = await import("@/lib/engine/seed");
  const started = Date.now();
  const result = await seed({ count: config.autoSeedCount, reset: false, useLlm: false });
  console.log(`[auto-seed] ${result.accounts} accounts, model v${result.model.version}, ${Math.round((Date.now() - started) / 100) / 10}s`);
}
