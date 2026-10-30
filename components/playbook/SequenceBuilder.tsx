"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Sequence, SequenceChannel } from "@/lib/types";

interface TemplateRef {
  id: string;
  name: string;
  channel: string;
  status: string;
}
interface PreviewStep {
  step: number;
  day: number;
  channel: string;
  title: string;
  subject: string | null;
  body: string;
  source: string;
}
type StepDraft = { id?: string; day: number; channel: SequenceChannel; title: string; templateId: string | null };
type Draft = { id?: string; name: string; description: string; steps: StepDraft[]; industries: string[]; sizeBands: string[]; signalKeys: string[]; priority: number };

const CHANNEL_LABEL: Record<SequenceChannel, string> = { email: "Email", linkedin: "LinkedIn", inmail: "InMail", call: "Call", gift: "Gift" };
const SIZE_BANDS = ["50-199", "200-999", "1000-4999", "5000+"];

async function api(url: string, method: string, body: unknown): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { ok: res.ok, data: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

const toDraft = (s: Sequence, copy = false): Draft => ({
  id: copy ? undefined : s.id,
  name: copy ? `${s.name} (copy)` : s.name,
  description: s.description,
  steps: s.steps.map((x) => ({ id: copy ? undefined : x.id, day: x.day, channel: x.channel, title: x.title, templateId: x.templateId })),
  industries: s.appliesTo.industries,
  sizeBands: s.appliesTo.sizeBands,
  signalKeys: s.appliesTo.signalKeys,
  priority: s.priority,
});

function ruleText(s: Sequence): string {
  const parts = [s.appliesTo.industries.join(", "), s.appliesTo.sizeBands.map((b) => `${b} employees`).join(", "), s.appliesTo.signalKeys.length ? `${s.appliesTo.signalKeys.length} signal${s.appliesTo.signalKeys.length > 1 ? "s" : ""}` : ""].filter(Boolean);
  return parts.length ? `Used for: ${parts.join(" · ")}` : "";
}

export function SequenceBuilder({ sequences, templates, canEdit, industries, signals, sampleAccounts }: { sequences: Sequence[]; templates: TemplateRef[]; canEdit: boolean; industries: string[]; signals: { key: string; label: string }[]; sampleAccounts: { slug: string; company: string }[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<Draft | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [previewFor, setPreviewFor] = useState<string | null>(null);
  const tplName = new Map(templates.map((t) => [t.id, t]));

  async function act(s: Sequence, action: string) {
    setErr(null);
    const r = await api(`/api/sequences/${s.id}`, "PATCH", { action });
    if (!r.ok) setErr(String(r.data.error ?? "failed"));
    router.refresh();
  }

  const rows = sequences.filter((s) => showArchived || s.status !== "archived");
  return (
    <div className="space-y-4">
      <section className="card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="card-title">How a sequence is chosen</div>
            <div className="card-hint mt-0.5">A Lab sequence experiment first; then the highest-priority active sequence whose segment rule matches the account; then the default. Steps without a template are written by the engine from research and your playbook.</div>
          </div>
          {canEdit && (
            <button className="btn btn-primary btn-sm" onClick={() => setEditing({ name: "", description: "", steps: [{ day: 0, channel: "email", title: "Intro email", templateId: null }], industries: [], sizeBands: [], signalKeys: [], priority: 0 })}>
              New sequence
            </button>
          )}
        </div>
      </section>

      {editing && <SequenceEditor draft={editing} templates={templates} industries={industries} signals={signals} sampleAccounts={sampleAccounts} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); router.refresh(); }} />}

      {err && <div className="text-[13px] text-[var(--bad)]">{err}</div>}
      <label className="flex items-center gap-1 text-[12.5px] text-[var(--muted)]">
        <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived
      </label>

      <div className="space-y-2">
        {rows.map((s) => (
          <article key={s.id} className="card p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[14px] font-semibold">{s.name}</span>
                  {s.isDefault && <span className="pill pill-accent">default</span>}
                  <span className={`pill ${s.status === "active" ? "pill-good" : s.status === "draft" ? "pill-warn" : ""}`}>{s.status}</span>
                  {s.builtIn && <span className="pill">built in</span>}
                </div>
                {s.description && <div className="mt-1 text-[12.5px] text-[var(--text-2)]">{s.description}</div>}
                {ruleText(s) && <div className="mt-1 text-[12px] text-[var(--muted)]">{ruleText(s)} · priority {s.priority}</div>}
              </div>
              <div className="flex shrink-0 flex-wrap gap-1">
                <button className="btn btn-sm" onClick={() => setPreviewFor(previewFor === s.id ? null : s.id)}>
                  {previewFor === s.id ? "Hide preview" : "Preview"}
                </button>
                {canEdit && !s.builtIn && s.status !== "archived" && (
                  <button className="btn btn-sm" onClick={() => setEditing(toDraft(s))}>
                    Edit
                  </button>
                )}
                {canEdit && (
                  <button className="btn btn-sm" onClick={() => setEditing(toDraft(s, true))}>
                    Duplicate
                  </button>
                )}
                {canEdit && !s.isDefault && s.status !== "archived" && (
                  <button className="btn btn-accent btn-sm" onClick={() => act(s, "set_default")}>
                    Make default
                  </button>
                )}
                {canEdit && s.status === "draft" && (
                  <button className="btn btn-sm" onClick={() => act(s, "activate")}>
                    Activate
                  </button>
                )}
                {canEdit && !s.builtIn && s.status !== "archived" && (
                  <button className="btn btn-ghost btn-sm" onClick={() => act(s, "archive")}>
                    Archive
                  </button>
                )}
              </div>
            </div>
            <ol className="mt-3 flex flex-wrap gap-1.5 text-[12px]">
              {s.steps.map((st, i) => (
                <li key={st.id} className="rounded-md border border-[var(--border)] px-2 py-1">
                  <span className="font-semibold">
                    {i + 1}. Day {st.day} · {CHANNEL_LABEL[st.channel]}
                  </span>
                  <span className="text-[var(--muted)]"> · {st.title}</span>
                  <div className="text-[11px] text-[var(--muted)]">{st.templateId ? `template: ${tplName.get(st.templateId)?.name ?? "missing"}${tplName.get(st.templateId)?.status === "draft" ? " (draft)" : ""}` : st.channel === "gift" ? "gift task" : "engine writes it"}</div>
                </li>
              ))}
            </ol>
            {previewFor === s.id && <SequencePreview sequenceId={s.id} sampleAccounts={sampleAccounts} />}
          </article>
        ))}
      </div>
    </div>
  );
}

