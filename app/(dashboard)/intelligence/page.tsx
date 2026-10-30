import Link from "next/link";
import { RetrainButton } from "@/components/dashboard/RetrainButton";
import { fmtPct, fmtTime } from "@/components/dashboard/format";
import { getStore } from "@/lib/store";
import type { IcpBucket, Weights } from "@/lib/types";

export const dynamic = "force-dynamic";

const WEIGHT_KEYS: { key: keyof Weights; label: string }[] = [
  { key: "signal", label: "Buying signals" },
  { key: "icp", label: "ICP similarity" },
  { key: "pain", label: "Operational pain" },
  { key: "timing", label: "Timing / urgency" },
  { key: "access", label: "Decision-maker access" },
];

export default async function IntelligencePage({ searchParams }: { searchParams: Promise<{ v?: string }> }) {
  const { v } = await searchParams;
  const models = await getStore().listModels();
  const selected = models.find((m) => String(m.version) === v) ?? models[0] ?? null;

  if (!selected) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold">Intelligence</h1>
        <div className="panel p-6 text-sm text-[var(--muted)]">No model trained yet. Seed demo data from the Pipeline page, or retrain once historical records exist.</div>
        <RetrainButton />
      </div>
    );
  }

  const previous = models.find((m) => m.version === selected.version - 1) ?? null;
  const patterns = [...selected.signalPatterns].sort((a, b) => b.lift - a.lift);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Intelligence</h1>
          <p className="text-sm text-[var(--muted)]">
            Model v{selected.version} · trained {fmtTime(selected.trainedAt)} on {selected.baseline.n} records · {selected.baseline.wins} won · {selected.baseline.meetings} meetings ·{" "}
            {fmtPct(selected.baseline.conversionRate, 1)} conversion (won or meeting)
          </p>
        </div>
        <RetrainButton />
      </div>

      <section className="grid gap-3 lg:grid-cols-3">
        <div className="panel p-4 lg:col-span-2">
          <h2 className="font-semibold">Category weights</h2>
          <div className="mt-1 text-xs text-[var(--muted)]">
            learned (orange) vs spec prior (grey){previous ? ` · deltas vs v${previous.version}` : ""} · correlation = in-sample point-biserial of the category sub-score with conversion
          </div>
          <div className="mt-3 space-y-3">
            {WEIGHT_KEYS.map(({ key, label }) => {
              const w = selected.weights[key];
              const p = selected.priorWeights[key];
              const corr = selected.categoryCorrelations[key];
              const delta = previous ? w - previous.weights[key] : null;
              return (
                <div key={key} className="grid grid-cols-[170px_1fr_150px] items-center gap-3 text-sm">
                  <div>
                    <div>{label}</div>
                    <div className="mono text-[11px] text-[var(--muted)]">corr {corr.toFixed(2)}</div>
                  </div>
                  <div className="space-y-1">
                    <span className="bar block">
                      <span style={{ width: `${Math.min(100, w * 250)}%` }} />
                    </span>
                    <span className="bar block opacity-40">
                      <span style={{ width: `${Math.min(100, p * 250)}%`, background: "var(--muted)" }} />
                    </span>
                  </div>
                  <div className="mono text-right">
                    {w.toFixed(2)} <span className="text-[var(--muted)]">/ prior {p.toFixed(2)}</span>
                    {delta !== null && Math.abs(delta) >= 0.005 && (
                      <span className={`ml-1 ${delta > 0 ? "text-[var(--good)]" : "text-[var(--bad)]"}`}>
                        {delta > 0 ? "+" : ""}
                        {delta.toFixed(2)}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <ul className="mt-4 space-y-1 border-t border-[var(--border)] pt-3 text-xs text-[var(--muted)]">
            {selected.notes.map((n, i) => (
              <li key={i}>• {n}</li>
            ))}
          </ul>
        </div>

        <div className="panel p-4">
          <h2 className="font-semibold">Versions</h2>
          <ol className="mt-2 max-h-[360px] space-y-2 overflow-y-auto text-sm">
            {models.map((m) => (
              <li key={m.version}>
                <Link href={`/intelligence?v=${m.version}`} className={`block rounded-md border p-2 no-underline ${m.version === selected.version ? "border-[var(--accent)] bg-[var(--panel-2)]" : "border-[var(--border)] hover:border-[var(--muted)]"}`}>
                  <div className="flex items-center justify-between">
                    <span className="font-medium">v{m.version}</span>
                    <span className="mono text-xs text-[var(--muted)]">{fmtTime(m.trainedAt)}</span>
                  </div>
                  <div className="mono text-xs text-[var(--muted)]">
                    n={m.baseline.n} · won {m.baseline.wins} · meetings {m.baseline.meetings} · conv {fmtPct(m.baseline.conversionRate, 1)}
                  </div>
                  <div className="mt-1 line-clamp-2 text-xs text-[var(--text)]/70">{m.notes[m.notes.length - 1]}</div>
                </Link>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="panel overflow-x-auto">
        <div className="flex items-center justify-between px-4 py-2">
          <h2 className="font-semibold">Signal patterns</h2>
          <span className="text-xs text-[var(--muted)]">conversion with vs without the signal, Laplace-smoothed · {patterns.length} keys</span>
        </div>
        <table className="w-full min-w-[900px] text-sm">
          <thead className="text-left text-[11px] uppercase tracking-wider text-[var(--muted)]">
            <tr>
              <th className="px-4 py-1.5">Signal</th>
              <th className="px-2 py-1.5">Type</th>
              <th className="px-2 py-1.5 text-right">Lift</th>
              <th className="px-2 py-1.5 text-right">With</th>
              <th className="px-2 py-1.5 text-right">Without</th>
              <th className="px-2 py-1.5 text-right">Converted / n</th>
              <th className="px-2 py-1.5 text-right">Weight</th>
              <th className="px-2 py-1.5 text-right">Confidence</th>
              <th className="px-2 py-1.5" />
            </tr>
          </thead>
          <tbody>
            {patterns.map((p) => {
              const low = p.withN < 5;
              return (
                <tr key={p.key} className={`border-t border-[var(--border)] ${low ? "text-[var(--muted)]" : ""}`}>
                  <td className="px-4 py-1.5">
                    <div>{p.label}</div>
                    <div className="mono text-[11px] text-[var(--muted)]">{p.key}</div>
                  </td>
                  <td className="px-2 py-1.5">
                    <span className="pill">{p.type}</span>
                  </td>
                  <td className="mono px-2 py-1.5 text-right font-semibold" style={{ color: low ? undefined : p.lift >= 1.5 ? "var(--good)" : p.lift < 0.8 ? "var(--bad)" : undefined }}>
                    {p.lift.toFixed(2)}x
                  </td>
                  <td className="mono px-2 py-1.5 text-right">{fmtPct(p.rateWith, 1)}</td>
                  <td className="mono px-2 py-1.5 text-right">{fmtPct(p.rateWithout, 1)}</td>
                  <td className="mono px-2 py-1.5 text-right">
                    {p.withWon}/{p.withN}
                  </td>
                  <td className="mono px-2 py-1.5 text-right">{p.weight.toFixed(2)}</td>
                  <td className="px-2 py-1.5">
                    <div className="flex items-center justify-end gap-2">
                      <span className="bar w-14">
                        <span style={{ width: `${p.confidence * 100}%` }} />
                      </span>
                      <span className="mono w-8 text-right">{Math.round(p.confidence * 100)}%</span>
                    </div>
                  </td>
                  <td className="px-2 py-1.5">{low && <span className="pill pill-warn">low sample</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="grid gap-3 lg:grid-cols-3">
        <BucketTable title="Industries" rows={selected.icp.industries} />
        <BucketTable title="Size bands" rows={selected.icp.sizeBands} />
        <BucketTable title="Personas" rows={selected.icp.personas} />
      </section>

      <section className="panel p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Messaging playbook</h2>
          <span className={selected.playbook.generatedBy === "llm" ? "pill pill-good" : "pill pill-warn"}>{selected.playbook.generatedBy === "llm" ? "written by Claude" : "template"}</span>
        </div>
        <p className="mt-2 text-sm leading-relaxed">{selected.playbook.summary}</p>
        {selected.playbook.angles.length > 0 && (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="text-left text-[11px] uppercase tracking-wider text-[var(--muted)]">
                <tr>
                  <th className="py-1 pr-2">Signal</th>
                  <th className="py-1 pr-2">Angle</th>
                  <th className="py-1 pr-2 text-right">Sample</th>
                  <th className="py-1 text-right">Conversion</th>
                </tr>
              </thead>
              <tbody>
                {selected.playbook.angles.map((a) => (
                  <tr key={a.signalKey} className="border-t border-[var(--border)] align-top">
                    <td className="mono py-1.5 pr-2 text-xs">{a.signalKey}</td>
                    <td className="py-1.5 pr-2">{a.angle}</td>
                    <td className="mono py-1.5 pr-2 text-right">{a.sampleSize}</td>
                    <td className="mono py-1.5 text-right">{fmtPct(a.winRate, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {selected.playbook.personaNotes.length > 0 && (
          <ul className="mt-3 space-y-1 border-t border-[var(--border)] pt-3 text-sm">
            {selected.playbook.personaNotes.map((n, i) => (
              <li key={i}>• {n}</li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function BucketTable({ title, rows }: { title: string; rows: IcpBucket[] }) {
  return (
    <div className="panel p-4">
      <h2 className="font-semibold">{title}</h2>
      <table className="mt-2 w-full text-sm">
        <thead className="text-left text-[11px] uppercase tracking-wider text-[var(--muted)]">
          <tr>
            <th className="py-1 pr-2">Name</th>
            <th className="py-1 pr-2 text-right">n</th>
            <th className="py-1 pr-2 text-right">Conv.</th>
            <th className="py-1 text-right">Lift</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name} className={`border-t border-[var(--border)] ${r.n < 5 ? "text-[var(--muted)]" : ""}`}>
              <td className="py-1 pr-2">{r.name}</td>
              <td className="mono py-1 pr-2 text-right">{r.n}</td>
              <td className="mono py-1 pr-2 text-right">{fmtPct(r.winRate)}</td>
              <td className="mono py-1 text-right" style={{ color: r.n >= 5 && r.lift >= 1.3 ? "var(--good)" : r.n >= 5 && r.lift < 0.8 ? "var(--bad)" : undefined }}>
                {r.lift.toFixed(2)}x
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
