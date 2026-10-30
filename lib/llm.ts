import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { config } from "@/lib/config";

/**
 * Thin wrapper over the Anthropic SDK used by every agent.
 *
 *  - Structured outputs via `output_config.format` (zod schema), parsed by the SDK.
 *  - Adaptive thinking is the model default; depth is controlled with `output_config.effort`.
 *  - Server-side refusal fallbacks are enabled (`fallbacks: "default"`) so a safety
 *    decline on the primary model is retried on a fallback inside the same call.
 *  - The system prompt is cached (`cache_control`) because each agent reuses a
 *    stable prompt across many accounts.
 *  - Every failure returns `null` so callers fall back to templates and the 24/7
 *    loop keeps running; usage and errors are tallied in `llmStats` for the dashboard.
 *
 * No ANTHROPIC_API_KEY => `getLlmClient()` is null and every agent uses its
 * template path. The demo is fully functional either way.
 */

export const LLM_MODEL = config.llm.model;

export const llmStats = {
  calls: 0,
  failures: 0,
  refusals: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  lastError: null as string | null,
};

let cached: Anthropic | null | undefined;

export function getLlmClient(): Anthropic | null {
  if (cached === undefined) {
    cached = config.llm.apiKey ? new Anthropic({ apiKey: config.llm.apiKey, maxRetries: 2, timeout: 120_000 }) : null;
  }
  return cached;
}

export function llmAvailable(): boolean {
  return getLlmClient() !== null;
}

export interface GenerateOptions<S extends z.ZodType> {
  schema: S;
  system: string;
  user: string;
  effort?: "low" | "medium" | "high";
  maxTokens?: number;
}

function recordUsage(usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null }) {
  llmStats.inputTokens += usage.input_tokens;
  llmStats.outputTokens += usage.output_tokens;
  llmStats.cacheReadTokens += usage.cache_read_input_tokens ?? 0;
}

function recordError(err: unknown): null {
  llmStats.failures++;
  if (err instanceof Anthropic.RateLimitError) llmStats.lastError = "rate limited";
  else if (err instanceof Anthropic.AuthenticationError) llmStats.lastError = "authentication failed (check ANTHROPIC_API_KEY)";
  else if (err instanceof Anthropic.BadRequestError) llmStats.lastError = `bad request: ${err.message}`;
  else if (err instanceof Anthropic.APIError) llmStats.lastError = `api error ${err.status}: ${err.message}`;
  else if (err instanceof Error) llmStats.lastError = err.message;
  else llmStats.lastError = String(err);
  console.warn(`[llm] ${llmStats.lastError}`);
  return null;
}

/** One structured-output call. Returns the parsed object or null (no key, refusal, or API error). */
export async function generateStructured<S extends z.ZodType>(opts: GenerateOptions<S>): Promise<z.infer<S> | null> {
  const client = getLlmClient();
  if (!client) return null;
  llmStats.calls++;
  try {
    const response = await client.beta.messages.parse({
      model: LLM_MODEL,
      max_tokens: opts.maxTokens ?? 8000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: {
        effort: opts.effort ?? config.llm.effort,
        format: betaZodOutputFormat(opts.schema),
      },
      system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: opts.user }],
    });
    recordUsage(response.usage);
    if (response.stop_reason === "refusal") {
      llmStats.refusals++;
      llmStats.lastError = `refusal${response.stop_details?.category ? ` (${response.stop_details.category})` : ""}`;
      return null;
    }
    if (response.stop_reason === "max_tokens") {
      llmStats.lastError = "output truncated at max_tokens";
      return null;
    }
    return (response.parsed_output as z.infer<S> | null) ?? null;
  } catch (err) {
    return recordError(err);
  }
}
