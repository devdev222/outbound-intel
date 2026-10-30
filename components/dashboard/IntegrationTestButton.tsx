"use client";

import { useState } from "react";
import { Spinner } from "./PipelineControls";

/** Runs a safe, read-mostly connectivity test for one integration and shows the result inline. */
export function IntegrationTestButton({ id, needsEmail = false }: { id: string; needsEmail?: boolean }) {
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function run() {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch(`/api/integrations/${encodeURIComponent(id)}/test`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(needsEmail && to.trim() ? { to: to.trim() } : {}),
      });
      let j: { ok?: boolean; message?: string; error?: string } = {};
      try {
        j = (await res.json()) as typeof j;
      } catch {
        /* ignore */
      }
      setResult({ ok: Boolean(j.ok) && res.ok, message: j.message ?? j.error ?? `HTTP ${res.status}` });
    } catch (err) {
      setResult({ ok: false, message: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      {needsEmail && (
        <input
          type="email"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="send test to…"
          className="rounded-md border border-[var(--border)] bg-[var(--panel)] px-2 py-1"
        />
      )}
      <button className="btn px-2 py-1 text-xs" onClick={run} disabled={busy || (needsEmail && !to.trim())}>
        {busy ? <Spinner /> : null} Test connection
      </button>
      {result && (
        <span className={result.ok ? "text-[var(--good)]" : "text-[var(--bad)]"} title={result.message}>
          {result.ok ? "✓" : "✕"} {result.message}
        </span>
      )}
    </div>
  );
}
