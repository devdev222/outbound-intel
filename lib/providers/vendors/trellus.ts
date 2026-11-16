import { config } from "@/lib/config";
import { PermanentError } from "@/lib/engine/operations";
import { httpJson } from "../http";
import { toProviderError } from "../outreach";

/**
 * Trellus Call Data API (read-only). Implemented from trellus.ai/developers,
 * read 2026-11-16; not yet verified against a real account.
 *
 *   POST https://rpt-2.trellus.ai/session-list-v6   Authorization: Bearer <key>
 *     { start, end (Unix microseconds), limit <= 1000, select: [...] } -> positional rows, newest first
 *   GET  https://ext.trellus.ai/visible             api_key: <key>   (access check)
 *   2 requests per 4 seconds per user; on 429 honor Retry-After.
 *
 * Trellus documents no outbound webhooks, so results are pulled. Calls are
 * queued through Attio tasks (see TrellusAttioDialerProvider), which Trellus
 * dials from its native Attio integration.
 */

export const CALL_FIELDS = ["session_id", "started_at", "duration", "customer_data.name", "customer_address", "user_log.disposition", "user_log.notes", "sales_metric.has_meeting_confirm", "resource_id"] as const;

export interface TrellusCall {
  sessionId: string;
  startedAt: string;
  durationSec: number;
  name: string | null;
  phone: string | null;
  disposition: string | null;
  notes: string | null;
  meetingDetected: boolean;
  repId: string | null;
}

/** started_at may come back in seconds, milliseconds or microseconds. */
function toIso(v: unknown): string {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return new Date().toISOString();
  const ms = n > 1e14 ? n / 1000 : n > 1e11 ? n : n * 1000;
  return new Date(ms).toISOString();
}

export function rowToCall(row: unknown[]): TrellusCall | null {
  const get = (f: (typeof CALL_FIELDS)[number]) => row[CALL_FIELDS.indexOf(f)];
  const id = get("session_id");
  if (id == null || id === "") return null;
  const s = (v: unknown) => (v == null || v === "" ? null : String(v));
  return {
    sessionId: String(id),
    startedAt: toIso(get("started_at")),
    durationSec: Number(get("duration")) || 0,
    name: s(get("customer_data.name")),
    phone: s(get("customer_address")),
    disposition: s(get("user_log.disposition")),
    notes: s(get("user_log.notes")),
    meetingDetected: get("sales_metric.has_meeting_confirm") === true || get("sales_metric.has_meeting_confirm") === 1 || get("sales_metric.has_meeting_confirm") === "true",
    repId: s(get("resource_id")),
  };
}

export async function listTrellusCalls(sinceMs: number, untilMs = Date.now()): Promise<TrellusCall[]> {
  if (!config.trellus.apiKey) throw new PermanentError("TRELLUS_API_KEY is not set");
  try {
    const { data } = await httpJson<unknown>("https://rpt-2.trellus.ai/session-list-v6", {
      method: "POST",
      headers: { authorization: `Bearer ${config.trellus.apiKey}` },
      body: { start: Math.floor(sinceMs * 1000), end: Math.floor(untilMs * 1000), limit: 1000, select: CALL_FIELDS },
      timeoutMs: 25_000,
    });
    if (!Array.isArray(data)) throw new PermanentError("trellus session-list: expected an array of rows");
    return data.map((r) => (Array.isArray(r) ? rowToCall(r) : null)).filter((x): x is TrellusCall => Boolean(x));
  } catch (err) {
    throw toProviderError(err, "trellus session-list");
  }
}

/** Read-only connection check. */
export async function testTrellus(): Promise<{ ok: boolean; message: string }> {
  if (!config.trellus.apiKey) return { ok: false, message: "TRELLUS_API_KEY is not set" };
  try {
    const { data } = await httpJson<unknown>("https://ext.trellus.ai/visible", { headers: { api_key: config.trellus.apiKey } });
    const n = Array.isArray(data) ? data.length : data && typeof data === "object" ? Object.keys(data).length : 0;
    return { ok: true, message: `authenticated; access check answered (${n} item${n === 1 ? "" : "s"})` };
  } catch (err) {
    throw toProviderError(err, "trellus visible");
  }
}
