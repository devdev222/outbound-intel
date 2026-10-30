import Link from "next/link";
import { notFound } from "next/navigation";
import { ActivityTimeline } from "@/components/dashboard/ActivityTimeline";
import { AlertCard } from "@/components/dashboard/AlertCard";
import { EngagementSimulator } from "@/components/dashboard/EngagementSimulator";
import { OutcomeButtons } from "@/components/dashboard/OutcomeButtons";
import { RepTaskActions } from "@/components/dashboard/RepTaskActions";
import { outreachPillClass } from "@/components/dashboard/format";
import { ScoreBreakdown } from "@/components/dashboard/ScoreBreakdown";
import { VideoPanel } from "@/components/dashboard/VideoPanel";
import { fmtInt, fmtTime, scoreColor, statusLabel, statusPillClass } from "@/components/dashboard/format";
import { getStore } from "@/lib/store";
import type { Signal } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function AccountPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const store = getStore();
  const account = await store.getAccountBySlug(slug);
  if (!account) notFound();

  const [model, events, alerts, outreach, outcomes, activity] = await Promise.all([
    store.getLatestModel(),
    store.listEvents({ accountId: account.id, limit: 100 }),
    store.listAlerts({ accountId: account.id }),
    store.listOutreach({ accountId: account.id }),
    store.listOutcomes({ accountId: account.id }),
    store.listActivity({ accountId: account.id, limit: 150 }),
  ]);

  const verified = account.signals.filter((s) => s.status === "verified");
  const hypotheses = account.signals.filter((s) => s.status === "hypothesis");
  const total = account.scores?.total ?? 0;
  const c = account.contact;
  const camp = account.campaign;

  return (
    <div className="space-y-5">
      <div className="text-xs">
        <Link href="/accounts" className="text-[var(--muted)] no-underline hover:underline">
          ← accounts
        </Link>
      </div>

      <header className="panel flex flex-wrap items-start justify-between gap-4 p-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold">{account.companyName}</h1>
            <span className={statusPillClass(account.status)}>{statusLabel(account.status)}</span>
            {account.pendingActivation && <span className="pill pill-accent">awaiting Jerry: {account.pendingActivation}</span>}
          </div>
          <div className="text-sm text-[var(--muted)]">
            {account.industry} · {fmtInt(account.employeeCount)} employees · {account.hqCity}, {account.hqState} · {account.domain}
            {account.facts.estimatedShipmentsPerMonth ? ` · ~${fmtInt(account.facts.estimatedShipmentsPerMonth)} shipments/mo` : ""}
          </div>
          <div className="flex flex-wrap gap-2 pt-1 text-xs">
            {camp && (
              <a href={`/for/${account.slug}`} target="_blank" rel="noreferrer" className="pill pill-info no-underline">
                open personalized page ↗
              </a>
            )}
            <span className="pill">source: {account.facts.source}</span>
            <span className="pill">created {fmtTime(account.createdAt)}</span>
            {account.lastAlertAt && <span className="pill">last alert {fmtTime(account.lastAlertAt)}</span>}
          </div>
        </div>
        <div className="flex gap-6 text-right">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-[var(--muted)]">score</div>
            <div className="mono text-4xl font-semibold" style={{ color: scoreColor(total) }}>
              {account.scores ? total : "-"}
            </div>
            <div className="text-[10px] text-[var(--muted)]">{account.modelVersion ? `model v${account.modelVersion}` : "unscored"}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-[var(--muted)]">priority</div>
            <div className="mono text-4xl font-semibold">{account.priority}</div>
            <div className="text-[10px] text-[var(--muted)]">engagement {account.engagementScore}</div>
          </div>
        </div>
      </header>

      <ScoreBreakdown scores={account.scores} weights={model?.weights ?? null} explanation={account.scoreExplanation} modelVersion={account.modelVersion} />

      <section className="grid gap-3 lg:grid-cols-3">
        <SignalList title="Verified signals" signals={verified} tone="good" empty="No verified signals." />
        <SignalList title="Hypotheses" signals={hypotheses} tone="warn" empty="No open hypotheses." />
        <div className="panel p-4">
          <h2 className="font-semibold">Missing information</h2>
          {account.missingInfo.length ? (
            <ul className="mt-2 space-y-1 text-sm">
              {account.missingInfo.map((m) => (
                <li key={m} className="flex gap-2">
                  <span className="text-[var(--muted)]">?</span>
                  <span>{m}</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="mt-2 text-sm text-[var(--muted)]">Nothing flagged.</div>
          )}
        </div>
      </section>

      <section className="grid gap-3 lg:grid-cols-3">
        <div className="panel space-y-3 p-4 lg:col-span-2">
          <Field label="Pain hypothesis" value={account.painHypothesis} />
          <Field label="Messaging angle" value={account.messagingAngle} />
          <Field label="Recommended persona" value={account.recommendedPersona} />
          <Field label="Account brief" value={account.brief} />
        </div>
        <div className="panel p-4">
          <h2 className="font-semibold">Contact</h2>
          {c ? (
            <dl className="mt-2 space-y-1.5 text-sm">
              <div>
                <dt className="text-xs text-[var(--muted)]">name</dt>
                <dd className="font-medium">{c.name}</dd>
              </div>
              <div>
                <dt className="text-xs text-[var(--muted)]">title</dt>
                <dd>
                  {c.title} <span className="pill">{c.seniority.replace("_", "-")}</span>
                </dd>
              </div>
              <div>
                <dt className="text-xs text-[var(--muted)]">email</dt>
                <dd className="mono break-all">{c.email ?? <span className="text-[var(--muted)]">unknown</span>}</dd>
              </div>
              <div>
                <dt className="text-xs text-[var(--muted)]">linkedin</dt>
                <dd className="mono break-all">
                  {c.linkedin ? (
                    <a href={c.linkedin} target="_blank" rel="noreferrer" className="text-[var(--info)]">
                      {c.linkedin.replace(/^https?:\/\/(www\.)?/, "")}
                    </a>
                  ) : (
                    <span className="text-[var(--muted)]">unknown</span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-[var(--muted)]">phone</dt>
                <dd className="mono">
                  {c.phone ?? <span className="text-[var(--muted)]">unknown</span>}{" "}
                  {c.phone && (c.phoneVerified ? <span className="pill pill-good">verified</span> : <span className="pill pill-warn">unverified</span>)}
                </dd>
              </div>
            </dl>
          ) : (
            <div className="mt-2 text-sm text-[var(--muted)]">No decision-maker identified yet ({account.facts.people.length} people known).</div>
          )}
        </div>
      </section>

      {camp && (
        <section className="panel p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">Campaign</h2>
            <div className="flex flex-wrap gap-1.5 text-xs">
              <span className="pill">format: {camp.arms.contentFormat.replace("_", " ")}</span>
              <span className="pill">video: {camp.arms.videoType}</span>
              <span className="pill">personalization: {camp.arms.personalization}</span>
              <span className="pill">angle: {camp.arms.angleVariant}</span>
              <span className={camp.arms.gifting === "gift" ? "pill pill-accent" : "pill"}>gifting: {camp.arms.gifting}</span>
            </div>
          </div>
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <div className="space-y-3 text-sm">
              <Field label="Headline" value={camp.headline} />
              <Field label="Subheadline" value={camp.subheadline} />
              <Field label="Angle" value={camp.angle} />
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="pill">persona: {camp.persona}</span>
                <span className="pill">case study: {camp.caseStudyId}</span>
                <span className="pill">launched {fmtTime(camp.launchedAt)}</span>
                <a href={camp.pageUrl} target="_blank" rel="noreferrer" className="pill pill-info no-underline">
                  {camp.pageUrl.replace(/^https?:\/\//, "")}
                </a>
              </div>
            </div>
            <div className="space-y-3 text-sm">
              <VideoPanel slug={account.slug} campaign={camp} />
              <div>
                <div className="text-xs uppercase tracking-wider text-[var(--muted)]">ROI defaults</div>
                <div className="mono text-xs">
                  {fmtInt(camp.roiDefaults.shipmentsPerMonth)} shipments/mo · {camp.roiDefaults.minutesPerShipment} min/shipment · ${camp.roiDefaults.hourlyCost}/hr ·{" "}
                  {camp.roiDefaults.coordinators} coordinator{camp.roiDefaults.coordinators === 1 ? "" : "s"}
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      <section className="grid gap-3 lg:grid-cols-2">
        <EngagementSimulator slug={account.slug} />
        <OutcomeButtons slug={account.slug} />
      </section>

      <section className="grid gap-3 lg:grid-cols-2">
        <ActivityTimeline activity={activity} events={events} />
        <div className="panel p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-semibold">Outreach sequence</h2>
            {outreach.some((t) => t.status === "awaiting_rep") && (
              <span className="pill pill-warn">{outreach.filter((t) => t.status === "awaiting_rep").length} rep task(s)</span>
            )}
          </div>
          {outreach.length ? (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-[11px] uppercase tracking-wider text-[var(--muted)]">
                  <tr>
                    <th className="py-1 pr-2">Step</th>
                    <th className="py-1 pr-2">Channel</th>
                    <th className="py-1 pr-2">Status</th>
                    <th className="py-1 pr-2">Scheduled</th>
                    <th className="py-1">Preview</th>
                  </tr>
                </thead>
                <tbody>
                  {outreach.map((t) => (
                    <tr key={t.id} className="border-t border-[var(--border)] align-top">
                      <td className="mono py-1.5 pr-2">{t.step}</td>
                      <td className="py-1.5 pr-2">{t.channel}</td>
                      <td className="py-1.5 pr-2">
                        <span className={outreachPillClass(t.status)}>{statusLabel(t.status)}</span>
                        {t.sentAt && <div className="mono mt-0.5 text-[10px] text-[var(--muted)]">{fmtTime(t.sentAt).slice(5)}</div>}
                      </td>
                      <td className="mono py-1.5 pr-2 text-xs text-[var(--muted)]">{fmtTime(t.scheduledFor).slice(0, 11)}</td>
                      <td className="py-1.5 text-xs">
                        {t.subject && <div className="font-medium">{t.subject}</div>}
                        <div className="line-clamp-2 text-[var(--muted)]" title={t.body}>
                          {t.body}
                        </div>
                        {t.note && <div className={`mt-0.5 ${t.status === "failed" ? "text-[var(--bad)]" : "text-[var(--warn)]"}`}>{t.note}</div>}
                        {t.provider && t.provider !== "pending" && <div className="mt-0.5 text-[10px] text-[var(--muted)]">via {t.provider}</div>}
                        {t.status === "awaiting_rep" && (
                          <div className="mt-1.5">
                            <RepTaskActions touch={t} />
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="mt-2 text-sm text-[var(--muted)]">No sequence launched yet.</div>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">Rep alerts</h2>
        {alerts.length ? alerts.map((a) => <AlertCard key={a.id} alert={a} />) : <div className="panel p-4 text-sm text-[var(--muted)]">No alerts yet. Cross the engagement threshold to activate Jerry.</div>}
      </section>

      <section className="panel p-4">
        <h2 className="font-semibold">Outcomes</h2>
        {outcomes.length ? (
          <ul className="mt-2 space-y-1 text-sm">
            {outcomes.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center gap-2">
                <span className="mono text-xs text-[var(--muted)]">{fmtTime(o.createdAt)}</span>
                <span className={o.outcomeType === "deal_won" || o.outcomeType === "meeting_booked" || o.outcomeType === "opportunity_created" ? "pill pill-good" : o.outcomeType === "replied" ? "pill pill-info" : "pill pill-bad"}>
                  {statusLabel(o.outcomeType)}
                </span>
                {o.value !== null && <span className="mono">${fmtInt(o.value)}</span>}
                {o.notes && <span className="text-[var(--muted)]">{o.notes}</span>}
                <span className="text-xs text-[var(--muted)]">via {o.source}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="mt-2 text-sm text-[var(--muted)]">No outcomes logged.</div>
        )}
      </section>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-[var(--muted)]">{label}</div>
      <div className="text-sm leading-relaxed">{value ?? <span className="text-[var(--muted)]">not set</span>}</div>
    </div>
  );
}

function SignalList({ title, signals, tone, empty }: { title: string; signals: Signal[]; tone: "good" | "warn"; empty: string }) {
  return (
    <div className="panel p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="font-semibold">{title}</h2>
        <span className={`pill pill-${tone}`}>{signals.length}</span>
      </div>
      {signals.length ? (
        <ul className="mt-2 space-y-2 text-sm">
          {signals.map((s) => (
            <li key={s.key} className={`rounded-md border-l-2 pl-2 ${tone === "good" ? "border-[var(--good)]" : "border-dashed border-[var(--warn)]"}`}>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-medium">{s.label}</span>
                {s.value !== undefined && <span className="pill">{String(s.value)}</span>}
                <span className="mono text-xs text-[var(--muted)]">conf {Math.round(s.confidence * 100)}%</span>
                <span className="text-xs text-[var(--muted)]">· {s.agent.replace("_", " ")}</span>
              </div>
              <ul className="mt-0.5 space-y-0.5 text-xs text-[var(--muted)]">
                {s.evidence.slice(0, 3).map((e, i) => (
                  <li key={i} className="truncate" title={e.snippet ?? e.title}>
                    {e.url ? (
                      <a href={e.url} target="_blank" rel="noreferrer" className="text-[var(--info)]">
                        {e.title}
                      </a>
                    ) : (
                      e.title
                    )}
                  </li>
                ))}
                {s.evidence.length > 3 && <li>+{s.evidence.length - 3} more</li>}
              </ul>
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-2 text-sm text-[var(--muted)]">{empty}</div>
      )}
    </div>
  );
}
