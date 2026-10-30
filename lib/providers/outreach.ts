import { z } from "zod";
import { config } from "@/lib/config";
import { renderTouchEmail } from "@/lib/engine/email";
import { PermanentError } from "@/lib/engine/operations";
import type { Account, OutreachTouch } from "@/lib/types";
import { HttpError, httpJson } from "./http";
import type { DialerProvider, LaunchResult, OutreachProvider, SendResult } from "./types";

/**
 * Outreach providers. Two shapes:
 *  - simple senders (mock, Resend, test): the engine schedules; the provider sends one
 *    touch when it is due, and only on the channels it supports. LinkedIn,
 *    InMail and gifts have no sending API, so those touches become manual tasks.
 *  - Cartage Sequencer: owns the whole cadence (email + InMail in parallel, AI
 *    reply handling); the engine hands over the touches and listens for events.
 *
 * Every response from an external system is validated at this boundary. A 4xx
 * other than 408/409/429 is a permanent failure (retrying cannot help).
 */

export function toProviderError(err: unknown, context: string): Error {
  if (err instanceof HttpError) {
    const transient = err.status === 408 || err.status === 409 || err.status === 429 || err.status >= 500;
    const message = `${context}: HTTP ${err.status} ${err.bodyText.slice(0, 200)}`;
    return transient ? new Error(message) : new PermanentError(message);
  }
  if (err instanceof z.ZodError) return new PermanentError(`${context}: unexpected response shape (${err.issues.map((i) => i.path.join(".") || "root").join(", ")})`);
  return err instanceof Error ? err : new Error(String(err));
}

// --- Mock ------------------------------------------------------------------------

export class MockOutreachProvider implements OutreachProvider {
  readonly name = "mock";
  readonly channels: OutreachTouch["channel"][] = ["email"];
  readonly ownsScheduling = false;

  async launchSequence(_account: Account, touches: OutreachTouch[]): Promise<LaunchResult> {
    return { sequenceId: null, touches: touches.map((t) => ({ ...t, provider: this.name })) };
  }

  async sendTouch(account: Account, touch: OutreachTouch): Promise<SendResult> {
    if (!account.contact?.email) return { status: "failed", note: "no contact email on file", retryable: false };
    return { status: "sent", externalId: `mock_${touch.id.slice(0, 8)}`, note: "mock sender: not actually delivered" };
  }

  async adaptSequence(_account: Account, reason: string) {
    return { adapted: false, note: `engine adapts the next touch itself (${reason})` };
  }
}

// --- Resend ----------------------------------------------------------------------

const ResendSendResponse = z.object({ id: z.string().min(1) });

/**
 * Resend adapter. Verified against the official docs on 2026-10-30:
 *   POST https://api.resend.com/emails   Authorization: Bearer re_xxx
 *   body { from, to: string|string[], subject, html?, text?, reply_to?, headers?, tags?: [{name, value}] }
 *   -> { id }
 *   Idempotency-Key header (unique per request, 24h) carries our operation key.
 * Docs: https://resend.com/docs/api-reference/emails/send-email
 */
export class ResendOutreachProvider implements OutreachProvider {
  readonly name = "resend";
  readonly channels: OutreachTouch["channel"][] = ["email"];
  readonly ownsScheduling = false;

  async launchSequence(_account: Account, touches: OutreachTouch[]): Promise<LaunchResult> {
    return { sequenceId: null, touches: touches.map((t) => ({ ...t, provider: this.name })) };
  }

  async sendTouch(account: Account, touch: OutreachTouch, idempotencyKey: string): Promise<SendResult> {
    if (!config.resend.apiKey || !config.resend.from) return { status: "failed", note: "RESEND_API_KEY / RESEND_FROM not set", retryable: false };
    if (!account.contact?.email) return { status: "failed", note: "no contact email on file", retryable: false };
    const { html, text, listUnsubscribe } = await renderTouchEmail(account, touch);
    const tagSafe = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 256);
    try {
      const { data } = await httpJson<unknown>("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${config.resend.apiKey}`, "idempotency-key": idempotencyKey.slice(0, 256) },
        body: {
          from: config.resend.from,
          to: [account.contact.email],
          subject: touch.subject ?? `${account.companyName}`,
          html,
          text,
          ...(config.resend.replyTo ? { reply_to: config.resend.replyTo } : {}),
          ...(listUnsubscribe ? { headers: { "List-Unsubscribe": `<${listUnsubscribe}>` } } : {}),
          tags: [
            { name: "account_slug", value: tagSafe(account.slug) },
            { name: "touch_id", value: tagSafe(touch.id) },
            { name: "step", value: String(touch.step) },
          ],
        },
      });
      return { status: "sent", externalId: ResendSendResponse.parse(data).id };
    } catch (err) {
      throw toProviderError(err, "resend send");
    }
  }

  async adaptSequence(_account: Account, reason: string) {
    return { adapted: false, note: `engine adapts the next touch itself (${reason})` };
  }
}

// --- Cartage Sequencer (internal) ---------------------------------------------------

const SequencerLaunchResponse = z.object({
  sequence_id: z.string().min(1),
  touches: z.array(z.object({ step: z.number(), external_id: z.string(), status: z.string().optional() })).default([]),
});

/**
 * Proposed contract, to be replaced by the real API shape once provided:
 *   POST {SEQUENCER_API_URL}/sequences            (Idempotency-Key: launch:<accountId>)
 *     { account, contact, touches: [{step, channel, subject?, body, scheduled_for}], experiment }
 *     -> { sequence_id, touches: [{step, external_id, status}] }
 *   POST {SEQUENCER_API_URL}/sequences/{sequence_id}/adapt  { reason }
 *   POST {SEQUENCER_API_URL}/sequences/{sequence_id}/pause  { until, reason }
 *   POST {SEQUENCER_API_URL}/sequences/{sequence_id}/resume
 *   The Sequencer relays opens / clicks / replies / InMail events to POST /api/track.
 */
