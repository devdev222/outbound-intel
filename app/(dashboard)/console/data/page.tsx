import { Card, Meter, PageHeader, Stat } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { getStore } from "@/lib/store";
import { getSettings } from "@/lib/store/collections";

export const dynamic = "force-dynamic";

export default async function DataSourcesPage() {
  await requireRole(["admin"]);
  const store = getStore();
  const [accounts, activity, settings, model] = await Promise.all([store.listAccounts(), store.listActivity({ limit: 5000 }), getSettings(), store.getLatestModel()]);
  const freshness = settings.automation.signalFreshnessDays;

  const bySource = new Map<string, number>();
  for (const a of accounts) bySource.set(a.facts.source, (bySource.get(a.facts.source) ?? 0) + 1);

  const buckets = { fresh: 0, aging: 0, stale: 0 };
  const signalSources = new Map<string, number>();
  let totalSignals = 0;
  for (const a of accounts)
    for (const s of a.signals) {
      if (s.type === "intent") continue;
      totalSignals++;
      const days = (Date.now() - new Date(s.detectedAt).getTime()) / 86_400_000;
      if (days <= 30) buckets.fresh++;
      else if (days <= 90) buckets.aging++;
      else buckets.stale++;
      for (const e of s.evidence) signalSources.set(e.source, (signalSources.get(e.source) ?? 0) + 1);
    }
  const staleByThreshold = accounts.reduce((n, a) => n + a.signals.filter((s) => s.type !== "intent" && (Date.now() - new Date(s.detectedAt).getTime()) / 86_400_000 > freshness).length, 0);

  const withContact = accounts.filter((a) => a.contact).length;
  const verifiedPhone = accounts.filter((a) => a.contact?.phone && a.contact.phoneVerified).length;
  const anyPhone = accounts.filter((a) => a.contact?.phone).length;
  const email = accounts.filter((a) => a.contact?.email).length;
  const linkedin = accounts.filter((a) => a.contact?.linkedin).length;

  const webhook = new Map<string, number>();
  for (const e of activity) if (e.actor === "webhook") webhook.set(e.action, (webhook.get(e.action) ?? 0) + 1);

  const pct = (n: number) => (accounts.length ? Math.round((n / accounts.length) * 100) : 0);

  return (
    <div className="page">
      <PageHeader eyebrow="Revenue engineering" title="Data sources" description="Where accounts, signals and contacts come from, how fresh they are, and what the webhooks have delivered." />
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Accounts by source" hint={`${accounts.length} accounts · store: ${store.kind}`}>
          <div className="space-y-2">
            {[...bySource.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => (
              <div key={k}>
                <div className="flex justify-between text-sm">
                  <span className="mono">{k}</span>
                  <span>{v}</span>
                </div>
                <Meter value={v} max={accounts.length} />
              </div>
            ))}
            {!bySource.size && <div className="text-sm text-[var(--muted)]">No accounts yet.</div>}
          </div>
          <div className="mt-3 text-xs text-[var(--muted)]">Synthetic accounts are demo data; Clay, RB2B and CRM sources are real once wired.</div>
        </Card>
        <Card title="Signal freshness" hint={`${totalSignals} signals · ${staleByThreshold} older than the ${freshness}-day threshold`}>
          <div className="space-y-2">
            {[
              ["0–30 days", buckets.fresh],
              ["31–90 days", buckets.aging],
              ["90+ days", buckets.stale],
            ].map(([label, n]) => (
              <div key={String(label)}>
                <div className="flex justify-between text-sm">
                  <span>{label}</span>
                  <span>{n}</span>
                </div>
                <Meter value={Number(n)} max={totalSignals || 1} accent={label === "90+ days"} />
              </div>
            ))}
          </div>
          <details className="mt-3 text-xs">
            <summary className="cursor-pointer text-[var(--muted)]">Evidence sources</summary>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {[...signalSources.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => (
                <span key={k} className="pill">
                  {k}: {v}
                </span>
              ))}
            </div>
          </details>
        </Card>
        <Card title="Contact verification" hint="usable channels on the selected decision-maker">
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Contact selected" value={`${withContact} (${pct(withContact)}%)`} />
            <Stat label="Verified phone" value={`${verifiedPhone} (${pct(verifiedPhone)}%)`} sub={`${anyPhone - verifiedPhone} unverified`} />
            <Stat label="Email" value={`${email} (${pct(email)}%)`} />
            <Stat label="LinkedIn" value={`${linkedin} (${pct(linkedin)}%)`} />
          </div>
        </Card>
        <Card title="Webhook deliveries" hint="activity written by inbound integrations">
          {webhook.size ? (
            <table className="table">
              <tbody>
                {[...webhook.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => (
                  <tr key={k}>
                    <td className="mono">{k}</td>
                    <td className="text-right">{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="text-sm text-[var(--muted)]">No webhook activity yet. Clay, Tavus, Resend, RB2B and Calendly deliveries will show here.</div>
          )}
        </Card>
        <Card title="Scoring model" hint={model ? `v${model.version} · trained ${model.trainedAt.slice(0, 16).replace("T", " ")}` : "no model"}>
          {model ? (
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Training records" value={model.baseline.n} />
              <Stat label="Conversion rate" value={`${Math.round(model.baseline.conversionRate * 100)}%`} sub={`${model.baseline.wins} won · ${model.baseline.meetings} meetings`} />
              <Stat label="Signal patterns" value={model.signalPatterns.filter((p) => p.withN >= 5).length} sub="with 5+ samples" />
              <Stat label="Playbook" value={model.playbook.generatedBy} />
            </div>
          ) : (
            <div className="text-sm text-[var(--muted)]">Run Learn to train a model.</div>
          )}
        </Card>
      </div>
    </div>
  );
}
