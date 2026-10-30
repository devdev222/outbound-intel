import { Badge, fmtMoney } from "@/components/ui";
import type { Experiment, ExperimentResults } from "@/lib/types";

const METRIC_LABEL: Record<string, string> = { meetings_held: "meetings held", opportunities: "opportunities", qualified_pipeline: "qualified pipeline", meetings_booked: "meetings booked" };

export function metricLabel(m: string) {
  return METRIC_LABEL[m] ?? m.replace(/_/g, " ");
}

export function ResultsTable({ experiment, results }: { experiment: Experiment; results: ExperimentResults }) {
  const comp = new Map(results.comparisons.map((c) => [c.armKey, c]));
  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th>Arm</th>
            <th>Accounts</th>
            <th>Meetings booked</th>
            <th>Meetings held</th>
            <th>Opportunities</th>
            <th>Pipeline</th>
            <th>Cost</th>
            <th>Cost / opp</th>
            <th>vs control</th>
          </tr>
        </thead>
        <tbody>
          {results.arms.map((a) => {
            const c = comp.get(a.armKey);
            return (
              <tr key={a.armKey}>
                <td>
                  <div className="font-medium">{a.name}</div>
                  {a.control && <span className="pill">control</span>}
                </td>
                <td>{a.accounts}</td>
                <td>{a.meetingsBooked}</td>
                <td>
                  {a.meetingsHeld} <span className="muted text-[11px]">est.</span>
                </td>
                <td>{a.opportunities}</td>
                <td>{a.qualifiedPipeline ? fmtMoney(a.qualifiedPipeline) : "–"}</td>
                <td>{a.cost ? fmtMoney(a.cost) : "–"}</td>
                <td>{a.costPerOpportunity != null ? fmtMoney(a.costPerOpportunity) : "–"}</td>
                <td>
                  {a.control ? (
                    <span className="muted">baseline</span>
                  ) : c ? (
                    <div className="flex flex-col gap-1">
                      <span className={c.lift > 0 ? "text-[var(--good)]" : c.lift < 0 ? "text-[var(--bad)]" : ""}>
                        {c.lift > 0 ? "+" : ""}
                        {Math.round(c.lift * 100)}% on {metricLabel(experiment.primaryMetric)}
                      </span>
                      {c.significant ? <Badge tone="good">significant (p={c.pValue})</Badge> : <Badge tone="warn" title={c.sampleWarning ?? undefined}>{c.sampleWarning ? "directional only" : `not significant (p=${c.pValue})`}</Badge>}
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
