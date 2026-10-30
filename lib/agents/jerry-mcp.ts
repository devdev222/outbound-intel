import { z } from "zod";
import { config } from "@/lib/config";
import type { EnrichmentResult } from "@/lib/providers";
import type { Account, Person } from "@/lib/types";

/**
 * Remote Jerry over MCP. When Cartage's Jerry already runs as a service that
 * speaks the Model Context Protocol, set JERRY_MODE=mcp and either
 * JERRY_MCP_URL (Streamable HTTP) or JERRY_MCP_COMMAND + JERRY_MCP_ARGS (stdio).
 * Two tools are called; map them with JERRY_TOOL_ENRICH / JERRY_TOOL_TALK if Jerry names them differently.
 *
 *   enrich_contact { name, title, email?, linkedin?, company, domain }
 *     -> { phone?, phone_verified?: boolean, linkedin?, email?, recent_news?: string[], tech_stack?: string[], notes?: string[] }
 *   talk_track { company, contact, signals: string[], engagement: string[], pain_hypothesis?, angle? }
 *     -> { talk_track, action?, notes?: string[] }
 *
 * Resilience: a failed connection is not cached forever. The client retries
 * with exponential backoff (5s .. 5min), drops the session on transport errors,
 * verifies at connect time that both tools exist, and validates every response
 * against a schema (a string "false" never verifies a phone).
 *
 * Uses @modelcontextprotocol/sdk (v1.x): Client + StreamableHTTPClientTransport / StdioClientTransport.
 */

/** Tool names on Jerry's MCP server; override when Cartage's Jerry exposes different names. */
const toolEnrich = () => process.env.JERRY_TOOL_ENRICH?.trim() || "enrich_contact";
const toolTalk = () => process.env.JERRY_TOOL_TALK?.trim() || "talk_track";

type McpClient = import("@modelcontextprotocol/sdk/client/index.js").Client;
type ToolResult = { content?: Array<{ type: string; text?: string }>; structuredContent?: unknown; isError?: boolean };

const EnrichSchema = z.object({
  phone: z.string().min(3).nullish(),
  phone_verified: z.boolean().nullish(),
  linkedin: z.string().nullish(),
  email: z.string().email().nullish(),
  recent_news: z.array(z.string()).nullish(),
  tech_stack: z.array(z.string()).nullish(),
  notes: z.array(z.string()).nullish(),
});

const TalkSchema = z.object({
  talk_track: z.string().min(1),
  action: z.string().nullish(),
  notes: z.array(z.string()).nullish(),
});

export function parseMcpArgs(raw: string, commandLine: string): { command: string; args: string[] } {
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string")) return { command: commandLine.trim(), args: parsed };
    } catch {
      /* fall through to whitespace split */
    }
    return { command: commandLine.trim(), args: raw.split(/\s+/).filter(Boolean) };
  }
  // Legacy: everything in JERRY_MCP_COMMAND.
  const [command, ...args] = commandLine.trim().split(/\s+/);
  return { command, args };
}

export interface JerryMcpStatus {
  configured: boolean;
  connected: boolean;
  transport: "http" | "stdio" | null;
  lastError: string | null;
  lastSuccessAt: string | null;
  nextRetryAt: string | null;
  tools: string[];
}

class JerryMcpClient {
  private client: McpClient | null = null;
  private connecting: Promise<McpClient | null> | null = null;
  private failures = 0;
  private nextRetryAt = 0;
  private lastError: string | null = null;
  private lastSuccessAt: string | null = null;
  private tools: string[] = [];

  status(): JerryMcpStatus {
    return {
      configured: config.jerry.mode === "mcp" && Boolean(config.jerry.mcpUrl || config.jerry.mcpCommand),
      connected: Boolean(this.client),
      transport: config.jerry.mcpUrl ? "http" : config.jerry.mcpCommand ? "stdio" : null,
      lastError: this.lastError,
      lastSuccessAt: this.lastSuccessAt,
      nextRetryAt: this.nextRetryAt ? new Date(this.nextRetryAt).toISOString() : null,
      tools: this.tools,
    };
  }

  private fail(message: string): never {
    this.lastError = message;
    throw new Error(message);
  }

  private async drop(): Promise<void> {
    const c = this.client;
    this.client = null;
    try {
      await c?.close();
    } catch {
      /* ignore */
    }
  }

