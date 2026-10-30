import type { AgentsPayload } from "@/components/dashboard/AgentTeam";
import { AGENTS } from "@/lib/agents";
import { isAgentRunning, loopStatus } from "@/lib/agents/runtime";
import { describeProviders } from "@/lib/config";
import { LLM_MODEL, llmAvailable, llmStats } from "@/lib/llm";
import { getStore } from "@/lib/store";
import type { PipelineSummary } from "@/lib/types";

/** Server-side builder for the team page's initial payload (same shape as GET /api/agents). */
export async function buildAgentsPayload(): Promise<AgentsPayload> {
  const store = getStore();
  const [states, recentRuns, accounts, alerts, events, model] = await Promise.all([
    store.getAgentStates(),
    store.listAgentRuns({ limit: 50 }),
    store.listAccounts(),
    store.listAlerts(),
    store.listEvents(),
    store.getLatestModel(),
  ]);
  const count = (s: string) => accounts.filter((a) => a.status === s).length;
  const summary: PipelineSummary = {
    accounts: accounts.length,
    scored: accounts.filter((a) => a.scores !== null).length,
    qualified: count("qualified"),
    campaignsLive: accounts.filter((a) => a.campaign !== null).length,
    engaged: count("engaged"),
    hot: count("hot"),
    meetings: count("meeting_booked"),
    won: count("won"),
    lost: count("lost"),
    alerts: alerts.length,
    events: events.length,
    modelVersion: model?.version ?? null,
  };
  return {
    agents: AGENTS.map((a) => ({
      id: a.id,
      name: a.name,
      role: a.role,
      description: a.description,
      step: a.step,
      cadenceSeconds: a.cadenceSeconds,
      state: states.find((s) => s.agentId === a.id) ?? null,
      running: isAgentRunning(a.id),
    })),
    loop: loopStatus(),
    llm: { available: llmAvailable(), model: LLM_MODEL, ...llmStats },
    providers: describeProviders(),
    recentRuns,
    summary,
  };
}
