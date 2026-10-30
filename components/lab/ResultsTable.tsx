import { Badge, fmtMoney } from "@/components/ui";
import type { Experiment, ExperimentResults } from "@/lib/types";

const METRIC_LABEL: Record<string, string> = { meetings_held: "meetings held (est.)", opportunities: "opportunities", qualified_pipeline: "qualified pipeline", meetings_booked: "meetings booked" };

export function metricLabel(m: string) {
  return METRIC_LABEL[m] ?? m.replace(/_/g, " ");
}

const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "–");

/** Per-arm funnel and outcome. Funnel columns are context; only the primary metric decides. */
export function ResultsTable({ experiment, results, descriptions }: { experiment: Experiment; results: ExperimentResults; descriptions?: Record<string, string> }) {
  const comp = new Map(results.comparisons.map((c) => [c.armKey, c]));
  const target = experiment.targetPerArm ?? 30;
  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th>Arm</th>
            <th>Enrolled</th>
            <th>First touch sent</th>
            <th>Engaged</th>
            <th>Meetings booked</th>
            <th>Opportunities</th>
            <th>Pipeline</th>
            <th>vs control on {metricLabel(experiment.primaryMetric)}</th>
          </tr>
        </thead>
        <tbody>
          {results.arms.map((a) => {
            const c = comp.get(a.armKey);
            return (
              <tr key={a.armKey}>
                <td>
                  <div className="font-medium">
                    {a.name} {a.control && <span className="pill">control</span>}
                  </div>
                  {descriptions?.[a.armKey] && <div className="text-[11.5px] text-[var(--muted)]">{descriptions[a.armKey]}</div>}
                </td>
                <td>
                  {a.accounts}
                  <span className="text-[11px] text-[var(--muted)]"> / {target}</span>
                </td>
                <td>{a.touched ?? "–"}</td>
                <td>
                  {a.engaged ?? "–"} <span className="text-[11px] text-[var(--muted)]">{a.engaged !== undefined ? pct(a.engaged, a.accounts) : ""}</span>
                </td>
                <td>
                  {a.meetingsBooked} <span className="text-[11px] text-[var(--muted)]">{pct(a.meetingsBooked, a.accounts)}</span>
                </td>
                <td>{a.opportunities}</td>
                <td>{a.qualifiedPipeline ? fmtMoney(a.qualifiedPipeline) : "–"}</td>
                <td>
                  {a.control ? (
                    <span className="text-[var(--muted)]">baseline</span>
                  ) : c ? (
                    <div className="flex flex-col gap-1">
                      <span className={c.lift > 0 ? "text-[var(--good)]" : c.lift < 0 ? "text-[var(--bad)]" : ""}>
                        {c.lift > 0 ? "+" : ""}
                        {Math.round(c.lift * 100)}%
                      </span>
                      {c.significant ? <Badge tone="good">significant (p={c.pValue})</Badge> : <Badge tone="warn" title={c.sampleWarning ?? undefined}>{c.sampleWarning ? (c.sampleWarning.startsWith("significance not computed") ? "not testable" : "too early") : `not significant (p=${c.pValue})`}</Badge>}
                    </div>
                  ) : (
                    "–"
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
