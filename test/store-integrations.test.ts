import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { config } from "@/lib/config";
import { createTask } from "@/lib/engine/tasks";
import { fingerprintFor, getConnections, saveTestResult, specFor } from "@/lib/integrations";
import { SupabaseStore } from "@/lib/store/supabase-store";
import type { Store } from "@/lib/store";
import type { Account } from "@/lib/types";
import { fresh, makeAccount, READY } from "./helpers";

/** The fields ticket 1 found missing from the Supabase mapping; every store must round-trip them. */
async function roundTrip(store: Store): Promise<void> {
  const a = await makeAccount(store, {
    ownerRepId: "rep_42",
    readiness: { ...READY, blockers: [] },
    nextAction: { type: "call", label: "Call back as agreed", reason: "committed", dueAt: "2030-01-02T15:00:00.000Z" },
    experiments: { exp_1: "b" },
    pipelineValue: 123_456,
    crmOwner: "Dana (CRM)",
    pausedUntil: "2030-02-01T00:00:00.000Z",
    pauseReason: "not now",
    enrichment: { attempts: 2, lastAttemptAt: "2030-01-01T00:00:00.000Z", lastSuccessAt: null, lastError: "clay: timeout", provider: "clay", nextAttemptAt: "2030-01-01T00:10:00.000Z" },
  });
  const back = (await store.getAccountById(a.id)) as Account;
  for (const k of ["ownerRepId", "nextAction", "experiments", "pipelineValue", "crmOwner", "pausedUntil", "pauseReason", "enrichment"] as const) {
    assert.deepEqual(back[k], a[k], `account.${k} survives a reload`);
  }
  assert.equal(back.readiness?.ready, true);

  const t = await createTask(store, { account: a, channel: "email", title: "Step", subject: "s", body: "b", status: "scheduled", source: "rep" });
  await store.updateOutreach({ ...t, attempts: 3, lastError: "timeout", approvedBy: "Sam", approvedAt: "2030-01-01T00:00:00.000Z" });
  const tb = await store.getOutreach(t.id);
  assert.equal(tb?.attempts, 3, "retry count survives a reload");
  assert.equal(tb?.lastError, "timeout");
  assert.equal(tb?.source, "rep");
  assert.equal(tb?.approvedBy, "Sam");

  // Assigned ready account stays in the rep's queue after reload.
  const mine = (await store.listAccounts()).filter((x) => x.ownerRepId === "rep_42" && x.readiness?.ready);
  assert.ok(mine.some((x) => x.id === a.id));

  // Atomic claims: two workers, one winner.
  await store.ensureOperation({ id: `op:${a.id}`, kind: "send", accountId: a.id, destination: "test", status: "pending", attempts: 0, maxAttempts: 3, leaseOwner: null, leaseUntil: null, nextAttemptAt: null, remoteId: null, lastError: null, result: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  const claims = await Promise.all([store.claimOperation(`op:${a.id}`, "w1", 60_000), store.claimOperation(`op:${a.id}`, "w2", 60_000)]);
  assert.equal(claims.filter(Boolean).length, 1);
}

describe("store round trips", () => {
  it("the in-memory store preserves every account and task field", async () => {
    await roundTrip(await fresh());
  });

  it("the Supabase store preserves every field (contract; needs SUPABASE_TEST_URL)", { skip: !process.env.SUPABASE_TEST_URL || !process.env.SUPABASE_TEST_KEY }, async () => {
    const url = process.env.SUPABASE_TEST_URL!;
    assert.ok(!url.includes(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "never-matches"), "refusing to run against the production project");
    const store = new SupabaseStore(url, process.env.SUPABASE_TEST_KEY!);
    assert.equal(await store.schemaVersion(), "5", "apply supabase/migrations 0001..0005 to the test project first");
    await roundTrip(store);
  });
});

describe("integration status", () => {
  let store: Store;
  beforeEach(async () => {
    store = await fresh();
  });

  it("a mock/test adapter is never verified, even with a passing test", async () => {
    const spec = specFor("outreach")!;
    assert.equal(spec.provider, "test");
    await saveTestResult(store, { id: "outreach", provider: "test", fingerprint: fingerprintFor(spec), ok: true, verified: false, message: "ok", at: new Date().toISOString(), by: "test" });
    const c = (await getConnections(store)).find((x) => x.id === "outreach")!;
    assert.equal(c.status, "mock");
    assert.equal(c.lastSuccessAt, null);
  });

  it("credentials alone are Configured; a passing test for that provider makes it Verified; a later failure Degraded", async () => {
    const saved = { outreach: config.providers.outreach, key: config.resend.apiKey, from: config.resend.from };
    const envSaved = { RESEND_API_KEY: process.env.RESEND_API_KEY, RESEND_FROM: process.env.RESEND_FROM };
    try {
      Object.assign(config.providers, { outreach: "resend" });
      Object.assign(config.resend, { apiKey: "re_test_not_real", from: "test@example.com" });
      process.env.RESEND_API_KEY = "re_test_not_real";
      process.env.RESEND_FROM = "test@example.com";
      let c = (await getConnections(store)).find((x) => x.id === "outreach")!;
      assert.equal(c.provider, "resend");
      assert.equal(c.status, "configured");

      const spec = specFor("outreach")!;
      const t0 = new Date(Date.now() - 60_000).toISOString();
      await saveTestResult(store, { id: "outreach", provider: "resend", fingerprint: fingerprintFor(spec), ok: true, verified: true, message: "sent", at: t0, by: "test" });
      c = (await getConnections(store)).find((x) => x.id === "outreach")!;
      assert.equal(c.status, "verified");

      await saveTestResult(store, { id: "outreach", provider: "resend", fingerprint: fingerprintFor(spec), ok: false, verified: false, message: "401 invalid key", at: new Date().toISOString(), by: "test" });
      c = (await getConnections(store)).find((x) => x.id === "outreach")!;
      assert.equal(c.status, "degraded", "a failed test after the last success degrades the connection");

      // A result for a different provider or changed settings does not count.
      process.env.RESEND_FROM = "other@example.com";
      await saveTestResult(store, { id: "outreach", provider: "resend", fingerprint: "stale", ok: true, verified: true, message: "sent", at: new Date().toISOString(), by: "test" });
      c = (await getConnections(store)).find((x) => x.id === "outreach")!;
      assert.equal(c.status, "configured");
    } finally {
      Object.assign(config.providers, { outreach: saved.outreach });
      Object.assign(config.resend, { apiKey: saved.key, from: saved.from });
      for (const [k, v] of Object.entries(envSaved)) if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("a runtime delivery failure after the last success marks the connection degraded", async () => {
    const saved = { alerts: config.providers.alerts, hook: config.slack.webhookUrl };
    try {
      Object.assign(config.providers, { alerts: "slack" });
      Object.assign(config.slack, { webhookUrl: "https://hooks.example/not-real" });
      const now = new Date().toISOString();
      const base = { kind: "alert" as const, accountId: null, destination: "slack", attempts: 1, maxAttempts: 5, leaseOwner: null, leaseUntil: null, nextAttemptAt: null, remoteId: null, result: null, createdAt: now };
      await store.ensureOperation({ ...base, id: "alert:1:slack", status: "succeeded", lastError: null, updatedAt: new Date(Date.now() - 120_000).toISOString() });
      await store.ensureOperation({ ...base, id: "alert:2:slack", status: "failed", lastError: "channel_not_found", updatedAt: now });
      const c = (await getConnections(store)).find((x) => x.id === "alerts")!;
      assert.equal(c.status, "degraded");
      assert.match(c.lastError?.message ?? "", /channel_not_found/);
    } finally {
      Object.assign(config.providers, { alerts: saved.alerts });
      Object.assign(config.slack, { webhookUrl: saved.hook });
    }
  });
});
