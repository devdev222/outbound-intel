import type { AgentId } from "@/lib/types";
import type { AgentDefinition } from "./base";
import { campaignAgent } from "./campaign-agent";
import { jerryAgent } from "./jerry";
import { learningAgent } from "./learning-agent";
import { researchAgent } from "./research";
import { scoringAgent } from "./scoring-agent";
import { expansionAgent, hiringAgent, icpAgent, painPointAgent, technologyAgent } from "./signal-agents";

/** The team, in pipeline order. The runtime runs them in this order on every tick. */
export const AGENTS: AgentDefinition[] = [
  icpAgent,
  hiringAgent,
  expansionAgent,
  technologyAgent,
  painPointAgent,
  researchAgent,
  scoringAgent,
  campaignAgent,
  jerryAgent,
  learningAgent,
];

export const AGENT_BY_ID: Record<AgentId, AgentDefinition> = Object.fromEntries(AGENTS.map((a) => [a.id, a])) as Record<AgentId, AgentDefinition>;

export type { AgentDefinition } from "./base";
