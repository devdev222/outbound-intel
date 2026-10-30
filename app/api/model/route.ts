import { requireApiRole } from "@/lib/auth";
import { json } from "@/lib/api";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

/** All scoring model versions, newest first. */
export async function GET() {
  const auth = await requireApiRole(["exec", "admin"]);
  if ("response" in auth) return auth.response;
  return json({ models: await getStore().listModels() });
}
