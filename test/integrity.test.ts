import assert from "node:assert/strict";
import { createHmac, generateKeyPairSync, sign as nodeSign } from "node:crypto";
import { beforeEach, describe, it } from "node:test";
import { authenticate } from "@/lib/auth/users";
import { authProblems, demoSignInAllowed, verifyIdToken } from "@/lib/auth/oidc";
import { hashToken, machineFromToken } from "@/lib/auth/machine";
import { config, configProblems } from "@/lib/config";
import { ContractError, invoke } from "@/lib/contracts/operations";
import { rebuildForNewContact } from "@/lib/engine/campaign";
import { isPhoneVerified, mergeContact } from "@/lib/engine/contact-fields";
import { logConversation } from "@/lib/engine/conversations";
import { retryCrmSyncs } from "@/lib/engine/crm-sync";
import { recordEngagement } from "@/lib/engine/engagement";
import { idempotent } from "@/lib/engine/idempotency";
import { recordOutcome } from "@/lib/engine/outcomes";
import { createTask } from "@/lib/engine/tasks";
import { pickContact } from "@/lib/agents/signal-agents";
import { getProviders, resetProviders } from "@/lib/providers";
import { effectsOf, failNext } from "@/lib/providers/testing";
import type { Store } from "@/lib/store";
import { endOfDayIso, dueLabel } from "@/lib/time";
import { pageTokenFor } from "@/lib/util";
import type { User } from "@/lib/types";
import { agentCtx, fresh, makeAccount, makeDue, READY, rep } from "./helpers";

let store: Store;
beforeEach(async () => {
  store = await fresh();
});

const machine = (scopes: string[]) => ({ kind: "machine" as const, id: "machine:test", name: "Test bridge", role: "machine" as const, scopes: scopes as never });
const asUser: User = { id: "machine:test", email: "", name: "Test bridge", role: "admin" };
async function withConfig<T>(patch: () => () => void, fn: () => Promise<T>): Promise<T> {
  const restore = patch();
  try {
    return await fn();
  } finally {
    restore();
  }
}
const liveMode = () => {
  const prev = config.mode;
  Object.assign(config, { mode: "live" });
  return () => Object.assign(config, { mode: prev });
};
const crmTest = () => {
  const prev = config.providers.crm;
  Object.assign(config.providers, { crm: "test" });
  resetProviders();
  return () => {
    Object.assign(config.providers, { crm: prev });
    resetProviders();
  };
};

describe("live-mode sign-in", () => {
  it("refuses demo passwords in live mode and fails closed without OIDC", async () => {
    await withConfig(liveMode, async () => {
      assert.equal(demoSignInAllowed(), false);
      assert.equal(await authenticate("admin@cartage.demo", "demo"), null);
      assert.ok(authProblems().length > 0, "missing OIDC is reported");
      assert.ok(configProblems().some((p) => p.key === "AUTH_PROVIDER"));
    });
    assert.ok(await authenticate("admin@cartage.demo", "demo"), "demo sign-in still works outside live mode");
  });

  it("verifies an OIDC ID token's signature, issuer, audience, expiry and nonce", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const jwk = { ...(publicKey.export({ format: "jwk" }) as Record<string, string>), kid: "k1", alg: "RS256" };
    const mint = (claims: Record<string, unknown>) => {
      const h = Buffer.from(JSON.stringify({ alg: "RS256", kid: "k1" })).toString("base64url");
      const p = Buffer.from(JSON.stringify(claims)).toString("base64url");
      return `${h}.${p}.${nodeSign("RSA-SHA256", Buffer.from(`${h}.${p}`), privateKey).toString("base64url")}`;
    };
    const base = { iss: "https://idp.test", aud: "client-1", exp: Math.floor(Date.now() / 1000) + 300, nonce: "n1", email: "sam@cartage.com", email_verified: true };
    const opts = { issuer: "https://idp.test", clientId: "client-1", nonce: "n1", jwks: { keys: [jwk as never] } };
    assert.equal((await verifyIdToken(mint(base), opts)).email, "sam@cartage.com");
    await assert.rejects(() => verifyIdToken(mint({ ...base, nonce: "other" }), opts), /nonce/);
    await assert.rejects(() => verifyIdToken(mint({ ...base, aud: "someone-else" }), opts), /audience/);
    await assert.rejects(() => verifyIdToken(mint({ ...base, exp: 1000 }), opts), /expired/);
    const tampered = mint(base).replace(/\.[^.]+\./, `.${Buffer.from(JSON.stringify({ ...base, email: "attacker@x.com" })).toString("base64url")}.`);
    await assert.rejects(() => verifyIdToken(tampered, opts), /signature/);
  });

  it("machine tokens resolve to scoped identities by hash only", () => {
    const prev = process.env.MACHINE_IDENTITIES;
    process.env.MACHINE_IDENTITIES = JSON.stringify([{ id: "seq", name: "Sequencer", sha256: hashToken("s3cret-token"), scopes: ["engagement:write"] }]);
    try {
      const m = machineFromToken("s3cret-token");
      assert.equal(m?.id, "machine:seq");
      assert.deepEqual(m?.scopes, ["engagement:write"]);
      assert.equal(machineFromToken("wrong"), null);
    } finally {
      if (prev === undefined) delete process.env.MACHINE_IDENTITIES;
      else process.env.MACHINE_IDENTITIES = prev;
    }
  });
});

