"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { CampaignDefaults, CompanyPlaybook } from "@/lib/types";

interface Learned {
  signalKey: string;
  angle: string;
  winRate: number;
  sampleSize: number;
}

async function save(body: unknown): Promise<string | null> {
  const res = await fetch("/api/playbook", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  return res.ok ? null : (data.error ?? `HTTP ${res.status}`);
}

const lines = (s: string) =>
  s
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);

function Section({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="card p-4">
      <div className="card-title">{title}</div>
      <div className="card-hint mb-3 mt-0.5">{hint}</div>
      {children}
    </section>
  );
}

/** Edit the team playbook. Read-only for BDRs. */
export function PlaybookEditor({ initial, signals, learned, canEdit }: { initial: CompanyPlaybook; signals: { key: string; label: string }[]; learned: Learned[]; canEdit: boolean }) {
  const router = useRouter();
  const [positioning, setPositioning] = useState(initial.positioning);
  const [tone, setTone] = useState(initial.toneRules.join("\n"));
  const [avoid, setAvoid] = useState(initial.avoid.join("\n"));
  const [angles, setAngles] = useState(initial.signalAngles.map((a) => ({ ...a, points: a.talkingPoints.join("\n") })));
  const [personas, setPersonas] = useState(initial.personas);
  const [objections, setObjections] = useState(initial.objections);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const label = new Map(signals.map((s) => [s.key, s.label]));
  const unused = signals.filter((s) => !angles.some((a) => a.signalKey === s.key));

  async function submit() {
    setBusy(true);
    setMsg(null);
    const err = await save({
      playbook: {
        positioning,
        toneRules: lines(tone),
        avoid: lines(avoid),
        signalAngles: angles.filter((a) => a.angle.trim()).map((a) => ({ signalKey: a.signalKey, angle: a.angle, talkingPoints: lines(a.points) })),
        personas: personas.filter((p) => p.title.trim()),
        objections: objections.filter((o) => o.objection.trim() && o.response.trim()),
      },
    });
    setBusy(false);
    setMsg(err ? { ok: false, text: err } : { ok: true, text: "Saved. New campaigns, talk tracks and follow-ups use it from now on." });
    if (!err) router.refresh();
  }

  const ro = !canEdit;
  return (
    <div className="space-y-4">
      <Section title="Positioning" hint="One paragraph on who you help and how. Every piece of copy Claude writes follows it.">
        <textarea className="field min-h-24" value={positioning} onChange={(e) => setPositioning(e.target.value)} readOnly={ro} placeholder="Cartage runs shipping operations for mid-market shippers..." />
      </Section>

      <div className="grid gap-4 md:grid-cols-2">
        <Section title="Tone rules" hint="One rule per line.">
          <textarea className="field min-h-28" value={tone} onChange={(e) => setTone(e.target.value)} readOnly={ro} placeholder={"Write like an operator talking to a peer\nUnder 90 words"} />
        </Section>
        <Section title="Never say" hint="Phrases, claims or habits to avoid. One per line.">
          <textarea className="field min-h-28" value={avoid} onChange={(e) => setAvoid(e.target.value)} readOnly={ro} placeholder={"Exclamation marks\nSavings we cannot cite"} />
        </Section>
      </div>

      <Section title="Angles by buying signal" hint="Your opening angle when this signal is the account's strongest. It overrides the learned playbook; empty signals fall back to it.">
        <div className="space-y-3">
          {angles.map((a, i) => {
            const l = learned.find((x) => x.signalKey === a.signalKey);
            return (
              <div key={a.signalKey} className="rounded-md border border-[var(--border)] p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[13px] font-semibold">{label.get(a.signalKey) ?? a.signalKey}</span>
                  {canEdit && (
                    <button className="btn btn-ghost btn-sm" onClick={() => setAngles(angles.filter((_, j) => j !== i))}>
                      Remove
                    </button>
                  )}
                </div>
                <input className="field" value={a.angle} readOnly={ro} onChange={(e) => setAngles(angles.map((x, j) => (j === i ? { ...x, angle: e.target.value } : x)))} placeholder="Opening angle" />
                <textarea className="field mt-2 min-h-16 text-[13px]" value={a.points} readOnly={ro} onChange={(e) => setAngles(angles.map((x, j) => (j === i ? { ...x, points: e.target.value } : x)))} placeholder="Talking points, one per line (optional)" />
                {l && <div className="mt-1 text-[12px] text-[var(--muted)]">Learned from history: “{l.angle}” ({Math.round(l.winRate * 100)}% win rate, n={l.sampleSize})</div>}
              </div>
            );
          })}
          {canEdit && unused.length > 0 && (
            <select
              className="field max-w-sm"
              value=""
              onChange={(e) => {
                const key = e.target.value;
                if (!key) return;
                const l = learned.find((x) => x.signalKey === key);
                setAngles([...angles, { signalKey: key, angle: l?.angle ?? "", talkingPoints: [], points: "" }]);
              }}
            >
              <option value="">+ Add an angle for a signal…</option>
              {unused.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                  {learned.some((x) => x.signalKey === s.key) ? " (learned angle available)" : ""}
                </option>
              ))}
            </select>
          )}
        </div>
      </Section>

      <Section title="Personas" hint="Matched against the contact's title (e.g. VP, Director, Transportation Manager).">
        <div className="space-y-2">
          {personas.map((p, i) => (
            <div key={p.id} className="grid gap-2 md:grid-cols-[180px_1fr_1fr_auto]">
              <input className="field" value={p.title} readOnly={ro} placeholder="Title contains" onChange={(e) => setPersonas(personas.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
              <input className="field" value={p.pains} readOnly={ro} placeholder="Cares about" onChange={(e) => setPersonas(personas.map((x, j) => (j === i ? { ...x, pains: e.target.value } : x)))} />
              <input className="field" value={p.angle} readOnly={ro} placeholder="Angle for them" onChange={(e) => setPersonas(personas.map((x, j) => (j === i ? { ...x, angle: e.target.value } : x)))} />
              {canEdit && (
                <button className="btn btn-ghost btn-sm" onClick={() => setPersonas(personas.filter((_, j) => j !== i))}>
                  Remove
                </button>
              )}
            </div>
          ))}
          {canEdit && (
            <button className="btn btn-sm" onClick={() => setPersonas([...personas, { id: `new_${Date.now()}`, title: "", pains: "", angle: "" }])}>
              + Add persona
            </button>
          )}
        </div>
      </Section>

      <Section title="Objection handling" hint="Reps see these on Today; follow-ups answer an objection the call notes mention.">
        <div className="space-y-2">
          {objections.map((o, i) => (
            <div key={o.id} className="grid gap-2 md:grid-cols-[1fr_2fr_auto]">
              <input className="field" value={o.objection} readOnly={ro} placeholder="When they say…" onChange={(e) => setObjections(objections.map((x, j) => (j === i ? { ...x, objection: e.target.value } : x)))} />
              <textarea className="field min-h-10" value={o.response} readOnly={ro} placeholder="We answer…" onChange={(e) => setObjections(objections.map((x, j) => (j === i ? { ...x, response: e.target.value } : x)))} />
              {canEdit && (
                <button className="btn btn-ghost btn-sm" onClick={() => setObjections(objections.filter((_, j) => j !== i))}>
                  Remove
                </button>
              )}
            </div>
          ))}
          {canEdit && (
            <button className="btn btn-sm" onClick={() => setObjections([...objections, { id: `new_${Date.now()}`, objection: "", response: "" }])}>
              + Add objection
            </button>
          )}
        </div>
      </Section>

      {canEdit && (
        <div className="sticky bottom-3 flex items-center gap-3 rounded-md border border-[var(--border)] bg-[var(--surface)] p-3 shadow-sm">
          <button className="btn btn-primary" onClick={submit} disabled={busy}>
            {busy ? "Saving…" : "Save playbook"}
          </button>
          {msg && <span className={`text-[13px] ${msg.ok ? "text-[var(--good)]" : "text-[var(--bad)]"}`}>{msg.text}</span>}
        </div>
      )}
    </div>
  );
}

