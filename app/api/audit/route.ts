import { requireApiRole } from "@/lib/auth";
import { json } from "@/lib/api";
import { auditLog } from "@/lib/store/collections";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireApiRole(["admin", "exec"]);
  if ("response" in auth) return auth.response;
  return json({ audit: (await auditLog.list()).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 300) });
}
