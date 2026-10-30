import { json } from "@/lib/api";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

/** Account list (summary fields). Filters: ?status=, ?q=, ?limit= */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const q = url.searchParams.get("q")?.toLowerCase() ?? "";
  const limit = Number(url.searchParams.get("limit") ?? 200);
  const accounts = (await getStore().listAccounts())
    .filter((a) => !status || a.status === status)
    .filter((a) => !q || a.companyName.toLowerCase().includes(q) || a.industry.toLowerCase().includes(q) || a.signals.some((s) => s.label.toLowerCase().includes(q)))
    .slice(0, limit)
    .map((a) => ({
      slug: a.slug,
      companyName: a.companyName,
      industry: a.industry,
      employeeCount: a.employeeCount,
      status: a.status,
      scores: a.scores,
      priority: a.priority,
      engagementScore: a.engagementScore,
      verifiedSignals: a.verifiedSignals,
      hypotheses: a.hypotheses,
      contact: a.contact,
      pageUrl: a.campaign?.pageUrl ?? null,
      modelVersion: a.modelVersion,
      updatedAt: a.updatedAt,
    }));
  return json({ accounts });
}
