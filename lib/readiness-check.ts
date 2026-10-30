import { config, configProblems } from "@/lib/config";
import { getStore } from "@/lib/store";
import { EXPECTED_SCHEMA_VERSION } from "@/lib/store/schema";

/**
 * Release readiness: configuration problems (live mode) plus the database
 * schema version. Used by GET /api/health and `npm run check`. Never returns
 * secret values, only which setting is wrong and how to fix it.
 */
export interface ReadinessResult {
  ok: boolean;
  mode: string;
  store: string;
  schema: { expected: string; actual: string | null; ok: boolean; error?: string };
  problems: { key: string; problem: string; fix: string }[];
}

export async function checkReadiness(): Promise<ReadinessResult> {
  const problems = configProblems();
  if (config.mode === "live") {
    // Required settings of every selected adapter, from the capability registry.
    const { effective } = await import("@/lib/capabilities");
    for (const slot of ["enrichment", "outreach", "dialer", "alerts", "crm", "video", "analytics"] as const) {
      const e = effective(slot);
      if (e.missing.length && !problems.some((p) => e.missing.some((m) => p.key === m))) problems.push({ key: `${slot.toUpperCase()}_CONFIG`, problem: `${e.label} is selected for ${slot} but ${e.missing.join(", ")} ${e.missing.length > 1 ? "are" : "is"} missing`, fix: `set ${e.missing.join(", ")}` });
    }
  }
  let actual: string | null = null;
  let error: string | undefined;
  let storeKind: string = config.store;
  try {
    const store = getStore();
    storeKind = store.kind;
    actual = await store.schemaVersion();
  } catch (err) {
    error = (err as Error).message;
  }
  const schemaOk = actual === EXPECTED_SCHEMA_VERSION;
  if (!schemaOk) {
    problems.push({
      key: "SCHEMA",
      problem: error ? `store unreachable: ${error}` : `database schema version is ${actual ?? "missing"}, expected ${EXPECTED_SCHEMA_VERSION}`,
      fix: "apply supabase/migrations/0001..0005 in order (see README), then re-run the check",
    });
  }
  return { ok: problems.length === 0, mode: config.mode, store: storeKind, schema: { expected: EXPECTED_SCHEMA_VERSION, actual, ok: schemaOk, ...(error ? { error } : {}) }, problems };
}
