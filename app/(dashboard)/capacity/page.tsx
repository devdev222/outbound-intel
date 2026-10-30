import Link from "next/link";
import { Badge, Card, Kpi, Meter, PageHeader, fmtMoney } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { capacityReport } from "@/lib/engine/capacity";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function CapacityPage() {
  const user = await requireRole(["exec", "admin"]);
  const c = await capacityReport(getStore());
  const verdictTone = c.recommendation.verdict === "add_capacity" ? "accent" : c.recommendation.verdict === "increase_supply" ? "warn" : "good";
  const verdictLabel = c.recommendation.verdict === "add_capacity" ? "Add capacity" : c.recommendation.verdict === "increase_supply" ? "Increase supply" : "Hold";

  return (
    <div className="page">
      <PageHeader eyebrow="Executive" title="Revenue capacity" description={`Account supply, rep utilization and the economics of adding a BDR, over the last ${c.windowDays} days.`} />

      <Card className="mb-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Badge tone={verdictTone}>{verdictLabel}</Badge>
            <div className="mt-2 text-[15px] font-semibold">{c.recommendation.headline}</div>
            <ul className="mt-2 list-disc pl-5 text-[13px] text-[var(--text-2)]">
              {c.recommendation.evidence.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          </div>
          <div className="card-hint max-w-xs">
            Economics (rep cost, tooling, opportunity value, hold rate) come from settings.{user.role === "admin" && (
              <>
                {" "}
                <Link href="/console/scoring" className="underline">Edit</Link>
              </>
            )}
          </div>
        </div>
      </Card>

      <div className="grid-kpi mb-6">
        <Kpi label="Utilization" value={`${Math.round(c.team.utilization * 100)}%`} hint={`${c.team.conversationsPerDay} of ${c.team.capacityPerDay} conversations per day`} tone={c.team.utilization >= 0.85 ? "warn" : undefined} />
        <Kpi label="Meetings booked / held" value={`${c.team.meetingsBooked} / ${c.team.meetingsHeld}`} hint="held is estimated from the hold rate" estimate />
        <Kpi label="Opportunities" value={String(c.team.opportunities)} hint={`${fmtMoney(c.team.pipeline)} pipeline`} />
        <Kpi label="Monthly team cost" value={fmtMoney(c.team.monthlyCost)} hint={`${c.reps.length} reps + tooling`} estimate />
        <Kpi label="Cost per held meeting" value={c.team.costPerMeetingHeld ? fmtMoney(c.team.costPerMeetingHeld) : "–"} estimate />
        <Kpi label="Cost per opportunity" value={c.team.costPerOpportunity ? fmtMoney(c.team.costPerOpportunity) : "–"} estimate />
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <Card title="Account supply" className="lg:col-span-1">
          <dl className="grid grid-cols-2 gap-3 text-[13px]">
            <div>
              <dt className="card-hint">Ready for reps</dt>
              <dd className="kpi-value text-[20px]">{c.supply.ready}</dd>
            </div>
            <div>
              <dt className="card-hint">Unassigned</dt>
              <dd className="kpi-value text-[20px]">{c.supply.unassignedReady}</dd>
            </div>
            <div>
              <dt className="card-hint">Back in enrichment</dt>
              <dd className="kpi-value text-[20px]">{c.supply.needsEnrichment}</dd>
            </div>
            <div>
              <dt className="card-hint">New this week</dt>
              <dd className="kpi-value text-[20px]">{c.supply.weeklyInflow}</dd>
            </div>
          </dl>
        </Card>
        <Card title="Incremental BDR economics" hint="If one rep is added at the team's current conversion rates (estimate)" className="lg:col-span-2">
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <div className="card-hint">Monthly cost</div>
              <div className="text-[15px] font-semibold">{fmtMoney(c.incremental.extraRepMonthlyCost)}</div>
            </div>
            <div>
              <div className="card-hint">Conversations added / month</div>
              <div className="text-[15px] font-semibold">{c.incremental.conversationsAdded}</div>
            </div>
            <div>
              <div className="card-hint">Meetings added</div>
              <div className="text-[15px] font-semibold">{c.incremental.meetingsAdded}</div>
            </div>
            <div>
              <div className="card-hint">Opportunities added</div>
              <div className="text-[15px] font-semibold">{c.incremental.opportunitiesAdded}</div>
            </div>
            <div>
              <div className="card-hint">Pipeline added</div>
              <div className="text-[15px] font-semibold">{fmtMoney(c.incremental.pipelineAdded)}</div>
            </div>
            <div>
              <div className="card-hint">Payback</div>
              <div className="text-[15px] font-semibold">{c.incremental.paybackMonths ? `${c.incremental.paybackMonths} months` : "–"}</div>
            </div>
          </div>
          {c.incremental.supplyLimited && <div className="mt-3 rounded-md bg-[var(--warn-soft)] px-3 py-2 text-[12.5px] text-[var(--warn)]">Supply-limited: ready accounts plus weekly inflow would not keep an additional rep busy for a month.</div>}
        </Card>
      </div>

      <Card title="Per rep" padded={false}>
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Rep</th>
                <th>Open</th>
                <th>Ready</th>
                <th>Conv / day</th>
                <th>Utilization</th>
                <th>Meetings</th>
                <th>Opps</th>
                <th>Pipeline</th>
              </tr>
            </thead>
            <tbody>
              {c.reps.map((r) => (
                <tr key={r.rep.id}>
                  <td className="font-medium">{r.rep.name}</td>
                  <td className="mono">{r.openAccounts}</td>
                  <td className="mono">{r.readyAccounts}</td>
                  <td className="mono">
                    {r.conversationsPerDay} <span className="muted">/ {r.rep.capacityPerDay}</span>
                  </td>
                  <td className="min-w-[140px]">
                    <div className="flex items-center gap-2">
                      <div className="flex-1">
                        <Meter value={r.utilization * 100} accent={r.utilization >= 0.85} />
                      </div>
                      <span className="mono w-10 text-right">{Math.round(r.utilization * 100)}%</span>
                    </div>
                  </td>
                  <td className="mono">{r.meetingsBooked30d}</td>
                  <td className="mono">{r.opportunities30d}</td>
                  <td className="mono">{fmtMoney(r.pipeline30d)}</td>
                </tr>
              ))}
              {!c.reps.length && (
                <tr>
                  <td colSpan={8} className="muted">
                    No active reps configured.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
