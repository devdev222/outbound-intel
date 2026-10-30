/**
 * `npm run journey`: the definition-of-done journey against a Supabase TEST
 * project with the controllable test adapters, once clean and once with
 * provider timeouts and two racing workers.
 *
 *   SUPABASE_TEST_URL=https://<test-project>.supabase.co SUPABASE_TEST_KEY=<secret key> npm run journey
 *
 * It uses the same isolation as the test suite (no other credentials, network
 * limited to localhost and the test project), creates its own uniquely named
 * accounts and never resets the database. Apply supabase/migrations 0001..0005
 * to the test project first.
 */
import "../test/setup";

const url = process.env.SUPABASE_TEST_URL;
const key = process.env.SUPABASE_TEST_KEY;
if (!url || !key) {
  console.error("journey: set SUPABASE_TEST_URL and SUPABASE_TEST_KEY (a dedicated test project, never production)");
  process.exit(1);
}
Object.assign(process.env, { STORE_PROVIDER: "supabase", NEXT_PUBLIC_SUPABASE_URL: url, SUPABASE_SECRET_KEY: key });

const { getStore } = await import("@/lib/store");
const { resetTestControl } = await import("@/lib/providers/testing");
const { resetProviders } = await import("@/lib/providers");
const { EXPECTED_SCHEMA_VERSION } = await import("@/lib/store/schema");
const { runJourney } = await import("../test/journey");

const store = getStore();
const version = await store.schemaVersion();
if (store.kind !== "supabase" || version !== EXPECTED_SCHEMA_VERSION) {
  console.error(`journey: expected a Supabase store at schema v${EXPECTED_SCHEMA_VERSION}, got ${store.kind} v${version ?? "missing"}`);
  process.exit(1);
}

let failed = false;
for (const faults of [false, true]) {
  resetTestControl();
  resetProviders();
  const label = faults ? "with timeouts and two workers" : "clean";
  try {
    const r = await runJourney(store, { faults, log: (s) => console.log(`  ${s}`) });
    console.log(`PASS journey ${label} (account ${r.accountId})`);
  } catch (err) {
    failed = true;
    console.error(`FAIL journey ${label}: ${(err as Error).message}`);
  }
}
process.exit(failed ? 1 : 0);