const DEFAULT_FIELDS: { key: keyof CampaignDefaults; label: string; options: { value: string; label: string }[] }[] = [
  { key: "contentFormat", label: "Links in outreach go to", options: [{ value: "landing_page", label: "Personalized page" }, { value: "direct_link", label: "Booking link directly" }] },
  { key: "personalization", label: "Copy", options: [{ value: "deep", label: "Account-specific (signal, numbers, video)" }, { value: "conventional", label: "Industry-level" }] },
  { key: "angleVariant", label: "Angle source", options: [{ value: "A", label: "Your playbook, then learned" }, { value: "B", label: "Catalog alternative" }] },
  { key: "proofMode", label: "Customer proof", options: [{ value: "matched", label: "Industry-matched story" }, { value: "generic", label: "General story" }, { value: "none", label: "No customer claim" }] },
  { key: "videoType", label: "Video", options: [{ value: "ai", label: "AI render" }, { value: "rep", label: "Rep records it" }] },
  { key: "gifting", label: "Gift step", options: [{ value: "control", label: "No gift" }, { value: "gift", label: "Gift after engagement" }] },
];

/** What every campaign launches with unless a Lab experiment changes it for an enrolled account. */
export function CampaignDefaultsEditor({ initial, canEdit, calendly }: { initial: CampaignDefaults; canEdit: boolean; calendly: boolean }) {
  const router = useRouter();
  const [d, setD] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function submit() {
    setBusy(true);
    setMsg(null);
    const err = await save({ defaults: { ...d, angleOverride: d.angleOverride?.trim() || null } });
    setBusy(false);
    setMsg(err ? { ok: false, text: err } : { ok: true, text: "Saved. Applies to campaigns launched from now on." });
    if (!err) router.refresh();
  }
  return (
    <section className="card p-4">
      <div className="card-title">Campaign defaults</div>
      <div className="card-hint mb-3 mt-0.5">What every new campaign launches with. Lab experiments change one of these for the accounts they enroll; rolling out a winner updates them.</div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {DEFAULT_FIELDS.map((f) => (
          <label key={f.key} className="text-[12px] font-medium">
            {f.label}
            <select className="field mt-1" disabled={!canEdit} value={String(d[f.key])} onChange={(e) => setD({ ...d, [f.key]: e.target.value })}>
              {f.options.map((o) => (
                <option key={o.value} value={o.value} disabled={o.value === "direct_link" && !calendly}>
                  {o.label}
                  {o.value === "direct_link" && !calendly ? " (needs a Calendly link)" : ""}
                </option>
              ))}
            </select>
          </label>
        ))}
        <label className="flex items-center gap-2 text-[12px] font-medium">
          <input type="checkbox" disabled={!canEdit} checked={d.assessmentInvite} onChange={(e) => setD({ ...d, assessmentInvite: e.target.checked })} />
          Invite to the freight assessment in the first email
        </label>
        <label className="text-[12px] font-medium md:col-span-2">
          Fixed angle for every account (optional; leave empty to use the angle by signal)
          <input className="field mt-1" disabled={!canEdit} value={d.angleOverride ?? ""} onChange={(e) => setD({ ...d, angleOverride: e.target.value })} placeholder="e.g. Scale shipping without adding coordinators" />
        </label>
      </div>
      {canEdit && (
        <div className="mt-3 flex items-center gap-3">
          <button className="btn btn-primary btn-sm" onClick={submit} disabled={busy}>
            {busy ? "Saving…" : "Save defaults"}
          </button>
          {msg && <span className={`text-[13px] ${msg.ok ? "text-[var(--good)]" : "text-[var(--bad)]"}`}>{msg.text}</span>}
        </div>
      )}
    </section>
  );
}
