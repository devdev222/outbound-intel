"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function ExperimentStatusButton({ id, status }: { id: string; status: "draft" | "running" | "completed" }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (status === "completed") return <span className="pill">completed</span>;
  const action = status === "draft" ? "start" : "stop";
  async function go() {
    setBusy(true);
    setErr(null);
    const res = await fetch(`/api/experiments/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setErr(data.error ?? "failed");
      return;
    }
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
