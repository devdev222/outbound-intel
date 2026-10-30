"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { AgentRun, AgentState, PipelineSummary } from "@/lib/types";
import { fmtShortTime, fmtTime, runPillClass } from "./format";
import { Spinner } from "./PipelineControls";

export interface AgentsPayload {
  agents: Array<{
    id: string;
    name: string;
    role: string;
    description: string;
    step: number;
    cadenceSeconds: number;
    state: AgentState | null;
    running: boolean;
  }>;
  loop: { running: boolean; intervalSeconds: number; startedAt: string | null; ticks: number; lastTickAt: string | null; inFlight: string[] };
  llm: { available: boolean; model: string; calls: number; failures: number; refusals: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; lastError: string | null };
  providers: Record<string, string>;
  recentRuns: AgentRun[];
  summary: PipelineSummary;
}

const STEP_LABEL: Record<number, string> = { 1: "learn", 2: "discover", 3: "score", 4: "personalize", 5: "experiment", 6: "monitor", 7: "activate", 8: "learn again" };

export function AgentTeam({ initial }: { initial: AgentsPayload }) {
  const router = useRouter();
  const [data, setData] = useState<AgentsPayload>(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [polling, setPolling] = useState(true);

  useEffect(() => {
    if (!polling) return;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/agents", { cache: "no-store" });
        if (!res.ok) return;
        const next = (await res.json()) as AgentsPayload;
        if (!cancelled) setData(next);
      } catch {
        /* keep last good payload */
      }
    };
    const timer = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [polling]);

  async function post(label: string, url: string, body?: unknown) {
    setBusy(label);
    try {
      const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const refreshed = await fetch("/api/agents", { cache: "no-store" });
      if (refreshed.ok) setData((await refreshed.json()) as AgentsPayload);
      router.refresh();
    } catch (err) {
      console.error(err);
    } finally {
      setBusy(null);
    }
  }

  const { loop, llm } = data;

  return (
    <div className="space-y-4">
      <section className="grid gap-3 md:grid-cols-2">
        <div className="panel p-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Runtime loop</h2>
            <label className="flex items-center gap-1 text-xs text-[var(--muted)]">
              <input type="checkbox" checked={polling} onChange={(e) => setPolling(e.target.checked)} /> live
            </label>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <span className={loop.running ? "pill pill-good" : "pill"}>{loop.running ? "running" : "stopped"}</span>
            <span className="pill">every {loop.intervalSeconds}s</span>
            <span className="pill">ticks {loop.ticks}</span>
            <span className="pill">started {fmtTime(loop.startedAt)}</span>
            <span className="pill">last tick {fmtTime(loop.lastTickAt)}</span>
            {loop.inFlight.length > 0 && <span className="pill pill-info">in flight: {loop.inFlight.join(", ")}</span>}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {loop.running ? (
              <button className="btn" disabled={busy !== null} onClick={() => post("loop", "/api/agents/loop", { action: "stop" })}>
                {busy === "loop" ? <Spinner /> : null} Stop loop
              </button>
            ) : (
              <button className="btn btn-accent" disabled={busy !== null} onClick={() => post("loop", "/api/agents/loop", { action: "start" })}>
                {busy === "loop" ? <Spinner /> : null} Start loop
              </button>
            )}
            <button className="btn" disabled={busy !== null} onClick={() => post("tick", "/api/agents/tick", { force: true })}>
              {busy === "tick" ? <Spinner /> : null} Run all once
            </button>
          </div>
          <p className="mt-3 text-xs text-[var(--muted)]">
            In production this loop is <span className="mono">npm run worker</span> on a long-running host, or a scheduler calling <span className="mono">POST /api/agents/tick</span> every minute. Same code path.
          </p>
        </div>
        <div className="panel p-4">
          <h2 className="font-semibold">Claude</h2>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <span className={llm.available ? "pill pill-good" : "pill pill-warn"}>{llm.available ? llm.model : "no API key · template mode"}</span>
            <span className="pill">calls {llm.calls}</span>
            <span className={llm.failures ? "pill pill-bad" : "pill"}>failures {llm.failures}</span>
            {llm.refusals > 0 && <span className="pill pill-warn">refusals {llm.refusals}</span>}
          </div>
          <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
            <div className="rounded-md bg-[var(--panel-2)] p-2">
              <dt className="text-[var(--muted)]">input tokens</dt>
              <dd className="mono text-base">{llm.inputTokens.toLocaleString("en-US")}</dd>
            </div>
            <div className="rounded-md bg-[var(--panel-2)] p-2">
              <dt className="text-[var(--muted)]">output tokens</dt>
              <dd className="mono text-base">{llm.outputTokens.toLocaleString("en-US")}</dd>
            </div>
            <div className="rounded-md bg-[var(--panel-2)] p-2">
              <dt className="text-[var(--muted)]">cache reads</dt>
              <dd className="mono text-base">{llm.cacheReadTokens.toLocaleString("en-US")}</dd>
            </div>
          </dl>
          {llm.lastError && <div className="mono mt-2 text-xs text-[var(--bad)]">last error: {llm.lastError}</div>}
          <p className="mt-3 text-xs text-[var(--muted)]">Scores are deterministic; Claude writes explanations, briefs, copy, playbook and talk tracks. Without a key every agent falls back to templates, so the loop never stalls.</p>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {data.agents.map((a) => {
          const st = a.state;
          const running = a.running || busy === `run:${a.id}`;
          const enabled = st?.enabled ?? true;
          return (
            <div key={a.id} className={`panel flex flex-col p-3 ${enabled ? "" : "opacity-60"}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-semibold">{a.name}</div>
                  <div className="text-xs text-[var(--muted)]">{a.role}</div>
                </div>
                <span className="pill" title={`pipeline step ${a.step}`}>
                  {a.step} · {STEP_LABEL[a.step] ?? ""}
                </span>
              </div>
              <p className="mt-2 flex-1 text-xs leading-relaxed text-[var(--text)]/80">{a.description}</p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                {running ? <span className="pill pill-info"><Spinner /> running</span> : <span className={runPillClass(st?.lastStatus)}>{st?.lastStatus ?? "never ran"}</span>}
                <span className="pill">every {a.cadenceSeconds}s</span>
              </div>
              <div className="mono mt-1.5 text-[11px] text-[var(--muted)]">
                last {fmtShortTime(st?.lastRunAt)} · {st?.totalRuns ?? 0} runs · {st?.totalProcessed ?? 0} processed
              </div>
              <div className="mt-2 flex items-center justify-between gap-2">
                <label className="flex items-center gap-1 text-xs text-[var(--muted)]">
                  <input
                    type="checkbox"
                    checked={enabled}
                    disabled={busy !== null}
                    onChange={(e) => post(`toggle:${a.id}`, `/api/agents/${a.id}/toggle`, { enabled: e.target.checked })}
                  />
                  enabled
                </label>
                <button className="btn px-2 py-1 text-xs" disabled={busy !== null || running} onClick={() => post(`run:${a.id}`, `/api/agents/${a.id}/run`)}>
                  Run now
                </button>
              </div>
            </div>
          );
        })}
      </section>

      <section className="panel overflow-x-auto">
        <div className="flex items-center justify-between px-4 py-2">
          <h2 className="font-semibold">Run log</h2>
          <span className="text-xs text-[var(--muted)]">last {data.recentRuns.length} runs · click a row for details</span>
        </div>
        <table className="w-full min-w-[720px] text-sm">
          <thead className="text-left text-[11px] uppercase tracking-wider text-[var(--muted)]">
            <tr>
              <th className="px-4 py-1.5">Started</th>
              <th className="px-2 py-1.5">Agent</th>
              <th className="px-2 py-1.5">Status</th>
              <th className="px-2 py-1.5 text-right">Processed</th>
              <th className="px-2 py-1.5">Summary</th>
            </tr>
          </thead>
          <tbody>
            {data.recentRuns.map((r) => {
              const open = expanded === r.id;
              const duration = r.finishedAt ? Math.max(0, (new Date(r.finishedAt).getTime() - new Date(r.startedAt).getTime()) / 1000) : null;
              return (
                <RunRows key={r.id} run={r} open={open} duration={duration} onToggle={() => setExpanded(open ? null : r.id)} />
              );
            })}
            {!data.recentRuns.length && (
              <tr>
                <td colSpan={5} className="px-4 py-4 text-sm text-[var(--muted)]">
                  No runs yet. Start the loop or run an agent.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function RunRows({ run, open, duration, onToggle }: { run: AgentRun; open: boolean; duration: number | null; onToggle: () => void }) {
  return (
    <>
      <tr className="cursor-pointer border-t border-[var(--border)] hover:bg-[var(--panel-2)]/60" onClick={onToggle}>
        <td className="mono px-4 py-1.5 text-xs text-[var(--muted)]">
          {fmtShortTime(run.startedAt)}
          {duration !== null && <span className="ml-1">({duration.toFixed(1)}s)</span>}
        </td>
        <td className="px-2 py-1.5">{run.agentId.replace("_", " ")}</td>
        <td className="px-2 py-1.5">
          <span className={runPillClass(run.status)}>{run.status}</span>
        </td>
        <td className="mono px-2 py-1.5 text-right">{run.processed}</td>
        <td className="px-2 py-1.5 text-xs">{run.summary || <span className="text-[var(--muted)]">…</span>}</td>
      </tr>
      {open && (
        <tr className="border-t border-[var(--border)] bg-[var(--panel-2)]/40">
          <td colSpan={5} className="px-4 py-2">
            {run.details.length ? (
              <pre className="mono max-h-64 overflow-auto whitespace-pre-wrap text-xs text-[var(--text)]/80">{run.details.join("\n")}</pre>
            ) : (
              <div className="text-xs text-[var(--muted)]">no detail lines</div>
            )}
            {run.error && <pre className="mono mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-xs text-[var(--bad)]">{run.error}</pre>}
          </td>
        </tr>
      )}
    </>
  );
}
