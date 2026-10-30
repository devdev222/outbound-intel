import Link from "next/link";
import { AccountTable } from "@/components/dashboard/AccountTable";
import { PipelineControls } from "@/components/dashboard/PipelineControls";
import { STATUS_ORDER, fmtTime, statusLabel, statusPillClass } from "@/components/dashboard/format";
import { loopStatus } from "@/lib/agents/runtime";
import { getStore } from "@/lib/store";
import type { Weights } from "@/lib/types";

export const dynamic = "force-dynamic";

const WEIGHT_KEYS: (keyof Weights)[] = ["signal", "icp", "pain", "timing", "access"];

export default async function PipelinePage() {
  const store = getStore();
  const [accounts, model, states, alerts] = await Promise.all([store.listAccounts(), store.getLatestModel(), store.getAgentStates(), store.listAlerts({ limit: 1 })]);
  const loop = loopStatus();

  const counts = Object.fromEntries(STATUS_ORDER.map((s) => [s, 0])) as Record<string, number>;
  for (const a of accounts) counts[a.status] = (counts[a.status] ?? 0) + 1;
  const errored = states.filter((s) => s.lastStatus === "error").length;
  const top = accounts.filter((a) => a.status !== "disqualified").slice(0, 25);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Pipeline</h1>
          <p className="text-sm text-[var(--muted)]">
            {accounts.length.toLocaleString("en-US")} accounts · learn → discover → score → personalize → experiment → monitor → activate → learn again
          </p>
        </div>
      </div>

      <PipelineControls loopRunning={loop.running} />

      <section className="grid grid-cols-2 gap-2 sm:grid-cols-5 lg:grid-cols-10">
        {STATUS_ORDER.map((s) => (
          <Link key={s} href={`/accounts?status=${s}`} className="panel block p-3 no-underline hover:border-[var(--accent)]">
            <div className="mono text-2xl font-semibold">{counts[s] ?? 0}</div>
            <div className="mt-1">
              <span className={statusPillClass(s)}>{statusLabel(s)}</span>
            </div>
          </Link>
        ))}
      </section>

      <section className="grid gap-3 md:grid-cols-2">
        <div className="panel p-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Scoring model</h2>
            <Link href="/intelligence" className="text-xs text-[var(--info)]">
              intelligence →
            </Link>
          </div>
          {model ? (
            <>
              <div className="mt-1 text-xs text-[var(--muted)]">
                v{model.version} · trained {fmtTime(model.trainedAt)} on {model.baseline.n} records ({model.baseline.wins} won, {model.baseline.meetings} meetings)
              </div>
              <div className="mt-3 space-y-2">
                {WEIGHT_KEYS.map((k) => (
                  <div key={k} className="grid grid-cols-[64px_1fr_90px] items-center gap-2 text-xs">
                    <span className="capitalize text-[var(--muted)]">{k}</span>
                    <div className="space-y-1">
                      <span className="bar block">
                        <span style={{ width: `${model.weights[k] * 100 * 2.5}%` }} />
                      </span>
                      <span className="bar block opacity-40">
                        <span style={{ width: `${model.priorWeights[k] * 100 * 2.5}%`, background: "var(--muted)" }} />
                      </span>
                    </div>
                    <span className="mono text-right">
                      {model.weights[k].toFixed(2)} <span className="text-[var(--muted)]">/ {model.priorWeights[k].toFixed(2)}</span>
                    </span>
                  </div>
                ))}
                <div className="text-[11px] text-[var(--muted)]">learned weight (orange) vs spec prior (grey)</div>
              </div>
            </>
          ) : (
            <div className="mt-2 text-sm text-[var(--muted)]">No model yet. Seed demo data to train the first version.</div>
          )}
        </div>

        <div className="panel p-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Agent team</h2>
            <Link href="/agents" className="text-xs text-[var(--info)]">
              agents →
            </Link>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <span className={loop.running ? "pill pill-good" : "pill"}>{loop.running ? `loop running · every ${loop.intervalSeconds}s` : "loop stopped"}</span>
            <span className="pill">ticks {loop.ticks}</span>
            <span className="pill">last tick {fmtTime(loop.lastTickAt)}</span>
            {loop.inFlight.length > 0 && <span className="pill pill-info">running: {loop.inFlight.join(", ")}</span>}
            <span className={errored ? "pill pill-bad" : "pill pill-good"}>{errored ? `${errored} agent${errored > 1 ? "s" : ""} in error` : "no agent errors"}</span>
          </div>
          <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
            <div className="rounded-md bg-[var(--panel-2)] p-2">
              <dt className="text-[var(--muted)]">agents with state</dt>
              <dd className="mono text-lg">{states.length}/10</dd>
            </div>
            <div className="rounded-md bg-[var(--panel-2)] p-2">
              <dt className="text-[var(--muted)]">total runs</dt>
              <dd className="mono text-lg">{states.reduce((n, s) => n + s.totalRuns, 0)}</dd>
            </div>
            <div className="rounded-md bg-[var(--panel-2)] p-2">
              <dt className="text-[var(--muted)]">last alert</dt>
              <dd className="mono text-sm">{alerts[0] ? fmtTime(alerts[0].createdAt) : "-"}</dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-[var(--muted)]">
            Run the loop in-process here for a demo, or deploy <span className="mono">npm run worker</span> / cron → <span className="mono">POST /api/agents/tick</span> for 24/7.
          </p>
        </div>
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Top accounts</h2>
          <Link href="/accounts" className="text-xs text-[var(--info)]">
            all accounts →
          </Link>
        </div>
        <AccountTable accounts={top} />
      </section>
    </div>
  );
}
