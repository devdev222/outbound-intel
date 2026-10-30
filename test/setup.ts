/**
 * Test isolation. Loaded with `node --import` BEFORE any application module, so
 * lib/config.ts reads only these values:
 *
 *  - in-memory store (a test can never reset Supabase or the local .data files)
 *  - controllable test adapters for outreach, alerts, dialer and enrichment
 *  - every real credential removed from the environment
 *  - network guard: any fetch to a non-local host throws
 *
 * The only way to touch a real database is the opt-in store contract test,
 * which needs SUPABASE_TEST_URL + SUPABASE_TEST_KEY and talks to that project only.
 */

const KEEP = new Set(["PATH", "Path", "PATHEXT", "SystemRoot", "SYSTEMROOT", "TEMP", "TMP", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "ComSpec", "COMSPEC", "NODE_OPTIONS", "SUPABASE_TEST_URL", "SUPABASE_TEST_KEY", "TZ"]);
const SECRETY = /(KEY|TOKEN|SECRET|PASSWORD|WEBHOOK|URL|DSN|SUPABASE|RESEND|SLACK|TAVUS|CLAY|POSTHOG|CALENDLY|ANTHROPIC|SEQUENCER|DIALER|CRM|JERRY|ENRICHMENT|RB2B|VERCEL)/i;
for (const k of Object.keys(process.env)) {
  if (KEEP.has(k)) continue;
  if (SECRETY.test(k)) delete process.env[k];
}

Object.assign(process.env, {
  NODE_ENV: "test",
  APP_MODE: "test",
  STORE_PROVIDER: "memory",
  AUTO_SEED: "false",
  DISCOVERY_PROVIDER: "mock",
  ENRICHMENT_PROVIDER: "test",
  VIDEO_PROVIDER: "mock",
  OUTREACH_PROVIDER: "test",
  DIALER_PROVIDER: "test",
  ANALYTICS_PROVIDER: "none",
  ALERT_PROVIDER: "test",
  CRM_PROVIDER: "mock",
  JERRY_MODE: "local",
  AUTH_SECRET: "test-secret-test-secret-test-secret-0000",
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
});

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  const supabaseContract = process.env.SUPABASE_TEST_URL && url.href.startsWith(process.env.SUPABASE_TEST_URL);
  if (!local && !supabaseContract) throw new Error(`test network guard: blocked request to ${url.host}`);
  return realFetch(input, init);
}) as typeof fetch;

export {};
