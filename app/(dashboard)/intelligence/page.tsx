import Link from "next/link";
import { RetrainButton } from "@/components/dashboard/RetrainButton";
import { Badge, ButtonLink, Card, EmptyState, PageHeader, Synthetic, fmtDate } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { EXPERIMENT_TYPES, normalizeExperiment } from "@/lib/engine/experiments";
import { getStore } from "@/lib/store";
import { experiments as expCol } from "@/lib/store/collections";
import type { IcpBucket, Weights } from "@/lib/types";

export const dynamic = "force-dynamic";

const WEIGHT_KEYS: { key: keyof Weights; label: string }[] = [
  { key: "signal", label: "Buying signals" },
  { key: "icp", label: "ICP similarity" },
  { key: "pain", label: "Operational pain" },
  { key: "timing", label: "Timing / urgency" },
  { key: "access", label: "Decision-maker access" },
];

function pct(n: number, d = 0) {
  return `${(n * 100).toFixed(d)}%`;
}

function Buckets({ title, rows }: { title: string; rows: IcpBucket[] }) {
  return (
    <div>
      <div className="card-title mb-1">{title}</div>
      <table className="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>n</th>
            <th>Conversion</th>
            <th>Lift</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((b) => (
            <tr key={b.name}>
              <td>{b.name}</td>
              <td className="mono">{b.n}</td>
              <td className="mono">{pct(b.winRate, 1)}</td>
              <td className="mono">{b.lift.toFixed(2)}x</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function IntelligencePage({ searchParams }: { searchParams: Promise<{ v?: string }> }) {
  await requireRole(["exec", "admin"]);
  const { v } = await searchParams;
  const store = getStore();
  const [models, accounts, experiments] = await Promise.all([store.listModels(), store.listAccounts(), expCol.list()]);
  const model = models.find((m) => String(m.version) === v) ?? models[0] ?? null;

  if (!model) {
    return (
      <div className="page">
        <PageHeader eyebrow="Executive" title="Intelligence" />
        <EmptyState title="No model trained yet" body="Seed demo data or connect the CRM export, then retrain." action={<RetrainButton />} />
      </div>
    );
  }

  const live = accounts.filter((a) => !["won", "lost", "disqualified"].includes(a.status));
  const liveWith = (key: string) => live.filter((a) => a.signals.some((s) => s.key === key && s.status === "verified")).length;
  const strongest = model.signalPatterns.filter((p) => p.withN >= 5 && p.lift > 1).slice(0, 6);
  const industries = model.icp.industries.filter((b) => b.n >= 5).slice(0, 5);
  const personas = model.icp.personas.filter((b) => b.n >= 5).slice(0, 5);
  const histN = Math.max(1, model.baseline.n);
  const emerging = model.signalPatterns
    .map((p) => ({ p, liveShare: live.length ? liveWith(p.key) / live.length : 0, histShare: p.withN / histN }))
    .filter((x) => x.liveShare > x.histShare * 1.3 && x.liveShare > 0.08)
    .sort((a, b) => b.liveShare - a.liveShare)
    .slice(0, 5);
  const existingTypes = new Set(experiments.map((e) => normalizeExperiment(e).type));
  const recommended = EXPERIMENT_TYPES.filter((t) => !existingTypes.has(t.type)).slice(0, 4);
  const previous = models.find((m) => m.version === model.version - 1) ?? null;
  const patterns = [...model.signalPatterns].sort((a, b) => b.lift - a.lift);
  const synthetic = accounts.some((a) => a.facts.source === "synthetic");

  return (
    <div className="page">
      <PageHeader
        eyebrow="Executive"
        title="Intelligence"
        description={`What converts, where the opportunities are, and what to test next. Model v${model.version}, trained ${fmtDate(model.trainedAt)} on ${model.baseline.n} records.`}
        actions={<Synthetic when={synthetic} />}
      />

      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <Card title="Strongest buying signals" hint="Historical conversion lift; 'live' is how many open accounts carry the signal today" className="lg:col-span-2" padded={false}>
          <table className="table">
            <thead>
              <tr>
                <th>Signal</th>
                <th>Lift</th>
                <th>Converted</th>
                <th>Live accounts</th>
              </tr>
            </thead>
            <tbody>
              {strongest.map((p) => (
                <tr key={p.key}>
                  <td>{p.label}</td>
                  <td className="mono">{p.lift.toFixed(1)}x</td>
                  <td className="mono">
                    {p.withWon}/{p.withN}
                  </td>
                  <td className="mono">{liveWith(p.key)}</td>
                </tr>
              ))}
              {!strongest.length && (
                <tr>
                  <td colSpan={4} className="muted">
                    No signal has five or more historical samples yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
        <div className="flex flex-col gap-4">
          <Card title="Best-performing industries">
            <ul className="divide-y divide-[var(--border)]">
              {industries.map((b) => (
                <li key={b.name} className="flex justify-between py-1.5 text-[13px]">
                  <span>{b.name}</span>
                  <span className="mono text-[var(--text-2)]">
                    {b.lift.toFixed(1)}x <span className="muted">· n={b.n}</span>
                  </span>
                </li>
              ))}
              {!industries.length && <li className="card-hint">Not enough history.</li>}
            </ul>
          </Card>
          <Card title="Best-performing personas">
            <ul className="divide-y divide-[var(--border)]">
              {personas.map((b) => (
                <li key={b.name} className="flex justify-between py-1.5 text-[13px]">
                  <span>{b.name}</span>
                  <span className="mono text-[var(--text-2)]">
                    {b.lift.toFixed(1)}x <span className="muted">· n={b.n}</span>
                  </span>
                </li>
              ))}
              {!personas.length && <li className="card-hint">Not enough history.</li>}
            </ul>
          </Card>
        </div>
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <Card title="Emerging opportunities" hint="Signals more common among open accounts than in the historical set">
          {emerging.length ? (
            <ul className="divide-y divide-[var(--border)]">
              {emerging.map(({ p, liveShare, histShare }) => (
                <li key={p.key} className="flex items-center justify-between gap-2 py-2 text-[13px]">
                  <div>
                    <div>{p.label}</div>
                    <div className="card-hint">
                      {pct(liveShare)} of open accounts vs {pct(histShare)} historically
                    </div>
                  </div>
                  {p.withN < 5 ? <Badge tone="warn">emerging, not yet validated</Badge> : <Badge tone="info">{p.lift.toFixed(1)}x lift</Badge>}
                </li>
              ))}
            </ul>
          ) : (
            <div className="card-hint">Current accounts mirror the historical signal mix.</div>
          )}
        </Card>
        <Card title="Questions the Lab has not tested yet" hint="Each one compares a single change against what you do today" actions={<ButtonLink href="/lab" variant="ghost" className="btn-sm">Open the Lab</ButtonLink>}>
          {recommended.length ? (
            <ul className="divide-y divide-[var(--border)]">
              {recommended.map((t) => (
                <li key={t.type} className="py-2 text-[13px]">
                  <div className="font-medium">{t.label}</div>
                  <div className="card-hint">{t.question}</div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="card-hint">Every kind of experiment has been tried at least once.</div>
          )}
        </Card>
      </div>

      <details className="card">
        <summary className="cursor-pointer px-4 py-3 text-[13px] font-semibold">Advanced: model weights, patterns, ICP buckets, playbook and versions</summary>
        <div className="space-y-6 border-t border-[var(--border)] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-[13px] text-[var(--muted)]">
              {model.baseline.wins} won · {model.baseline.meetings} meetings · {pct(model.baseline.conversionRate, 1)} conversion (won or meeting)
            </div>
            <RetrainButton />
          </div>

          <div>
            <div className="card-title mb-2">Category weights (learned vs prior){previous ? ` · deltas vs v${previous.version}` : ""}</div>
            <div className="space-y-2">
              {WEIGHT_KEYS.map(({ key, label }) => {
                const w = model.weights[key];
                const p = model.priorWeights[key];
                const delta = previous ? w - previous.weights[key] : null;
                return (
                  <div key={key} className="grid grid-cols-[170px_1fr_200px] items-center gap-3 text-[13px]">
                    <div>
                      {label}
                      <div className="mono text-[11px] text-[var(--muted)]">corr {model.categoryCorrelations[key].toFixed(2)}</div>
                    </div>
                    <div className="space-y-1">
                      <div className="bar bar-accent">
                        <span style={{ width: `${Math.min(100, w * 250)}%` }} />
                      </div>
                      <div className="bar opacity-50">
                        <span style={{ width: `${Math.min(100, p * 250)}%` }} />
                      </div>
                    </div>
                    <div className="mono text-right">
                      {w.toFixed(2)} <span className="muted">/ prior {p.toFixed(2)}</span>
                      {delta !== null && Math.abs(delta) >= 0.005 && <span className={`ml-1 ${delta > 0 ? "text-[var(--good)]" : "text-[var(--bad)]"}`}>{delta > 0 ? "+" : ""}{delta.toFixed(2)}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div>
            <div className="card-title mb-2">Signal patterns ({patterns.length})</div>
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Key</th>
                    <th>Type</th>
                    <th>Lift</th>
                    <th>With</th>
                    <th>Without</th>
                    <th>Weight</th>
                    <th>Confidence</th>
                  </tr>
                </thead>
                <tbody>
                  {patterns.map((p) => (
                    <tr key={p.key} className={p.withN < 5 ? "opacity-60" : ""}>
                      <td className="mono">{p.key}</td>
                      <td>{p.type}</td>
                      <td className="mono">{p.lift.toFixed(2)}x</td>
                      <td className="mono">
                        {p.withWon}/{p.withN} ({pct(p.rateWith, 1)})
                      </td>
                      <td className="mono">
                        {p.withoutWon}/{p.withoutN} ({pct(p.rateWithout, 1)})
                      </td>
                      <td className="mono">{p.weight.toFixed(2)}</td>
                      <td className="mono">
                        {p.confidence.toFixed(2)} {p.withN < 5 && <span className="muted">low sample</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Buckets title="Industries" rows={model.icp.industries.filter((b) => b.n > 0)} />
            <Buckets title="Size bands" rows={model.icp.sizeBands.filter((b) => b.n > 0)} />
            <Buckets title="Personas" rows={model.icp.personas.filter((b) => b.n > 0)} />
          </div>

          <div>
            <div className="card-title mb-1">
              Playbook <Badge>{model.playbook.generatedBy}</Badge>
            </div>
            <p className="text-[13px]">{model.playbook.summary}</p>
            <table className="table mt-2">
              <thead>
                <tr>
                  <th>Signal</th>
                  <th>Angle</th>
                  <th>n</th>
                  <th>Conversion</th>
                </tr>
              </thead>
              <tbody>
                {model.playbook.angles.map((a) => (
                  <tr key={a.signalKey}>
                    <td className="mono">{a.signalKey}</td>
                    <td>{a.angle}</td>
                    <td className="mono">{a.sampleSize}</td>
                    <td className="mono">{pct(a.winRate, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {model.playbook.personaNotes.length > 0 && (
              <ul className="mt-2 list-disc pl-5 text-[12.5px] text-[var(--text-2)]">
                {model.playbook.personaNotes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <div className="card-title mb-1">Versions</div>
            <ul className="divide-y divide-[var(--border)]">
              {models.map((m) => (
                <li key={m.version} className="py-2 text-[13px]">
                  <Link href={`/intelligence?v=${m.version}`} className={`font-medium hover:underline ${m.version === model.version ? "text-[var(--accent)]" : ""}`}>
                    v{m.version}
                  </Link>
                  <span className="muted"> · {fmtDate(m.trainedAt)} · n={m.baseline.n}</span>
                  <ul className="mt-1 list-disc pl-5 text-[12px] text-[var(--muted)]">
                    {m.notes.map((n, i) => (
                      <li key={i}>{n}</li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </details>
    </div>
  );
}
