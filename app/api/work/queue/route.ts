import { requireApiRole } from "@/lib/auth";
import { json } from "@/lib/api";
import { buildWorkQueue } from "@/lib/engine/workqueue";
import { getProviders } from "@/lib/providers";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

/** The BDR's day as one prioritized queue (now, meetings, follow-ups, needs attention). ?rep=<repId> for managers; BDRs always get their own. */
export async function GET(req: Request) {
  const auth = await requireApiRole(["bdr", "exec", "admin"]);
  if ("response" in auth) return auth.response;
  const url = new URL(req.url);
  const rep = url.searchParams.get("rep");
  const repId = auth.user.role === "bdr" ? (auth.user.repId ?? null) : rep === "all" ? null : (rep ?? auth.user.repId ?? null);
  return json(await buildWorkQueue(getStore(), getProviders(), repId));
}
