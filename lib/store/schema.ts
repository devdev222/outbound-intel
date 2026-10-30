/** The schema version this code expects. Bump together with a new supabase/migrations/NNNN_*.sql that updates app_meta. */
export const EXPECTED_SCHEMA_VERSION = "4";

/** Task statuses retired by the lifecycle redesign, mapped to their replacement (0004 migrates Postgres; local stores map on read). */
export function normalizeTaskStatus<T extends { status: string }>(t: T): T {
  return t.status === "awaiting_rep" ? { ...t, status: "manual" } : t;
}
