"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Automation = { autoSendEmail: boolean; autoLaunchCampaigns: boolean; autoProposeGifts: boolean; requireFollowUpApproval: boolean; signalFreshnessDays: number; qualificationThreshold: number; hotThreshold: number };
type Economics = { repFullyLoadedMonthly: number; toolingMonthly: number; videoCostPerRender: number; avgOpportunityValue: number; meetingHoldRate: number };

async function patchSettings(body: unknown): Promise<string | null> {
  const res = await fetch("/api/settings", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = (await res.json().catch(() => ({}))) as { error?: string };
  return res.ok ? null : (j.error ?? `HTTP ${res.status}`);
}

export function ScoringSettingsForm({ automation, economics }: { automation: Automation; economics: Economics }) {
  const router = useRouter();
  const [a, setA] = useState(automation);
  const [e, setE] = useState(economics);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const err = await patchSettings({ automation: { signalFreshnessDays: a.signalFreshnessDays, qualificationThreshold: a.qualificationThreshold, hotThreshold: a.hotThreshold }, economics: e });
    setBusy(false);
    setMsg(err ? `Not saved: ${err}` : "Saved");
    if (!err) router.refresh();
  }

  const num = (label: string, value: number, onChange: (v: number) => void, step = 1, hint?: string) => (
    <label className="text-xs text-[var(--text-2)]">
      {label}
      <input type="number" step={step} className="field mt-1" value={value} onChange={(ev) => onChange(Number(ev.target.value))} />
      {hint && <span className="mt-0.5 block text-[11px] text-[var(--muted)]">{hint}</span>}
    </label>
  );

  return (
    <div className="space-y-4">
      <div>
        <div className="card-title mb-2">Thresholds</div>
        <div className="grid gap-3 sm:grid-cols-3">
          {num("Qualification threshold (0–100)", a.qualificationThreshold, (v) => setA({ ...a, qualificationThreshold: v }), 1, "total score needed before readiness checks run")}
          {num("Hot engagement threshold", a.hotThreshold, (v) => setA({ ...a, hotThreshold: v }), 1, "engagement score that alerts the rep")}
          {num("Signal freshness (days)", a.signalFreshnessDays, (v) => setA({ ...a, signalFreshnessDays: v }), 1, "older signals do not count as evidence")}
        </div>
      </div>
      <div>
        <div className="card-title mb-2">Economics</div>
        <div className="grid gap-3 sm:grid-cols-3">
          {num("Rep fully loaded cost / month ($)", e.repFullyLoadedMonthly, (v) => setE({ ...e, repFullyLoadedMonthly: v }), 100)}
          {num("Tooling / month ($)", e.toolingMonthly, (v) => setE({ ...e, toolingMonthly: v }), 50)}
          {num("Video cost per render ($)", e.videoCostPerRender, (v) => setE({ ...e, videoCostPerRender: v }), 0.1)}
          {num("Average opportunity value ($)", e.avgOpportunityValue, (v) => setE({ ...e, avgOpportunityValue: v }), 1000, "used when the CRM supplies no amount")}
          {num("Meeting hold rate (0–1)", e.meetingHoldRate, (v) => setE({ ...e, meetingHoldRate: v }), 0.05)}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button className="btn btn-primary" onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save settings"}
        </button>
        {msg && <span className="text-xs text-[var(--muted)]">{msg}</span>}
      </div>
    </div>
  );
}

export function AutomationToggles({ automation }: { automation: Automation }) {
  const router = useRouter();
  const [a, setA] = useState(automation);
  const [msg, setMsg] = useState<string | null>(null);
  const items: { key: keyof Automation; label: string; on: string; off: string }[] = [
    { key: "autoSendEmail", label: "Send email touches automatically", on: "Due emails are sent by the active provider.", off: "Every email waits for a rep to approve it." },
    { key: "autoLaunchCampaigns", label: "Launch campaigns automatically", on: "Rep-ready accounts get a page and sequence without review.", off: "Qualified accounts wait; nothing launches." },
    { key: "autoProposeGifts", label: "Propose gifts automatically", on: "The engine proposes gifts under active campaigns; approvals still apply.", off: "Gifts are proposed manually from the Gifting page." },
    { key: "requireFollowUpApproval", label: "Require approval of drafted follow-ups", on: "Conversation follow-ups are drafted and wait for a human.", off: "Drafted follow-ups are scheduled immediately." },
  ];
  async function toggle(key: keyof Automation, value: boolean) {
    const next = { ...a, [key]: value };
    setA(next);
    const err = await patchSettings({ automation: { [key]: value } });
    setMsg(err ? `Not saved: ${err}` : `Saved ${new Date().toLocaleTimeString()}`);
    if (!err) router.refresh();
  }
  return (
    <div className="space-y-3">
      {items.map((it) => {
        const on = Boolean(a[it.key]);
        return (
          <label key={it.key} className="flex items-start gap-3 rounded-md border border-[var(--border)] p-3">
            <input type="checkbox" className="mt-1" checked={on} onChange={(e) => toggle(it.key, e.target.checked)} />
            <span>
              <span className="block text-sm font-medium">{it.label}</span>
              <span className="block text-xs text-[var(--muted)]">{on ? it.on : it.off}</span>
            </span>
          </label>
        );
      })}
      {msg && <div className="text-xs text-[var(--muted)]">{msg}</div>}
    </div>
  );
}

