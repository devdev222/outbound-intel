import type { Store } from "@/lib/store";
import type { Account, CompanyFacts } from "@/lib/types";
import { accountFromFacts, mergeFacts } from "./accounts";

/**
 * Ingest discovery output (a Clay row, an identified website visitor's company,
 * a CRM import) into the account table: merge into an existing account when the
 * domain or name matches, otherwise create one. The agent team picks it up on
 * the next tick because factsUpdatedAt moved.
 */
export async function ingestFacts(store: Store, facts: CompanyFacts): Promise<{ account: Account; created: boolean }> {
  const all = await store.listAccounts();
  const domain = facts.domain.toLowerCase().replace(/^www\./, "");
  const existing = all.find((a) => a.domain.toLowerCase().replace(/^www\./, "") === domain) ?? all.find((a) => a.companyName.toLowerCase() === facts.companyName.toLowerCase());
  if (existing) {
    const merged = mergeFacts(existing, facts);
    return { account: await store.upsertAccount(merged), created: false };
  }
  const account = accountFromFacts(facts, new Set(all.map((a) => a.slug)));
  return { account: await store.upsertAccount(account), created: true };
}
