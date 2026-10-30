import Link from "next/link";
import { ExperimentStatusButton, RolloutButton } from "@/components/lab/LabActions";
import { NewExperiment } from "@/components/lab/NewExperiment";
import { metricLabel } from "@/components/lab/ResultsTable";
import { Badge, Card, EmptyState, PageHeader, fmtDate } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { computeResults, TYPE_INFO, verdictFor, type Verdict } from "@/lib/engine/experiments";
import { labContext } from "@/lib/engine/lab-view";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

const TONE: Record<Verdict["state"], "good" | "info" | "warn" | "neutral" | "accent"> = { significant: "good", directional: "info", collecting: "neutral", no_signal: "warn", not_started: "neutral", rolled_out: "accent" };
const ORDER = { running: 0, draft: 1, completed: 2 } as const;

export default async function LabPage() {
  const user = await requireRole(["exec", "admin"]);
  const store = getStore();
  const { experiments, wizard, describe } = await labContext(store);
  const rows = await Promise.all(
    experiments
      .sort((a, b) => ORDER[a.status] - ORDER[b.status] || b.createdAt.localeCompare(a.createdAt))
      .map(async (e) => {
        const results = e.status === "draft" ? null : await computeResults(store, e);
        return { e, results, verdict: verdictFor(e, results), arms: describe(e) };
      }),
  );

  return (
    <div className="page">
      <PageHeader
        eyebrow="Executive"
        title="Experimentation Lab"
        description="Test one change at a time against what you do today, on meetings and opportunities rather than opens or clicks."
        actions={<NewExperiment data={wizard} />}
      />

      <section className="card mb-5 grid gap-3 p-4 text-[12.5px] text-[var(--text-2)] md:grid-cols-3">
        <div>
          <div className="font-semibold text-[var(--text)]">1. One question per experiment</div>
          Compare your sequences, a template for one step, an angle, proof, video, page or gift. Control is exactly today&apos;s setting; two experiments can&apos;t change the same thing at once.
        </div>
        <div>
          <div className="font-semibold text-[var(--text)]">2. Accounts enroll as campaigns launch</div>
          Each new campaign that fits the segment is assigned an arm at random. Campaigns already running are not changed. About {wizard.launchesPerWeek} campaigns launched per week recently.
        </div>
        <div>
          <div className="font-semibold text-[var(--text)]">3. Read, then roll out</div>
          Results stay &quot;collecting&quot; until every arm reaches its sample size. Rolling out a winner makes it the default (sequence, step template or campaign default).
        </div>
      </section>

      {rows.length === 0 ? (
        <EmptyState title="No experiments yet" body="Start with a question: which sequence books more meetings, which version of your intro email works, or whether matched customer proof helps." />
      ) : (
        <div className="flex flex-col gap-4">
          {rows.map(({ e, results, verdict, arms }) => {
            const progress = verdict.needed ? Math.min(100, Math.round((verdict.enrolled / verdict.needed) * 100)) : 0;
            const leaderArm = e.arms.find((a) => a.key === verdict.leader);
            return (
              <Card
                key={e.id}
                title={e.name}
                hint={`${TYPE_INFO.get(e.type)?.label ?? e.type} · measured on ${metricLabel(e.primaryMetric)} · ${e.status === "draft" ? `draft since ${fmtDate(e.createdAt).slice(0, 10)}` : `started ${fmtDate(e.startedAt).slice(0, 10)}`}${e.endedAt ? ` · ended ${fmtDate(e.endedAt).slice(0, 10)}` : ""}`}
                actions={
                  <div className="flex items-center gap-2">
                    <Badge tone={e.status === "running" ? "good" : e.status === "draft" ? "neutral" : "info"}>{e.status}</Badge>
                    <ExperimentStatusButton id={e.id} status={e.status} canEdit={user.role !== "bdr"} />
                    <Link className="btn btn-sm" href={`/lab/${e.id}`}>
                      Details
                    </Link>
                  </div>
                }
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={TONE[verdict.state]}>{verdict.headline}</Badge>
                  <span className="text-[12.5px] text-[var(--text-2)]">{verdict.detail}</span>
                </div>
                {e.status !== "draft" && !e.rollout && (
                  <div className="mt-2">
                    <div className="bar" aria-label={`${verdict.enrolled} of ${verdict.needed} accounts enrolled`}>
                      <span style={{ width: `${progress}%` }} />
                    </div>
                    <div className="mt-1 text-[11.5px] text-[var(--muted)]">
                      {verdict.enrolled} of {verdict.needed} accounts enrolled ({e.targetPerArm ?? 30} per arm)
                    </div>
                  </div>
                )}
                <ul className="mt-3 grid gap-1.5 text-[12.5px] md:grid-cols-2">
                  {e.arms.map((a) => {
                    const r = results?.arms.find((x) => x.armKey === a.key);
                    return (
                      <li key={a.key} className="rounded-md border border-[var(--border)] px-2.5 py-1.5">
                        <div className="font-medium">
                          {a.name} {a.control && <span className="pill">control</span>} {verdict.leader === a.key && verdict.state !== "collecting" && <span className="pill pill-good">ahead</span>}
                        </div>
                        <div className="text-[11.5px] text-[var(--muted)]">{arms[a.key]}</div>
                        {r && (
                          <div className="mt-0.5 text-[11.5px]">
                            {r.accounts} enrolled · {r.meetingsBooked} meetings · {r.opportunities} opportunities
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
                {user.role !== "bdr" && leaderArm && !leaderArm.control && (verdict.state === "significant" || verdict.state === "directional") && (
                  <div className="mt-3">
                    <RolloutButton id={e.id} armKey={leaderArm.key} armName={leaderArm.name} recommended={verdict.state === "significant"} />
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
