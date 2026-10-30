"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

async function patch(id: string, body: unknown): Promise<{ ok: boolean; error?: string; applied?: string }> {
  const res = await fetch(`/api/experiments/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as { error?: string; applied?: string };
  return { ok: res.ok, error: data.error, applied: data.applied };
}

export function ExperimentStatusButton({ id, status, canEdit = true }: { id: string; status: "draft" | "running" | "completed"; canEdit?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (status === "completed" || !canEdit) return null;
  const action = status === "draft" ? "start" : "stop";
  async function go() {
    setBusy(true);
    setErr(null);
    const r = await patch(id, { action });
    setBusy(false);
    if (!r.ok) return setErr(r.error ?? "failed");
    router.refresh();
  }
  return (
    <span className="inline-flex items-center gap-2">
      <button className={`btn btn-sm ${action === "start" ? "btn-primary" : ""}`} onClick={go} disabled={busy}>
        {busy ? "…" : action === "start" ? "Start" : "Stop"}
      </button>
      {err && <span className="text-[12px] text-[var(--bad)]">{err}</span>}
    </span>
  );
}

/** Make an arm the new default. Confirms first, because it changes what every new campaign launches with. */
export function RolloutButton({ id, armKey, armName, recommended }: { id: string; armKey: string; armName: string; recommended: boolean }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function go() {
    setBusy(true);
    const r = await patch(id, { action: "rollout", armKey });
    setBusy(false);
    setConfirm(false);
    setMsg(r.ok ? { ok: true, text: r.applied ?? "Rolled out." } : { ok: false, text: r.error ?? "failed" });
    if (r.ok) router.refresh();
  }
  if (msg) return <span className={`text-[12px] ${msg.ok ? "text-[var(--good)]" : "text-[var(--bad)]"}`}>{msg.text}</span>;
  if (!confirm)
    return (
      <button className={`btn btn-sm ${recommended ? "btn-accent" : ""}`} onClick={() => setConfirm(true)}>
        Roll out
      </button>
    );
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 text-[12px]">
      Make “{armName}” the default for every new campaign and end the experiment?
      <button className="btn btn-accent btn-sm" onClick={go} disabled={busy}>
        {busy ? "…" : "Yes, roll out"}
      </button>
      <button className="btn btn-ghost btn-sm" onClick={() => setConfirm(false)}>
        Cancel
      </button>
    </span>
  );
}