  private async connect(): Promise<McpClient> {
    if (this.client) return this.client;
    if (config.jerry.mode !== "mcp") this.fail("JERRY_MODE is not mcp");
    if (!config.jerry.mcpUrl && !config.jerry.mcpCommand) this.fail("JERRY_MCP_URL or JERRY_MCP_COMMAND is not set");
    if (Date.now() < this.nextRetryAt) this.fail(`Jerry MCP unavailable (${this.lastError ?? "connection failed"}); next retry ${new Date(this.nextRetryAt).toISOString()}`);
    if (!this.connecting) {
      this.connecting = (async () => {
        try {
          const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
          const client = new Client({ name: "outbound-intel", version: "0.2.0" });
          if (config.jerry.mcpUrl) {
            const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
            await client.connect(
              new StreamableHTTPClientTransport(new URL(config.jerry.mcpUrl), {
                requestInit: config.jerry.mcpToken ? { headers: { authorization: `Bearer ${config.jerry.mcpToken}` } } : undefined,
              }),
            );
          } else {
            const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
            const { command, args } = parseMcpArgs(config.jerry.mcpArgs, config.jerry.mcpCommand);
            await client.connect(new StdioClientTransport({ command, args }));
          }
          // Validate the tool mapping once per connection.
          // Paginated tool discovery: follow nextCursor until the server has listed everything.
          const names: string[] = [];
          let cursor: string | undefined;
          for (let pageNo = 0; pageNo < 50; pageNo++) {
            const listed = await client.listTools(cursor ? { cursor } : undefined);
            names.push(...listed.tools.map((t) => t.name));
            cursor = listed.nextCursor;
            if (!cursor) break;
          }
          this.tools = names;
          const missing = [toolEnrich(), toolTalk()].filter((t) => !this.tools.includes(t));
          if (missing.length) {
            await client.close().catch(() => undefined);
            throw new Error(`Jerry MCP server does not expose: ${missing.join(", ")} (has: ${this.tools.join(", ") || "none"})`);
          }
          this.client = client;
          this.failures = 0;
          this.nextRetryAt = 0;
          return client;
        } catch (err) {
          this.failures++;
          this.nextRetryAt = Date.now() + Math.min(5 * 60_000, 5_000 * 2 ** (this.failures - 1));
          this.lastError = (err as Error).message;
          return null;
        } finally {
          this.connecting = null;
        }
      })();
    }
    const c = await this.connecting;
    if (!c) this.fail(`Jerry MCP connection failed: ${this.lastError}`);
    return c;
  }

  private async call(name: string, args: Record<string, unknown>): Promise<unknown> {
    const client = await this.connect();
    let res: ToolResult;
    try {
      res = (await client.callTool({ name, arguments: args })) as ToolResult;
    } catch (err) {
      // Transport-level failure: drop the session so the next call reconnects.
      await this.drop();
      this.failures++;
      this.nextRetryAt = Date.now() + Math.min(5 * 60_000, 5_000 * 2 ** (this.failures - 1));
      this.fail(`Jerry MCP ${name} failed: ${(err as Error).message}`);
    }
    if (res.isError) this.fail(`Jerry MCP ${name} returned an error: ${res.content?.find((c) => c.type === "text")?.text ?? "unknown"}`);
    if (res.structuredContent && typeof res.structuredContent === "object") return res.structuredContent;
    const text = res.content?.find((c) => c.type === "text")?.text;
    if (!text) this.fail(`Jerry MCP ${name} returned no content`);
    try {
      return JSON.parse(text);
    } catch {
      this.fail(`Jerry MCP ${name} returned non-JSON text`);
    }
  }

  /** Throws on any failure; callers record it as a visible enrichment blocker. */
  async enrichContactOrThrow(person: Person, account: Account): Promise<EnrichmentResult> {
    const raw = await this.call(toolEnrich(), { name: person.name, title: person.title, email: person.email, linkedin: person.linkedin, company: account.companyName, domain: account.domain });
    const parsed = EnrichSchema.safeParse(raw);
    if (!parsed.success) this.fail(`Jerry MCP ${toolEnrich()} returned an unexpected shape: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`);
    const r = parsed.data;
    const phoneVerified = r.phone_verified === true && Boolean(r.phone ?? person.phone);
    this.lastSuccessAt = new Date().toISOString();
    this.lastError = null;
    return {
      contact: { ...person, phone: r.phone ?? person.phone, phoneVerified, linkedin: r.linkedin ?? person.linkedin, email: r.email ?? person.email, verifiedBy: "jerry-mcp" },
      phoneVerified,
      linkedinMatched: Boolean(r.linkedin ?? person.linkedin),
      recentNews: r.recent_news ?? [],
      techStack: r.tech_stack ?? [],
      notes: r.notes ?? [],
      complete: true,
      provider: "jerry-mcp",
      provenance: "provider",
    };
  }

  /** Talk track is optional polish: returns null on failure and the local template is used. */
  async talkTrack(account: Account, contact: Person | null, engagement: string[], signals: string[]): Promise<{ talkTrack: string; action: string; notes: string[] } | null> {
    try {
      const raw = await this.call(toolTalk(), {
        company: account.companyName,
        contact: contact ? { name: contact.name, title: contact.title } : null,
        signals,
        engagement,
        pain_hypothesis: account.painHypothesis,
        angle: account.messagingAngle ?? account.campaign?.angle,
      });
      const parsed = TalkSchema.safeParse(raw);
      if (!parsed.success) return null;
      this.lastSuccessAt = new Date().toISOString();
      return { talkTrack: parsed.data.talk_track, action: parsed.data.action ?? "Call now", notes: parsed.data.notes ?? [] };
    } catch (err) {
      console.warn(`[jerry-mcp] ${(err as Error).message}`);
      return null;
    }
  }

  /** Connection test for the Integrations page. */
  async test(): Promise<{ ok: boolean; message: string }> {
    try {
      await this.drop();
      this.nextRetryAt = 0;
      await this.connect();
      this.lastSuccessAt = new Date().toISOString();
      return { ok: true, message: `Connected over ${config.jerry.mcpUrl ? "HTTP" : "stdio"}; tools: ${this.tools.join(", ")}` };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __outboundIntelJerryMcp: JerryMcpClient | undefined;
}

export const jerryMcp: JerryMcpClient = globalThis.__outboundIntelJerryMcp ?? (globalThis.__outboundIntelJerryMcp = new JerryMcpClient());
