import Link from "next/link";
import { notFound } from "next/navigation";
import { ApproveFollowUp } from "@/components/bdr/ApproveFollowUp";
import { AssignRep } from "@/components/bdr/AssignRep";
import { ConversationPanel } from "@/components/bdr/ConversationPanel";
import { ActivityTimeline } from "@/components/dashboard/ActivityTimeline";
import { AlertCard } from "@/components/dashboard/AlertCard";
import { EngagementSimulator } from "@/components/dashboard/EngagementSimulator";
import { OutcomeButtons } from "@/components/dashboard/OutcomeButtons";
import { PauseControl } from "@/components/bdr/PauseControl";
import { TaskActions } from "@/components/dashboard/TaskActions";
import { isOpen, primaryActionFor } from "@/lib/engine/tasks";
import { getProviders } from "@/lib/providers";
import { ScoreBreakdown } from "@/components/dashboard/ScoreBreakdown";
import { VideoPanel } from "@/components/dashboard/VideoPanel";
import { outreachPillClass } from "@/components/dashboard/format";
import { Badge, Card, PageHeader, Tabs, fmtAgo, fmtDate, fmtMoney } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { config } from "@/lib/config";
import { rankProof } from "@/lib/engine/proof";
import { getStore } from "@/lib/store";
import { conversationsFor, proofStories, reps as repCol } from "@/lib/store/collections";
import type { Account, Signal } from "@/lib/types";

export const dynamic = "force-dynamic";

type Tab = "research" | "scoring" | "history" | "campaign" | "technical";

function openerFor(a: Account, talkTrack: string | undefined): string {
  if (talkTrack) return talkTrack;
  const first = a.contact?.name.split(" ")[0] ?? "there";
  const sig = a.signals.find((s) => s.status === "verified" && s.type !== "intent");
  return `Hi ${first}, this is ${config.brandName}. I noticed ${sig ? sig.label.toLowerCase() : "how shipping coordination is scaling"} at ${a.companyName}, and I work with teams at your volume on exactly that. Do you have two minutes for me to ask how coordination is handled today?`;
}

function SignalRow({ s }: { s: Signal }) {
  const ev = s.evidence[0];
  return (
    <li className="py-2">
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <span className="font-medium">{s.label}</span>
        {s.value !== undefined && <Badge>{String(s.value)}</Badge>}
        <Badge tone={s.status === "verified" ? "good" : "warn"}>{s.status}</Badge>
        <span className="text-[12px] text-[var(--muted)]">
          {fmtAgo(s.detectedAt)} · {s.agent.replace(/_/g, " ")} · {Math.round(s.confidence * 100)}%
        </span>
      </div>
      {ev && (
        <div className="text-[12px] text-[var(--text-2)]">
          {ev.url ? (
            <a href={ev.url} target="_blank" rel="noreferrer" className="hover:underline">
              {ev.title}
            </a>
          ) : (
            ev.title
          )}
          <span className="text-[var(--muted)]"> · {ev.source}</span>
        </div>
      )}
    </li>
  );
}

