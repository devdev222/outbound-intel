import { json } from "@/lib/api";
import { getIntegrations } from "@/lib/integrations";

export const dynamic = "force-dynamic";

export async function GET() {
  return json({ integrations: getIntegrations() });
}
