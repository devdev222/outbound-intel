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

/** Business-facing grouping of the team. Order matters. */
export const AGENT_GROUPS: { key: string; label: string; purpose: string; ids: string[] }[] = [
  { key: "market", label: "Market Intelligence", purpose: "Finds and verifies buying signals across the market.", ids: ["hiring", "expansion", "technology", "pain_point"] },
  { key: "account", label: "Account Intelligence", purpose: "Turns signals into qualified, rep-ready accounts.", ids: ["icp", "research", "scoring"] },
  { key: "activation", label: "Campaign Activation", purpose: "Personalizes, launches and activates reps.", ids: ["campaign", "video", "jerry"] },
  { key: "learning", label: "Continuous Learning", purpose: "Retrains the model from every outcome.", ids: ["learning"] },
];

export function AgentTeam({ initial, grouped = false }: { initial: AgentsPayload; grouped?: boolean }) {
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
  const errors = data.agents.filter((a) => a.state?.lastStatus === "error");
  const byId = new Map(data.agents.map((a) => [a.id, a]));
  const groups = grouped ? AGENT_GROUPS.map((g) => ({ ...g, agents: g.ids.map((id) => byId.get(id)).filter((a): a is AgentsPayload["agents"][number] => Boolean(a)) })) : [{ key: "all", label: "Team", purpose: "", agents: data.agents }];

  const renderAgent = (a: AgentsPayload["agents"][number]) => {
    const st = a.state;
    const running = a.running || busy === `run:${a.id}`;
    const enabled = st?.enabled ?? true;
    return (
      <div key={a.id} className={`card flex flex-col p-3 ${enabled ? "" : "opacity-60"}`}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="font-semibold">{a.name}</div>
            <div className="text-xs text-[var(--muted)]">{a.role}</div>
          </div>
          {running ? (
            <span className="pill pill-info">
              <Spinner /> running
            </span>
          ) : (
            <span className={runPillClass(st?.lastStatus)}>{st?.lastStatus ?? "never ran"}</span>
          )}
        </div>
        <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
          <div>
            <div className="text-[var(--muted)]">processed</div>
            <div className="font-semibold">{(st?.totalProcessed ?? 0).toLocaleString("en-US")}</div>
          </div>
          <div>
            <div className="text-[var(--muted)]">runs</div>
            <div className="font-semibold">{st?.totalRuns ?? 0}</div>
          </div>
          <div>
            <div className="text-[var(--muted)]">cadence</div>
            <div className="font-semibold">{a.cadenceSeconds}s</div>
          </div>
        </div>
        <div className="mono mt-1.5 text-[11px] text-[var(--muted)]">last run {fmtShortTime(st?.lastRunAt)}</div>
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer text-[var(--muted)]">What it does</summary>
          <p className="mt-1 leading-relaxed text-[var(--text-2)]">{a.description}</p>
        </details>
        <div className="mt-2 flex items-center justify-between gap-2">
          <label className="flex items-center gap-1 text-xs text-[var(--muted)]">
            <input type="checkbox" checked={enabled} disabled={busy !== null} onChange={(e) => post(`toggle:${a.id}`, `/api/agents/${a.id}/toggle`, { enabled: e.target.checked })} />
            enabled
          </label>
          <button className="btn btn-sm" disabled={busy !== null || running} onClick={() => post(`run:${a.id}`, `/api/agents/${a.id}/run`)}>
            Run now
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-5">
      <section className="card flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className={loop.running ? "pill pill-good" : "pill"}>{loop.running ? "loop running" : "loop stopped"}</span>
          <span className="pill">every {loop.intervalSeconds}s</span>
          <span className="pill">{loop.ticks} ticks</span>
          <span className="pill">last tick {fmtTime(loop.lastTickAt)}</span>
          {loop.inFlight.length > 0 && <span className="pill pill-info">in flight: {loop.inFlight.join(", ")}</span>}
          <span className={errors.length ? "pill pill-bad" : "pill pill-good"}>{errors.length ? `${errors.length} agent${errors.length === 1 ? "" : "s"} erroring` : "no agent errors"}</span>
          <span className={llm.available ? "pill pill-good" : "pill pill-warn"}>{llm.available ? `Claude · ${llm.model}` : "Claude off · templates"}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1 text-xs text-[var(--muted)]">
            <input type="checkbox" checked={polling} onChange={(e) => setPolling(e.target.checked)} /> live
          </label>
          {loop.running ? (
            <button className="btn btn-sm" disabled={busy !== null} onClick={() => post("loop", "/api/agents/loop", { action: "stop" })}>
              {busy === "loop" ? <Spinner /> : null} Stop loop
            </button>
          ) : (
            <button className="btn btn-primary btn-sm" disabled={busy !== null} onClick={() => post("loop", "/api/agents/loop", { action: "start" })}>
              {busy === "loop" ? <Spinner /> : null} Start loop
            </button>
          )}
          <button className="btn btn-sm" disabled={busy !== null} onClick={() => post("tick", "/api/agents/tick", { force: true })}>
            {busy === "tick" ? <Spinner /> : null} Run all once
          </button>
        </div>
      </section>

      {groups.map((g) => (
        <section key={g.key}>
          {grouped && (
            <div className="mb-2">
              <h2 className="section-title mb-0">{g.label}</h2>
              <div className="text-xs text-[var(--muted)]">{g.purpose}</div>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{g.agents.map(renderAgent)}</div>
        </section>
      ))}

      <details className="card">
        <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">
          Technical view: run log, Claude usage, providers <span className="ml-2 text-xs font-normal text-[var(--muted)]">last {data.recentRuns.length} runs</span>
        </summary>
        <div className="divider" />
        <div className="grid gap-3 p-4 md:grid-cols-2">
          <div>
            <div className="card-title">Claude usage</div>
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              <span className="pill">calls {llm.calls}</span>
              <span className={llm.failures ? "pill pill-bad" : "pill"}>failures {llm.failures}</span>
              {llm.refusals > 0 && <span className="pill pill-warn">refusals {llm.refusals}</span>}
              <span className="pill">in {llm.inputTokens.toLocaleString("en-US")}</span>
              <span className="pill">out {llm.outputTokens.toLocaleString("en-US")}</span>
              <span className="pill">cache {llm.cacheReadTokens.toLocaleString("en-US")}</span>
            </div>
            {llm.lastError && <div className="mono mt-2 text-xs text-[var(--bad)]">last error: {llm.lastError}</div>}
          </div>
          <div>
            <div className="card-title">Active adapters</div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {Object.entries(data.providers).map(([k, v]) => (
                <span key={k} className="pill mono">
                  {k}: {v}
                </span>
              ))}
            </div>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="table min-w-[720px]">
            <thead>
              <tr>
                <th>Started</th>
                <th>Agent</th>
                <th>Status</th>
                <th className="text-right">Processed</th>
                <th>Summary</th>
              </tr>
            </thead>
            <tbody>
              {data.recentRuns.map((r) => {
                const open = expanded === r.id;
                const duration = r.finishedAt ? Math.max(0, (new Date(r.finishedAt).getTime() - new Date(r.startedAt).getTime()) / 1000) : null;
                return <RunRows key={r.id} run={r} open={open} duration={duration} onToggle={() => setExpanded(open ? null : r.id)} />;
              })}
              {!data.recentRuns.length && (
                <tr>
                  <td colSpan={5} className="text-sm text-[var(--muted)]">
                    No runs yet. Start the loop or run an agent.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

function RunRows({ run, open, duration, onToggle }: { run: AgentRun; open: boolean; duration: number | null; onToggle: () => void }) {
  return (
    <>
      <tr className="cursor-pointer" onClick={onToggle}>
        <td className="mono text-xs text-[var(--muted)]">
          {fmtShortTime(run.startedAt)}
          {duration !== null && <span className="ml-1">({duration.toFixed(1)}s)</span>}
        </td>
        <td>{run.agentId.replace("_", " ")}</td>
        <td>
          <span className={runPillClass(run.status)}>{run.status}</span>
        </td>
        <td className="mono text-right">{run.processed}</td>
        <td className="text-xs">{run.summary || <span className="text-[var(--muted)]">…</span>}</td>
      </tr>
      {open && (
        <tr>
          <td colSpan={5} className="bg-[var(--surface-2)]">
            {run.details.length ? <pre className="mono max-h-64 overflow-auto whitespace-pre-wrap text-xs">{run.details.join("\n")}</pre> : <div className="text-xs text-[var(--muted)]">no detail lines</div>}
            {run.error && <pre className="mono mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-xs text-[var(--bad)]">{run.error}</pre>}
          </td>
        </tr>
      )}
    </>
  );
}
