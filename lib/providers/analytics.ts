import { config } from "@/lib/config";
import { httpJson } from "./http";
import type { AnalyticsEvent, AnalyticsProvider } from "./types";

/** First-party only: events already land in our events table; nothing to mirror. */
export class NoopAnalyticsProvider implements AnalyticsProvider {
  readonly name = "none";
  async capture(): Promise<void> {}
}

/**
 * PostHog server-side capture. Verified against the official docs on 2026-10-29:
 *   POST {host}/i/v0/e/   Content-Type: application/json
 *   { api_key, event, distinct_id, properties: {...}, timestamp: ISO8601 }
 *   Hosts: https://us.i.posthog.com (US) or https://eu.i.posthog.com (EU).
 *   Auth is the project token in the body; there is no auth header.
 *   Batch alternative: POST {host}/batch/ { api_key, batch: [...] } (< 20 MB).
 * Docs: https://posthog.com/docs/api/capture
 *
 * We mirror every first-party engagement event so PostHog funnels, session
 * replay and retention work on top of the same data the scoring loop uses.
 */
export class PostHogAnalyticsProvider implements AnalyticsProvider {
  readonly name = "posthog";

  async capture(event: AnalyticsEvent): Promise<void> {
    if (!config.posthog.apiKey) return;
    const host = config.posthog.host.replace(/\/$/, "");
    await httpJson(`${host}/i/v0/e/`, {
      method: "POST",
      body: {
        api_key: config.posthog.apiKey,
        event: event.event,
        distinct_id: event.distinctId.slice(0, 200),
        properties: event.properties,
        timestamp: event.timestamp ?? new Date().toISOString(),
      },
      timeoutMs: 5000,
    });
  }
}
