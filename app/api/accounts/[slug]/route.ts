import { requireApiRole } from "@/lib/auth";
import { json, requireAccount } from "@/lib/api";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

/** Full account detail with engagement, alerts, outreach and outcomes. */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const auth = await requireApiRole(["bdr", "exec", "admin"]);
  if ("response" in auth) return auth.response;
  const { slug } = await params;
  const store = getStore();
  const found = await requireAccount(store, slug);
  if ("response" in found) return found.response;
  const a = found.account;
  const [events, alerts, outreach, outcomes] = await Promise.all([
    store.listEvents({ accountId: a.id, limit: 100 }),
    store.listAlerts({ accountId: a.id }),
    store.listOutreach({ accountId: a.id }),
    store.listOutcomes({ accountId: a.id }),
  ]);
  return json({ account: a, events, alerts, outreach, outcomes });
}
