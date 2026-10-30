import "../scripts/_env";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { actorAsUser, audit } from "@/lib/auth";
import { mcpActor } from "@/lib/auth/machine";
import { ContractError, invoke, OPERATIONS } from "@/lib/contracts/operations";
import { getProviders } from "@/lib/providers";
import { getStore } from "@/lib/store";

/**
 * The engine as an MCP server (stdio), built on the shared operation contracts
 * in lib/contracts/operations.ts, the same ones behind POST /api/v1/<name>.
 *
 *   claude mcp add outbound-intel -e MCP_SCOPES=read -- npm --prefix <repo> run -s mcp
 *
 * - Read-only by default. Mutating tools are listed but refuse to run unless
 *   MCP_SCOPES grants their scope (e.g. MCP_SCOPES=read,tasks:write,outcomes:write).
 * - Every tool declares an output schema and returns structuredContent, plus
 *   the same JSON as text for clients without structured output support.
 * - Annotations: readOnlyHint, destructiveHint, idempotentHint, openWorldHint.
 * - Mutations require idempotencyKey (persisted in the operations table).
 * - Every mutation is audited as mcp:<MCP_CLIENT_NAME>.
 *
 * stdio only: whoever starts the process is the caller. Remote (HTTP) MCP needs
 * OAuth-protected transport first; see docs/MCP.md.
 */

// stdio transport owns stdout; keep every log on stderr.
console.log = (...args: unknown[]) => console.error(...args);

const actor = mcpActor();
const server = new McpServer({ name: "outbound-intel", version: "0.3.0" });

for (const o of OPERATIONS) {
  const allowed = actor.scopes.includes(o.scope);
  server.registerTool(
    o.name,
    {
      title: o.title,
      description: `${o.description}${o.mutates ? ` Requires scope ${o.scope}${allowed ? "" : " (NOT granted to this server; set MCP_SCOPES)"}. Pass idempotencyKey; retries return the first result.` : ""}${o.pagination ? " Paginated: pass nextCursor as cursor." : ""}`,
      inputSchema: o.input.shape,
      outputSchema: o.output.shape,
      annotations: { title: o.title, readOnlyHint: !o.mutates, destructiveHint: o.destructive, idempotentHint: true, openWorldHint: o.openWorld },
    },
    async (args: unknown) => {
      try {
        const result = (await invoke(o.name, args, { store: getStore(), providers: getProviders(), actor, user: actorAsUser(actor) })) as Record<string, unknown>;
        if (o.mutates) await audit(actor, `mcp:${o.name}`, String((args as Record<string, unknown>)?.accountId ?? (args as Record<string, unknown>)?.taskId ?? (args as Record<string, unknown>)?.slug ?? ""), "");
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }], structuredContent: result };
      } catch (err) {
        const message = err instanceof ContractError ? `${err.code}: ${err.message}` : `internal: ${(err as Error).message}`;
        return { content: [{ type: "text" as const, text: message }], isError: true };
      }
    },
  );
}

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`outbound-intel MCP server ready (stdio) as ${actor.id} with scopes: ${actor.scopes.join(", ")}`);