type Suppression = { id: string; target: string; reason: string; note: string | null; createdBy: string; at: string };
export function SuppressionManager({ suppressions }: { suppressions: Suppression[] }) {
  const router = useRouter();
  const [target, setTarget] = useState("");
  const [reason, setReason] = useState("do_not_contact");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  async function add() {
    const res = await fetch("/api/suppressions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ target, reason, note: note || undefined }) });
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    setMsg(res.ok ? "Added" : (j.error ?? `HTTP ${res.status}`));
    if (res.ok) {
      setTarget("");
      setNote("");
      router.refresh();
    }
  }
  async function remove(id: string) {
    await fetch(`/api/suppressions?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    router.refresh();
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex-1 text-xs text-[var(--text-2)]">
          Email or @domain
          <input className="field mt-1" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="name@company.com or @company.com" />
        </label>
        <label className="text-xs text-[var(--text-2)]">
          Reason
          <select className="field mt-1" value={reason} onChange={(e) => setReason(e.target.value)}>
            {["opt_out", "customer", "competitor", "do_not_contact", "bounced", "manual"].map((r) => (
              <option key={r} value={r}>
                {r.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </label>
        <label className="flex-1 text-xs text-[var(--text-2)]">
          Note
          <input className="field mt-1" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <button className="btn btn-primary" onClick={add} disabled={target.trim().length < 3}>
          Suppress
        </button>
      </div>
      {msg && <div className="text-xs text-[var(--muted)]">{msg}</div>}
      {suppressions.length ? (
        <table className="table">
          <thead>
            <tr>
              <th>Target</th>
              <th>Reason</th>
              <th>Note</th>
              <th>By</th>
              <th>When</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {suppressions.map((s) => (
              <tr key={s.id}>
                <td className="mono">{s.target}</td>
                <td>{s.reason.replace(/_/g, " ")}</td>
                <td className="text-xs text-[var(--muted)]">{s.note ?? ""}</td>
                <td className="text-xs">{s.createdBy}</td>
                <td className="mono text-xs text-[var(--muted)]">{s.at.slice(0, 16).replace("T", " ")}</td>
                <td className="text-right">
                  <button className="btn btn-ghost btn-sm" onClick={() => remove(s.id)}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="text-sm text-[var(--muted)]">No suppressions. Opt-outs from email links land here automatically.</div>
      )}
    </div>
  );
}

type Rep = { id: string; name: string; email: string; capacityPerDay: number; active: boolean };
export function RepsManager({ reps }: { reps: Rep[] }) {
  const router = useRouter();
  const [draft, setDraft] = useState<Rep>({ id: "", name: "", email: "", capacityPerDay: 35, active: true });
  const [msg, setMsg] = useState<string | null>(null);
  async function save(rep: Rep) {
    const res = await fetch("/api/reps", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...rep, id: rep.id || undefined }) });
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    setMsg(res.ok ? "Saved" : (j.error ?? `HTTP ${res.status}`));
    if (res.ok) {
      setDraft({ id: "", name: "", email: "", capacityPerDay: 35, active: true });
      router.refresh();
    }
  }
  return (
    <div className="space-y-3">
      <table className="table">
        <thead>
          <tr>
            <th>Rep</th>
            <th>Email</th>
            <th className="text-right">Capacity / day</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {reps.map((r) => (
            <tr key={r.id}>
              <td className="font-medium">{r.name}</td>
              <td className="mono text-xs">{r.email}</td>
              <td className="text-right">{r.capacityPerDay}</td>
              <td>
                <span className={r.active ? "pill pill-good" : "pill"}>{r.active ? "active" : "inactive"}</span>
              </td>
              <td className="text-right">
                <button className="btn btn-ghost btn-sm" onClick={() => save({ ...r, active: !r.active })}>
                  {r.active ? "Deactivate" : "Activate"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-[var(--text-2)]">
          Name
          <input className="field mt-1" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        </label>
        <label className="text-xs text-[var(--text-2)]">
          Email
          <input className="field mt-1" type="email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
        </label>
        <label className="text-xs text-[var(--text-2)]">
          Capacity / day
          <input className="field mt-1" type="number" value={draft.capacityPerDay} onChange={(e) => setDraft({ ...draft, capacityPerDay: Number(e.target.value) })} />
        </label>
        <button className="btn btn-primary" onClick={() => save(draft)} disabled={draft.name.length < 2 || !draft.email.includes("@")}>
          Add rep
        </button>
      </div>
      {msg && <div className="text-xs text-[var(--muted)]">{msg}</div>}
    </div>
  );
}
