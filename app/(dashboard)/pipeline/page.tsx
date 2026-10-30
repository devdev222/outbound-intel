import Link from "next/link";
import { Recommendations } from "@/components/exec/Recommendations";
import { Badge, Card, Kpi, PageHeader, Synthetic, fmtAgo, fmtMoney } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { execSummary } from "@/lib/engine/insights";
import { getStore } from "@/lib/store";
import type { Account, AccountStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

const STAGES: { key: string; label: string; match: (a: Account) => boolean }[] = [
  { key: "discovered", label: "Discovered", match: () => true },
  { key: "scored", label: "Scored", match: (a) => a.scores !== null },
  { key: "qualified", label: "Qualified", match: (a) => a.scores !== null && !!a.readiness && (["qualified", "campaign_live", "engaged", "hot", "meeting_booked", "won"] as AccountStatus[]).includes(a.status) },
  { key: "campaign_live", label: "Campaign live", match: (a) => a.campaign !== null },
  { key: "engaged", label: "Engaged or hot", match: (a) => a.engagementScore > 0 || (["engaged", "hot", "meeting_booked", "won"] as AccountStatus[]).includes(a.status) },
  { key: "meeting", label: "Meeting booked", match: (a) => (["meeting_booked", "won"] as AccountStatus[]).includes(a.status) },
  { key: "won", label: "Won", match: (a) => a.status === "won" },
];

export default async function PipelinePage() {
  await requireRole(["exec", "admin"]);
  const store = getStore();
  const [accounts, outcomes, summary] = await Promise.all([store.listAccounts(), store.listOutcomes({ limit: 20 }), execSummary(store)]);
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const counts = STAGES.map((s) => accounts.filter(s.match).length);
  const enrichment = accounts.filter((a) => a.status === "needs_enrichment").length;

  const ready = accounts.filter((a) => a.readiness?.ready).length;
  const meetings = new Set(outcomes.filter((o) => o.outcomeType === "meeting_booked").map((o) => o.accountId)).size;
  const allOutcomes = await store.listOutcomes();
  const meetingAccounts = new Set(allOutcomes.filter((o) => o.outcomeType === "meeting_booked").map((o) => o.accountId));
  const oppAccounts = new Set(allOutcomes.filter((o) => o.outcomeType === "opportunity_created" || o.outcomeType === "deal_won").map((o) => o.accountId));
  const readyToMeeting = ready ? meetingAccounts.size / Math.max(ready, meetingAccounts.size) : 0;
  const meetingToOpp = meetingAccounts.size ? [...oppAccounts].filter((id) => meetingAccounts.has(id)).length / meetingAccounts.size : 0;
  void meetings;

  return (
    <div className="page">
      <PageHeader eyebrow="Executive" title="Pipeline" description="Where accounts are, how they convert between stages, and what the system recommends." actions={<Synthetic when={summary.syntheticData} />} />

      <div className="grid-kpi mb-6">
        <Kpi label="Qualified pipeline" value={fmtMoney(summary.kpis[0].value)} hint={summary.kpis[0].hint} estimate={summary.kpis[0].estimate} />
        <Kpi label="Ready → meeting" value={`${Math.round(readyToMeeting * 100)}%`} hint={`${meetingAccounts.size} accounts booked of ${ready} rep-ready`} estimate />
        <Kpi label="Meeting → opportunity" value={`${Math.round(meetingToOpp * 100)}%`} hint={`${oppAccounts.size} opportunities created`} />
        <Kpi label="Back in enrichment" value={String(enrichment)} hint="qualified on score, missing readiness checks" tone={enrichment > 10 ? "warn" : undefined} />
      </div>

      <Card title="Account flow" hint="Cumulative counts; the percentage is the conversion from the previous stage." className="mb-6">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4 lg:grid-cols-7">
          {STAGES.map((s, i) => {
            const prev = i > 0 ? counts[i - 1] : null;
            const pct = prev ? Math.round((counts[i] / prev) * 100) : null;
            return (
              <div key={s.key} className="rounded-lg border border-[var(--border)] p-3">
                <div className="card-hint">{s.label}</div>
                <div className="kpi-value mt-1 text-[22px]">{counts[i]}</div>
                {pct !== null && <div className="mono mt-1 text-[11.5px] text-[var(--muted)]">{pct}% of previous</div>}
              </div>
            );
          })}
        </div>
        {enrichment > 0 && (
          <div className="card-hint mt-3">
            {enrichment} account{enrichment === 1 ? "" : "s"} scored above the threshold but returned to enrichment (missing contact, evidence or ownership checks). <Link href="/accounts?status=needs_enrichment" className="underline">Review</Link>
          </div>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Recommendations items={summary.recommendations} />
        </div>
        <Card title="Recent outcomes" hint="Latest meetings, opportunities and closes">
          {outcomes.length ? (
            <ul className="divide-y divide-[var(--border)]">
              {outcomes.map((o) => {
                const a = byId.get(o.accountId);
                const tone = o.outcomeType === "deal_won" || o.outcomeType === "opportunity_created" ? "good" : o.outcomeType === "meeting_booked" ? "info" : o.outcomeType === "deal_lost" || o.outcomeType === "no_response" ? "bad" : "neutral";
                return (
                  <li key={o.id} className="flex items-center justify-between gap-2 py-2 text-[13px]">
                    <div className="min-w-0">
                      {a ? (
                        <Link href={`/accounts/${a.slug}`} className="truncate font-medium hover:underline">
                          {a.companyName}
                        </Link>
                      ) : (
                        <span className="muted">unknown account</span>
                      )}
                      <div className="card-hint">
                        {fmtAgo(o.createdAt)} · {o.source}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {o.value != null && <span className="mono">{fmtMoney(o.value)}</span>}
                      <Badge tone={tone}>{o.outcomeType.replace(/_/g, " ")}</Badge>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="card-hint">No outcomes logged yet.</div>
          )}
        </Card>
      </div>
    </div>
  );
}
