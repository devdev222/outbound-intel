import Link from "next/link";
import { ExperimentStatusButton } from "@/components/lab/LabActions";
import { NewExperiment } from "@/components/lab/NewExperiment";
import { ResultsTable, metricLabel } from "@/components/lab/ResultsTable";
import { Badge, Card, EmptyState, PageHeader, fmtDate } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { EXPERIMENT_TEMPLATES, computeResults } from "@/lib/engine/experiments";
import { INDUSTRIES, SIGNAL_CATALOG } from "@/lib/engine/signal-catalog";
import { getStore } from "@/lib/store";
import { experiments } from "@/lib/store/collections";

export const dynamic = "force-dynamic";

export default async function LabPage() {
  await requireRole(["exec", "admin"]);
  const store = getStore();
  const list = (await experiments.list()).sort((a, b) => (a.status === b.status ? b.createdAt.localeCompare(a.createdAt) : a.status === "running" ? -1 : b.status === "running" ? 1 : a.status === "draft" ? -1 : 1));
  const rows = await Promise.all(list.map(async (e) => ({ e, results: e.status === "draft" ? null : await computeResults(store, e) })));
  const templates = EXPERIMENT_TEMPLATES.map((t) => ({ type: t.type, name: t.name, hypothesis: t.hypothesis, arms: t.arms, primaryMetric: t.primaryMetric }));
  const signalKeys = SIGNAL_CATALOG.filter((s) => s.type !== "intent").map((s) => ({ key: s.key, label: s.label }));

  return (
    <div className="page">
      <PageHeader
        eyebrow="Executive"
        title="Experimentation Lab"
        description="Randomized tests measured on meetings held, opportunities and qualified pipeline. Opens, clicks and replies are not success metrics here."
        actions={<NewExperiment templates={templates} industries={[...INDUSTRIES]} signalKeys={signalKeys} />}
      />
      {rows.length === 0 ? (
        <EmptyState title="No experiments yet" body="Start from a template: messaging angle, AI vs rep video, personalized page vs direct link, assessment-led outreach, gifting, or matched testimonials." />
      ) : (
        <div className="flex flex-col gap-4">
          {rows.map(({ e, results }) => (
            <Card
              key={e.id}
              title={e.name}
              hint={`${e.type.replace(/_/g, " ")} · primary metric: ${metricLabel(e.primaryMetric)} · ${e.status === "draft" ? `created ${fmtDate(e.createdAt)}` : `started ${fmtDate(e.startedAt)}`}${e.endedAt ? ` · ended ${fmtDate(e.endedAt)}` : ""}`}
              actions={
                <div className="flex items-center gap-2">
                  <Badge tone={e.status === "running" ? "good" : e.status === "draft" ? "neutral" : "info"}>{e.status}</Badge>
                  <ExperimentStatusButton id={e.id} status={e.status} />
                  <Link className="btn btn-sm" href={`/lab/${e.id}`}>
                    Detail
                  </Link>
                </div>
              }
            >
              <p className="mb-3 text-[13px] text-[var(--text-2)]">{e.hypothesis}</p>
              {results ? (
                <ResultsTable experiment={e} results={results} />
              ) : (
                <div className="text-[12px] text-[var(--muted)]">
                  Draft. Arms: {e.arms.map((a) => `${a.name} (${Math.round(a.share * 100)}%)`).join(", ")}. Start it to begin assigning eligible accounts as their campaigns launch.
                </div>
              )}
              {(e.segment.industries.length || e.segment.sizeBands.length || e.segment.signalKeys.length) > 0 && (
                <div className="mt-2 text-[12px] text-[var(--muted)]">
                  Segment: {[e.segment.industries.join(", "), e.segment.sizeBands.join(", "), e.segment.signalKeys.join(", ")].filter(Boolean).join(" · ")} · min score {e.segment.minScore}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
