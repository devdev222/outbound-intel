import type { ScoreBreakdown as Breakdown, Weights } from "@/lib/types";
import { scoreColor } from "./format";

const ROWS: { key: keyof Weights; label: string; hint: string }[] = [
  { key: "signal", label: "Buying signals", hint: "presence of high-converting signals, weighted by learned lift" },
  { key: "icp", label: "ICP similarity", hint: "industry, size band and persona vs historical converters" },
  { key: "pain", label: "Operational pain", hint: "pain evidence and technology gaps" },
  { key: "timing", label: "Timing / urgency", hint: "recency of signals; expansion and hiring count more" },
  { key: "access", label: "Decision-maker access", hint: "contact identified, seniority fit, email / LinkedIn / verified phone" },
];

export function ScoreBreakdown({ scores, weights, explanation, modelVersion }: { scores: Breakdown | null; weights: Weights | null; explanation: string | null; modelVersion: number | null }) {
  if (!scores) {
    return <div className="panel p-4 text-sm text-[var(--muted)]">Not scored yet. The Scoring Agent runs after Research has produced a brief.</div>;
  }
  return (
    <div className="panel p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="font-semibold">Score breakdown</h2>
        <span className="text-xs text-[var(--muted)]">{modelVersion ? `model v${modelVersion}` : "weights unknown"}</span>
      </div>
      <div className="mt-3 space-y-2.5">
        {ROWS.map((r) => {
          const sub = scores[r.key];
          const w = weights?.[r.key] ?? 0;
          return (
            <div key={r.key} className="grid grid-cols-[150px_1fr_52px_60px_70px] items-center gap-2 text-sm" title={r.hint}>
              <span>{r.label}</span>
              <span className="bar">
                <span style={{ width: `${sub}%` }} />
              </span>
              <span className="mono text-right">{sub}</span>
              <span className="mono text-right text-[var(--muted)]">× {w.toFixed(2)}</span>
              <span className="mono text-right">= {(sub * w).toFixed(1)}</span>
            </div>
          );
        })}
        <div className="grid grid-cols-[150px_1fr_52px_60px_70px] items-center gap-2 border-t border-[var(--border)] pt-2 text-sm font-semibold">
          <span>Total</span>
          <span />
          <span />
          <span />
          <span className="mono text-right text-lg" style={{ color: scoreColor(scores.total) }}>
            {scores.total}
          </span>
        </div>
      </div>
      {explanation && <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-[var(--text)]/90">{explanation}</p>}
    </div>
  );
}
