import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

/**
 * Starts the real stdio MCP server in a child process (in-memory store, mock
 * providers, read-only scopes) and checks what an MCP client sees.
 */
let client: Client;

before(async () => {
  const env: Record<string, string> = {};
  for (const k of ["PATH", "Path", "PATHEXT", "SystemRoot", "SYSTEMROOT", "TEMP", "TMP", "USERPROFILE", "HOME", "APPDATA", "LOCALAPPDATA"]) if (process.env[k]) env[k] = process.env[k]!;
  Object.assign(env, { STORE_PROVIDER: "memory", APP_MODE: "test", OUTREACH_PROVIDER: "test", ALERT_PROVIDER: "test", DIALER_PROVIDER: "test", ENRICHMENT_PROVIDER: "test", CRM_PROVIDER: "mock", MCP_SCOPES: "read", MCP_CLIENT_NAME: "test-client" });
  client = new Client({ name: "test", version: "0.0.1" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: ["--import", "tsx", "mcp/server.ts"], env, stderr: "ignore" }));
});

after(async () => {
  await client?.close();
});

describe("MCP server (stdio)", () => {
  it("lists every contract with an output schema and annotations", async () => {
    const { tools } = await client.listTools();
    const byName = new Map(tools.map((t) => [t.name, t]));
    for (const name of ["list_accounts", "get_account_brief", "list_tasks", "act_on_task", "log_outcome", "log_conversation", "mark_wrong_contact", "record_provider_event", "run_agent"]) assert.ok(byName.has(name), `${name} is listed`);
    const read = byName.get("list_accounts")!;
    assert.equal(read.annotations?.readOnlyHint, true);
    assert.ok(read.outputSchema, "output schema declared");
    const del = byName.get("mark_wrong_contact")!;
    assert.equal(del.annotations?.readOnlyHint, false);
    assert.equal(del.annotations?.destructiveHint, true);
    assert.equal(byName.get("log_outcome")!.annotations?.openWorldHint, true);
    assert.ok(JSON.stringify(byName.get("log_outcome")!.inputSchema).includes("opportunityId"));
  });

  it("returns structured content for reads", async () => {
    const r = await client.callTool({ name: "list_accounts", arguments: { limit: 5 } });
    assert.ok(!r.isError);
    const sc = r.structuredContent as { items: unknown[]; nextCursor: string | null };
    assert.ok(Array.isArray(sc.items));
    assert.ok("nextCursor" in sc);
  });

  it("refuses mutations without an explicitly granted scope", async () => {
    const r = await client.callTool({ name: "log_outcome", arguments: { slug: "any", outcomeType: "replied", idempotencyKey: "mcp-key-0001" } });
    assert.equal(r.isError, true);
    assert.match(JSON.stringify(r.content), /forbidden/);
  });
});
