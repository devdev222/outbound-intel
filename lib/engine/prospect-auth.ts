import { error } from "@/lib/api";
import type { Store } from "@/lib/store";
import type { Account } from "@/lib/types";
import { pageTokenFor } from "@/lib/util";

/**
 * Public prospect endpoints are reachable without a session, so they require
 * the page token rendered into the personalized page. That ties a submission
 * to a real link we sent and stops anyone creating tasks for arbitrary slugs.
 */
export async function accountForPage(store: Store, slug: string, token: string): Promise<{ account: Account } | { response: Response }> {
  const account = await store.getAccountBySlug(slug);
  if (!account || token !== pageTokenFor(account.id)) return { response: error("unknown page", 404) };
  if (account.status === "disqualified") return { response: error("this page is no longer active", 410) };
  return { account };
}
