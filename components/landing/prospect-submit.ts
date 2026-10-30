"use client";

import { getVisitorId } from "./Tracker";

/**
 * Client side of the prospect endpoints (/api/prospect/*). Each submission
 * carries a requestId that stays the same across retries, so the server returns
 * the original task instead of creating a duplicate. Transient failures
 * (network, 5xx, 429) are retried a few times with backoff; the caller shows
 * success only when this resolves ok.
 */

export function newRequestId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export type SubmitResult = { ok: true; taskId?: string } | { ok: false; retryable: boolean; message: string };

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function submitProspect(path: "/api/prospect/meeting-request" | "/api/prospect/estimate", body: Record<string, unknown>, attempts = 3): Promise<SubmitResult> {
  let last: SubmitResult = { ok: false, retryable: true, message: "Could not reach the server." };
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await wait(600 * 2 ** (i - 1));
    try {
      const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, visitorId: getVisitorId() }) });
      if (res.ok) {
        const data = (await res.json().catch(() => ({}))) as { taskId?: string };
        return { ok: true, taskId: data.taskId };
      }
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      const retryable = res.status >= 500 || res.status === 429 || res.status === 408;
      last = { ok: false, retryable, message: data.error ?? `Request failed (${res.status}).` };
      if (!retryable) return last;
    } catch {
      last = { ok: false, retryable: true, message: "Could not reach the server." };
    }
  }
  return last;
}
