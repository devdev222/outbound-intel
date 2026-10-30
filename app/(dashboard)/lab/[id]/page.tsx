import Link from "next/link";
import { notFound } from "next/navigation";
import { ExperimentStatusButton, RolloutButton } from "@/components/lab/LabActions";
import { ResultsTable, metricLabel } from "@/components/lab/ResultsTable";
import { Badge, Card, PageHeader, Stat, fmtDate } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { canonicalOpportunities } from "@/lib/engine/opportunities";
import { computeResults, forecast, getExperiment, TYPE_INFO, verdictFor } from "@/lib/engine/experiments";
import { labContext } from "@/lib/engine/lab-view";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function ExperimentDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ conflict?: string }> }) {
  const user = await requireRole(["exec", "admin"]);
  const { id } = await params;
  const { conflict } = await searchParams;
  const exp = await getExperiment(id);
  if (!exp) notFound();
  const store = getStore();
  const [{ describe }, results, accounts, outcomes, pace] = await Promise.all([labContext(store), computeResults(store, exp), store.listAccounts(), store.listOutcomes(), forecast(store, exp)]);
  const verdict = verdictFor(exp, exp.status === "draft" ? null : results);
  const arms = describe(exp);
  const assigned = accounts.filter((a) => a.experiments?.[exp.id]).sort((a, b) => b.priority - a.priority);
  const opps = new Set(canonicalOpportunities(outcomes).map((o) => o.accountId));
  const outcomeFor = (accountId: string) => {
    const os = outcomes.filter((o) => o.accountId === accountId);
    if (os.some((o) => o.outcomeType === "deal_won")) return "won";
    if (opps.has(accountId)) return "opportunity";
    if (os.some((o) => o.outcomeType === "meeting_booked")) return "meeting booked";
    if (os.some((o) => o.outcomeType === "meeting_requested")) return "meeting requested";
    if (os.some((o) => o.outcomeType === "deal_lost")) return "lost";
    return "–";
  };
  const remaining = Math.max(0, verdict.needed - verdict.enrolled);
  const canEdit = user.role !== "bdr";

  return (
    <div className="page">
      <div className="mb-3 text-[12px]">
        <Link href="/lab" className="text-[var(--muted)] hover:text-[var(--text)]">
          ← Experiments
        </Link>
      </div>
      <PageHeader
        eyebrow={TYPE_INFO.get(exp.type)?.label ?? exp.type}
        title={exp.name}
        description={exp.hypothesis}
        actions={
          <>
            <Badge tone={exp.status === "running" ? "good" : exp.status === "draft" ? "neutral" : "info"}>{exp.status}</Badge>
            <ExperimentStatusButton id={exp.id} status={exp.status} canEdit={canEdit} />
          </>
        }
      />
      {conflict && exp.status === "draft" && <div className="mb-4 rounded-md bg-[var(--warn-soft)] p-3 text-[13px]">Saved as a draft: another running experiment already changes this setting. Stop that one, then start this.</div>}

      <Card className="mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[15px] font-semibold">{verdict.headline}</span>
        </div>
        <p className="mt-1 text-[13px] text-[var(--text-2)]">{verdict.detail}</p>
        <div className="mt-3 grid gap-4 sm:grid-cols-4">
          <Stat label="Measured on" value={metricLabel(exp.primaryMetric)} />
          <Stat label="Enrolled" value={`${verdict.enrolled} / ${verdict.needed}`} sub={`${exp.targetPerArm ?? 30} per arm`} />
          <Stat label="Time to sample size" value={exp.status === "completed" ? "–" : remaining === 0 ? "reached" : pace.weeksToTarget ? `~${Math.ceil(remaining / Math.max(pace.launchesPerWeek, 0.1))} weeks` : "no recent launches"} sub={`${pace.waiting} eligible accounts waiting to launch`} />
          <Stat label="Started" value={exp.startedAt ? fmtDate(exp.startedAt).slice(0, 10) : "not yet"} sub={exp.endedAt ? `ended ${fmtDate(exp.endedAt).slice(0, 10)}` : `by ${exp.createdBy}`} />
        </div>
        {exp.rollout && <div className="mt-3 text-[13px] text-[var(--good)]">Rolled out by {exp.rollout.by} on {fmtDate(exp.rollout.at).slice(0, 10)}: {exp.rollout.applied}</div>}
      </Card>

      <Card title="Arms" hint="Who gets what. Everything else stays at the campaign defaults." className="mb-4">
        <ul className="grid gap-2 md:grid-cols-2">
          {exp.arms.map((a) => (
            <li key={a.key} className="rounded-md border border-[var(--border)] p-3 text-[13px]">
              <div className="font-medium">
                {a.name} {a.control && <span className="pill">control</span>} <span className="text-[var(--muted)]">{Math.round(a.share * 100)}% of new campaigns</span>
              </div>
              <div className="mt-0.5 text-[12.5px] text-[var(--text-2)]">{arms[a.key]}</div>
              {canEdit && !a.control && exp.status !== "draft" && !exp.rollout && <div className="mt-2"><RolloutButton id={exp.id} armKey={a.key} armName={a.name} recommended={verdict.state === "significant" && verdict.leader === a.key} /></div>}
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Results by arm" hint="Funnel columns show activity; only the primary metric decides. Meetings held are estimated from the hold rate." className="mb-4">
        <ResultsTable experiment={exp} results={results} descriptions={arms} />
      </Card>

      <Card title="Enrolled accounts" hint="Assignment is random but stable per account; outcome is the furthest stage reached" padded={false}>
        {assigned.length === 0 ? (
          <div className="px-4 pb-4 text-[13px] text-[var(--muted)]">{exp.status === "draft" ? "Start the experiment to begin enrolling." : "No accounts yet. Eligible accounts enroll when their campaign launches."}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Arm</th>
                  <th>Sequence</th>
                  <th>Status</th>
                  <th>Outcome</th>
                </tr>
              </thead>
              <tbody>
                {assigned.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <Link href={`/accounts/${a.slug}`} className="font-medium hover:underline">
                        {a.companyName}
                      </Link>
                      <div className="text-[12px] text-[var(--muted)]">{a.industry}</div>
                    </td>
                    <td>{exp.arms.find((x) => x.key === a.experiments?.[exp.id])?.name ?? a.experiments?.[exp.id]}</td>
                    <td className="text-[12.5px]">{a.campaign?.sequence?.name ?? "–"}</td>
                    <td>{a.status.replace(/_/g, " ")}</td>
                    <td>{outcomeFor(a.id)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
