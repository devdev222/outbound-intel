import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { processDueTouches } from "@/lib/engine/outreach";
import { approveTask, completeManually, createTask, deliverTask, MAX_SEND_ATTEMPTS, primaryActionFor, sendTaskNow, TaskError } from "@/lib/engine/tasks";
import { getProviders } from "@/lib/providers";
import { effectsOf, failNext, testControl } from "@/lib/providers/testing";
import type { Store } from "@/lib/store";
import { fresh, makeAccount, makeDue, rep } from "./helpers";

let store: Store;
beforeEach(async () => {
  store = await fresh();
});

describe("task lifecycle: approval vs delivery", () => {
  it("approval schedules but never marks a task sent", async () => {
    const a = await makeAccount(store);
    const t = await createTask(store, { account: a, channel: "email", title: "Follow up", subject: "Hi", body: "Body", status: "awaiting_approval", source: "conversation" });
    assert.equal(primaryActionFor(t, getProviders()), "review_approve");
    const approved = await approveTask(store, getProviders(), t.id, rep);
    assert.equal(approved.status, "scheduled");
    assert.equal(approved.sentAt, undefined);
    assert.equal(effectsOf("send").length, 0, "approving must not reach the provider");
    const reloaded = await store.getOutreach(t.id);
    assert.equal(reloaded?.status, "scheduled");
  });

  it("only a provider acknowledgment marks a delivered task sent", async () => {
    const a = await makeAccount(store);
    const t = await createTask(store, { account: a, channel: "email", title: "Step 1", subject: "Hi", body: "Body", status: "scheduled", source: "sequence" });
    const r = await sendTaskNow(store, getProviders(), t.id, rep);
    assert.equal(r.state, "sent");
    assert.equal(r.task.status, "sent");
    assert.equal(r.task.completionMode, "provider");
    assert.equal(effectsOf("send", a.id).length, 1);
  });

  it("channels without a sending provider become manual and complete only when a person marks them", async () => {
    const a = await makeAccount(store);
    const t = await createTask(store, { account: a, channel: "linkedin", title: "Connect", body: "Hi Nina", status: "awaiting_approval", source: "sequence" });
    const approved = await approveTask(store, getProviders(), t.id, rep);
    assert.equal(approved.status, "manual");
    assert.equal(primaryActionFor(approved, getProviders()), "mark_sent");
    const done = await completeManually(store, t.id, rep);
    assert.equal(done.status, "sent");
    assert.equal(done.completionMode, "manual");
    await assert.rejects(() => completeManually(store, t.id, rep), TaskError);
  });

  it("the scheduler holds unapproved drafts and sends approved due tasks", async () => {
    const a = await makeAccount(store);
    await createTask(store, { account: a, channel: "email", title: "Draft", subject: "s", body: "b", status: "awaiting_approval", source: "conversation" });
    const due = await createTask(store, { account: a, channel: "email", title: "Due", subject: "s", body: "b", status: "scheduled", source: "rep" });
    const r = await processDueTouches(store, getProviders());
    assert.equal(r.sent, 1);
    assert.equal((await store.getOutreach(due.id))?.status, "sent");
    assert.equal(effectsOf("send").length, 1);
  });
});

describe("provider failures and retries", () => {
  it("a transient failure schedules a retry; success later sends exactly once", async () => {
    const a = await makeAccount(store);
    const t = await createTask(store, { account: a, channel: "email", title: "Step", subject: "s", body: "b", status: "scheduled", source: "sequence" });
    failNext("send", 1, "timeout");
    const first = await deliverTask(store, getProviders(), t, a);
    assert.equal(first.state, "retry_scheduled");
    assert.notEqual(first.task.status, "sent");
    assert.equal((await store.getOutreach(t.id))?.status, "scheduled");
    await store.requeueOperation(`send:${t.id}`);
    const second = await deliverTask(store, getProviders(), (await store.getOutreach(t.id))!, a);
    assert.equal(second.state, "sent");
    assert.equal(effectsOf("send").length, 1);
  });

  it("retries are bounded: the task ends failed and visible", async () => {
    const a = await makeAccount(store);
    const t = await createTask(store, { account: a, channel: "email", title: "Step", subject: "s", body: "b", status: "scheduled", source: "sequence" });
    failNext("send", MAX_SEND_ATTEMPTS + 2, "error");
    let last = await deliverTask(store, getProviders(), t, a);
    for (let i = 1; i < MAX_SEND_ATTEMPTS; i++) {
      await makeDue(store, `send:${t.id}`);
      last = await deliverTask(store, getProviders(), (await store.getOutreach(t.id))!, a);
    }
    assert.equal(last.state, "failed");
    const reloaded = await store.getOutreach(t.id);
    assert.equal(reloaded?.status, "failed");
    assert.ok(reloaded?.lastError);
    assert.equal(primaryActionFor(reloaded!, getProviders()), "retry");
  });

  it("a permanent provider error fails immediately without retry", async () => {
    const a = await makeAccount(store);
    const t = await createTask(store, { account: a, channel: "email", title: "Step", subject: "s", body: "b", status: "scheduled", source: "sequence" });
    failNext("send", 1, "permanent");
    const r = await deliverTask(store, getProviders(), t, a);
    assert.equal(r.state, "failed");
    assert.equal((await store.getOperation(`send:${t.id}`))?.status, "dead");
  });
});

describe("duplicate workers", () => {
  it("two workers delivering the same task produce one external effect", async () => {
    const a = await makeAccount(store);
    const t = await createTask(store, { account: a, channel: "email", title: "Step", subject: "s", body: "b", status: "scheduled", source: "sequence" });
    testControl().delayMs.send = 80;
    const [r1, r2] = await Promise.all([deliverTask(store, getProviders(), t, a), deliverTask(store, getProviders(), t, a)]);
    const states = [r1.state, r2.state].sort();
    assert.deepEqual(states, ["busy", "sent"]);
    assert.equal(effectsOf("send").length, 1);
  });

  it("two schedulers running at once send each due task once", async () => {
    const a = await makeAccount(store);
    for (let i = 0; i < 3; i++) await createTask(store, { account: a, channel: "email", title: `Step ${i}`, subject: "s", body: "b", status: "scheduled", source: "sequence", step: i + 1 });
    testControl().delayMs.send = 40;
    await Promise.all([processDueTouches(store, getProviders()), processDueTouches(store, getProviders())]);
    assert.equal(effectsOf("send").length, 3);
    const tasks = await store.listOutreach({ accountId: a.id });
    assert.ok(tasks.every((t) => t.status === "sent" || t.status === "sending" || t.status === "scheduled"));
    assert.equal(tasks.filter((t) => t.status === "sent").length, 3);
  });
});
