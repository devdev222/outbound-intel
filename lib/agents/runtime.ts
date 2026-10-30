import { config } from "@/lib/config";
import { bootstrapModel } from "@/lib/engine/learn";
import { getProviders } from "@/lib/providers";
import { getStore, type Store } from "@/lib/store";
import type { AgentId, AgentRun, AgentState, ScoringModel } from "@/lib/types";
import { nowIso, uuid } from "@/lib/util";
import { AGENT_BY_ID, AGENTS } from "./index";
import type { AgentContext } from "./base";

/**
 * Agent runtime: the thing that makes the team run 24/7.
 *
 *  - `runAgent(id)`     run one agent now (guarded against overlapping runs)
 *  - `tick()`           run every enabled agent whose cadence has elapsed, in pipeline order
 *  - `startLoop()`      keep ticking on an interval inside this process (worker or dev server)
 *  - `runPipelineOnce()` one full pass in order, used by scripts
 *
 * Deployment options for "24/7": `npm run worker` as a long-running process
 * (Railway/Fly/ECS), or a scheduler hitting POST /api/agents/tick every minute
 * (Vercel Cron, GitHub Actions, Supabase pg_cron -> http). Both call the same
 * `tick()`. State (last run, totals, run log) lives in the store, so several
 * workers can share one database; a per-process lock stops the same agent
 * overlapping with itself inside a process.
 */

declare global {
  // eslint-disable-next-line no-var
  var __outboundIntelRuntime:
    | {
        running: Map<AgentId, Promise<AgentRun>>;
        loop: { timer: ReturnType<typeof setInterval> | null; intervalSeconds: number; startedAt: string | null; ticks: number };
        lastTickAt: string | null;
      }
    | undefined;
}

function rt() {
  if (!globalThis.__outboundIntelRuntime) {
    globalThis.__outboundIntelRuntime = {
      running: new Map(),
      loop: { timer: null, intervalSeconds: config.agents.tickSeconds, startedAt: null, ticks: 0 },
      lastTickAt: null,
    };
  }
  return globalThis.__outboundIntelRuntime;
}

export async function getOrBootstrapModel(store: Store): Promise<ScoringModel> {
  const latest = await store.getLatestModel();
  if (latest) return latest;
  return store.saveModel(bootstrapModel(1));
}

async function getState(store: Store, agentId: AgentId): Promise<AgentState> {
  const states = await store.getAgentStates();
  return states.find((s) => s.agentId === agentId) ?? { agentId, enabled: true, lastRunAt: null, lastStatus: null, totalRuns: 0, totalProcessed: 0 };
}

export async function setAgentEnabled(agentId: AgentId, enabled: boolean): Promise<AgentState> {
  const store = getStore();
  const state = { ...(await getState(store, agentId)), enabled };
  await store.saveAgentState(state);
  return state;
}

/** Run one agent now. If it is already running in this process, returns the in-flight run. */
export function runAgent(agentId: AgentId, opts: { force?: boolean } = {}): Promise<AgentRun> {
  const r = rt();
  const inflight = r.running.get(agentId);
  if (inflight) return inflight;

  const def = AGENT_BY_ID[agentId];
  const store = getStore();
  const providers = getProviders();

  const p = (async (): Promise<AgentRun> => {
    const state = await getState(store, agentId);
    const run: AgentRun = {
      id: uuid(),
      agentId,
      startedAt: nowIso(),
      finishedAt: null,
      status: "running",
      processed: 0,
      summary: "",
      details: [],
    };
    if (!state.enabled && !opts.force) {
      run.status = "skipped";
      run.finishedAt = nowIso();
      run.summary = "agent disabled";
      return run;
    }
    await store.insertAgentRun(run);
    const log = (line: string) => {
      run.details.push(`${new Date().toISOString().slice(11, 19)} ${line}`);
      console.log(`[${def.id}] ${line}`);
    };
    try {
      const model = await getOrBootstrapModel(store);
      const ctx: AgentContext = { store, providers, model, batchSize: config.agents.batchSize, log };
      const result = await def.run(ctx);
      run.status = "ok";
      run.processed = result.processed;
      run.summary = result.summary;
    } catch (err) {
      run.status = "error";
      run.error = (err as Error).stack ?? String(err);
      run.summary = `error: ${(err as Error).message}`;
      console.error(`[${def.id}] ${run.error}`);
    } finally {
      run.finishedAt = nowIso();
      await store.updateAgentRun(run);
      await store.saveAgentState({
        ...state,
        lastRunAt: run.startedAt,
        lastStatus: run.status,
        totalRuns: state.totalRuns + 1,
        totalProcessed: state.totalProcessed + run.processed,
      });
    }
    return run;
  })();

  r.running.set(agentId, p);
  p.finally(() => r.running.delete(agentId)).catch(() => undefined);
  return p;
}

