"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Pause ("Not now") or resume all outreach for an account. Enforced by the scheduler, the dialer and the Sequencer. */
export function PauseControl({ slug, pausedUntil, pauseReason }: { slug: string; pausedUntil: string | null; pauseReason: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState(30);
  const [reason, setReason] = useState("Prospect asked to reconnect later");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const paused = Boolean(pausedUntil && pausedUntil > new Date().toISOString());

  async function send(body: Record<string, unknown>) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/accounts/${encodeURIComponent(slug)}/pause`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const data = (await res.json().catch(() => ({}))) as { error?: string; external?: string };
      if (!res.ok) return setMsg(data.error ?? `HTTP ${res.status}`);
      if (data.external === "pending" || data.external === "failed") setMsg(`saved here; the Sequencer has not confirmed yet (${data.external}), retrying automatically`);
      setOpen(false);
      router.refresh();
    } catch {
      setMsg("network error; try again");
    } finally {
      setBusy(false);
    }
  }

  if (paused) {
    return (
      <span className="flex flex-wrap items-center gap-1.5">
        <span className="pill pill-warn" title={pauseReason ?? undefined}>
          Paused until {pausedUntil!.slice(0, 10)}
        </span>
        <button className="btn btn-sm" onClick={() => send({ action: "resume" })} disabled={busy}>
          Resume outreach
        </button>
        {msg && <span className="text-[12px] text-[var(--muted)]">{msg}</span>}
      </span>
    );
  }
  if (!open)
    return (
      <button className="btn btn-sm" onClick={() => setOpen(true)}>
        Pause outreach
      </button>
    );
  return (
    <span className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
      <select className="field max-w-[110px]" value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Pause length">
        {[14, 30, 60, 90].map((d) => (
          <option key={d} value={d}>
            {d} days
          </option>
        ))}
      </select>
      <input className="field max-w-[240px]" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason" />
      <button className="btn btn-accent btn-sm" onClick={() => send({ action: "pause", days, reason })} disabled={busy || !reason.trim()}>
        Pause
      </button>
      <button className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>
        Cancel
      </button>
      {msg && <span className="text-[12px] text-[var(--muted)]">{msg}</span>}
    </span>
  );
}
