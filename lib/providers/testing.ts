import type { Account, HotLeadAlert, OutreachTouch, Person } from "@/lib/types";
import type { AlertProvider, DialerProvider, EnrichmentProvider, EnrichmentResult, LaunchResult, OutreachProvider, SendResult } from "./types";

/**
 * Controllable test adapters (OUTREACH/ALERT/DIALER/ENRICHMENT_PROVIDER=test).
 * They behave like real providers that own or do not own scheduling, record
 * every external effect keyed by idempotency key (duplicate keys are ignored,
 * like a provider honouring Idempotency-Key), and can be told to fail, time out
 * or hang. Used by the automated tests and the reliability journey; refused in
 * live mode by the configuration check.
 */

export type FailureMode = "error" | "timeout" | "permanent";

interface Control {
  /** Fail the next N calls of an operation ("launch" | "send" | "pause" | "resume" | "alert" | "dialer" | "enrich"). */
  failNext: Record<string, { n: number; mode: FailureMode }>;
  /** Artificial latency in ms per operation (lets two workers overlap). */
  delayMs: Record<string, number>;
  /** Every effect that reached the "provider", with the idempotency key. */
  effects: { op: string; key: string; accountId: string; at: string; detail?: string }[];
  ownsScheduling: boolean;
}

declare global {
  // eslint-disable-next-line no-var
  var __outboundIntelTestControl: Control | undefined;
}

export function testControl(): Control {
  if (!globalThis.__outboundIntelTestControl) globalThis.__outboundIntelTestControl = { failNext: {}, delayMs: {}, effects: [], ownsScheduling: false };
  return globalThis.__outboundIntelTestControl;
}

export function resetTestControl(opts: { ownsScheduling?: boolean } = {}): Control {
  globalThis.__outboundIntelTestControl = { failNext: {}, delayMs: {}, effects: [], ownsScheduling: Boolean(opts.ownsScheduling) };
  return globalThis.__outboundIntelTestControl;
}

export function failNext(op: string, n = 1, mode: FailureMode = "error"): void {
  testControl().failNext[op] = { n, mode };
}

export function effectsOf(op: string, accountId?: string) {
  return testControl().effects.filter((e) => e.op === op && (!accountId || e.accountId === accountId));
}

/** Shared by test adapters in other modules (e.g. TestCrmProvider). */
export async function testStep(op: string, key: string, accountId: string, detail?: string): Promise<{ duplicate: boolean }> {
  return step(op, key, accountId, detail);
}

async function step(op: string, key: string, accountId: string, detail?: string): Promise<{ duplicate: boolean }> {
  const c = testControl();
  const delay = c.delayMs[op] ?? 0;
  if (delay) await new Promise((r) => setTimeout(r, delay));
  const f = c.failNext[op];
  if (f && f.n > 0) {
    f.n--;
    if (f.mode === "timeout") throw new Error(`${op}: timed out (test adapter)`);
    const err = new Error(`${op}: failed (test adapter)`) as Error & { permanent?: boolean };
    if (f.mode === "permanent") err.permanent = true;
    throw err;
  }
  const duplicate = c.effects.some((e) => e.op === op && e.key === key);
  if (!duplicate) c.effects.push({ op, key, accountId, at: new Date().toISOString(), detail });
  return { duplicate };
}

export class TestOutreachProvider implements OutreachProvider {
  readonly name = "test";
  get channels(): OutreachTouch["channel"][] {
    return testControl().ownsScheduling ? ["email", "linkedin", "inmail"] : ["email"];
  }
  get ownsScheduling(): boolean {
    return testControl().ownsScheduling;
  }

  async launchSequence(account: Account, touches: OutreachTouch[], key: string): Promise<LaunchResult> {
    if (!this.ownsScheduling) return { sequenceId: null, touches: touches.map((t) => ({ ...t, provider: this.name })) };
    await step("launch", key, account.id);
    return { sequenceId: `seq_${account.id.slice(0, 8)}`, touches: touches.map((t) => (this.channels.includes(t.channel) ? { ...t, provider: this.name, externalId: `seq_${t.step}`, note: "scheduled in the test sequencer" } : t)) };
  }

  async sendTouch(account: Account, touch: OutreachTouch, key: string): Promise<SendResult> {
    if (!account.contact?.email) return { status: "failed", note: "no contact email on file", retryable: false };
    await step("send", key, account.id, touch.subject);
    return { status: "sent", externalId: `test_${touch.id.slice(0, 8)}` };
  }

  async adaptSequence(_account: Account, reason: string) {
    return { adapted: true, note: `test adapter adapted (${reason})` };
  }

  async pauseSequence(account: Account, until: string, _reason: string, key: string): Promise<void> {
    await step("pause", key, account.id, until);
  }

  async resumeSequence(account: Account, key: string): Promise<void> {
    await step("resume", key, account.id);
  }
}

export class TestAlertProvider implements AlertProvider {
  readonly name = "test";
  async sendHotLead(alert: HotLeadAlert, key = `alert:${alert.accountId}`) {
    await step("alert", key, alert.accountId, alert.triggeredBy);
    return { delivered: true, via: "test:alerts", remoteId: `msg_${key.slice(-8)}` };
  }
}

export class TestDialerProvider implements DialerProvider {
  readonly name = "test";
  async queueCall(input: { account: Account; contact: Person; context: string; idempotencyKey: string }) {
    await step("dialer", input.idempotencyKey, input.account.id, input.contact.name);
    return { queued: true, externalId: `call_${input.idempotencyKey.slice(-8)}`, note: "queued in the test dialer" };
  }
}

export class TestEnrichmentProvider implements EnrichmentProvider {
  readonly name = "test";
  async enrichContact(person: Person, account: Account): Promise<EnrichmentResult> {
    await step("enrich", `enrich:${account.id}:${person.name}`, account.id);
    const first = person.name.split(" ")[0]?.toLowerCase() ?? "contact";
    return {
      contact: { ...person, email: person.email ?? `${first}@${account.domain}`, phone: person.phone ?? "(555) 010-0000", phoneVerified: true, verifiedBy: "test" },
      phoneVerified: true,
      linkedinMatched: Boolean(person.linkedin),
      recentNews: [],
      techStack: [],
      notes: [],
      complete: true,
      provider: this.name,
      provenance: "provider",
    };
  }
}
