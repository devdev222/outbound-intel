import Link from "next/link";
import { notFound } from "next/navigation";
import { ExperimentStatusButton } from "@/components/lab/LabActions";
import { ResultsTable, metricLabel } from "@/components/lab/ResultsTable";
import { Badge, Card, PageHeader, Stat, fmtDate } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { computeResults } from "@/lib/engine/experiments";
import { getStore } from "@/lib/store";
import { experiments } from "@/lib/store/collections";

export const dynamic = "force-dynamic";

export default async function ExperimentDetail({ params }: { params: Promise<{ id: string }> }) {
  await requireRole(["exec", "admin"]);
  const { id } = await params;
  const exp = await experiments.get(id);
  if (!exp) notFound();
  const store = getStore();
  const results = await computeResults(store, exp);
  const [accounts, outcomes] = await Promise.all([store.listAccounts(), store.listOutcomes()]);
  const assigned = accounts.filter((a) => a.experiments?.[exp.id]).sort((a, b) => b.priority - a.priority);
  const outcomeFor = (accountId: string) => {
    const os = outcomes.filter((o) => o.accountId === accountId);
    if (os.some((o) => o.outcomeType === "deal_won")) return "won";
    if (os.some((o) => o.outcomeType === "opportunity_created")) return "opportunity";
    if (os.some((o) => o.outcomeType === "meeting_booked")) return "meeting booked";
    if (os.some((o) => o.outcomeType === "deal_lost")) return "lost";
    return "–";
  };

  return (
    <div className="page">
      <div className="mb-3 text-[12px]">
        <Link href="/lab" className="text-[var(--muted)] hover:text-[var(--text)]">
          ← Experiments
        </Link>
      </div>
      <PageHeader
        eyebrow={exp.type.replace(/_/g, " ")}
        title={exp.name}
        description={exp.hypothesis}
        actions={
          <>
            <Badge tone={exp.status === "running" ? "good" : exp.status === "draft" ? "neutral" : "info"}>{exp.status}</Badge>
            <ExperimentStatusButton id={exp.id} status={exp.status} />
          </>
        }
      />
      <Card className="mb-4">
        <div className="grid gap-4 sm:grid-cols-4">
          <Stat label="Primary metric" value={metricLabel(exp.primaryMetric)} />
          <Stat label="Accounts assigned" value={assigned.length} />
          <Stat label="Started" value={fmtDate(exp.startedAt)} sub={exp.endedAt ? `ended ${fmtDate(exp.endedAt)}` : undefined} />
          <Stat label="Created by" value={exp.createdBy} />
        </div>
      </Card>
      <Card title="Results by arm" hint={`computed ${fmtDate(results.computedAt)}; meetings held are estimated from the configured hold rate`} className="mb-4">
        <ResultsTable experiment={exp} results={results} />
        {results.comparisons.some((c) => c.sampleWarning) && <div className="mt-2 text-[12px] text-[var(--warn)]">Treat differences as directional until each arm has 30+ accounts.</div>}
      </Card>
      <Card title="Assigned accounts" hint="arm assignment is deterministic per account; outcome is the furthest stage reached" padded={false}>
        {assigned.length === 0 ? (
          <div className="px-4 pb-4 text-[13px] text-[var(--muted)]">No accounts assigned yet. Assignment happens when an eligible account&apos;s campaign launches.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Arm</th>
                  <th>Status</th>
                  <th>Score</th>
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
                    <td>{a.status.replace(/_/g, " ")}</td>
                    <td>{a.scores?.total ?? "–"}</td>
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
