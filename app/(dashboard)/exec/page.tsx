import Link from "next/link";
import { AskPanel } from "@/components/exec/AskPanel";
import { ExperimentCards } from "@/components/exec/ExperimentCards";
import { Recommendations } from "@/components/exec/Recommendations";
import { Card, Kpi, Meter, PageHeader, Synthetic, Tabs, fmtMoney } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { execSummary, type Kpi as KpiData } from "@/lib/engine/insights";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

function kpiValue(k: KpiData): string {
  if (k.format === "currency") return fmtMoney(k.value);
  if (k.format === "pct") return `${Math.round(k.value * 100)}%`;
  if (k.format === "ratio") return k.value.toFixed(2);
  return k.value.toLocaleString();
}

export default async function ExecPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  await requireRole(["exec", "admin"]);
  const { days } = await searchParams;
  const windowDays = days === "90" ? 90 : days === "7" ? 7 : 30;
  const s = await execSummary(getStore(), windowDays);
  const cap = s.capacity;

  return (
    <div className="page">
      <PageHeader
        eyebrow="Executive command center"
        title="Pipeline generation"
        description={`Outcomes for the last ${windowDays} days. Model v${s.model.version} trained on ${s.model.n} historical records.`}
        actions={<Synthetic when={s.syntheticData} />}
      />
      <Tabs base="/exec" param="days" current={String(windowDays)} tabs={[{ key: "7", label: "7 days" }, { key: "30", label: "30 days" }, { key: "90", label: "90 days" }]} />

      <div className="grid-kpi mb-6">
        {s.kpis.map((k) => (
          <Kpi key={k.key} label={k.label} value={kpiValue(k)} hint={k.hint} estimate={k.estimate} tone={k.key === "utilization" ? (k.value >= 0.85 ? "warn" : undefined) : undefined} />
        ))}
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Recommendations items={s.recommendations} />
        </div>
        <div className="flex flex-col gap-4">
          <Card title="Capacity and supply" hint={`${cap.reps.length} active reps`} actions={<Link href="/capacity" className="btn btn-ghost btn-sm">Details</Link>}>
            <div className="mb-1 flex items-center justify-between text-[13px]">
              <span>Utilization</span>
              <span className="mono">{Math.round(cap.team.utilization * 100)}%</span>
            </div>
            <Meter value={cap.team.utilization * 100} accent={cap.team.utilization >= 0.85} />
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              <div>
                <div className="kpi-value text-[18px]">{cap.supply.ready}</div>
                <div className="card-hint">ready</div>
              </div>
              <div>
                <div className="kpi-value text-[18px]">{cap.supply.unassignedReady}</div>
                <div className="card-hint">unassigned</div>
              </div>
              <div>
                <div className="kpi-value text-[18px]">{cap.supply.needsEnrichment}</div>
                <div className="card-hint">in enrichment</div>
              </div>
            </div>
            <p className="mt-3 text-[12.5px] text-[var(--text-2)]">{cap.recommendation.headline}</p>
          </Card>
          <Card title="Top-performing buying signals" hint="Conversion lift vs baseline in the historical set">
            {s.topSignals.length ? (
              <ul className="divide-y divide-[var(--border)]">
                {s.topSignals.map((t) => (
                  <li key={t.key} className="flex items-center justify-between gap-2 py-1.5 text-[13px]">
                    <span className="truncate">{t.label}</span>
                    <span className="mono shrink-0 text-[var(--text-2)]">
                      {t.lift.toFixed(1)}x <span className="muted">· {t.conversions}</span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="card-hint">No signal has enough history yet.</div>
            )}
            <Link href="/intelligence" className="mt-2 inline-block text-[12px] text-[var(--text-2)] underline">
              All insights
            </Link>
          </Card>
        </div>
      </div>

      <h2 className="section-title">Experiment results</h2>
      <div className="mb-6">
        <ExperimentCards experiments={s.experiments} />
      </div>

      <AskPanel />
    </div>
  );
}