describe("public telemetry vs provider events", () => {
  it("public page intent alone cannot activate a rep; an authenticated touch corroborates it", async () => {
    const a = await makeAccount(store, { status: "campaign_live" });
    const r1 = await recordEngagement(store, getProviders(), a, { eventType: "pricing_viewed", visitorId: "v1", source: "page" });
    assert.equal(r1.activationTriggered, false);
    assert.equal((await store.getAccountById(a.id))?.pendingActivation ?? null, null);
    await recordEngagement(store, getProviders(), (await store.getAccountById(a.id))!, { eventType: "email_click", visitorId: "nina@x", source: "provider" });
    const r2 = await recordEngagement(store, getProviders(), (await store.getAccountById(a.id))!, { eventType: "video_75", visitorId: "v1", source: "page" });
    assert.equal(r2.activationTriggered, true);
  });

  it("public telemetry is capped per day so scripted traffic cannot inflate the score", async () => {
    const a = await makeAccount(store, { engagementScore: 0 });
    for (let i = 0; i < 12; i++) await recordEngagement(store, getProviders(), (await store.getAccountById(a.id))!, { eventType: "pricing_viewed", visitorId: `v${i}`, source: "page" });
    assert.ok((await store.getAccountById(a.id))!.engagementScore <= 30);
  });

  it("the tracking endpoint needs the page token, accepts only page events, and ignores repeats", async () => {
    const { POST } = await import("@/app/api/track/route");
    const a = await makeAccount(store);
    const call = (body: Record<string, unknown>) => POST(new Request("http://localhost/api/track", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
    const ok = { slug: a.slug, token: pageTokenFor(a.id), event: "page_view", visitorId: "visitor-1" };
    assert.equal((await call({ ...ok, event: "email_reply" })).status, 400, "provider events are refused");
    assert.equal((await call({ ...ok, token: "zzzzzzzz" })).status, 404, "wrong token");
    assert.equal((await call({ slug: a.slug, event: "page_view", visitorId: "visitor-1" })).status, 400, "token required");
    assert.equal((await call(ok)).status, 200);
    const dup = await (await call(ok)).json();
    assert.equal(dup.deduplicated, true);
    assert.equal((await store.listEvents({ accountId: a.id })).filter((e) => e.eventType === "page_view").length, 1);
  });
});

describe("wrong contact", () => {
  it("invalidates the contact, holds its outreach, reopens research, and rebuilds for the next verified person", async () => {
    const a = await makeAccount(store, { facts: { ...(await makeAccount(store)).facts, people: [{ name: "Nina Park", title: "VP Logistics", seniority: "vp" }, { name: "Omar Diaz", title: "Director of Transportation", seniority: "director" }] } });
    const ctx = await agentCtx(store);
    const launched = await (await import("@/lib/engine/campaign")).launchCampaign(a, ctx);
    await store.upsertAccount(launched);
    const before = await store.listOutreach({ accountId: a.id });
    assert.ok(before.length >= 5);

    await logConversation(store, getProviders(), (await store.getAccountById(a.id))!, { channel: "call", outcome: "wrong_contact", notes: "Nina moved to finance; Omar owns freight" }, rep);
    const after = (await store.getAccountById(a.id))!;
    assert.equal(after.contact, null);
    assert.equal(after.readiness?.ready, false);
    assert.equal(after.status, "needs_enrichment");
    assert.ok(after.contactHold);
    assert.equal(after.rejectedContacts?.[0]?.name, "Nina Park");
    const tasks = await store.listOutreach({ accountId: a.id });
    assert.ok(tasks.every((t) => t.status === "skipped" || t.status === "sent" || t.status === "done"), "contact-specific outreach is held");
    assert.equal(tasks.filter((t) => t.source === "conversation").length, 0, "no follow-up drafted to the wrong person");
    assert.equal(pickContact(after.facts.people, ctx.model, after)?.name, "Omar Diaz", "research never re-picks the rejected person");

    // A different, verified contact arrives and the account is ready again: the sequence is rebuilt, history kept.
    const withNew = (await store.patchAccount(a.id, (cur) => ({ ...cur, contact: mergeContact(null, { name: "Omar Diaz", title: "Director of Transportation", email: "omar@x.example", phone: "+1 555 010 2222", phoneVerified: true }, "test"), readiness: READY, status: "qualified" })))!;
    const rebuilt = await rebuildForNewContact(withNew, ctx);
    assert.equal(rebuilt.contactHold, null);
    assert.equal(rebuilt.campaign?.revision, 1);
    const all = await store.listOutreach({ accountId: a.id });
    assert.ok(all.length > before.length, "old tasks are kept as history; new ones added");
    assert.ok(all.some((t) => t.status === "scheduled" && /Omar/.test(t.body)));
  });
});

describe("idempotency", () => {
  it("a repeated key returns the stored result and never runs twice", async () => {
    let runs = 0;
    const r1 = await idempotent(store, "test", "key-1", async () => ++runs);
    const r2 = await idempotent(store, "test", "key-1", async () => ++runs);
    assert.equal(runs, 1);
    assert.equal(r1.state === "done" && r1.result, 1);
    assert.ok(r2.state === "done" && r2.replayed && r2.result === 1);
  });

  it("a redelivered Resend webhook is processed once", async () => {
    const prev = config.resend.webhookSecret;
    const secret = `whsec_${Buffer.from("test-signing-secret").toString("base64")}`;
    Object.assign(config.resend, { webhookSecret: secret });
    try {
      const { POST } = await import("@/app/api/webhooks/resend/route");
      const a = await makeAccount(store);
      const raw = JSON.stringify({ type: "email.clicked", data: { email_id: "e1", tags: { account_slug: a.slug }, to: ["nina@x"] } });
      const send = () => {
        const id = "msg_1";
        const ts = String(Math.floor(Date.now() / 1000));
        const sig = createHmac("sha256", Buffer.from(secret.replace(/^whsec_/, ""), "base64")).update(`${id}.${ts}.${raw}`).digest("base64");
        return POST(new Request("http://localhost/api/webhooks/resend", { method: "POST", headers: { "svix-id": id, "svix-timestamp": ts, "svix-signature": `v1,${sig}` }, body: raw }));
      };
      assert.equal((await send()).status, 200);
      const second = await (await send()).json();
      assert.equal(second.duplicate, true);
      assert.equal((await store.listEvents({ accountId: a.id })).filter((e) => e.eventType === "email_click").length, 1);
    } finally {
      Object.assign(config.resend, { webhookSecret: prev });
    }
  });

  it("conversation and outcome mutations through the shared contract run once per key", async () => {
    const a = await makeAccount(store);
    const ctx = { store, providers: getProviders(), actor: machine(["conversations:write", "outcomes:write", "read"]), user: asUser };
    const c1 = (await invoke("log_conversation", { accountId: a.id, channel: "call", outcome: "connected", notes: "talked", idempotencyKey: "conv-key-1" }, ctx)) as { conversationId: string };
    const c2 = (await invoke("log_conversation", { accountId: a.id, channel: "call", outcome: "connected", notes: "talked", idempotencyKey: "conv-key-1" }, ctx)) as { conversationId: string };
    assert.equal(c1.conversationId, c2.conversationId);
    const o1 = (await invoke("log_outcome", { accountId: a.id, outcomeType: "opportunity_created", value: 50_000, opportunityId: "crm-opp-9", idempotencyKey: "out-key-1" }, ctx)) as { opportunityId: string };
    await invoke("log_outcome", { accountId: a.id, outcomeType: "opportunity_created", value: 50_000, opportunityId: "crm-opp-9", idempotencyKey: "out-key-1" }, ctx);
    assert.equal(o1.opportunityId, "crm-opp-9");
    assert.equal((await store.listOutcomes({ accountId: a.id })).filter((o) => o.outcomeType === "opportunity_created").length, 1);
  });

  it("contract scopes are enforced; MCP-style read-only callers cannot mutate", async () => {
    const a = await makeAccount(store);
    const ro = { store, providers: getProviders(), actor: machine(["read"]), user: asUser };
    await assert.rejects(() => invoke("log_outcome", { accountId: a.id, outcomeType: "replied", idempotencyKey: "k-123456" }, ro), (e: unknown) => e instanceof ContractError && e.code === "forbidden");
    const page1 = (await invoke("list_accounts", { limit: 1 }, ro)) as { items: unknown[]; nextCursor: string | null };
    await makeAccount(store);
    assert.equal(page1.items.length, 1);
    assert.ok(page1.nextCursor === null || typeof page1.nextCursor === "string");
  });
});

describe("CRM write-back", () => {
  it("is durable: a failed sync retries with the same id and lands exactly once", async () => {
    await withConfig(crmTest, async () => {
      const a = await makeAccount(store);
      failNext("crm", 1, "timeout");
      const r = await recordOutcome(store, getProviders(), a, { outcomeType: "meeting_booked", source: "test" });
      const op = await store.getOperation(`crm:${r.outcome.id}`);
      assert.equal(op?.status, "failed", "the failure is recorded, not dropped");
      assert.equal(effectsOf("crm").length, 0);
      await makeDue(store, `crm:${r.outcome.id}`);
      const retried = await retryCrmSyncs(store, getProviders());
      assert.equal(retried.synced, 1);
      assert.equal(effectsOf("crm").length, 1);
      assert.equal(effectsOf("crm")[0].key, `crm:${r.outcome.id}`, "stable idempotency key per outcome");
      assert.equal((await retryCrmSyncs(store, getProviders())).synced, 0, "nothing left to retry");
    });
  });
});

describe("concurrency and history", () => {
  it("concurrent engagement does not overwrite assignment, pause or other increments", async () => {
    const a = await makeAccount(store, { engagementScore: 0, ownerRepId: "rep_a" });
    const until = new Date(Date.now() + 5 * 86_400_000).toISOString();
    await Promise.all([
      ...Array.from({ length: 5 }, (_, i) => recordEngagement(store, getProviders(), a, { eventType: "email_click", visitorId: `p${i}`, source: "provider" })),
      store.patchAccount(a.id, (cur) => ({ ...cur, ownerRepId: "rep_b" })),
      store.patchAccount(a.id, (cur) => ({ ...cur, pausedUntil: until, pauseReason: "not now" })),
    ]);
    const after = (await store.getAccountById(a.id))!;
    assert.equal(after.ownerRepId, "rep_b");
    assert.equal(after.pausedUntil, until);
    assert.equal(after.engagementScore, 25, "five clicks x 5 points, none lost");
  });

  it("a late outcome never regresses training history", async () => {
    const a = await makeAccount(store);
    await recordOutcome(store, getProviders(), a, { outcomeType: "deal_won", value: 90_000, source: "crm" });
    await recordOutcome(store, getProviders(), (await store.getAccountById(a.id))!, { outcomeType: "meeting_booked", source: "late-calendar-sync" });
    const h = await store.getHistorical(`loop_${a.id}`);
    assert.equal(h?.outcome, "won");
    assert.equal(h?.dealValue, 90_000);
  });
});

describe("contact verification", () => {
  it("phone verification never carries to a different number", () => {
    const v = mergeContact(null, { name: "Nina Park", title: "VP", phone: "(555) 010-1234", phoneVerified: true }, "clay");
    assert.equal(isPhoneVerified(v), true);
    const sameNumber = mergeContact(v, { phone: "+1 555 010 1234" }, "http");
    assert.equal(isPhoneVerified(sameNumber), true, "formatting changes are the same number");
    const changed = mergeContact(v, { phone: "(555) 999-0000" }, "http");
    assert.equal(isPhoneVerified(changed), false);
    assert.equal(changed.fieldSources?.phone?.source, "http");
    const otherPerson = mergeContact(v, { name: "Omar Diaz", email: "omar@x.example" }, "clay");
    assert.equal(otherPerson.phone, undefined, "a different person does not inherit the phone");
  });

  it("the Clay webhook does not mark a new number verified", async () => {
    const prev = config.clay.inboundSecret;
    Object.assign(config.clay, { inboundSecret: "clay-secret" });
    try {
      const { POST } = await import("@/app/api/webhooks/clay/route");
      const a = await makeAccount(store);
      assert.equal(isPhoneVerified(a.contact), true);
      const res = await POST(new Request("http://localhost/api/webhooks/clay", { method: "POST", headers: { "x-webhook-secret": "clay-secret", "content-type": "application/json" }, body: JSON.stringify({ kind: "contact", account_slug: a.slug, full_name: "Nina Park", phone: "(555) 777-8888" }) }));
      assert.equal(res.status, 200);
      const c = (await store.getAccountById(a.id))!.contact;
      assert.equal(c?.phone, "(555) 777-8888");
      assert.equal(isPhoneVerified(c), false);
    } finally {
      Object.assign(config.clay, { inboundSecret: prev });
    }
  });
});

describe("configuration and deadlines", () => {
  it("readiness evaluates the effective enrichment adapter (Jerry over MCP)", async () => {
    const prev = { ...config.jerry };
    await withConfig(liveMode, async () => {
      Object.assign(config.jerry, { mode: "mcp", mcpUrl: "https://jerry.internal/mcp" });
      try {
        assert.ok(!configProblems().some((p) => p.key === "ENRICHMENT_PROVIDER"), "Jerry over MCP counts as real enrichment");
        Object.assign(config.jerry, { mcpUrl: "", mcpCommand: "" });
        assert.ok(configProblems().some((p) => p.key === "JERRY_MCP_URL"));
      } finally {
        Object.assign(config.jerry, prev);
      }
    });
  });

  it("'due today' ends at midnight in the rep's timezone, not the server's", () => {
    const now = new Date("2026-11-02T03:30:00Z"); // 9:30 PM Nov 1 in Chicago (CST)
    assert.equal(endOfDayIso("America/Chicago", now), "2026-11-02T05:59:59.999Z");
    assert.equal(endOfDayIso("UTC", now), "2026-11-02T23:59:59.999Z");
    assert.equal(dueLabel("2026-11-02T15:00:00Z", "America/Chicago", now).text, "due tomorrow 9:00 AM");
    assert.equal(dueLabel("2026-10-30T15:00:00Z", "America/Chicago", now).overdue, true);
  });

  it("tasks created for a held contact are excluded from new outreach", async () => {
    const a = await makeAccount(store);
    await createTask(store, { account: a, channel: "email", title: "x", subject: "s", body: "b", status: "scheduled", source: "sequence" });
    await logConversation(store, getProviders(), a, { channel: "call", outcome: "wrong_contact", notes: "" }, rep);
    const { processDueTouches } = await import("@/lib/engine/outreach");
    await processDueTouches(store, getProviders());
    assert.equal(effectsOf("send", a.id).length, 0);
  });
});

describe("deadline formatting", () => {
  it("formats an absolute deadline with its timezone without throwing", async () => {
    const { formatInTz } = await import("@/lib/time");
    assert.match(formatInTz("2026-11-02T15:00:00Z", "America/Chicago"), /Nov 2, 2026.*9:00.*CST/);
  });
});
