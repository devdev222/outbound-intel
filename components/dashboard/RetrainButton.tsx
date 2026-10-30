"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Spinner } from "./PipelineControls";

export function RetrainButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function retrain() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/agents/learning/run", { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as { run?: { summary?: string }; error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setMessage(data.run?.summary ?? "done");
      router.push("/intelligence");
      router.refresh();
    } catch (err) {
      setMessage(`failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button className="btn btn-accent" onClick={retrain} disabled={busy}>
        {busy ? <Spinner /> : null} Retrain now
      </button>
      {message && <div className="mono max-w-md text-right text-xs text-[var(--muted)]">{message}</div>}
    </div>
  );
}
