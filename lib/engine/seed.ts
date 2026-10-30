import { getProviders } from "@/lib/providers";
import { getStore } from "@/lib/store";
import type { ScoringModel } from "@/lib/types";
import { runPipelineOnce } from "@/lib/agents/runtime";
import { accountFromFacts } from "./accounts";
import { learn } from "./learn";

export interface SeedResult {
  historical: number;
  model: ScoringModel;
  accounts: number;
  runs: { agentId: string; status: string; summary: string }[];
}

/**
 * Seed the engine: pull the historical book of business from the CRM provider,
 * train the first real model, discover a batch of companies, and (optionally)
 * run the whole team once so the dashboard has something to show.
 */
export async function seed(opts: { count?: number; reset?: boolean; runPipeline?: boolean; useLlm?: boolean; platformDemo?: boolean } = {}): Promise<SeedResult> {
  const store = getStore();
  const providers = getProviders();
  const count = opts.count ?? 120;

  if (opts.reset !== false) await store.reset();

  const historical = await providers.crm.exportHistorical();
  await store.replaceHistorical(historical);
  const model = await learn(store, { useLlm: opts.useLlm });

  const facts = await providers.discovery.discover(count);
  const existing = new Set((await store.listAccounts()).map((a) => a.slug));
  const accounts = facts.map((f) => {
    const a = accountFromFacts(f, existing);
    existing.add(a.slug);
    return a;
  });
  await store.upsertAccounts(accounts);

  const { ensureDemoIdentities } = await import("@/lib/auth/users");
  await ensureDemoIdentities();
  const runs =
    opts.runPipeline === false
      ? []
      : (await runPipelineOnce({ drain: true })).filter((r) => r.processed > 0 || r.status === "error").map((r) => ({ agentId: r.agentId, status: r.status, summary: r.summary }));
  if (opts.runPipeline !== false && opts.platformDemo !== false) {
    const { seedPlatformDemo } = await import("./seed-platform");
    await seedPlatformDemo(store);
  }
  return { historical: historical.length, model, accounts: accounts.length, runs };
}
