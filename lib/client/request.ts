/**
 * One way to call the API from the browser:
 *  - a request id per user action, sent as Idempotency-Key, so a retry after a
 *    timeout or a double click never records twice;
 *  - a timeout instead of a spinner that never ends;
 *  - a plain-language error and whether retrying is safe.
 * Callers keep the user's input on failure and re-enable their controls.
 */

export type RequestResult<T> = { ok: true; data: T; status: number } | { ok: false; status: number; error: string; retryable: boolean };

export function newRequestId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function message(status: number, serverError: string | undefined): { error: string; retryable: boolean } {
  if (status === 0) return { error: "Couldn't reach the server. Nothing was lost; check your connection and try again.", retryable: true };
  if (status === 401) return { error: "Your session expired. Sign in again in another tab, then retry; your input is kept here.", retryable: true };
  if (status === 403) return { error: serverError ? `Not allowed: ${serverError}` : "You don't have permission to do this.", retryable: false };
  if (status === 404) return { error: serverError ?? "That record no longer exists. Refresh the page.", retryable: false };
  if (status === 408 || status === 429) return { error: "The server is busy. Wait a moment and try again.", retryable: true };
  if (status === 409) return { error: serverError ?? "This is already being processed. Wait a moment, then refresh.", retryable: true };
  if (status >= 500) return { error: serverError ? `The server had a problem: ${serverError}. Try again.` : "The server had a problem. Try again.", retryable: true };
  return { error: serverError ?? `Request failed (${status}).`, retryable: false };
}

export async function requestJson<T = Record<string, unknown>>(url: string, opts: { method?: string; body?: unknown; requestId?: string; timeoutMs?: number } = {}): Promise<RequestResult<T>> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 25_000);
  try {
    const res = await fetch(url, {
      method: opts.method ?? "POST",
      headers: { "content-type": "application/json", ...(opts.requestId ? { "idempotency-key": opts.requestId } : {}) },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: ctrl.signal,
    });
    const data = (await res.json().catch(() => ({}))) as T & { ok?: boolean; error?: string };
    if (res.ok && data.ok !== false) return { ok: true, data, status: res.status };
    return { ok: false, status: res.status, ...message(res.status, data.error) };
  } catch (err) {
    const aborted = (err as Error).name === "AbortError";
    return { ok: false, status: aborted ? 408 : 0, ...(aborted ? { error: "The request timed out. It may still complete; retrying is safe.", retryable: true } : message(0, undefined)) };
  } finally {
    clearTimeout(timer);
  }
}

/** Keep unsent text across reloads and failures (per-browser convenience, never required). */
export const drafts = {
  get(key: string): string {
    try {
      return window.localStorage.getItem(`draft:${key}`) ?? "";
    } catch {
      return "";
    }
  },
  set(key: string, value: string): void {
    try {
      if (value) window.localStorage.setItem(`draft:${key}`, value);
      else window.localStorage.removeItem(`draft:${key}`);
    } catch {
      /* storage unavailable */
    }
  },
};
