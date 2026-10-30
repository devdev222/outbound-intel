import { requireApiRole } from "@/lib/auth";
import { json } from "@/lib/api";
import { capacityReport } from "@/lib/engine/capacity";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireApiRole(["exec", "admin"]);
  if ("response" in auth) return auth.response;
  return json(await capacityReport(getStore()));
}
