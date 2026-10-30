import assert from "node:assert/strict";
import path from "node:path";
import { after, describe, it } from "node:test";
import { jerryMcp, parseMcpArgs } from "@/lib/agents/jerry-mcp";
import { config } from "@/lib/config";
import { fresh, makeAccount } from "./helpers";

const fixture = path.resolve("test/fixtures/fake-jerry.mjs");
const saved = { ...config.jerry };

function useStdio(script: string, phoneVerified = "true") {
  Object.assign(config.jerry, { mode: "mcp", mcpUrl: "", mcpCommand: process.execPath, mcpArgs: JSON.stringify([script, phoneVerified]) });
}

describe("Jerry over MCP", () => {
  after(() => {
    Object.assign(config.jerry, saved);
  });

  it("parses executable and arguments separately (JSON array or whitespace)", () => {
    assert.deepEqual(parseMcpArgs('["server.js","--port","9"]', "C:\\Program Files\\node.exe"), { command: "C:\\Program Files\\node.exe", args: ["server.js", "--port", "9"] });
    assert.deepEqual(parseMcpArgs("a b", "node"), { command: "node", args: ["a", "b"] });
    assert.deepEqual(parseMcpArgs("", "node a b"), { command: "node", args: ["a", "b"] });
  });

  it("recovers from a failed connection without a restart", async () => {
    useStdio(path.resolve("test/fixtures/does-not-exist.mjs"));
    const failed = await jerryMcp.test();
    assert.equal(failed.ok, false);
    assert.ok(jerryMcp.status().lastError);

    useStdio(fixture, "true");
    const ok = await jerryMcp.test();
    assert.equal(ok.ok, true, ok.message);
    assert.deepEqual(jerryMcp.status().tools.sort(), ["enrich_contact", "talk_track"]);

    const store = await fresh();
    const a = await makeAccount(store);
    const r = await jerryMcp.enrichContactOrThrow(a.contact!, a);
    assert.equal(r.phoneVerified, true);
    assert.equal(r.contact.verifiedBy, "jerry-mcp");
  });

  it('a string "false" never verifies a phone', async () => {
    useStdio(fixture, "false");
    await jerryMcp.test(); // reconnect so the new child gets the new argument
    const store = await fresh();
    const a = await makeAccount(store);
    await assert.rejects(() => jerryMcp.enrichContactOrThrow(a.contact!, a), /unexpected shape/);
    await jerryMcp.test().catch(() => undefined);
  });
});
