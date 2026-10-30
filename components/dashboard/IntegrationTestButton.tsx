"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Spinner } from "./PipelineControls";

/**
 * Runs the connection test for one integration. Tests with a real side effect
 * (a visible Slack post, a real email, a row in a Clay table) say so and ask
 * for confirmation first. The result is saved and shown on the card.
 */
export function IntegrationTestButton({ id, provider, needsEmail = false, sideEffect = null }: { id: string; provider: string; needsEmail?: boolean; sideEffect?: string | null }) {
  const router = useRouter();
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function run() {
    setBusy(true);
    setResult(null);
    setConfirming(false);
    try {
      const res = await fetch(`/api/integrations/${encodeURIComponent(id)}/test`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...(needsEmail && to.trim() ? { to: to.trim() } : {}), ...(sideEffect ? { confirmSideEffect: true } : {}) }),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string; error?: string };
      setResult({ ok: Boolean(j.ok) && res.ok, message: j.message ?? j.error ?? `HTTP ${res.status}` });
      router.refresh();
    } catch (err) {
      setResult({ ok: false, message: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        {needsEmail && (
          <input type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="send test to…" className="rounded-md border border-[var(--border)] bg-[var(--panel)] px-2 py-1" />
        )}
        <button className="btn px-2 py-1 text-xs" onClick={() => (sideEffect && !confirming ? setConfirming(true) : run())} disabled={busy || (needsEmail && !to.trim())}>
          {busy ? <Spinner /> : null} Test {provider}
        </button>
      </div>
      {confirming && sideEffect && (
        <div className="flex flex-wrap items-center gap-2 text-[var(--warn)]">
          This test {sideEffect}.
          <button className="btn btn-accent px-2 py-0.5 text-xs" onClick={run}>
            Run it
          </button>
          <button className="btn btn-ghost px-2 py-0.5 text-xs" onClick={() => setConfirming(false)}>
            Cancel
          </button>
        </div>
      )}
      {result && (
        <span className={result.ok ? "text-[var(--good)]" : "text-[var(--bad)]"} title={result.message}>
          {result.ok ? "✓" : "✕"} {result.message}
        </span>
      )}
    </div>
  );
}
