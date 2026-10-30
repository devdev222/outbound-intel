import { AGENTS } from "@/lib/agents";
import { isAgentRunning, loopStatus } from "@/lib/agents/runtime";
import { json, pipelineSummary } from "@/lib/api";
import { describeProviders } from "@/lib/config";
import { LLM_MODEL, llmAvailable, llmStats } from "@/lib/llm";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

/** Team status for the Agents page (polled). */
export async function GET() {
  const store = getStore();
  const [states, recentRuns, summary] = await Promise.all([store.getAgentStates(), store.listAgentRuns({ limit: 50 }), pipelineSummary(store)]);
  return json({
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
    llm: { available: llmAvailable(), model: llmAvailable() ? LLM_MODEL : "templates (no ANTHROPIC_API_KEY)", ...llmStats },
    providers: describeProviders(),
    recentRuns,
    summary,
  });
}