function SequencePreview({ sequenceId, steps, sampleAccounts }: { sequenceId?: string; steps?: StepDraft[]; sampleAccounts: { slug: string; company: string }[] }) {
  const [slug, setSlug] = useState(sampleAccounts[0]?.slug ?? "");
  const [data, setData] = useState<{ company: string; contact: string | null; steps: PreviewStep[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function load(s = slug) {
    setBusy(true);
    setErr(null);
    const r = await api("/api/sequences/preview", "POST", { sequenceId, steps, slug: s || undefined });
    setBusy(false);
    if (!r.ok) return setErr(String(r.data.error ?? "preview failed"));
    const acc = r.data.account as { company: string; contact: string | null };
    setData({ company: acc.company, contact: acc.contact, steps: r.data.steps as PreviewStep[] });
  }
  return (
    <div className="mt-3 rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <select className="field max-w-[260px] text-[12px]" value={slug} onChange={(e) => setSlug(e.target.value)} aria-label="Preview account">
          {sampleAccounts.map((a) => (
            <option key={a.slug} value={a.slug}>
              {a.company}
            </option>
          ))}
        </select>
        <button className="btn btn-sm" onClick={() => load()} disabled={busy}>
          {busy ? "Rendering…" : data ? "Re-render" : "Render for this account"}
        </button>
        <span className="text-[11.5px] text-[var(--muted)]">Nothing is created or sent.</span>
      </div>
      {err && <div className="text-[12.5px] text-[var(--bad)]">{err}</div>}
      {data && (
        <ol className="space-y-2">
          {data.steps.map((p) => (
            <li key={p.step} className="rounded-md bg-[var(--surface)] p-2.5 text-[12.5px]">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <span className="font-semibold">
                  {p.step}. Day {p.day} · {p.channel}
                </span>
                <span className="text-[var(--muted)]">{p.title}</span>
                <span className="pill">{p.source}</span>
              </div>
              {p.subject && <div className="font-medium">{p.subject}</div>}
              <div className="whitespace-pre-wrap text-[var(--text-2)]">{p.body}</div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function SequenceEditor({ draft, templates, industries, signals, sampleAccounts, onClose, onSaved }: { draft: Draft; templates: TemplateRef[]; industries: string[]; signals: { key: string; label: string }[]; sampleAccounts: { slug: string; company: string }[]; onClose: () => void; onSaved: () => void }) {
  const [d, setD] = useState(draft);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const setStep = (i: number, patch: Partial<StepDraft>) => setD({ ...d, steps: d.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= d.steps.length) return;
    const steps = [...d.steps];
    [steps[i], steps[j]] = [steps[j], steps[i]];
    setD({ ...d, steps });
  };
  const toggle = (key: "industries" | "sizeBands" | "signalKeys", v: string) => setD({ ...d, [key]: d[key].includes(v) ? d[key].filter((x) => x !== v) : [...d[key], v] });

  async function save(activate: boolean) {
    setBusy(true);
    setErr(null);
    const payload = { name: d.name, description: d.description, steps: d.steps.map((s) => ({ ...s, templateId: s.channel === "gift" ? null : s.templateId })), appliesTo: { industries: d.industries, sizeBands: d.sizeBands, signalKeys: d.signalKeys }, priority: d.priority };
    const r = d.id ? await api(`/api/sequences/${d.id}`, "PATCH", { ...payload, action: activate ? "activate" : "save" }) : await api("/api/sequences", "POST", { ...payload, status: activate ? "active" : "draft" });
    setBusy(false);
    if (!r.ok) return setErr(String(r.data.error ?? "could not save"));
    onSaved();
  }

  return (
    <section className="card border-[var(--border-strong)] p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="card-title">{d.id ? "Edit sequence" : "New sequence"}</div>
        <button className="btn btn-ghost btn-sm" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        <input className="field" placeholder="Sequence name" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} />
        <input className="field" placeholder="What it is for (optional)" value={d.description} onChange={(e) => setD({ ...d, description: e.target.value })} />
      </div>

      <div className="mt-4">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">Steps</div>
        <div className="mt-1 space-y-1.5">
          {d.steps.map((s, i) => {
            const options = templates.filter((t) => t.channel === s.channel && t.status !== "archived");
            return (
              <div key={s.id ?? `new-${i}`} className="grid items-center gap-1.5 md:grid-cols-[40px_90px_120px_1fr_1.3fr_auto]">
                <span className="text-[12px] font-semibold text-[var(--muted)]">#{i + 1}</span>
                <label className="flex items-center gap-1 text-[12px]">
                  Day
                  <input className="field w-16" type="number" min={0} max={90} value={s.day} onChange={(e) => setStep(i, { day: Number(e.target.value) })} />
                </label>
                <select className="field" value={s.channel} onChange={(e) => setStep(i, { channel: e.target.value as SequenceChannel, templateId: null })}>
                  {Object.entries(CHANNEL_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
                <input className="field" placeholder="Step title" value={s.title} onChange={(e) => setStep(i, { title: e.target.value })} />
                {s.channel === "gift" ? (
                  <span className="text-[12px] text-[var(--muted)]">Gift task for the rep</span>
                ) : (
                  <select className="field" value={s.templateId ?? ""} onChange={(e) => setStep(i, { templateId: e.target.value || null })}>
                    <option value="">Engine writes it</option>
                    {options.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                        {t.status === "draft" ? " (draft)" : ""}
                      </option>
                    ))}
                  </select>
                )}
                <div className="flex gap-1">
                  <button className="btn btn-ghost btn-sm" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">
                    ↑
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => move(i, 1)} disabled={i === d.steps.length - 1} aria-label="Move down">
                    ↓
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setD({ ...d, steps: d.steps.filter((_, j) => j !== i) })} disabled={d.steps.length === 1} aria-label="Remove step">
                    ✕
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        {d.steps.length < 12 && (
          <button className="btn btn-sm mt-2" onClick={() => setD({ ...d, steps: [...d.steps, { day: (d.steps[d.steps.length - 1]?.day ?? 0) + 3, channel: "email", title: "Follow-up email", templateId: null }] })}>
            + Add step
          </button>
        )}
      </div>

      <details className="mt-4">
        <summary className="cursor-pointer text-[12.5px] font-medium">Use for a segment (optional)</summary>
        <div className="mt-2 text-[11.5px] text-[var(--muted)]">Leave empty to use this sequence only when it is the default or in an experiment.</div>
        <div className="mt-2 grid gap-3 md:grid-cols-3">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-[var(--muted)]">Industries</div>
            <div className="mt-1 flex flex-wrap gap-1">
              {industries.map((x) => (
                <button key={x} type="button" className={`pill ${d.industries.includes(x) ? "pill-accent" : ""}`} onClick={() => toggle("industries", x)}>
                  {x}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-[var(--muted)]">Company size</div>
            <div className="mt-1 flex flex-wrap gap-1">
              {SIZE_BANDS.map((x) => (
                <button key={x} type="button" className={`pill ${d.sizeBands.includes(x) ? "pill-accent" : ""}`} onClick={() => toggle("sizeBands", x)}>
                  {x}
                </button>
              ))}
            </div>
            <label className="mt-2 flex items-center gap-1 text-[12px]">
              Priority
              <input className="field w-20" type="number" min={0} max={100} value={d.priority} onChange={(e) => setD({ ...d, priority: Number(e.target.value) })} />
            </label>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-[var(--muted)]">Buying signals</div>
            <div className="mt-1 flex flex-wrap gap-1">
              {signals.map((x) => (
                <button key={x.key} type="button" className={`pill ${d.signalKeys.includes(x.key) ? "pill-accent" : ""}`} onClick={() => toggle("signalKeys", x.key)}>
                  {x.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </details>

      {err && <div className="mt-3 text-[12.5px] text-[var(--bad)]">{err}</div>}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button className="btn btn-primary btn-sm" onClick={() => save(true)} disabled={busy || !d.name.trim()}>
          {busy ? "Saving…" : "Save and activate"}
        </button>
        <button className="btn btn-sm" onClick={() => save(false)} disabled={busy || !d.name.trim()}>
          Save as draft
        </button>
        <button className="btn btn-ghost btn-sm" onClick={() => setPreview(!preview)}>
          {preview ? "Hide preview" : "Preview"}
        </button>
      </div>
      {preview && <SequencePreview steps={d.steps} sampleAccounts={sampleAccounts} />}
    </section>
  );
}
