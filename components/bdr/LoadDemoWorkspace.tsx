"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Demo-only: seeds the synthetic workspace (the API refuses this in live mode). */
export function LoadDemoWorkspace() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function load() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/seed", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ count: 40 }) });
      if (!res.ok) {
        setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${res.status}`);
        return;
      }
      router.refresh();
    } catch {
      setError("network error; try again");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-col items-center gap-1">
      <button className="btn btn-accent" onClick={load} disabled={busy}>
        {busy ? "Loading demo workspace…" : "Load demo workspace"}
      </button>
      {error && <span className="text-[12px] text-[var(--bad)]">{error}</span>}
    </div>
  );
}
