import { config } from "@/lib/config";
import type { EnrichmentResult } from "@/lib/providers";
import type { Account, Person } from "@/lib/types";

/**
 * Remote Jerry over MCP. When Cartage's Jerry already runs as a service that
 * speaks the Model Context Protocol, set JERRY_MODE=mcp and either
 * JERRY_MCP_URL (Streamable HTTP) or JERRY_MCP_COMMAND (stdio). This client
 * calls two tools on it; the names and argument shapes below are the contract
 * we propose and can be renamed to match the real server.
 *
 *   enrich_contact { name, title, email?, linkedin?, company, domain }
 *     -> { phone?, phone_verified?, linkedin?, email?, recent_news?: string[], tech_stack?: string[], notes?: string[] }
 *   talk_track { company, contact, signals: string[], engagement: string[], pain_hypothesis?, angle? }
 *     -> { talk_track, action, notes?: string[] }
 *
 * Uses @modelcontextprotocol/sdk (v1.x): Client + StreamableHTTPClientTransport / StdioClientTransport.
 * Docs: https://github.com/modelcontextprotocol/typescript-sdk/blob/v1.x/README.md
 */

type ToolResult = { content?: Array<{ type: string; text?: string }>; structuredContent?: unknown; isError?: boolean };

class JerryMcpClient {
  private clientPromise: Promise<import("@modelcontextprotocol/sdk/client/index.js").Client | null> | null = null;

  private async connect() {
    if (this.clientPromise) return this.clientPromise;
    this.clientPromise = (async () => {
      if (config.jerry.mode !== "mcp") return null;
      try {
        const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
        const client = new Client({ name: "outbound-intel", version: "0.1.0" });
        if (config.jerry.mcpUrl) {
          const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
          const transport = new StreamableHTTPClientTransport(new URL(config.jerry.mcpUrl), {
            requestInit: config.jerry.mcpToken ? { headers: { authorization: `Bearer ${config.jerry.mcpToken}` } } : undefined,
          });
          await client.connect(transport);
        } else if (config.jerry.mcpCommand) {
          const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
          const [command, ...args] = config.jerry.mcpCommand.split(/\s+/);
          await client.connect(new StdioClientTransport({ command, args }));
        } else {
          return null;
        }
        return client;
      } catch (err) {
        console.warn(`[jerry-mcp] connect failed: ${(err as Error).message}`);
        return null;
      }
    })();
    return this.clientPromise;
  }

  private async call(name: string, args: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    const client = await this.connect();
    if (!client) return null;
    try {
      const res = (await client.callTool({ name, arguments: args })) as ToolResult;
      if (res.isError) return null;
      if (res.structuredContent && typeof res.structuredContent === "object") return res.structuredContent as Record<string, unknown>;
      const text = res.content?.find((c) => c.type === "text")?.text;
      return text ? (JSON.parse(text) as Record<string, unknown>) : null;
    } catch (err) {
      console.warn(`[jerry-mcp] ${name} failed: ${(err as Error).message}`);
      return null;
    }
  }

  async enrichContact(person: Person, account: Account): Promise<EnrichmentResult | null> {
    const r = await this.call("enrich_contact", {
      name: person.name,
      title: person.title,
      email: person.email,
      linkedin: person.linkedin,
      company: account.companyName,
      domain: account.domain,
    });
    if (!r) return null;
    return {
      contact: {
        ...person,
        phone: (r.phone as string) ?? person.phone,
        phoneVerified: Boolean(r.phone_verified),
        linkedin: (r.linkedin as string) ?? person.linkedin,
        email: (r.email as string) ?? person.email,
      },
      phoneVerified: Boolean(r.phone_verified),
      linkedinMatched: Boolean(r.linkedin ?? person.linkedin),
      recentNews: (r.recent_news as string[]) ?? [],
      techStack: (r.tech_stack as string[]) ?? [],
      notes: (r.notes as string[]) ?? [],
      complete: true,
      provider: "jerry-mcp",
    };
  }

  async talkTrack(account: Account, contact: Person | null, engagement: string[], signals: string[]): Promise<{ talkTrack: string; action: string; notes: string[] } | null> {
    const r = await this.call("talk_track", {
      company: account.companyName,
      contact: contact ? { name: contact.name, title: contact.title } : null,
      signals,
      engagement,
      pain_hypothesis: account.painHypothesis,
      angle: account.messagingAngle ?? account.campaign?.angle,
    });
    if (!r || typeof r.talk_track !== "string") return null;
    return { talkTrack: r.talk_track, action: (r.action as string) ?? "Call now", notes: (r.notes as string[]) ?? [] };
  }
}

export const jerryMcp = new JerryMcpClient();