export class CartageSequencerProvider implements OutreachProvider {
  readonly name = "sequencer";
  readonly channels: OutreachTouch["channel"][] = ["email", "linkedin", "inmail"];
  readonly ownsScheduling = true;

  private headers(idempotencyKey?: string) {
    return {
      ...(config.sequencer.apiKey ? { authorization: `Bearer ${config.sequencer.apiKey}` } : {}),
      ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
    } as Record<string, string>;
  }

  async launchSequence(account: Account, touches: OutreachTouch[], idempotencyKey: string): Promise<LaunchResult> {
    if (!config.sequencer.apiUrl) throw new PermanentError("SEQUENCER_API_URL is required for OUTREACH_PROVIDER=sequencer");
    try {
      const { data } = await httpJson<unknown>(`${config.sequencer.apiUrl}/sequences`, {
        method: "POST",
        headers: this.headers(idempotencyKey),
        body: {
          account: { slug: account.slug, company: account.companyName, domain: account.domain },
          contact: account.contact,
          touches: touches.filter((t) => this.channels.includes(t.channel)).map((t) => ({ step: t.step, channel: t.channel, subject: t.subject, body: t.body, scheduled_for: t.scheduledFor })),
          experiment: account.campaign?.arms ?? null,
          paused_until: account.pausedUntil ?? null,
        },
      });
      const parsed = SequencerLaunchResponse.parse(data);
      const byStep = new Map(parsed.touches.map((t) => [t.step, t]));
      return {
        sequenceId: parsed.sequence_id,
        touches: touches.map((t) =>
          this.channels.includes(t.channel)
            ? { ...t, provider: this.name, externalId: byStep.get(t.step)?.external_id ?? parsed.sequence_id, status: "scheduled" as const, note: "scheduled in the Sequencer" }
            : t,
        ),
      };
    } catch (err) {
      throw toProviderError(err, "sequencer launch");
    }
  }

  async sendTouch(): Promise<SendResult> {
    return { status: "failed", note: "the Sequencer owns scheduling; sendTouch is not used", retryable: false };
  }

  async adaptSequence(account: Account, reason: string) {
    const seqId = account.campaign?.sequenceId;
    if (!config.sequencer.apiUrl || !seqId) return { adapted: false, note: seqId ? "sequencer not configured" : "no acknowledged sequence id" };
    try {
      await httpJson(`${config.sequencer.apiUrl}/sequences/${encodeURIComponent(seqId)}/adapt`, { method: "POST", headers: this.headers(), body: { reason } });
    } catch (err) {
      throw toProviderError(err, "sequencer adapt");
    }
    return { adapted: true, note: `sequencer adapted for: ${reason}` };
  }

  async pauseSequence(account: Account, until: string, reason: string, idempotencyKey: string): Promise<void> {
    const seqId = account.campaign?.sequenceId;
    if (!seqId) return; // nothing launched remotely yet; the launch carries paused_until
    if (!config.sequencer.apiUrl) throw new PermanentError("SEQUENCER_API_URL is not configured");
    try {
      await httpJson(`${config.sequencer.apiUrl}/sequences/${encodeURIComponent(seqId)}/pause`, { method: "POST", headers: this.headers(idempotencyKey), body: { until, reason } });
    } catch (err) {
      throw toProviderError(err, "sequencer pause");
    }
  }

  async resumeSequence(account: Account, idempotencyKey: string): Promise<void> {
    const seqId = account.campaign?.sequenceId;
    if (!seqId) return;
    if (!config.sequencer.apiUrl) throw new PermanentError("SEQUENCER_API_URL is not configured");
    try {
      await httpJson(`${config.sequencer.apiUrl}/sequences/${encodeURIComponent(seqId)}/resume`, { method: "POST", headers: this.headers(idempotencyKey), body: {} });
    } catch (err) {
      throw toProviderError(err, "sequencer resume");
    }
  }
}

// --- Dialer -------------------------------------------------------------------------

/** Mock dialer: the call queue table in the store is the queue. */
export class MockDialerProvider implements DialerProvider {
  readonly name = "mock";
  async queueCall() {
    return { queued: true, note: "queued in local call queue (mock dialer)" };
  }
}

const DialerResponse = z.object({ call_id: z.string().min(1) });

/**
 * Cartage Dialer adapter (internal). Proposed contract:
 *   POST {DIALER_API_URL}/queue { account_slug, contact: {name, phone, title}, context, priority } -> { call_id }
 *   with Idempotency-Key so a retried activation never queues the same call twice.
 */
export class CartageDialerProvider implements DialerProvider {
  readonly name = "cartage";
  async queueCall(input: { account: Account; contact: { name: string; phone?: string; title: string }; context: string; idempotencyKey: string }) {
    if (!config.dialer.apiUrl) throw new PermanentError("DIALER_API_URL is required for DIALER_PROVIDER=cartage");
    try {
      const { data } = await httpJson<unknown>(`${config.dialer.apiUrl}/queue`, {
        method: "POST",
        headers: { ...(config.dialer.apiKey ? { authorization: `Bearer ${config.dialer.apiKey}` } : {}), "idempotency-key": input.idempotencyKey } as Record<string, string>,
        body: { account_slug: input.account.slug, contact: input.contact, context: input.context, priority: input.account.priority },
      });
      return { queued: true, externalId: DialerResponse.parse(data).call_id, note: "queued in Cartage Dialer" };
    } catch (err) {
      throw toProviderError(err, "dialer queue");
    }
  }
}
