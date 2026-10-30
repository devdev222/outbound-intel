import { json } from "@/lib/api";
import { checkReadiness } from "@/lib/readiness-check";

export const dynamic = "force-dynamic";

/**
 * Public health check for uptime monitors and deploy gates: 200 when the
 * configuration and database schema are ready, 503 otherwise. Lists which
 * settings are wrong (names only, never values).
 */
export async function GET() {
  const r = await checkReadiness();
  return json(r, r.ok ? 200 : 503);
}
