import { config } from "@/lib/config";
import type { Providers } from "@/lib/providers";
import type { Store } from "@/lib/store";
import type { Account, EngagementEvent, OutreachTouch } from "@/lib/types";
import { nowIso, uuid } from "@/lib/util";
import { logActivity } from "./activity";
import { describeEvent } from "./engagement";

/**
 * Outreach scheduling: the engine sends each touch when it is due through the
 * active provider. Channels the provider cannot send (LinkedIn, InMail, gifts
 * for Resend/mock) become rep tasks the rep completes from the dashboard, so
 * the whole sequence is visible and actionable even before the Sequencer is
 * wired in.
 */

export interface DueTouchResult {
  sent: number;
  repTasks: number;
  failed: number;
  skipped: number;
}

function repTaskUrl(account: Account, touch: OutreachTouch): string | undefined {
  if (touch.channel === "linkedin" || touch.channel === "inmail") return account.contact?.linkedin ?? undefined;
  return undefined;
}

export async function processDueTouches(
  store: Store,
  providers: Providers,
  opts: { log?: (s: string) => void; activity?: (accountId: string, action: string, summary: string, details?: string[]) => void; limit?: number } = {},
): Promise<DueTouchResult> {
  const result: DueTouchResult = { sent: 0, repTasks: 0, failed: 0, skipped: 0 };
  if (providers.outreach.ownsScheduling) return result;

  const due = await store.listOutreach({ status: "scheduled", dueBefore: nowIso(), limit: opts.limit ?? 50 });
  const accounts = new Map<string, Account | null>();
  for (const touch of due) {
    if (!accounts.has(touch.accountId)) accounts.set(touch.accountId, await store.getAccountById(touch.accountId));
    const account = accounts.get(touch.accountId);
    if (!account) continue;
    // Stop sequences for accounts that are done (meeting booked, won, lost, replied).
    if (["meeting_booked", "won", "lost", "disqualified"].includes(account.status)) {
      await store.updateOutreach({ ...touch, status: "skipped", note: `sequence stopped: account ${account.status}` });
      result.skipped++;
      continue;
    }

    if (!providers.outreach.channels.includes(touch.channel)) {
      const taskUrl = repTaskUrl(account, touch);
      await store.updateOutreach({ ...touch, status: "awaiting_rep", note: `${touch.channel} has no sending API here; rep task`, taskUrl });
      opts.activity?.(account.id, "rep_task_created", `Step ${touch.step} (${touch.channel}) handed to a rep`, [touch.body.slice(0, 140)]);
      result.repTasks++;
      continue;
    }

    try {
      const r = await providers.outreach.sendTouch(account, touch);
      if (r.status === "sent") {
        await store.updateOutreach({ ...touch, status: "sent", sentAt: nowIso(), externalId: r.externalId, note: r.note, provider: providers.outreach.name });
        const ev: EngagementEvent = {
          id: uuid(),
          accountId: account.id,
          eventType: `${touch.channel}_sent`,
          properties: { step: touch.step, provider: providers.outreach.name, touchId: touch.id },
          visitorId: null,
          createdAt: nowIso(),
        };
        await store.insertEvent(ev);
        opts.activity?.(account.id, "touch_sent", `Step ${touch.step} email sent via ${providers.outreach.name}`, [touch.subject ?? "", r.note ?? ""]);
        result.sent++;
      } else {
        await store.updateOutreach({ ...touch, status: "awaiting_rep", note: r.note ?? "send failed; handed to rep", taskUrl: repTaskUrl(account, touch) });
        opts.activity?.(account.id, "rep_task_created", `Step ${touch.step} email could not be sent automatically`, [r.note ?? ""]);
        result.repTasks++;
      }
    } catch (err) {
      const attempts = Number((touch as OutreachTouch & { attempts?: number }).attempts ?? 0) + 1;
      const msg = (err as Error).message;
      opts.log?.(`send failed for ${account.slug} step ${touch.step}: ${msg}`);
      if (attempts >= 3) {
        await store.updateOutreach({ ...touch, status: "failed", note: msg });
        opts.activity?.(account.id, "touch_failed", `Step ${touch.step} failed after ${attempts} attempts`, [msg]);
        result.failed++;
      } else {
        // retry in 10 minutes
        await store.updateOutreach({ ...touch, scheduledFor: new Date(Date.now() + 10 * 60_000).toISOString(), note: `retry ${attempts}: ${msg}`, ...({ attempts } as object) });
      }
    }
  }
  return result;
}

