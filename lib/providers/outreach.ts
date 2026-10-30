import { config } from "@/lib/config";
import type { Account, OutreachTouch } from "@/lib/types";
import { httpJson } from "./http";
import type { DialerProvider, OutreachProvider } from "./types";

/** Mock sequencer: marks the first touch sent and the rest scheduled. */
export class MockOutreachProvider implements OutreachProvider {
  readonly name = "mock";

  async launchSequence(_account: Account, touches: OutreachTouch[]): Promise<OutreachTouch[]> {
    const now = new Date().toISOString();
    return touches.map((t, i) => ({
      ...t,
      provider: this.name,
      status: i === 0 ? "sent" : "scheduled",
      sentAt: i === 0 ? now : undefined,
      externalId: `mock_seq_${t.accountId.slice(0, 8)}_${t.step}`,
    }));
  }

  async adaptSequence(_account: Account, reason: string) {
    return { adapted: true, note: `mock sequencer: next touch adapted (${reason})` };
  }
}

/**
 * Cartage Sequencer adapter (internal system). Contract we propose, to be
 * replaced by the real API shape once provided:
 *   POST {SEQUENCER_API_URL}/sequences
 *     { account: {slug, company, domain}, contact: {name, email, linkedin, title},
 *       touches: [{step, channel, subject?, body, scheduled_for}], experiment: {...} }
 *     -> { sequence_id, touches: [{step, external_id, status}] }
 *   POST {SEQUENCER_API_URL}/sequences/{sequence_id}/adapt { reason }
 * Email + InMail sequences run in parallel inside the Sequencer; AI follow-up
 * agents there handle replies.
 */
export class CartageSequencerProvider implements OutreachProvider {
  readonly name = "sequencer";

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
          touches: touches.map((t) => ({
            step: t.step,
            channel: t.channel,
            subject: t.subject,
            body: t.body,
            scheduled_for: t.scheduledFor,
          })),
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

  async adaptSequence(account: Account, reason: string) {
    const seqId = account.campaign ? `acct_${account.slug}` : null;
    if (!config.sequencer.apiUrl || !seqId) return { adapted: false, note: "sequencer not configured" };
    await httpJson(`${config.sequencer.apiUrl}/sequences/${encodeURIComponent(seqId)}/adapt`, {
      method: "POST",
      headers: this.headers(),
      body: { reason },
    });
    return { adapted: true, note: `sequencer adapted for: ${reason}` };
  }
}

/** Mock dialer: the call queue table in the store is the queue. */
export class MockDialerProvider implements DialerProvider {
  readonly name = "mock";
  async queueCall() {
    return { queued: true, note: "queued in local call queue (mock dialer)" };
  }
}

/**
 * Cartage Dialer adapter (internal). Proposed contract:
 *   POST {DIALER_API_URL}/queue { account_slug, contact: {name, phone, title}, context, priority }
 *     -> { call_id }
 */
export class CartageDialerProvider implements DialerProvider {
  readonly name = "cartage";
  async queueCall(input: { account: Account; contact: { name: string; phone?: string; title: string }; context: string }) {
    if (!config.dialer.apiUrl) throw new Error("DIALER_API_URL is required for DIALER_PROVIDER=cartage");
    const { data } = await httpJson<{ call_id: string }>(`${config.dialer.apiUrl}/queue`, {
      method: "POST",
      headers: config.dialer.apiKey ? { authorization: `Bearer ${config.dialer.apiKey}` } : {},
      body: {
        account_slug: input.account.slug,
        contact: input.contact,
        context: input.context,
        priority: input.account.priority,
      },
    });
    return { queued: true, externalId: data.call_id, note: "queued in Cartage Dialer" };
  }
}
