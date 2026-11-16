import { z } from "zod";
import { config } from "@/lib/config";
import type { Providers } from "@/lib/providers";
import { amplemarket } from "@/lib/providers/vendors/amplemarket";
import type { Store } from "@/lib/store";
import { suppressions } from "@/lib/store/collections";
import { nowIso, uuid } from "@/lib/util";
import { coordinateSignal } from "./coordination";
import { idempotencyId, idempotent } from "./idempotency";

/**
 * Opt-outs kept in step with Amplemarket's exclusion lists, both ways:
 *   push  our suppressions (opt-outs, do-not-contact, competitors, customers) to
 *         POST /excluded-emails and /excluded-domains, each entry once (operation amp-excl:<target>)
 *   pull  GET /excluded-emails (cursor pages): anyone excluded in Amplemarket, e.g.
 *         after unsubscribing there, who is one of our people becomes a suppression
 *         and is opted out of the group, so the engine never contacts them either
 * Runs from the Campaign Agent at most every 10 minutes.
 */

const MIN_INTERVAL_MS = 10 * 60_000;
let lastRun = 0;

export interface ExclusionSyncResult {
  pushed: number;
  pulled: number;
  skipped: boolean;
}

const Excluded = z
  .object({
    excluded_emails: z.array(z.object({ email: z.string(), excluded_reason: z.string().nullish(), source: z.string().nullish() }).passthrough()).default([]),
    _links: z.object({ next: z.object({ href: z.string() }).nullish() }).passthrough().nullish(),
  })
  .passthrough();

export async function syncAmplemarketExclusions(store: Store, providers: Providers, opts: { force?: boolean } = {}): Promise<ExclusionSyncResult> {
  if (!config.amplemarket.apiKey || !config.amplemarket.syncExclusions) return { pushed: 0, pulled: 0, skipped: true };
  if (!opts.force && Date.now() - lastRun < MIN_INTERVAL_MS) return { pushed: 0, pulled: 0, skipped: true };
  lastRun = Date.now();
  const pushed = await pushSuppressions(store);
  const pulled = await pullExclusions(store, providers);
  return { pushed, pulled, skipped: false };
}

async function pushSuppressions(store: Store): Promise<number> {
  const all = await suppressions.list();
  const pending: { target: string; done: boolean }[] = [];
  for (const s of all) {
    const op = await store.getOperation(idempotencyId("amp-excl", s.target.toLowerCase()));
    if (op?.status !== "succeeded") pending.push({ target: s.target.toLowerCase(), done: false });
  }
  const emails = pending.filter((p) => !p.target.startsWith("@") && p.target.includes("@")).map((p) => p.target);
  const domains = pending.filter((p) => p.target.startsWith("@")).map((p) => p.target.slice(1));
  let n = 0;
  for (let i = 0; i < emails.length; i += 500) {
    const batch = emails.slice(i, i + 500);
    await amplemarket(`/excluded-emails`, { method: "POST", body: { excluded_emails: batch.map((email) => ({ email })) }, context: "add excluded emails" });
    for (const e of batch) await idempotent(store, "amp-excl", e, async () => ({ at: nowIso() }));
    n += batch.length;
  }
  for (let i = 0; i < domains.length; i += 500) {
    const batch = domains.slice(i, i + 500);
    await amplemarket(`/excluded-domains`, { method: "POST", body: { excluded_domains: batch.map((domain) => ({ domain })) }, context: "add excluded domains" });
    for (const d of batch) await idempotent(store, "amp-excl", `@${d}`, async () => ({ at: nowIso() }));
    n += batch.length;
  }
  return n;
}

async function pullExclusions(store: Store, providers: Providers): Promise<number> {
  const contacts = await store.listContacts({ status: ["selected", "paused", "candidate"] });
  const byEmail = new Map(contacts.filter((c) => c.person.email).map((c) => [c.person.email!.toLowerCase(), c]));
  if (!byEmail.size) return 0;
  const suppressed = new Set((await suppressions.list()).map((s) => s.target.toLowerCase()));
  let path: string | null = `/excluded-emails?page[size]=2000`;
  let n = 0;
  for (let page = 0; path && page < 25; page++) {
    const r = Excluded.parse(await amplemarket(path, { context: "list excluded emails" }));
    for (const e of r.excluded_emails) {
      const email = e.email.toLowerCase();
      const c = byEmail.get(email);
      if (!c || suppressed.has(email)) continue;
      await suppressions.put({ id: uuid(), target: email, reason: "opt_out", note: `excluded in Amplemarket${e.excluded_reason ? ` (${e.excluded_reason})` : ""}`, createdBy: "amplemarket", at: nowIso() });
      // Already on Amplemarket's list: never push it back.
      await idempotent(store, "amp-excl", email, async () => ({ at: nowIso(), from: "amplemarket" }));
      await coordinateSignal(store, providers, c.id, { kind: "opted_out", detail: `excluded in Amplemarket${e.excluded_reason ? ` (${e.excluded_reason})` : ""}` }, "amplemarket");
      suppressed.add(email);
      n++;
    }
    const next = r._links?.next?.href ?? null;
    path = next ? next.replace(/^https?:\/\/[^/]+/, "") : null;
  }
  return n;
}

/** Test hook: let the next sync run immediately. */
export function resetExclusionSyncThrottle(): void {
  lastRun = 0;
}