/** Rep completed (or skipped) a task from the dashboard. */
export async function completeRepTask(store: Store, touchId: string, status: "sent" | "skipped", by = "rep"): Promise<OutreachTouch | null> {
  const touch = await store.getOutreach(touchId);
  if (!touch) return null;
  const updated: OutreachTouch = { ...touch, status, sentAt: status === "sent" ? nowIso() : touch.sentAt, note: `${status} by ${by}` };
  await store.updateOutreach(updated);
  const account = await store.getAccountById(touch.accountId);
  if (account && status === "sent") {
    const eventType = touch.channel === "gift" ? "gift_sent" : touch.channel === "email" ? "email_sent" : "linkedin_sent";
    const ev: EngagementEvent = {
      id: uuid(),
      accountId: account.id,
      eventType,
      properties: { step: touch.step, channel: touch.channel, provider: "rep", touchId: touch.id },
      visitorId: null,
      createdAt: nowIso(),
    };
    await store.insertEvent(ev);
    await logActivity(store, account.id, "rep", "rep_task_done", `${describeEvent(ev)} (step ${touch.step})`);
  } else if (account) {
    await logActivity(store, account.id, "rep", "rep_task_skipped", `Step ${touch.step} (${touch.channel}) skipped by rep`);
  }
  return updated;
}

/**
 * After an engagement spike, rewrite the next scheduled email so it references
 * what the prospect just did (the Sequencer does this itself when it owns the cadence).
 */
export async function adaptNextTouch(store: Store, account: Account, reason: string, lines: string[]): Promise<OutreachTouch | null> {
  const next = (await store.listOutreach({ accountId: account.id, status: "scheduled" })).find((t) => t.channel === "email");
  if (!next) return null;
  const first = account.contact?.name.split(" ")[0] ?? "there";
  const hint = lines[0] ? lines[0].replace(/^Viewed personalized page.*$/, "spent time on the page we built for you").replace(/^Watched/, "watched").replace(/^Used/, "used") : reason;
  const body = `${first}, saw you ${hint.charAt(0).toLowerCase()}${hint.slice(1)}. Happy to walk through the numbers on a quick call.\n\n${next.body}`;
  const updated: OutreachTouch = { ...next, body, note: `adapted after: ${reason}`, scheduledFor: new Date(Date.now() + 30 * 60_000).toISOString() };
  await store.updateOutreach(updated);
  return updated;
}

/** "Send me my estimate" form from the personalized page: creates a rep task with the numbers. */
export async function createEstimateTask(store: Store, account: Account, props: Record<string, unknown>): Promise<OutreachTouch> {
  const inputs = (props.inputs ?? {}) as Record<string, unknown>;
  const results = (props.results ?? {}) as Record<string, unknown>;
  const email = (props.email as string) ?? account.contact?.email ?? "";
  const name = (props.name as string) ?? account.contact?.name ?? "";
  const fmt = (o: Record<string, unknown>) =>
    Object.entries(o)
      .map(([k, v]) => `${k}: ${String(v)}`)
      .join(", ");
  const touch: OutreachTouch = {
    id: uuid(),
    accountId: account.id,
    channel: "email",
    step: 99,
    subject: `Your estimate, ${account.companyName}`,
    body: `${name || "Hi"},\n\nHere is the estimate you requested from the page we built for ${account.companyName}.\n\nInputs: ${fmt(inputs) || "n/a"}\nResults: ${fmt(results) || "n/a"}\n\nWant to walk through it on a 15-minute call?`,
    status: "awaiting_rep",
    scheduledFor: nowIso(),
    provider: "rep",
    note: `estimate requested by ${email || "prospect"}; send within the hour`,
    taskUrl: email ? `mailto:${email}` : undefined,
  };
  await store.insertOutreach([touch]);
  await logActivity(store, account.id, "system", "estimate_requested", `Prospect requested their estimate by email`, [fmt(inputs), fmt(results)].filter(Boolean));
  if (email && account.contact && !account.contact.email) {
    await store.upsertAccount({ ...account, contact: { ...account.contact, email } });
  }
  return touch;
}

export const brand = config.brandName;
