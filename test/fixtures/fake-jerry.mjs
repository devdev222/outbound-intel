// A stand-in for Cartage's Jerry MCP server, used only by test/jerry-mcp.test.ts.
// The first argument controls what enrich_contact reports for phone_verified
// ("true" -> boolean true, anything else -> that raw string, to prove strings never verify).
// An argument is used because MCP stdio clients pass only a minimal environment to the child.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "fake-jerry", version: "0.0.1" });
const verified = process.argv[2] ?? "true";

server.registerTool(
  "enrich_contact",
  { description: "test enrichment", inputSchema: { name: z.string(), title: z.string().optional(), company: z.string(), domain: z.string() } },
  async ({ name }) => ({
    content: [{ type: "text", text: JSON.stringify({ phone: "(555) 010-9999", phone_verified: verified === "true" ? true : verified, linkedin: `https://linkedin.example/${name.replace(/\s+/g, "-")}` }) }],
  }),
);
server.registerTool("talk_track", { description: "test talk track", inputSchema: { company: z.string() } }, async ({ company }) => ({
  content: [{ type: "text", text: JSON.stringify({ talk_track: `Hi, calling about ${company}.`, action: "Call now" }) }],
}));

await server.connect(new StdioServerTransport());
