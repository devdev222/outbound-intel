import { requireApiRole } from "@/lib/auth";
import { json } from "@/lib/api";
import { getConnections } from "@/lib/integrations";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireApiRole(["admin"]);
  if ("response" in auth) return auth.response;
  return json({ integrations: await getConnections(getStore()) });
}