/** Run every agent whose cadence has elapsed, in pipeline order. */
export async function tick(opts: { force?: boolean } = {}): Promise<AgentRun[]> {
  const store = getStore();
  const states = await store.getAgentStates();
  const runs: AgentRun[] = [];
  const now = Date.now();
  for (const def of AGENTS) {
    const state = states.find((s) => s.agentId === def.id);
    if (state && !state.enabled) continue;
    const due = opts.force || !state?.lastRunAt || now - new Date(state.lastRunAt).getTime() >= def.cadenceSeconds * 1000;
    if (!due) continue;
    runs.push(await runAgent(def.id));
  }
  rt().lastTickAt = nowIso();
  rt().loop.ticks++;
  return runs;
}

/** Run one agent repeatedly until it reports no work (bounded). Used after a learn pass to re-score everything. */
export async function runAgentUntilDrained(agentId: AgentId, maxRuns = 20): Promise<AgentRun[]> {
  const runs: AgentRun[] = [];
  for (let i = 0; i < maxRuns; i++) {
    const run = await runAgent(agentId, { force: true });
    runs.push(run);
    if (run.status !== "ok" || run.processed === 0) break;
  }
  return runs;
}

/**
 * One complete pass through the team regardless of cadence (scripts, demo).
 * With `drain`, keeps passing until no agent has work left (bounded), so a
 * freshly seeded batch is fully processed instead of one batch per agent.
 */
export async function runPipelineOnce(opts: { drain?: boolean; maxPasses?: number } = {}): Promise<AgentRun[]> {
  const runs: AgentRun[] = [];
  const maxPasses = opts.drain ? (opts.maxPasses ?? 12) : 1;
  for (let pass = 0; pass < maxPasses; pass++) {
    let processed = 0;
    for (const def of AGENTS) {
      const run = await runAgent(def.id, { force: true });
      runs.push(run);
      if (def.id !== "learning") processed += run.processed;
    }
    if (processed === 0) break;
  }
  return runs;
}

export function startLoop(intervalSeconds = config.agents.tickSeconds): { started: boolean; intervalSeconds: number } {
  const r = rt();
  if (r.loop.timer) return { started: false, intervalSeconds: r.loop.intervalSeconds };
  r.loop.intervalSeconds = intervalSeconds;
  r.loop.startedAt = nowIso();
  r.loop.ticks = 0;
  let busy = false;
  const fire = async () => {
    if (busy) return;
    busy = true;
    try {
      await tick();
    } catch (err) {
      console.error("[runtime] tick failed:", err);
    } finally {
      busy = false;
    }
  };
  void fire();
  r.loop.timer = setInterval(fire, intervalSeconds * 1000);
  return { started: true, intervalSeconds };
}

export function stopLoop(): boolean {
  const r = rt();
  if (!r.loop.timer) return false;
  clearInterval(r.loop.timer);
  r.loop.timer = null;
  return true;
}

export function loopStatus() {
  const r = rt();
  return {
    running: Boolean(r.loop.timer),
    intervalSeconds: r.loop.intervalSeconds,
    startedAt: r.loop.startedAt,
    ticks: r.loop.ticks,
    lastTickAt: r.lastTickAt,
    inFlight: [...r.running.keys()],
  };
}

export function isAgentRunning(agentId: AgentId): boolean {
  return rt().running.has(agentId);
}
