/**
 * `npm run smoke`: HTTP smoke checks against a production build, in a separate
 * process with an isolated environment.
 *
 * The server is started with a minimal environment (PATH and OS basics only),
 * the in-memory store and test adapters, and every credential explicitly
 * blanked, so it cannot reset a real database or contact a real provider even
 * if a .env.local with live keys exists. Requires `npm run build` first.
 *
 * Checks the permission boundaries and the public prospect contracts:
 *  - unauthenticated callers cannot read or change outcomes
 *  - a BDR cannot run admin operations (seed/reset, agent controls, integration tests)
 *  - prospect endpoints validate input and require the page token
 *  - tracking refuses business commands
 *  - /api/health reports ready
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const PORT = Number(process.env.SMOKE_PORT ?? 3217);
const BASE = `http://127.0.0.1:${PORT}`;
const nextBin = path.resolve("node_modules/next/dist/bin/next");

if (!existsSync(path.resolve(".next/BUILD_ID"))) {
  console.error("smoke: no production build found; run `npm run build` first");
  process.exit(1);
}

const BLANK = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "ANTHROPIC_API_KEY",
  "RESEND_API_KEY",
  "RESEND_FROM",
  "RESEND_WEBHOOK_SECRET",
  "SLACK_WEBHOOK_URL",
  "SLACK_BOT_TOKEN",
  "TAVUS_API_KEY",
  "CLAY_DISCOVERY_WEBHOOK_URL",
  "CLAY_ENRICHMENT_WEBHOOK_URL",
  "CLAY_WEBHOOK_TOKEN",
  "CLAY_WEBHOOK_SECRET",
  "POSTHOG_API_KEY",
  "SEQUENCER_API_URL",
  "SEQUENCER_API_KEY",
  "DIALER_API_URL",
  "DIALER_API_KEY",
  "CRM_EXPORT_URL",
  "CRM_API_KEY",
  "ENRICHMENT_API_URL",
  "ENRICHMENT_API_KEY",
  "JERRY_MCP_URL",
  "JERRY_MCP_COMMAND",
  "JERRY_MCP_TOKEN",
  "CALENDLY_WEBHOOK_SIGNING_KEY",
  "NEXT_PUBLIC_CALENDLY_URL",
  "RB2B_WEBHOOK_SECRET",
  "CRON_SECRET",
  "AUTH_DISABLED",
];
const OS_KEEP = ["PATH", "Path", "PATHEXT", "SystemRoot", "SYSTEMROOT", "TEMP", "TMP", "ComSpec", "HOME", "USERPROFILE", "LOCALAPPDATA", "APPDATA"];

const env: Record<string, string> = {};
// NODE_ENV is typed as a union in Next's ProcessEnv; this record is passed as-is to the child.
for (const k of OS_KEEP) if (process.env[k]) env[k] = process.env[k]!;
for (const k of BLANK) env[k] = "";
Object.assign(env, {
  NODE_ENV: "production",
  APP_MODE: "test",
  STORE_PROVIDER: "memory",
  AUTO_SEED: "false",
  DISCOVERY_PROVIDER: "mock",
  ENRICHMENT_PROVIDER: "test",
  VIDEO_PROVIDER: "mock",
  OUTREACH_PROVIDER: "test",
  DIALER_PROVIDER: "test",
  ALERT_PROVIDER: "test",
  ANALYTICS_PROVIDER: "none",
  CRM_PROVIDER: "mock",
  JERRY_MODE: "local",
  AUTH_SECRET: "smoke-secret-smoke-secret-smoke-secret-0",
  DEMO_PASSWORD: "demo",
  NEXT_PUBLIC_APP_URL: BASE,
  NEXT_TELEMETRY_DISABLED: "1",
});

const server = spawn(process.execPath, [nextBin, "start", "-p", String(PORT), "-H", "127.0.0.1"], { env: env as NodeJS.ProcessEnv, stdio: ["ignore", "pipe", "pipe"] });
let serverLog = "";
server.stdout.on("data", (d) => (serverLog += d));
server.stderr.on("data", (d) => (serverLog += d));

const results: { name: string; ok: boolean; detail: string }[] = [];
function check(name: string, ok: boolean, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}

async function waitForServer(): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.status === 200 || r.status === 503) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`server did not start on ${BASE}\n${serverLog.slice(-2000)}`);
}

async function call(method: string, p: string, body?: unknown, cookie?: string): Promise<{ status: number; json: Record<string, unknown>; setCookie: string | null }> {
  const r = await fetch(`${BASE}${p}`, { method, headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual" });
  const json = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: r.status, json, setCookie: r.headers.get("set-cookie") };
}

async function login(email: string): Promise<string> {
  const r = await call("POST", "/api/auth/login", { email, password: "demo" });
  if (r.status !== 200 || !r.setCookie) throw new Error(`login failed for ${email}: ${r.status} ${JSON.stringify(r.json)}`);
  return r.setCookie.split(";")[0];
}

try {
  await waitForServer();

  const health = await call("GET", "/api/health");
  check("health reports ready", health.status === 200, `status ${health.status}`);

  // Outcomes are protected.
  check("unauthenticated GET /api/outcomes is refused", (await call("GET", "/api/outcomes")).status === 401);
  check("unauthenticated POST /api/outcomes is refused", (await call("POST", "/api/outcomes", { slug: "x", outcomeType: "meeting_booked" })).status === 401);
  check("unauthenticated task command is refused", (await call("POST", "/api/tasks/any", { action: "approve" })).status === 401);

  // Role boundaries.
  const bdr = await login("bdr@cartage.demo");
  const admin = await login("admin@cartage.demo");
  check("BDR cannot seed/reset", (await call("POST", "/api/seed", { count: 0, resetOnly: true }, bdr)).status === 403);
  check("BDR cannot toggle agents", (await call("POST", "/api/agents/scoring/toggle", { enabled: false }, bdr)).status === 403);
  check("BDR cannot run agents", (await call("POST", "/api/agents/scoring/run", {}, bdr)).status === 403);
  check("BDR cannot run integration tests", (await call("POST", "/api/integrations/store/test", {}, bdr)).status === 403);
  check("BDR can read templates and sequences", (await call("GET", "/api/templates", undefined, bdr)).status === 200 && (await call("GET", "/api/sequences", undefined, bdr)).status === 200);
  check("BDR cannot upload templates or change the playbook", (await call("POST", "/api/templates", { files: [{ name: "a.txt", content: "Subject: x\n\nbody" }] }, bdr)).status === 403 && (await call("PUT", "/api/playbook", { defaults: { videoType: "rep" } }, bdr)).status === 403);
  check("provider events need a machine token", (await call("POST", "/api/events", { eventId: "e-1", slug: "x", event: "email_reply" })).status === 401);
  check("provider events reject an invalid machine token", (await fetch(`${BASE}/api/events`, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer not-a-real-token" }, body: "{}" })).status === 401);
  check("contract catalog is readable by a BDR", (await call("GET", "/api/v1", undefined, bdr)).status === 200);
  check("BDR cannot run agents through the contract API", (await call("POST", "/api/v1/run_agent", { agentId: "scoring", idempotencyKey: "smoke-0001" }, bdr)).status === 403);
  check("contract API validates input", (await call("POST", "/api/v1/log_outcome", { outcomeType: "nope" }, bdr)).status === 400);
  check("BDR can read the work queue", (await call("GET", "/api/work/queue", undefined, bdr)).status === 200);
  check("admin can read integration status", (await call("GET", "/api/integrations", undefined, admin)).status === 200);
  const storeTest = await call("POST", "/api/integrations/store/test", {}, admin);
  check("admin store test names the provider", storeTest.status === 200 && String(storeTest.json.message ?? "").startsWith("memory:"), String(storeTest.json.message ?? storeTest.status));
  check("a memory store is never reported verified", storeTest.json.verified === false);

  // Agent tick needs a session or the cron secret.
  check("unauthenticated agent tick is refused", [401, 403, 503].includes((await call("POST", "/api/agents/tick")).status));

  // Public prospect contracts.
  check("meeting request rejects a bad body", (await call("POST", "/api/prospect/meeting-request", { slug: "x" })).status === 400);
  check("meeting request requires a valid page token", (await call("POST", "/api/prospect/meeting-request", { slug: "nope", token: "abcdefgh", requestId: "smoke-req-0001", email: "a@b.co" })).status === 404);
  check("estimate requires a valid page token", (await call("POST", "/api/prospect/estimate", { slug: "nope", token: "abcdefgh", requestId: "smoke-req-0002", email: "a@b.co", inputs: {}, results: {} })).status === 404);
  check("tracking refuses estimate submissions", (await call("POST", "/api/track", { slug: "nope", event: "estimate_submitted" })).status === 400);
  check("tracking refuses provider events and missing page tokens", (await call("POST", "/api/track", { slug: "nope", token: "abcdefgh", event: "email_reply", visitorId: "v-1234" })).status === 400 && (await call("POST", "/api/track", { slug: "nope", event: "page_view", visitorId: "v-1234" })).status === 400);
  check("opt-out rejects an unsigned link", (await fetch(`${BASE}/api/optout?a=x&e=a%40b.co&t=bad`)).status >= 400);
} catch (err) {
  check("smoke run", false, (err as Error).message);
} finally {
  server.kill();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} smoke checks passed`);
process.exit(failed.length ? 1 : 0);
