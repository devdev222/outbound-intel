"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface Outcome {
  metric: string;
  value: string;
  verified: boolean;
  source: string;
}
export interface EditableStory {
  id?: string;
  customer: string;
  industry: string;
  sizeBand: string;
  challenges: string[];
  capabilities: string[];
  outcomes: Outcome[];
  quote?: string;
  quoteBy?: string;
  approved: boolean;
  placeholder?: boolean;
}

const SIZE_BANDS = ["50-199", "200-999", "1000-4999", "5000+"];

export function ProofEditor({ industries, initial, label = "Add customer story" }: { industries: string[]; initial?: EditableStory; label?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [s, setS] = useState<EditableStory>(
    initial ?? { customer: "", industry: industries[0] ?? "", sizeBand: "200-999", challenges: [], capabilities: [], outcomes: [{ metric: "", value: "", verified: false, source: "" }], quote: "", quoteBy: "", approved: false },
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const list = (v: string) => v.split(",").map((x) => x.trim()).filter(Boolean);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const res = await fetch("/api/proof", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...s, outcomes: s.outcomes.filter((o) => o.metric && o.value) }) });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setErr(data.error ?? "failed");
      return;
    }
    setOpen(false);
    router.refresh();
  }

  if (!open)
    return (
      <button className={`btn ${initial ? "btn-sm" : "btn-primary"}`} onClick={() => setOpen(true)}>
        {label}
      </button>
    );

  return (
    <form onSubmit={submit} className="card flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <div className="card-title">{initial ? `Edit: ${initial.customer}` : "New customer story"}</div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-[12px] font-medium sm:col-span-1">
          Customer
          <input className="field mt-1" value={s.customer} onChange={(e) => setS({ ...s, customer: e.target.value })} required />
        </label>
        <label className="text-[12px] font-medium">
          Industry
          <select className="field mt-1" value={s.industry} onChange={(e) => setS({ ...s, industry: e.target.value })}>
            {industries.map((i) => (
              <option key={i}>{i}</option>
            ))}
          </select>
        </label>
        <label className="text-[12px] font-medium">
          Company size
          <select className="field mt-1" value={s.sizeBand} onChange={(e) => setS({ ...s, sizeBand: e.target.value })}>
            {SIZE_BANDS.map((b) => (
              <option key={b}>{b}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-[12px] font-medium">
          Operational challenges (comma-separated)
          <input className="field mt-1" value={s.challenges.join(", ")} onChange={(e) => setS({ ...s, challenges: list(e.target.value) })} placeholder="manual coordination load, new facility launch" />
        </label>
        <label className="text-[12px] font-medium">
          Wilson capabilities (comma-separated)
          <input className="field mt-1" value={s.capabilities.join(", ")} onChange={(e) => setS({ ...s, capabilities: list(e.target.value) })} placeholder="managed capacity, tendering and tracking" />
        </label>
      </div>
      <div>
        <div className="text-[12px] font-medium">Outcomes</div>
        <div className="mt-1 flex flex-col gap-1">
          {s.outcomes.map((o, i) => (
            <div key={i} className="grid gap-1 sm:grid-cols-[1fr_120px_1fr_auto]">
              <input className="field" placeholder="metric (e.g. hours saved / week)" value={o.metric} onChange={(e) => setS({ ...s, outcomes: s.outcomes.map((x, j) => (j === i ? { ...x, metric: e.target.value } : x)) })} />
              <input className="field" placeholder="value" value={o.value} onChange={(e) => setS({ ...s, outcomes: s.outcomes.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })} />
              <input className="field" placeholder="source (required when verified)" value={o.source} onChange={(e) => setS({ ...s, outcomes: s.outcomes.map((x, j) => (j === i ? { ...x, source: e.target.value } : x)) })} />
              <label className="flex items-center gap-1 text-[12px]">
                <input type="checkbox" checked={o.verified} onChange={(e) => setS({ ...s, outcomes: s.outcomes.map((x, j) => (j === i ? { ...x, verified: e.target.checked } : x)) })} /> verified
              </label>
            </div>
          ))}
          <button type="button" className="btn btn-ghost btn-sm self-start" onClick={() => setS({ ...s, outcomes: [...s.outcomes, { metric: "", value: "", verified: false, source: "" }] })}>
            + outcome
          </button>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
        <label className="text-[12px] font-medium">
          Quote
          <textarea className="field mt-1" rows={2} value={s.quote ?? ""} onChange={(e) => setS({ ...s, quote: e.target.value })} />
        </label>
        <label className="text-[12px] font-medium">
          Attributed to
          <input className="field mt-1" value={s.quoteBy ?? ""} onChange={(e) => setS({ ...s, quoteBy: e.target.value })} />
        </label>
      </div>
      <label className="flex items-center gap-2 text-[13px]">
        <input type="checkbox" checked={s.approved} onChange={(e) => setS({ ...s, approved: e.target.checked })} /> Approved for prospect-facing use (marketing / legal sign-off obtained)
      </label>
      {err && <div className="text-[12px] text-[var(--bad)]">{err}</div>}
      <div className="flex gap-2">
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save story"}
        </button>
      </div>
    </form>
  );
}
