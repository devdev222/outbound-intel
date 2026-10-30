import { requireApiRole } from "@/lib/auth";
import { json } from "@/lib/api";
import { execSummary } from "@/lib/engine/insights";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireApiRole(["exec", "admin"]);
  if ("response" in auth) return auth.response;
  const days = Number(new URL(req.url).searchParams.get("days") ?? 30);
  return json(await execSummary(getStore(), Number.isFinite(days) && days > 0 ? Math.min(days, 365) : 30));
}
