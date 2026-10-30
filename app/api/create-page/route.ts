import { runPipelineOnce } from "@/lib/agents/runtime";
import { error, json, safeEqual } from "@/lib/api";
import { config } from "@/lib/config";
import { ingestFacts } from "@/lib/engine/ingest";
import { clayRowToFacts, type ClayRow } from "@/lib/providers/discovery/clay";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Spec endpoint "called by Clay": creates (or refreshes) the account for a
 * company row and returns its personalized page URL immediately. Clay's HTTP
 * API column can store `page_url` in the cell ("Field paths to return").
 * The agent team then researches, scores and (if qualified) launches the
 * campaign; the page renders a preview until the campaign exists.
 */
export async function POST(req: Request) {
  if (config.clay.inboundSecret) {
    const header = req.headers.get("x-webhook-secret") ?? "";
    if (!safeEqual(header, config.clay.inboundSecret)) return error("unauthorized", 401);
  }
  let row: Partial<ClayRow>;
  try {
    row = (await req.json()) as Partial<ClayRow>;
  } catch {
    return error("invalid JSON");
  }
  if (!row.company_name) return error("company_name is required");
  const { account, created } = await ingestFacts(getStore(), clayRowToFacts(row as ClayRow));
  void runPipelineOnce();
  return json({ ok: true, created, slug: account.slug, page_url: `${config.appUrl}/for/${account.slug}` });
}
