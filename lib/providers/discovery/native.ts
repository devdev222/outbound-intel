import { z } from "zod";
import { getLlmClient, LLM_MODEL } from "@/lib/llm";
import type { CompanyFacts, SignalType } from "@/lib/types";
import type { SignalCollector } from "../types";

/**
 * Native signal collector: Claude with the web_search server tool, no Clay.
 *
 * This is the "replace Clay over time" path. Each signal type can be routed
 * here independently (SIGNAL_SOURCE_HIRING=native, ...). The collector asks
 * Claude to search the open web for evidence of one signal type at one company
 * and return structured facts with source URLs, which the signal agents then
 * interpret exactly as they would Clay-sourced facts.
 *
 * Tool reference (Anthropic docs): server tool type `web_search_20260209`,
 * result blocks `web_search_tool_result`. Only runs when ANTHROPIC_API_KEY is set.
 */

const JobSchema = z.object({
  title: z.string(),
  department: z.string().default("Operations"),
  posted_at: z.string().default(""),
  url: z.string().default(""),
  location: z.string().optional(),
});
const NewsSchema = z.object({
  headline: z.string(),
  kind: z.enum(["facility", "funding", "acquisition", "leadership", "expansion", "other"]).default("other"),
  published_at: z.string().default(""),
  url: z.string().default(""),
  summary: z.string().optional(),
});
const TechSchema = z.object({
  name: z.string(),
  category: z.enum(["tms", "erp", "wms", "spreadsheet", "visibility", "other"]).default("other"),
  source: z.string().default("web"),
});
const PainSchema = z.object({
  text: z.string(),
  theme: z.string().default("operations"),
  source: z.string().default("web"),
  url: z.string().default(""),
  captured_at: z.string().default(""),
});

const PROMPTS: Record<Extract<SignalType, "hiring" | "expansion" | "technology" | "pain">, string> = {
  hiring:
    "Find CURRENT job postings at the company for logistics, transportation, supply chain, shipping, freight, dispatch, or warehouse coordination roles. Return a JSON array of {title, department, posted_at, url, location}.",
  expansion:
    "Find news from the last 12 months about the company opening facilities, plants, distribution centers, warehouses, expanding geographically, funding rounds, or acquisitions. Return a JSON array of {headline, kind, published_at, url, summary} where kind is one of facility|funding|acquisition|leadership|expansion|other.",
  technology:
    "Find evidence of the company's transportation management system (TMS), ERP, WMS, or visibility tooling, including job postings that name systems and vendor case studies. Return a JSON array of {name, category, source} where category is one of tms|erp|wms|spreadsheet|visibility|other.",
  pain:
    "Find public evidence of operational pain in shipping or freight coordination at the company: employee reviews, earnings call remarks, press quotes, forum posts about manual coordination, carrier issues, late shipments, or spreadsheet-driven logistics. Return a JSON array of {text, theme, source, url, captured_at}.",
};

function extractJsonArray(text: string): unknown[] {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i)?.[1] ?? text;
  const start = fenced.indexOf("[");
  const end = fenced.lastIndexOf("]");
  if (start < 0 || end <= start) return [];
  try {
    const parsed = JSON.parse(fenced.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export class NativeSignalCollector implements SignalCollector {
  readonly name = "native (Claude + web search)";

  async collect(facts: CompanyFacts, type: SignalType): Promise<Partial<CompanyFacts>> {
    const client = getLlmClient();
    if (!client) return {};
    if (!(type in PROMPTS)) return {};
    const task = PROMPTS[type as keyof typeof PROMPTS];

    const response = await client.messages.create({
      model: LLM_MODEL,
      max_tokens: 16000,
      output_config: { effort: "medium" },
      system:
        "You are a B2B prospecting research collector. Use web search. Only report facts you found on a page you can cite with its URL. Prefer the company's own domain, job boards, and reputable news. Respond with ONLY a fenced ```json code block containing the array; no prose.",
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 6 }],
      messages: [
        {
          role: "user",
          content: `Company: ${facts.companyName} (${facts.domain}), ${facts.industry}, HQ ${facts.hqCity}, ${facts.hqState}.\n\nTask: ${task}`,
        },
      ],
    });

    if (response.stop_reason === "refusal") return {};
    const text = response.content
      .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    const items = extractJsonArray(text);
    const now = new Date().toISOString();

    switch (type) {
      case "hiring":
        return {
          jobPostings: items
            .map((i) => JobSchema.safeParse(i))
            .filter((r) => r.success)
            .map((r) => ({
              title: r.data!.title,
              department: r.data!.department,
              postedAt: r.data!.posted_at || now,
              url: r.data!.url,
              location: r.data!.location,
            })),
        };
      case "expansion":
        return {
          news: items
            .map((i) => NewsSchema.safeParse(i))
            .filter((r) => r.success)
            .map((r) => ({
              headline: r.data!.headline,
              kind: r.data!.kind,
              publishedAt: r.data!.published_at || now,
              url: r.data!.url,
              summary: r.data!.summary,
            })),
        };
      case "technology":
        return {
          techStack: items
            .map((i) => TechSchema.safeParse(i))
            .filter((r) => r.success)
            .map((r) => ({ name: r.data!.name, category: r.data!.category, source: r.data!.source })),
        };
      case "pain":
        return {
          painEvidence: items
            .map((i) => PainSchema.safeParse(i))
            .filter((r) => r.success)
            .map((r) => ({
              text: r.data!.text,
              theme: r.data!.theme,
              source: r.data!.source,
              url: r.data!.url,
              capturedAt: r.data!.captured_at || now,
            })),
        };
      default:
        return {};
    }
  }
}
