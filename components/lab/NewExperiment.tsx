"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface Arm {
  key: string;
  name: string;
  share: number;
  config: Record<string, unknown>;
  control: boolean;
}
export interface Template {
  type: string;
  name: string;
  hypothesis: string;
  arms: Arm[];
  primaryMetric: string;
}

const METRICS = [
  { key: "meetings_held", label: "Meetings held" },
  { key: "opportunities", label: "Qualified opportunities" },
  { key: "qualified_pipeline", label: "Qualified pipeline" },
  { key: "meetings_booked", label: "Meetings booked" },
];
const SIZE_BANDS = ["50-199", "200-999", "1000-4999", "5000+"];

export function NewExperiment({ templates, industries, signalKeys }: { templates: Template[]; industries: string[]; signalKeys: { key: string; label: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [t, setT] = useState<Template | null>(null);
  const [name, setName] = useState("");
  const [hypothesis, setHypothesis] = useState("");
  const [metric, setMetric] = useState("meetings_held");
  const [arms, setArms] = useState<Arm[]>([]);
  const [minScore, setMinScore] = useState(60);
  const [inds, setInds] = useState<string[]>([]);
  const [bands, setBands] = useState<string[]>([]);
  const [sigs, setSigs] = useState<string[]>([]);
  const [start, setStart] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function pick(tp: Template) {
    setT(tp);
    setName(tp.name);
    setHypothesis(tp.hypothesis);
    setMetric(tp.primaryMetric);
    setArms(tp.arms.map((a) => ({ ...a })));
  }
  const toggle = (list: string[], set: (v: string[]) => void, v: string) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!t) return;
    setBusy(true);
    setErr(null);
    const res = await fetch("/api/experiments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, hypothesis, type: t.type, segment: { industries: inds, sizeBands: bands, signalKeys: sigs, minScore }, arms, primaryMetric: metric, start }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setErr(data.error ?? "failed");
      return;
    }
    setOpen(false);
    setT(null);
    router.refresh();
  }

  if (!open)
    return (
      <button className="btn btn-primary" onClick={() => setOpen(true)}>
        New experiment
      </button>
    );

  return (
    <div className="card p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="card-title">New experiment</div>
        <button className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      {!t ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {templates.map((tp) => (
            <button key={tp.name} className="card p-3 text-left hover:bg-[var(--surface-2)]" onClick={() => pick(tp)}>
              <div className="pill mb-1">{tp.type.replace(/_/g, " ")}</div>
              <div className="text-[13px] font-semibold">{tp.name}</div>
              <div className="mt-0.5 text-[12px] text-[var(--muted)]">{tp.hypothesis}</div>
            </button>
          ))}
        </div>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-3">
          <label className="text-[12px] font-medium">
            Name
            <input className="field mt-1" value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label className="text-[12px] font-medium">
            Hypothesis
            <textarea className="field mt-1" rows={2} value={hypothesis} onChange={(e) => setHypothesis(e.target.value)} required />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-[12px] font-medium">
              Primary metric
              <select className="field mt-1" value={metric} onChange={(e) => setMetric(e.target.value)}>
                {METRICS.map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-[12px] font-medium">
              Minimum score
              <input className="field mt-1" type="number" min={0} max={100} value={minScore} onChange={(e) => setMinScore(Number(e.target.value))} />
            </label>
          </div>
          <div>
            <div className="text-[12px] font-medium">Arms (shares are normalized)</div>
            <div className="mt-1 flex flex-col gap-1">
              {arms.map((a, i) => (
                <div key={a.key} className="flex items-center gap-2 text-[13px]">
                  <input className="field" value={a.name} onChange={(e) => setArms(arms.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                  <input className="field w-20" type="number" min={0} step={0.05} value={a.share} onChange={(e) => setArms(arms.map((x, j) => (j === i ? { ...x, share: Number(e.target.value) } : x)))} />
                  <span className="pill">{a.control ? "control" : "treatment"}</span>
                </div>
              ))}
            </div>
          </div>
          <details>
            <summary className="cursor-pointer text-[12px] font-medium">Segment (optional)</summary>
            <div className="mt-2 grid gap-3 sm:grid-cols-3">
              <div>
                <div className="text-[11.5px] uppercase tracking-wide text-[var(--muted)]">Industries</div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {industries.map((i) => (
                    <button type="button" key={i} className={`pill ${inds.includes(i) ? "pill-accent" : ""}`} onClick={() => toggle(inds, setInds, i)}>
                      {i}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="text-[11.5px] uppercase tracking-wide text-[var(--muted)]">Size bands</div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {SIZE_BANDS.map((b) => (
                    <button type="button" key={b} className={`pill ${bands.includes(b) ? "pill-accent" : ""}`} onClick={() => toggle(bands, setBands, b)}>
                      {b}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="text-[11.5px] uppercase tracking-wide text-[var(--muted)]">Signals</div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {signalKeys.map((s) => (
                    <button type="button" key={s.key} className={`pill ${sigs.includes(s.key) ? "pill-accent" : ""}`} title={s.key} onClick={() => toggle(sigs, setSigs, s.key)}>
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </details>
          <label className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" checked={start} onChange={(e) => setStart(e.target.checked)} /> Start now (assignments apply to new campaign launches)
          </label>
          {err && <div className="text-[12px] text-[var(--bad)]">{err}</div>}
          <div className="flex gap-2">
            <button className="btn btn-primary" type="submit" disabled={busy}>
              {busy ? "Creating…" : "Create experiment"}
            </button>
            <button className="btn btn-ghost" type="button" onClick={() => setT(null)}>
              Back to templates
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
