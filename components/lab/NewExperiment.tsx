"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export interface WizardType {
  type: string;
  label: string;
  question: string;
  suggestedMetric: string;
  /** null when it can be created; otherwise why not. */
  blocked: string | null;
  /** Name of a running experiment that already tests this (it can still be created as a draft). */
  busyWith: string | null;
}
export interface WizardData {
  types: WizardType[];
  sequences: { id: string; name: string; isDefault: boolean; summary: string }[];
  defaultSequence: { name: string; steps: { step: number; title: string; channel: string; current: string }[] };
  templates: { id: string; name: string; channel: string; status: string }[];
  industries: string[];
  signals: { key: string; label: string }[];
  launchesPerWeek: number;
}

const METRICS = [
  { key: "meetings_booked", label: "Meetings booked", note: "significance test available" },
  { key: "opportunities", label: "Qualified opportunities", note: "significance test available" },
  { key: "meetings_held", label: "Meetings held (estimated)", note: "directional only" },
  { key: "qualified_pipeline", label: "Qualified pipeline ($)", note: "directional only" },
];
const SIZE_BANDS = ["50-199", "200-999", "1000-4999", "5000+"];

export function NewExperiment({ data }: { data: WizardData }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<WizardType | null>(null);
  const [seqIds, setSeqIds] = useState<string[]>([]);
  const [step, setStep] = useState(1);
  const [tplIds, setTplIds] = useState<string[]>([]);
  const [angle, setAngle] = useState("");
  const [useCatalog, setUseCatalog] = useState(false);
  const [noProof, setNoProof] = useState(false);
  const [metric, setMetric] = useState("meetings_booked");
  const [target, setTarget] = useState(30);
  const [minScore, setMinScore] = useState(60);
  const [inds, setInds] = useState<string[]>([]);
  const [bands, setBands] = useState<string[]>([]);
  const [start, setStart] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function reset() {
    setType(null);
    setSeqIds([]);
    setTplIds([]);
    setAngle("");
    setUseCatalog(false);
    setErr(null);
  }
  const toggle = (list: string[], set: (v: string[]) => void, v: string, max = 99) => set(list.includes(v) ? list.filter((x) => x !== v) : list.length >= max ? list : [...list, v]);
  const stepInfo = data.defaultSequence.steps.find((s) => s.step === step);
  const stepTemplates = data.templates.filter((t) => stepInfo && t.channel === stepInfo.channel && t.status !== "archived");
  const arms = 1 + (type?.type === "sequence" ? seqIds.length : type?.type === "template" ? tplIds.length : type?.type === "proof" && noProof ? 2 : 1);
  const weeks = data.launchesPerWeek > 0 ? Math.ceil((target * arms) / data.launchesPerWeek) : null;

  const ready =
    type &&
    (type.type === "sequence" ? seqIds.length > 0 : type.type === "template" ? tplIds.length > 0 : type.type === "angle" ? useCatalog || angle.trim().length > 5 : true);

  async function submit() {
    if (!type) return;
    setBusy(true);
    setErr(null);
    const choices = type.type === "sequence" ? { sequenceIds: seqIds } : type.type === "template" ? { templateStep: step, templateIds: tplIds } : type.type === "angle" ? { angle: useCatalog ? "catalog" : angle } : type.type === "proof" ? { includeNoProof: noProof } : {};
    const res = await fetch("/api/experiments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: type.type, choices, primaryMetric: metric, targetPerArm: target, segment: { industries: inds, sizeBands: bands, signalKeys: [], minScore }, start }),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string; experiment?: { id: string }; conflict?: string | null };
    setBusy(false);
    if (!res.ok) return setErr(body.error ?? "could not create the experiment");
    setOpen(false);
    reset();
    if (body.experiment) router.push(`/lab/${body.experiment.id}${body.conflict ? "?conflict=1" : ""}`);
    else router.refresh();
  }

  if (!open)
    return (
      <button className="btn btn-primary" onClick={() => setOpen(true)}>
        New experiment
      </button>
    );

  return (
    <section className="card mb-4 w-full p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="card-title">{type ? `New experiment: ${type.label}` : "What do you want to learn?"}</div>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => {
            setOpen(false);
            reset();
          }}
        >
          Cancel
        </button>
      </div>

      {!type ? (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {data.types.map((t) => (
            <button
              key={t.type}
              className={`card p-3 text-left ${t.blocked ? "cursor-not-allowed opacity-55" : "hover:bg-[var(--surface-2)]"}`}
              disabled={Boolean(t.blocked)}
              onClick={() => {
                setType(t);
                setMetric(t.suggestedMetric);
              }}
            >
              <div className="text-[13px] font-semibold">{t.label}</div>
              <div className="mt-0.5 text-[12px] text-[var(--text-2)]">{t.question}</div>
              {t.blocked && <div className="mt-1 text-[11.5px] text-[var(--bad)]">{t.blocked}</div>}
              {!t.blocked && t.busyWith && <div className="mt-1 text-[11.5px] text-[var(--warn)]">Already running: {t.busyWith}. You can prepare a draft.</div>}
            </button>
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div>
            <div className="mb-1 text-[12px] font-semibold">1. What to compare</div>
            <p className="mb-2 text-[12px] text-[var(--muted)]">The control arm keeps exactly what you do today; challengers change only this one thing.</p>
            {type.type === "sequence" && (
              <div className="space-y-1.5">
                <div className="text-[12.5px]">
                  Control: <span className="font-medium">{data.sequences.find((s) => s.isDefault)?.name ?? "current default"}</span>
                </div>
                {data.sequences.filter((s) => !s.isDefault).length === 0 && <div className="text-[12.5px] text-[var(--bad)]">Create and activate another sequence first (Playbook & sequences).</div>}
                {data.sequences
                  .filter((s) => !s.isDefault)
                  .map((s) => (
                    <label key={s.id} className="flex items-start gap-2 text-[12.5px]">
                      <input type="checkbox" checked={seqIds.includes(s.id)} onChange={() => toggle(seqIds, setSeqIds, s.id, 2)} />
                      <span>
                        <span className="font-medium">{s.name}</span> <span className="text-[var(--muted)]">{s.summary}</span>
                      </span>
                    </label>
                  ))}
              </div>
            )}
            {type.type === "template" && (
              <div className="space-y-2">
                <label className="text-[12.5px]">
                  Step of “{data.defaultSequence.name}”
                  <select
                    className="field mt-1 max-w-md"
                    value={step}
                    onChange={(e) => {
                      setStep(Number(e.target.value));
                      setTplIds([]);
                    }}
                  >
                    {data.defaultSequence.steps
                      .filter((s) => s.channel !== "gift")
                      .map((s) => (
                        <option key={s.step} value={s.step}>
                          {s.step}. {s.title} ({s.channel}) · now: {s.current}
                        </option>
                      ))}
                  </select>
                </label>
                {stepTemplates.length === 0 && <div className="text-[12.5px] text-[var(--bad)]">No {stepInfo?.channel} templates yet. Upload some under Playbook & sequences → Templates.</div>}
                {stepTemplates.map((t) => (
                  <label key={t.id} className="flex items-center gap-2 text-[12.5px]">
                    <input type="checkbox" checked={tplIds.includes(t.id)} onChange={() => toggle(tplIds, setTplIds, t.id, 2)} />
                    {t.name} {t.status === "draft" && <span className="pill pill-warn">draft</span>}
                  </label>
                ))}
              </div>
            )}
            {type.type === "angle" && (
              <div className="space-y-2">
                <div className="text-[12.5px]">Control: your playbook angle for each account&apos;s top signal (learned angle where you have none).</div>
                <input className="field" placeholder="Challenger angle, e.g. Cut tender rejections before peak season" value={angle} disabled={useCatalog} onChange={(e) => setAngle(e.target.value)} />
                <label className="flex items-center gap-2 text-[12.5px]">
                  <input type="checkbox" checked={useCatalog} onChange={(e) => setUseCatalog(e.target.checked)} /> Instead, test the catalog&apos;s alternative angle for each signal
                </label>
              </div>
            )}
            {type.type === "proof" && (
              <label className="flex items-center gap-2 text-[12.5px]">
                <input type="checkbox" checked={noProof} onChange={(e) => setNoProof(e.target.checked)} /> Also test a third arm with no customer claim at all
              </label>
            )}
            {["landing_page", "video", "assessment", "gifting"].includes(type.type) && <div className="text-[12.5px] text-[var(--text-2)]">{type.question} Two arms, split evenly.</div>}
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <label className="text-[12px] font-semibold">
              2. Success metric
              <select className="field mt-1 font-normal" value={metric} onChange={(e) => setMetric(e.target.value)}>
                {METRICS.map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.label} ({m.note})
                  </option>
                ))}
              </select>
            </label>
            <label className="text-[12px] font-semibold">
              Accounts per arm before reading results
              <input className="field mt-1 font-normal" type="number" min={10} max={500} value={target} onChange={(e) => setTarget(Number(e.target.value))} />
            </label>
            <label className="text-[12px] font-semibold">
              Minimum account score
              <input className="field mt-1 font-normal" type="number" min={0} max={100} value={minScore} onChange={(e) => setMinScore(Number(e.target.value))} />
            </label>
          </div>

          <details>
            <summary className="cursor-pointer text-[12px] font-semibold">3. Limit to a segment (optional)</summary>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              <div className="flex flex-wrap gap-1">
                {data.industries.map((i) => (
                  <button type="button" key={i} className={`pill ${inds.includes(i) ? "pill-accent" : ""}`} onClick={() => toggle(inds, setInds, i)}>
                    {i}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap gap-1">
                {SIZE_BANDS.map((b) => (
                  <button type="button" key={b} className={`pill ${bands.includes(b) ? "pill-accent" : ""}`} onClick={() => toggle(bands, setBands, b)}>
                    {b} employees
                  </button>
                ))}
              </div>
            </div>
          </details>

          <div className="rounded-md bg-[var(--surface-2)] p-3 text-[12.5px] text-[var(--text-2)]">
            {arms} arms × {target} accounts = {arms * target} campaign launches.{" "}
            {weeks ? `At the recent pace of about ${data.launchesPerWeek} launches a week, results are readable in roughly ${weeks} week${weeks === 1 ? "" : "s"}.` : "No campaigns launched in the last two weeks, so there is no pace to estimate from yet."} Accounts enroll when their campaign launches; already-running campaigns are not changed.
          </div>

          <label className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" checked={start} onChange={(e) => setStart(e.target.checked)} /> Start now
          </label>
          {err && <div className="text-[12.5px] text-[var(--bad)]">{err}</div>}
          <div className="flex gap-2">
            <button className="btn btn-primary" onClick={submit} disabled={busy || !ready}>
              {busy ? "Creating…" : start ? "Create and start" : "Save as draft"}
            </button>
            <button className="btn btn-ghost" onClick={reset}>
              Back
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