export default async function AccountPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ tab?: string }> }) {
  const user = await requireRole(["bdr", "exec", "admin"]);
  const { slug } = await params;
  const { tab: tabParam } = await searchParams;
  const tab: Tab = (["research", "scoring", "history", "campaign", "technical"] as Tab[]).includes(tabParam as Tab) ? (tabParam as Tab) : "research";
  const store = getStore();
  const account = await store.getAccountBySlug(slug);
  if (!account) notFound();

  const [model, events, alerts, outreach, outcomes, activity, conversations, reps, stories] = await Promise.all([
    store.getLatestModel(),
    store.listEvents({ accountId: account.id, limit: 100 }),
    store.listAlerts({ accountId: account.id }),
    store.listOutreach({ accountId: account.id }),
    store.listOutcomes({ accountId: account.id }),
    store.listActivity({ accountId: account.id, limit: 150 }),
    conversationsFor(account.id),
    repCol.list(),
    proofStories.list(),
  ]);

  const verified = account.signals.filter((s) => s.status === "verified" && s.type !== "intent").sort((x, y) => y.detectedAt.localeCompare(x.detectedAt));
  const intent = account.signals.filter((s) => s.type === "intent");
  const hypotheses = account.signals.filter((s) => s.status === "hypothesis");
  const c = account.contact;
  const camp = account.campaign;
  const latestAlert = alerts[0];
  const latestConv = conversations[0];
  const proof = rankProof(account, stories, { allowPlaceholders: config.demoBanner })[0] ?? null;
  const proofOutcome = proof ? (proof.story.outcomes.find((o) => o.verified) ?? proof.story.outcomes[0]) : null;
  const industry = model?.icp.industries.find((i) => i.name === account.industry);
  const owner = account.ownerRepId ? reps.find((r) => r.id === account.ownerRepId) : null;
  const providers = getProviders();
  const pendingTasks = outreach.filter((t) => t.status === "awaiting_approval" || t.status === "manual" || t.status === "failed");
  const preparedFollowUp = latestConv?.followUpDraft ?? (pendingTasks.find((t) => t.channel === "email") ? { subject: pendingTasks.find((t) => t.channel === "email")!.subject ?? "", body: pendingTasks.find((t) => t.channel === "email")!.body } : null);
  const opener = openerFor(account, latestAlert?.payload.talkTrack);
  const ready = account.readiness?.ready ?? false;
  const blockers = account.readiness?.blockers ?? [];
  const pageUrl = camp?.pageUrl ?? `${config.appUrl}/for/${account.slug}`;

  const panelCtx = {
    slug: account.slug,
    company: account.companyName,
    opener,
    painHypothesis: account.painHypothesis,
    proofLine: proof && proofOutcome ? `${proof.story.customer}: ${proofOutcome.value} ${proofOutcome.metric.toLowerCase()}${proofOutcome.verified ? "" : " (unverified placeholder)"}` : null,
    proofPlaceholder: proof?.story.placeholder,
    contact: c,
    preparedFollowUp,
  };

  return (
    <div className="page">
      <div className="mb-2 text-[12px]">
        <Link href="/accounts" className="text-[var(--muted)] hover:underline">
          ← Accounts
        </Link>
      </div>
      <PageHeader
        title={account.companyName}
        description={`${account.industry} · ${account.employeeCount.toLocaleString()} employees · ${account.hqCity}, ${account.hqState}`}
        actions={
          <>
            <Badge tone={account.status === "hot" ? "accent" : account.status === "won" ? "good" : account.status === "lost" || account.status === "disqualified" ? "bad" : "info"}>{account.status.replace(/_/g, " ")}</Badge>
            {ready ? <Badge tone="good">rep-ready</Badge> : account.readiness ? <Badge tone="warn">{blockers.length} readiness blocker{blockers.length === 1 ? "" : "s"}</Badge> : null}
            {!["won", "lost", "disqualified"].includes(account.status) && <PauseControl slug={account.slug} pausedUntil={account.pausedUntil ?? null} pauseReason={account.pauseReason ?? null} />}
            <a href={pageUrl} target="_blank" rel="noreferrer" className="btn btn-sm">
              Personalized page ↗
            </a>
          </>
        }
      />

      {!ready && blockers.length > 0 && (
        <div className="mb-5 rounded-[10px] border border-[#fed7aa] bg-[var(--warn-soft)] px-4 py-3 text-[13px]">
          <div className="font-semibold text-[var(--warn)]">Not in the rep queue yet</div>
          <ul className="mt-1 list-disc pl-5 text-[var(--text-2)]">
            {blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
          <div className="mt-1 text-[12px] text-[var(--muted)]">The agents keep enriching; the account enters the queue automatically once every check passes.</div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="1 · Why this account matters">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[13px]">
            <span>
              <span className="text-[22px] font-semibold">{account.scores?.total ?? "–"}</span>
              <span className="text-[var(--muted)]">/100 score</span>
            </span>
            <span>
              priority <span className="font-semibold">{account.priority}</span>
            </span>
            {account.pipelineValue != null && (
              <span>
                est. value <span className="font-semibold">{fmtMoney(account.pipelineValue)}</span> <Badge title="Size-based estimate until the CRM supplies an amount">estimate</Badge>
              </span>
            )}
          </div>
          <p className="mt-2 text-[13px] text-[var(--text-2)]">
            {industry && industry.n >= 5 ? `${account.industry} companies convert at ${industry.lift.toFixed(1)}x the historical baseline (n=${industry.n}). ` : `Limited history for ${account.industry}. `}
            {verified.length ? `${verified.length} verified buying signal${verified.length === 1 ? "" : "s"}` : "No verified signals yet"}
            {hypotheses.length ? `, ${hypotheses.length} hypothes${hypotheses.length === 1 ? "is" : "es"} to confirm` : ""}.
          </p>
          <div className="mt-2 text-[12px] text-[var(--muted)]">Owner: {owner ? owner.name : "unassigned"}</div>
        </Card>

        <Card title="2 · Why now" hint={verified[0] ? `Most recent signal ${fmtAgo(verified[0].detectedAt)}` : undefined}>
          {verified.length + intent.length === 0 ? (
            <div className="text-[13px] text-[var(--muted)]">No verified trigger yet.</div>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {[...intent, ...verified].slice(0, 4).map((s) => (
                <SignalRow key={s.key} s={s} />
              ))}
            </ul>
          )}
        </Card>

        <Card title="3 · What problem Wilson might solve">
          <div className="text-[14px] font-medium">{account.painHypothesis ?? "Pain hypothesis not written yet"}</div>
          {account.messagingAngle && (
            <blockquote className="mt-2 border-l-2 border-[var(--accent)] pl-3 text-[13px] text-[var(--text-2)]">{account.messagingAngle}</blockquote>
          )}
          {proof && proofOutcome && (
            <div className="mt-3 text-[12.5px]">
              <span className="text-[var(--muted)]">Proof to cite: </span>
              {proof.story.customer}, {proofOutcome.value} {proofOutcome.metric.toLowerCase()} {proofOutcome.verified ? <Badge tone="good">verified</Badge> : <Badge tone="warn">{proof.story.placeholder ? "placeholder" : "unverified"}</Badge>}
            </div>
          )}
        </Card>

        <Card title="4 · Who to contact" hint={account.recommendedPersona ? `Persona: ${account.recommendedPersona}` : undefined}>
          {c ? (
            <div className="text-[13px]">
              <div className="text-[15px] font-semibold">{c.name}</div>
              <div className="text-[var(--text-2)]">{c.title}</div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                {c.phone ? (
                  <span className="mono">
                    {c.phone} {c.phoneVerified ? <Badge tone="good">verified</Badge> : <Badge>unverified</Badge>}
                  </span>
                ) : (
                  <span className="text-[var(--muted)]">no phone</span>
                )}
                {c.email ? <span className="mono">{c.email}</span> : <span className="text-[var(--muted)]">no email</span>}
                {c.linkedin && (
                  <a href={c.linkedin} target="_blank" rel="noreferrer" className="text-[var(--info)] hover:underline">
                    LinkedIn
                  </a>
                )}
              </div>
            </div>
          ) : (
            <div className="text-[13px] text-[var(--muted)]">No decision-maker identified. {account.facts.people.length ? `${account.facts.people.length} people on file for Research to evaluate.` : "No people found yet."}</div>
          )}
        </Card>

        <Card title="5 · What to say" hint={latestAlert ? `From Jerry's latest alert (${fmtAgo(latestAlert.createdAt)})` : "Generated opener"}>
          <blockquote className="text-[13px] italic text-[var(--text-2)]">“{opener}”</blockquote>
          {preparedFollowUp && (
            <div className="mt-3 text-[12.5px]">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">Prepared follow-up</div>
              <div className="font-medium">{preparedFollowUp.subject}</div>
              <div className="whitespace-pre-wrap text-[var(--text-2)]">{preparedFollowUp.body}</div>
            </div>
          )}
        </Card>

        <Card title="6 · What to do next">
          {account.nextAction ? (
            <div className="text-[13px]">
              <div className="text-[15px] font-semibold">{account.nextAction.label}</div>
              <div className="text-[var(--text-2)]">{account.nextAction.reason}</div>
              <div className="text-[12px] text-[var(--muted)]">due {fmtDate(account.nextAction.dueAt)}</div>
            </div>
          ) : (
            <div className="text-[13px] text-[var(--muted)]">No action recommended yet.</div>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <ConversationPanel ctx={panelCtx} />
            {user.role !== "bdr" && <AssignRep slug={account.slug} reps={reps.map((r) => ({ id: r.id, name: r.name }))} current={account.ownerRepId ?? null} />}
          </div>
        </Card>
      </div>

      <div className="mt-8">
        <Tabs
          base={`/accounts/${account.slug}`}
          current={tab}
          tabs={[
            { key: "research", label: "Research" },
            { key: "scoring", label: "Scoring" },
            { key: "history", label: "History", count: activity.length + conversations.length },
            { key: "campaign", label: "Campaign" },
            { key: "technical", label: "Technical" },
          ]}
        />

        {tab === "research" && (
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Account brief">
              <p className="text-[13px] text-[var(--text-2)]">{account.brief ?? "Research has not written the brief yet."}</p>
            </Card>
            <Card title="Missing information">
              {account.missingInfo.length ? (
                <ul className="list-disc pl-5 text-[13px] text-[var(--text-2)]">
                  {account.missingInfo.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              ) : (
                <div className="text-[13px] text-[var(--muted)]">Nothing flagged.</div>
              )}
            </Card>
            <Card title={`Verified signals (${verified.length + intent.length})`}>
              <ul className="divide-y divide-[var(--border)]">
                {[...verified, ...intent].map((s) => (
                  <SignalRow key={s.key} s={s} />
                ))}
              </ul>
            </Card>
            <Card title={`Hypotheses (${hypotheses.length})`} hint="Inferred, not yet confirmed by evidence">
              <ul className="divide-y divide-[var(--border)]">
                {hypotheses.map((s) => (
                  <SignalRow key={s.key} s={s} />
                ))}
              </ul>
              {hypotheses.length === 0 && <div className="text-[13px] text-[var(--muted)]">None.</div>}
            </Card>
          </div>
        )}

        {tab === "scoring" && (
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Score breakdown" hint={`Model v${account.modelVersion ?? "–"}`}>
              <ScoreBreakdown scores={account.scores} weights={model?.weights ?? null} explanation={account.scoreExplanation} modelVersion={account.modelVersion} />
            </Card>
            <Card title="Readiness checks" hint={account.readiness ? `Evaluated ${fmtAgo(account.readiness.evaluatedAt)}` : undefined}>
              {account.readiness ? (
                <ul className="divide-y divide-[var(--border)] text-[13px]">
                  {account.readiness.checks.map((k) => (
                    <li key={k.key} className="flex items-start gap-2 py-2">
                      <Badge tone={k.pass ? "good" : "bad"}>{k.pass ? "pass" : "fail"}</Badge>
                      <div>
                        <div className="font-medium">{k.label}</div>
                        <div className="text-[12px] text-[var(--muted)]">{k.detail}</div>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="text-[13px] text-[var(--muted)]">Not evaluated yet.</div>
              )}
            </Card>
          </div>
        )}

        {tab === "history" && (
          <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
            <Card title="Account history" hint="Team actions and prospect engagement, newest first">
              <ActivityTimeline activity={activity} events={events} />
            </Card>
            <div className="space-y-4">
              <Card title={`Conversations (${conversations.length})`}>
                {conversations.length === 0 ? (
                  <div className="text-[13px] text-[var(--muted)]">No conversations logged yet.</div>
                ) : (
                  <ul className="divide-y divide-[var(--border)]">
                    {conversations.map((cv) => (
                      <li key={cv.id} className="py-3 text-[13px]">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge tone="info">{cv.channel}</Badge>
                          <span className="font-medium">{cv.outcome.replace(/_/g, " ")}</span>
                          <span className="text-[12px] text-[var(--muted)]">{fmtAgo(cv.at)}</span>
                        </div>
                        <div className="mt-1 text-[var(--text-2)]">{cv.summary}</div>
                        {cv.objections.length > 0 && <div className="text-[12px] text-[var(--muted)]">Objections: {cv.objections.join("; ")}</div>}
                        {cv.followUpDraft && (
                          <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px]">
                            <span className="text-[var(--muted)]">Follow-up “{cv.followUpDraft.subject}”</span>
                            {cv.approved ? <Badge tone="good">approved</Badge> : <ApproveFollowUp conversationId={cv.id} />}
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
              <Card title={`Outcomes (${outcomes.length})`}>
                {outcomes.length === 0 ? (
                  <div className="text-[13px] text-[var(--muted)]">None yet.</div>
                ) : (
                  <ul className="divide-y divide-[var(--border)] text-[13px]">
                    {outcomes.map((o) => (
                      <li key={o.id} className="flex items-center justify-between py-2">
                        <span>
                          {o.outcomeType.replace(/_/g, " ")}
                          {o.value ? ` · ${fmtMoney(o.value)}` : ""}
                        </span>
                        <span className="text-[12px] text-[var(--muted)]">
                          {o.source} · {fmtAgo(o.createdAt)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
          </div>
        )}

        {tab === "campaign" && (
          <div className="space-y-4">
            {camp ? (
              <>
                <Card title="Campaign" hint={`Launched ${fmtDate(camp.launchedAt)} · persona ${camp.persona}`}>
                  <div className="text-[15px] font-semibold">{camp.headline}</div>
                  <div className="text-[13px] text-[var(--text-2)]">{camp.subheadline}</div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {Object.entries(camp.arms).map(([k, v]) => (
                      <Badge key={k}>
                        {k}: {String(v)}
                      </Badge>
                    ))}
                  </div>
                  <div className="mt-2 text-[12px] text-[var(--muted)]">
                    ROI defaults: {camp.roiDefaults.shipmentsPerMonth.toLocaleString()} shipments/mo · {camp.roiDefaults.minutesPerShipment} min · ${camp.roiDefaults.hourlyCost}/hr · {camp.roiDefaults.coordinators} coordinators
                  </div>
                </Card>
                <VideoPanel slug={account.slug} campaign={camp} />
              </>
            ) : (
              <Card title="Campaign">
                <div className="text-[13px] text-[var(--muted)]">No campaign yet. Campaigns launch automatically once the account qualifies and passes readiness.</div>
              </Card>
            )}
            <Card title={`Outreach sequence (${outreach.length})`}>
              {outreach.length === 0 ? (
                <div className="text-[13px] text-[var(--muted)]">No touches scheduled.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Step</th>
                        <th>Channel</th>
                        <th>Status</th>
                        <th>Scheduled</th>
                        <th>Message</th>
                      </tr>
                    </thead>
                    <tbody>
                      {outreach.map((t) => (
                        <tr key={t.id}>
                          <td>{t.step}</td>
                          <td>{t.channel}</td>
                          <td>
                            <span className={outreachPillClass(t.status)}>{t.status.replace(/_/g, " ")}</span>
                            {t.note && <div className="text-[11px] text-[var(--muted)]">{t.note}</div>}
                          </td>
                          <td className="mono whitespace-nowrap">{fmtDate(t.scheduledFor).slice(0, 10)}</td>
                          <td className="max-w-md">
                            {t.subject && <div className="font-medium">{t.subject}</div>}
                            <div className="line-clamp-3 whitespace-pre-wrap text-[var(--text-2)]">{t.body}</div>
                            {isOpen(t) && (
                              <div className="mt-1">
                                <TaskActions task={t} action={primaryActionFor(t, providers)} compact />
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
            {alerts.length > 0 && (
              <div className="space-y-3">
                <h3 className="section-title">Rep alerts</h3>
                {alerts.map((al) => (
                  <AlertCard key={al.id} alert={al} />
                ))}
              </div>
            )}
          </div>
        )}

        {tab === "technical" && (
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Data provenance">
              <dl className="grid grid-cols-[140px_1fr] gap-y-1 text-[13px]">
                <dt className="text-[var(--muted)]">Facts source</dt>
                <dd>
                  {account.facts.source} {account.facts.source === "synthetic" && <Badge tone="warn">synthetic</Badge>}
                </dd>
                <dt className="text-[var(--muted)]">Facts updated</dt>
                <dd>{fmtDate(account.factsUpdatedAt)}</dd>
                <dt className="text-[var(--muted)]">Created</dt>
                <dd>{fmtDate(account.createdAt)}</dd>
                <dt className="text-[var(--muted)]">Domain</dt>
                <dd className="mono">{account.domain}</dd>
                <dt className="text-[var(--muted)]">CRM owner</dt>
                <dd>{account.crmOwner ?? "none"}</dd>
                <dt className="text-[var(--muted)]">Experiments</dt>
                <dd>
                  {account.experiments && Object.keys(account.experiments).length ? (
                    Object.entries(account.experiments).map(([id, arm]) => (
                      <div key={id} className="mono text-[12px]">
                        {id.slice(0, 8)} → {arm}
                      </div>
                    ))
                  ) : (
                    <span className="text-[var(--muted)]">none</span>
                  )}
                </dd>
              </dl>
            </Card>
            <Card title="Agent runs on this account">
              <ul className="text-[13px]">
                {Object.entries(account.agentRuns)
                  .sort((a, b) => b[1].localeCompare(a[1]))
                  .map(([agent, at]) => (
                    <li key={agent} className="flex justify-between py-1">
                      <span>{agent.replace(/_/g, " ")}</span>
                      <span className="text-[12px] text-[var(--muted)]">{fmtDate(at)}</span>
                    </li>
                  ))}
                {Object.keys(account.agentRuns).length === 0 && <li className="text-[var(--muted)]">No agent has processed this account yet.</li>}
              </ul>
            </Card>
            <Card title="Demo controls" hint="Simulated engagement and outcomes for walkthroughs; not available in production" className="lg:col-span-2">
              <div className="grid gap-4 md:grid-cols-2">
                <EngagementSimulator slug={account.slug} />
                <OutcomeButtons slug={account.slug} />
              </div>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
