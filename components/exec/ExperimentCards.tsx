import { Badge, ButtonLink, Card, EmptyState, fmtMoney } from "@/components/ui";
import type { ExperimentResults } from "@/lib/types";

export interface ExperimentCardData {
  experimentId: string;
  name: string;
  status: string;
  primaryMetric: string;
  results: ExperimentResults;
}

export function ExperimentCards({ experiments }: { experiments: ExperimentCardData[] }) {
  if (!experiments.length) return <EmptyState title="No experiments running" body="Design a randomized test in the Experimentation Lab. Results are measured on meetings held, opportunities and qualified pipeline." action={<ButtonLink href="/lab" variant="primary">Open the Lab</ButtonLink>} />;
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {experiments.map((e) => {
        const ctrl = e.results.arms.find((a) => a.control);
        return (
          <Card key={e.experimentId} title={e.name} hint={`Primary metric: ${e.primaryMetric.replace(/_/g, " ")} · ${e.status}`} actions={<ButtonLink href={`/lab/${e.experimentId}`} variant="ghost" className="btn-sm">Details</ButtonLink>}>
            <table className="table">
              <thead>
                <tr>
                  <th>Arm</th>
                  <th>Accounts</th>
                  <th>Held</th>
                  <th>Opps</th>
                  <th>Pipeline</th>
                  <th>Cost</th>
                  <th>Lift</th>
                </tr>
              </thead>
              <tbody>
                {e.results.arms.map((a) => {
                  const cmp = e.results.comparisons.find((c) => c.armKey === a.armKey);
                  return (
                    <tr key={a.armKey}>
                      <td>
                        {a.name} {a.control && <span className="muted text-[11px]">(control)</span>}
                      </td>
                      <td className="mono">{a.accounts}</td>
                      <td className="mono">{a.meetingsHeld}</td>
                      <td className="mono">{a.opportunities}</td>
                      <td className="mono">{fmtMoney(a.qualifiedPipeline)}</td>
                      <td className="mono">{fmtMoney(a.cost)}</td>
                      <td>
                        {a.control || !cmp ? (
                          <span className="muted">–</span>
                        ) : (
                          <span className="flex items-center gap-1.5">
                            <span className={`mono ${cmp.lift > 0 ? "text-[var(--good)]" : cmp.lift < 0 ? "text-[var(--bad)]" : ""}`}>
                              {cmp.lift > 0 ? "+" : ""}
                              {Math.round(cmp.lift * 100)}%
                            </span>
                            {cmp.significant ? <Badge tone="good" title={`p = ${cmp.pValue}`}>significant</Badge> : <Badge title={cmp.sampleWarning ?? `p = ${cmp.pValue}`}>{cmp.sampleWarning ? "small sample" : "not significant"}</Badge>}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {ctrl && ctrl.accounts < 30 && <div className="card-hint mt-2">Directional only until each arm has 30+ accounts.</div>}
          </Card>
        );
      })}
    </div>
  );
}
