import { Badge, Card, EmptyState } from "@/components/ui";
import type { Recommendation } from "@/lib/engine/insights";

export function Recommendations({ items, title = "Recommendations" }: { items: Recommendation[]; title?: string }) {
  if (!items.length) return <EmptyState title="No recommendations yet" body="Recommendations appear once the team has outcomes, experiments or capacity pressure to act on." />;
  const tone = (p: Recommendation["priority"]) => (p === "high" ? "accent" : p === "medium" ? "info" : "neutral");
  return (
    <Card title={title} hint="Generated from outcomes, the learned model, experiments and capacity. Each one cites its evidence.">
      <div className="grid gap-3 md:grid-cols-2">
        {items.map((r, i) => (
          <div key={i} className="rounded-lg border border-[var(--border)] p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="text-[13.5px] font-semibold">{r.title}</div>
              <Badge tone={tone(r.priority)}>{r.priority}</Badge>
            </div>
            <p className="mt-1 text-[13px] text-[var(--text-2)]">{r.why}</p>
            <p className="mt-2 text-[13px]">
              <span className="font-medium">Do:</span> {r.action}
            </p>
            {r.evidence.length > 0 && (
              <details className="mt-2">
                <summary className="cursor-pointer text-[12px] text-[var(--muted)]">Evidence ({r.evidence.length})</summary>
                <ul className="mt-1 list-disc pl-5 text-[12px] text-[var(--muted)]">
                  {r.evidence.map((e, j) => (
                    <li key={j}>{e}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}
