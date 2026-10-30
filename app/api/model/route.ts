import { json } from "@/lib/api";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

/** All scoring model versions, newest first. */
export async function GET() {
  return json({ models: await getStore().listModels() });
}
