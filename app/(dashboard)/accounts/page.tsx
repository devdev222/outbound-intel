import Link from "next/link";
import { Badge, EmptyState, Meter, PageHeader, Tabs, fmtAgo } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { getStore } from "@/lib/store";
import { reps as repCol } from "@/lib/store/collections";
import type { Account } from "@/lib/types";

export const dynamic = "force-dynamic";

type View = "ready" | "enrichment" | "all";

function whyNow(a: Account): string {
  const verified = a.signals.filter((s) => s.status === "verified" && s.type !== "intent").sort((x, y) => y.detectedAt.localeCompare(x.detectedAt));
  const intent = a.signals.filter((s) => s.type === "intent");
  const parts = [...verified.slice(0, 2).map((s) => s.label), ...intent.slice(0, 1).map((s) => s.label)];
  return parts.length ? parts.join(" · ") : a.painHypothesis ?? "No signal yet";
}

export default async function AccountsPage({ searchParams }: { searchParams: Promise<{ view?: string; q?: string; rep?: string }> }) {
  const user = await requireRole(["bdr", "exec", "admin"]);
  const sp = await searchParams;
  const view: View = sp.view === "enrichment" || sp.view === "all" ? sp.view : "ready";
  const q = (sp.q ?? "").trim().toLowerCase();
  const store = getStore();
  const [accounts, reps] = await Promise.all([store.listAccounts(), repCol.list()]);
  const repName = new Map(reps.map((r) => [r.id, r.name]));
  const repFilter = sp.rep ?? (user.role === "bdr" ? user.repId ?? "" : "");

  const base = accounts.filter((a) => !["disqualified"].includes(a.status));
  const ready = base.filter((a) => a.readiness?.ready && !["won", "lost"].includes(a.status));
  const enrichment = base.filter((a) => a.status === "needs_enrichment" || (a.readiness && !a.readiness.ready && (a.scores?.total ?? 0) >= 50));
  let rows = view === "ready" ? ready : view === "enrichment" ? enrichment : base;
  if (repFilter) rows = rows.filter((a) => a.ownerRepId === repFilter);
  if (q) rows = rows.filter((a) => a.companyName.toLowerCase().includes(q) || a.industry.toLowerCase().includes(q) || a.signals.some((s) => s.label.toLowerCase().includes(q)) || (a.contact?.name.toLowerCase().includes(q) ?? false));
  rows = [...rows].sort((x, y) => y.priority - x.priority);

  const query = (patch: Record<string, string>) => {
    const p = new URLSearchParams({ view, ...(q ? { q } : {}), ...(repFilter ? { rep: repFilter } : {}), ...patch });
    return `/accounts?${p.toString()}`;
  };

  return (
    <div className="page">
      <PageHeader
        eyebrow="Accounts"
        title="Priority queue"
        description="Accounts the engine has prepared, ranked by priority. Expand a row for the supporting detail."
        actions={
          <form className="flex items-center gap-2" action="/accounts">
            <input type="hidden" name="view" value={view} />
            {repFilter && <input type="hidden" name="rep" value={repFilter} />}
            <input name="q" defaultValue={sp.q ?? ""} placeholder="Search company, signal, contact" className="field w-64" />
            <button className="btn btn-sm" type="submit">
              Search
            </button>
          </form>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tabs
          base="/accounts"
          keep={{ q, rep: repFilter }}
          param="view"
          current={view}
          tabs={[
            { key: "ready", label: "Rep-ready", count: ready.length },
            { key: "enrichment", label: "In enrichment", count: enrichment.length },
            { key: "all", label: "All", count: base.length },
          ]}
        />
        {user.role !== "bdr" && (
          <div className="mb-4 flex flex-wrap gap-1 text-[12px]">
            <Link href={query({ rep: "" })} className={`pill ${!repFilter ? "pill-info" : ""}`}>
              All reps
            </Link>
            {reps.map((r) => (
              <Link key={r.id} href={query({ rep: r.id })} className={`pill ${repFilter === r.id ? "pill-info" : ""}`}>
                {r.name}
              </Link>
            ))}
          </div>
        )}
      </div>

      {rows.length === 0 ? (
        <EmptyState title={view === "ready" ? "No rep-ready accounts match" : view === "enrichment" ? "Nothing is stuck in enrichment" : "No accounts match"} body={q ? "Try a broader search." : view === "ready" ? "Accounts appear here once every readiness check passes." : undefined} />
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="table">
            <thead>
              <tr>
                <th>Company</th>
                <th>Why now</th>
                <th>Decision-maker</th>
                <th>Readiness</th>
                <th>Recommended next action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => {
                const c = a.contact;
                const blockers = a.readiness?.blockers ?? [];
                const verified = a.signals.filter((s) => s.status === "verified");
                const hyps = a.signals.filter((s) => s.status === "hypothesis");
                return (
                  <tr key={a.id}>
                    <td colSpan={5} className="!p-0">
                      <details className="group">
                        <summary className="grid cursor-pointer grid-cols-[1.3fr_1.6fr_1.3fr_0.9fr_1.2fr] gap-3 px-3 py-3 text-[13px] hover:bg-[#fafaf8] [&::-webkit-details-marker]:hidden">
                          <div className="min-w-0">
                            <Link href={`/accounts/${a.slug}`} className="font-semibold hover:underline">
                              {a.companyName}
                            </Link>
                            <div className="text-[12px] text-[var(--muted)]">
                              {a.industry} · P{a.priority}
                              {a.status === "hot" && <Badge tone="accent">hot</Badge>}
                            </div>
                          </div>
                          <div className="text-[var(--text-2)]">{whyNow(a)}</div>
                          <div>
                            {c ? (
                              <>
                                <div className="font-medium">{c.name}</div>
                                <div className="flex flex-wrap items-center gap-1 text-[12px] text-[var(--muted)]">
                                  {c.title}
                                  {c.phone && <Badge tone={c.phoneVerified ? "good" : "neutral"}>{c.phoneVerified ? "phone ✓" : "phone"}</Badge>}
                                  {c.email && <Badge>email</Badge>}
                                  {c.linkedin && <Badge>LinkedIn</Badge>}
                                </div>
                              </>
                            ) : (
                              <span className="text-[var(--muted)]">Not identified</span>
                            )}
                          </div>
                          <div>
                            {a.readiness?.ready ? (
                              <Badge tone="good">ready</Badge>
                            ) : a.readiness ? (
                              <Badge tone="warn" title={blockers.join("\n")}>
                                {blockers.length} blocker{blockers.length === 1 ? "" : "s"}
                              </Badge>
                            ) : (
                              <Badge>not evaluated</Badge>
                            )}
                          </div>
                          <div>
                            {a.nextAction ? (
                              <>
                                <div className="font-medium">{a.nextAction.label}</div>
                                <div className="text-[12px] text-[var(--muted)]">due {fmtAgo(a.nextAction.dueAt).replace(" ago", "")}</div>
                              </>
                            ) : (
                              <span className="text-[var(--muted)]">–</span>
                            )}
                          </div>
                        </summary>
                        <div className="grid gap-4 border-t border-[var(--border)] bg-[var(--surface-2)] px-4 py-4 text-[12.5px] md:grid-cols-3">
                          <div className="space-y-2">
                            <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">Score</div>
                            {a.scores ? (
                              <>
                                <div className="text-[18px] font-semibold">{a.scores.total}/100</div>
                                {(["signal", "icp", "pain", "timing", "access"] as const).map((k) => (
                                  <div key={k} className="grid grid-cols-[70px_1fr_30px] items-center gap-2">
                                    <span className="capitalize text-[var(--muted)]">{k}</span>
                                    <Meter value={a.scores![k]} />
                                    <span className="mono text-right">{a.scores![k]}</span>
                                  </div>
                                ))}
                                <div className="text-[var(--muted)]">
                                  priority {a.priority} · engagement {a.engagementScore} · model v{a.modelVersion ?? "–"}
                                </div>
                              </>
                            ) : (
                              <div className="text-[var(--muted)]">Not scored yet</div>
                            )}
                          </div>
                          <div className="space-y-2">
                            <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">Firmographics</div>
                            <div>
                              {a.employeeCount.toLocaleString()} employees · {a.hqCity}, {a.hqState}
                            </div>
                            <div>
                              Status <Badge>{a.status.replace(/_/g, " ")}</Badge> · owner {a.ownerRepId ? repName.get(a.ownerRepId) ?? a.ownerRepId : "unassigned"}
                            </div>
                            <div className="text-[var(--muted)]">
                              created {fmtAgo(a.createdAt)} · source {a.facts.source}
                            </div>
                            {blockers.length > 0 && (
                              <ul className="list-disc pl-4 text-[var(--warn)]">
                                {blockers.map((b) => (
                                  <li key={b}>{b}</li>
                                ))}
                              </ul>
                            )}
                          </div>
                          <div className="space-y-2">
                            <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">Signals</div>
                            <div className="flex flex-wrap gap-1">
                              {verified.map((s) => (
                                <Badge key={s.key} tone="info">
                                  {s.label}
                                </Badge>
                              ))}
                              {hyps.map((s) => (
                                <Badge key={s.key} title="Hypothesis, not yet verified">
                                  {s.label}?
                                </Badge>
                              ))}
                              {verified.length + hyps.length === 0 && <span className="text-[var(--muted)]">none</span>}
                            </div>
                            <Link href={`/accounts/${a.slug}`} className="btn btn-sm mt-1">
                              Open account
                            </Link>
                          </div>
                        </div>
                      </details>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
