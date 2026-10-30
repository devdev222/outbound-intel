# MCP: what works today, and what remote access still needs

## The engine as an MCP server (stdio)

`npm run mcp` starts the engine's MCP server over **stdio**. It exposes the shared operation contracts in `lib/contracts/operations.ts` (the same ones behind `POST /api/v1/<name>`; see `docs/CONTRACTS.md`).

- **Read-only by default.** Mutating tools are listed but refuse to run unless `MCP_SCOPES` grants their scope, e.g. `MCP_SCOPES=read,tasks:write,outcomes:write`. Scopes: `read`, `engagement:write`, `outcomes:write`, `conversations:write`, `tasks:write`, `contacts:write`, `agents:run`.
- **Attribution.** `MCP_CLIENT_NAME` names the caller; every mutation is written to the audit log as `mcp:<name>`.
- **Structured output.** Every tool declares an `outputSchema` and returns `structuredContent` (plus the same JSON as text).
- **Annotations.** `readOnlyHint`, `destructiveHint` (e.g. `mark_wrong_contact`), `idempotentHint`, `openWorldHint` (tools that reach external systems: outcomes with CRM sync, provider events, agent runs).
- **Idempotency.** Mutations require `idempotencyKey` (provider events use `eventId`), persisted in the `operations` table: a retry returns the first result.
- **Pagination.** `list_accounts` and `list_tasks` return `nextCursor`.

```bash
claude mcp add outbound-intel -e MCP_SCOPES=read -e MCP_CLIENT_NAME=claude-code -- npm --prefix <repo> run -s mcp
```

**Trust model.** stdio has no authentication of its own: whoever can start the process with your environment can act with the scopes you grant it, against the store the environment points at. Use it on trusted machines only; grant the narrowest scopes.

## The engine as an MCP client (Jerry)

`JERRY_MODE=mcp` makes the engine call Cartage's Jerry over MCP (Streamable HTTP via `JERRY_MCP_URL` + `JERRY_MCP_TOKEN`, or stdio via `JERRY_MCP_COMMAND` + `JERRY_MCP_ARGS`).

- Tool names are configurable: `JERRY_TOOL_ENRICH` (default `enrich_contact`) and `JERRY_TOOL_TALK` (default `talk_track`).
- Tool discovery follows `nextCursor` until every tool is listed, then checks both mapped tools exist.
- Every result is schema-validated; a string `"false"` never verifies a phone; phone verification is bound to the returned number.
- Failed connections back off (5s to 5min) and recover without a restart.
- **Status: proposed contract.** The tool names and result shapes are this repo's proposal; they are unverified until Cartage's Jerry passes the connection test on the Integrations page.

## What remote (HTTP) MCP access still needs

The engine's server is **stdio only**. Exposing it to remote clients (for example a hosted agent) requires, before any deployment:

1. **Transport:** Streamable HTTP via the SDK's `StreamableHTTPServerTransport`, mounted on a route that is not behind the session-cookie proxy.
2. **Authorization:** the MCP authorization spec (OAuth 2.1 resource server): publish Protected Resource Metadata, validate bearer access tokens from Cartage's IdP (issuer, audience = this server, expiry, signature via JWKS) on every request, and map token scopes to the scopes above. The existing `MACHINE_IDENTITIES` static tokens are acceptable only for server-to-server bridges, not for interactive remote MCP clients.
3. **Session and origin checks:** validate `Origin`, bind sessions to the authenticated principal, and reject requests without a valid session id after initialization.
4. **Rate limits and payload limits** per principal, and per-tool timeouts.
5. **Audit:** record the token subject (not just the client name) on every mutation.
6. **Tests:** an end-to-end test with a real token from the IdP's test tenant, including expired, wrong-audience and insufficient-scope tokens.

None of this is implemented yet; do not expose `npm run mcp` over a network socket.
