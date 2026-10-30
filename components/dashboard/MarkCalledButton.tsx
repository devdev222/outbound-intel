"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Spinner } from "./PipelineControls";

export function MarkCalledButton({ id, status }: { id: string; status: "queued" | "called" | "skipped" }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function set(next: "called" | "skipped") {
    setBusy(true);
    try {
      await fetch(`/api/calls/${encodeURIComponent(id)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: next }) });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (status !== "queued") return <span className="pill">{status}</span>;
  return (
    <div className="flex gap-1">
      <button className="btn px-2 py-1 text-xs" disabled={busy} onClick={() => set("called")}>
        {busy ? <Spinner /> : null} Mark called
      </button>
      <button className="btn px-2 py-1 text-xs text-[var(--muted)]" disabled={busy} onClick={() => set("skipped")}>
        Skip
      </button>
    </div>
  );
}
