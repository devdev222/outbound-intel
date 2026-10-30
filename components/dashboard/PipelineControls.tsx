"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

async function post(url: string, body?: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data: unknown = text;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* keep text */
  }
  if (!res.ok) throw new Error(typeof data === "object" && data && "error" in data ? String((data as { error: unknown }).error) : `HTTP ${res.status}`);
  return data;
}

export function PipelineControls({ loopRunning }: { loopRunning: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function run(label: string, fn: () => Promise<string>) {
    setBusy(label);
    setMessage(null);
    try {
      const msg = await fn();
      setMessage(msg);
      router.refresh();
    } catch (err) {
      setMessage(`${label} failed: ${(err as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  const seed = () => {
    const raw = window.prompt("How many companies should the discovery agent find?", "120");
    if (raw === null) return;
    const count = Math.max(1, Math.min(500, Number(raw) || 120));
    void run("Seed", async () => {
      const r = (await post("/api/seed", { count })) as { historical?: number; accounts?: number; modelVersion?: number; runs?: unknown[] };
      return `Seeded ${r.accounts ?? "?"} accounts from ${r.historical ?? "?"} historical records; model v${r.modelVersion ?? "?"}; ${r.runs?.length ?? 0} agent runs.`;
    });
  };

  const pass = () =>
    run("Run one pass", async () => {
      const r = (await post("/api/agents/tick", { force: true })) as { runs?: { agentId: string; status: string; summary: string }[] };
      return (r.runs ?? []).map((x) => `${x.agentId}: ${x.summary}`).join(" | ") || "No agents ran.";
    });

  const loop = (action: "start" | "stop") =>
    run(action === "start" ? "Start loop" : "Stop loop", async () => {
      const r = (await post("/api/agents/loop", { action })) as { running?: boolean; intervalSeconds?: number };
      return r.running ? `Loop running every ${r.intervalSeconds}s.` : "Loop stopped.";
    });

  const reset = () => {
    if (!window.confirm("Reset the store? This deletes all accounts, history, events, alerts and models.")) return;
    void run("Reset", async () => {
      await post("/api/seed", { count: 0, resetOnly: true });
      return "Store reset.";
    });
  };

  return (
    <div className="panel flex flex-wrap items-center gap-2 p-3">
      <button className="btn btn-accent" onClick={seed} disabled={busy !== null}>
        {busy === "Seed" ? <Spinner /> : null} Seed demo data
      </button>
      <button className="btn" onClick={pass} disabled={busy !== null}>
        {busy === "Run one pass" ? <Spinner /> : null} Run one pass
      </button>
      {loopRunning ? (
        <button className="btn" onClick={() => loop("stop")} disabled={busy !== null}>
          {busy === "Stop loop" ? <Spinner /> : null} Stop loop
        </button>
      ) : (
        <button className="btn" onClick={() => loop("start")} disabled={busy !== null}>
          {busy === "Start loop" ? <Spinner /> : null} Start loop
        </button>
      )}
      <button className="btn ml-auto text-[var(--bad)]" onClick={reset} disabled={busy !== null}>
        {busy === "Reset" ? <Spinner /> : null} Reset
      </button>
      {message && <div className="mono w-full whitespace-pre-wrap break-words text-xs text-[var(--muted)]">{message}</div>}
      {busy === "Seed" && <div className="w-full text-xs text-[var(--muted)]">Seeding runs the whole team once; with an LLM key this can take up to a minute.</div>}
    </div>
  );
}

export function Spinner() {
  return <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />;
}
