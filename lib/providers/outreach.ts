import { config } from "@/lib/config";
import { renderTouchEmail } from "@/lib/engine/email";
import type { Account, OutreachTouch } from "@/lib/types";
import { httpJson } from "./http";
import type { DialerProvider, OutreachProvider, SendResult } from "./types";

/**
 * Outreach providers. Two shapes:
 *  - simple senders (mock, Resend): the engine schedules; the provider sends one
 *    touch when it is due, and only on the channels it supports. LinkedIn,
 *    InMail and gifts have no sending API, so those touches become rep tasks.
 *  - Cartage Sequencer: owns the whole cadence (email + InMail in parallel, AI
 *    reply handling); the engine hands over the touches and listens for events.
 */

// --- Mock ------------------------------------------------------------------------

export class MockOutreachProvider implements OutreachProvider {
  readonly name = "mock";
  readonly channels: OutreachTouch["channel"][] = ["email"];
  readonly ownsScheduling = false;

  async launchSequence(_account: Account, touches: OutreachTouch[]): Promise<OutreachTouch[]> {
    return touches.map((t) => ({ ...t, provider: this.name }));
  }

  async sendTouch(account: Account, touch: OutreachTouch): Promise<SendResult> {
    if (!account.contact?.email) return { status: "failed", note: "no contact email on file" };
    return { status: "sent", externalId: `mock_${touch.id.slice(0, 8)}`, note: "mock sender: not actually delivered" };
  }

  async adaptSequence(_account: Account, reason: string) {
    return { adapted: false, note: `engine adapts the next touch itself (${reason})` };
  }
}

// --- Resend ----------------------------------------------------------------------

/**
 * Resend adapter. Verified against the official docs on 2026-10-30:
 *   POST https://api.resend.com/emails   Authorization: Bearer re_xxx
 *   body { from, to: string|string[], subject, html?, text?, reply_to?, headers?, tags?: [{name, value}] }
 *   -> { id }
 *   Optional Idempotency-Key header (unique per request, 24h).
 *   Webhooks (email.delivered / opened / clicked / bounced / complained) are
 *   handled by /api/webhooks/resend; we tag every send with account_slug and
 *   touch_id so events map back without a lookup table.
 * Docs: https://resend.com/docs/api-reference/emails/send-email
 */
export class ResendOutreachProvider implements OutreachProvider {
  readonly name = "resend";
  readonly channels: OutreachTouch["channel"][] = ["email"];
  readonly ownsScheduling = false;

  async launchSequence(_account: Account, touches: OutreachTouch[]): Promise<OutreachTouch[]> {
    return touches.map((t) => ({ ...t, provider: this.name }));
  }

  async sendTouch(account: Account, touch: OutreachTouch): Promise<SendResult> {
    if (!config.resend.apiKey || !config.resend.from) return { status: "failed", note: "RESEND_API_KEY / RESEND_FROM not set" };
    if (!account.contact?.email) return { status: "failed", note: "no contact email on file" };
    const { html, text } = renderTouchEmail(account, touch);
    const tagSafe = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 256);
    const { data } = await httpJson<{ id: string }>("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.resend.apiKey}`,
        "idempotency-key": `touch-${touch.id}`,
      },
      body: {
        from: config.resend.from,
        to: [account.contact.email],
        subject: touch.subject ?? `${account.companyName}`,
        html,
        text,
        ...(config.resend.replyTo ? { reply_to: config.resend.replyTo } : {}),
        tags: [
          { name: "account_slug", value: tagSafe(account.slug) },
          { name: "touch_id", value: tagSafe(touch.id) },
          { name: "step", value: String(touch.step) },
        ],
      },
    });
    return { status: "sent", externalId: data.id };
  }

  async adaptSequence(_account: Account, reason: string) {
    return { adapted: false, note: `engine adapts the next touch itself (${reason})` };
  }
}

// --- Cartage Sequencer (internal) ---------------------------------------------------

/**
 * Proposed contract, to be replaced by the real API shape once provided:
 *   POST {SEQUENCER_API_URL}/sequences
 *     { account: {slug, company, domain}, contact: {name, email, linkedin, title},
 *       touches: [{step, channel, subject?, body, scheduled_for}], experiment: {...} }
 *     -> { sequence_id, touches: [{step, external_id, status}] }
 *   POST {SEQUENCER_API_URL}/sequences/{sequence_id}/adapt { reason }
 *   The Sequencer relays opens / clicks / replies / InMail events to POST /api/track.
 */
export class CartageSequencerProvider implements OutreachProvider {
  readonly name = "sequencer";
  readonly channels: OutreachTouch["channel"][] = ["email", "linkedin", "inmail"];
  readonly ownsScheduling = true;

  private headers() {
    return (config.sequencer.apiKey ? { authorization: `Bearer ${config.sequencer.apiKey}` } : {}) as Record<string, string>;
  }

  async launchSequence(account: Account, touches: OutreachTouch[]): Promise<OutreachTouch[]> {
    if (!config.sequencer.apiUrl) throw new Error("SEQUENCER_API_URL is required for OUTREACH_PROVIDER=sequencer");
    const { data } = await httpJson<{ sequence_id: string; touches: { step: number; external_id: string; status: string }[] }>(
      `${config.sequencer.apiUrl}/sequences`,
      {
        method: "POST",
        headers: this.headers(),
        body: {
          account: { slug: account.slug, company: account.companyName, domain: account.domain },
          contact: account.contact,
          touches: touches.map((t) => ({ step: t.step, channel: t.channel, subject: t.subject, body: t.body, scheduled_for: t.scheduledFor })),
          experiment: account.campaign?.arms ?? null,
        },
      },
    );
    const byStep = new Map(data.touches.map((t) => [t.step, t]));
    return touches.map((t) => ({
      ...t,
      provider: this.name,
      externalId: byStep.get(t.step)?.external_id ?? data.sequence_id,
      status: (byStep.get(t.step)?.status as OutreachTouch["status"]) ?? "scheduled",
    }));
  }

  async sendTouch(): Promise<SendResult> {
    return { status: "failed", note: "the Sequencer owns scheduling; sendTouch is not used" };
  }

  async adaptSequence(account: Account, reason: string) {
    const seqId = account.campaign ? `acct_${account.slug}` : null;
    if (!config.sequencer.apiUrl || !seqId) return { adapted: false, note: "sequencer not configured" };
    await httpJson(`${config.sequencer.apiUrl}/sequences/${encodeURIComponent(seqId)}/adapt`, { method: "POST", headers: this.headers(), body: { reason } });
    return { adapted: true, note: `sequencer adapted for: ${reason}` };
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

/**
 * Cartage Dialer adapter (internal). Proposed contract:
 *   POST {DIALER_API_URL}/queue { account_slug, contact: {name, phone, title}, context, priority } -> { call_id }
 */
export class CartageDialerProvider implements DialerProvider {
  readonly name = "cartage";
  async queueCall(input: { account: Account; contact: { name: string; phone?: string; title: string }; context: string }) {
    if (!config.dialer.apiUrl) throw new Error("DIALER_API_URL is required for DIALER_PROVIDER=cartage");
    const { data } = await httpJson<{ call_id: string }>(`${config.dialer.apiUrl}/queue`, {
      method: "POST",
      headers: config.dialer.apiKey ? { authorization: `Bearer ${config.dialer.apiKey}` } : {},
      body: { account_slug: input.account.slug, contact: input.contact, context: input.context, priority: input.account.priority },
    });
    return { queued: true, externalId: data.call_id, note: "queued in Cartage Dialer" };
  }
}
