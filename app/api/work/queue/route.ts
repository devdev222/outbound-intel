import { requireApiRole } from "@/lib/auth";
import { json } from "@/lib/api";
import { buildWorkQueue } from "@/lib/engine/workqueue";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

/** The BDR's day: calls ready, follow-ups, high-intent engagement, meetings, exceptions. ?rep=<repId> for managers. */
export async function GET(req: Request) {
  const auth = await requireApiRole(["bdr", "exec", "admin"]);
  if ("response" in auth) return auth.response;
  const url = new URL(req.url);
  const repId = url.searchParams.get("rep") ?? auth.user.repId ?? null;
  return json(await buildWorkQueue(getStore(), repId));
}
