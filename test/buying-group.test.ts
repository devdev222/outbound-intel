import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { config } from "@/lib/config";
import { ContractError, invoke } from "@/lib/contracts/operations";
import { buildBuyingGroup, classifyRole, DEFAULT_PLAN, mapCandidates, planFor } from "@/lib/engine/buying-group";
import { extendGroupOutreach, launchCampaign } from "@/lib/engine/campaign";
import { coverageView, replaceContactCmd } from "@/lib/engine/contact-commands";
import { ACCOUNT_LIMITS, coordinateSchedule } from "@/lib/engine/coordination";
import { logConversation } from "@/lib/engine/conversations";
import { recordEngagement } from "@/lib/engine/engagement";
import { learnBuyingGroups } from "@/lib/engine/learn-buying-group";
import { processDueTouches } from "@/lib/engine/outreach";
import { recordOutcome } from "@/lib/engine/outcomes";
import { completeManually, MESSAGE_CHANNELS } from "@/lib/engine/tasks";
import { getProviders, resetProviders } from "@/lib/providers";
import { effectsOf, failNext } from "@/lib/providers/testing";
import type { Store } from "@/lib/store";
import { suppressions } from "@/lib/store/collections";
import { generateHistorical } from "@/lib/synthetic/generate";
import type { Account, BuyingContact, Person, ScoringModel, Task, User } from "@/lib/types";
import { uuid } from "@/lib/util";
import { agentCtx, fresh, makeAccount, rep } from "./helpers";

let store: Store;
beforeEach(async () => {
  store = await fresh();
});

const DAY = 86_400_000;
const asUser: User = { id: "machine:test", email: "", name: "Test bridge", role: "admin" };
const machine = (scopes: string[]) => ({ kind: "machine" as const, id: "machine:test", name: "Test bridge", role: "machine" as const, scopes: scopes as never });

function people(domain: string, extra: Person[] = []): Person[] {
  return [
    { name: "Carla Chen", title: "CFO", seniority: "c_level", email: `carla@${domain}` },
    { name: "Dev Patel", title: "Director of Logistics", seniority: "director", email: `dev@${domain}` },
    { name: "Tom Ruiz", title: "Transportation Manager", seniority: "manager", email: `tom@${domain}` },
    { name: "Pia Moss", title: "Procurement Manager", seniority: "manager", email: `pia@${domain}` },
    ...extra,
  ];
}

/** A qualified account with a five-person buying group on file (two possible operational owners). */
async function groupAccount(extra: Person[] = [], patch: Partial<Account> = {}): Promise<Account> {
  const domain = `bg-${uuid().slice(0, 6)}.example`;
  const a = await makeAccount(store, { domain, contact: null, ...patch });
  return (await store.patchAccount(a.id, (cur) => ({ ...cur, facts: { ...cur.facts, people: people(domain, extra) } })))!;
}

async function built(a: Account, model: ScoringModel | null = null) {
  return buildBuyingGroup(store, getProviders(), a, model);
}

const byName = (cs: BuyingContact[], n: string) => cs.find((c) => c.person.name.startsWith(n))!;
const dayOf = (iso: string) => Math.floor(new Date(iso).getTime() / DAY);

describe("buying group: research and verification", () => {
  it("classifies roles from title and seniority, with evidence", () => {
    assert.equal(classifyRole({ title: "CFO", seniority: "c_level" }).role, "economic_buyer");
    assert.equal(classifyRole({ title: "Director of Logistics", seniority: "director" }).role, "operational_owner");
    assert.equal(classifyRole({ title: "Transportation Manager", seniority: "manager" }).role, "champion");
    assert.equal(classifyRole({ title: "Procurement Manager", seniority: "manager" }).role, "supporting");
    assert.match(classifyRole({ title: "CFO", seniority: "c_level" }).evidence[0], /CFO/);
  });

  it("an account holds four independently verified contacts with stable ids", async () => {
    const a = await groupAccount();
    const r = await built(a);
    assert.equal(r.selected.length, 4);
    assert.deepEqual(new Set(r.selected.map((c) => c.role)), new Set(DEFAULT_PLAN.roles));
    for (const c of r.selected) {
      assert.ok(c.ready, `${c.person.name} ready`);
      assert.ok(c.verification.checkedAt, "verified individually");
      assert.equal(c.verification.employment?.ok, true);
      assert.ok(c.selectedReason, "why this person");
    }
    assert.equal(effectsOf("enrich", a.id).length, 4, "one verification per person");
    assert.equal(r.coverage.gaps.length, 0);
    assert.equal(r.account.primaryContactId, byName(r.selected, "Dev").id, "operational owner leads by default");
    assert.equal(r.account.contact?.name, "Dev Patel", "account.contact mirrors the primary person");
    // Re-running is idempotent: same ids, no duplicate people.
    const again = await built(r.account);
    assert.deepEqual(again.selected.map((c) => c.id).sort(), r.selected.map((c) => c.id).sort());
    assert.equal((await store.listContacts({ accountId: a.id })).length, 4);
  });

  it("only two verify: two contacts plus explicit coverage gaps; retries close the gaps", async () => {
    const a = await groupAccount();
    failNext("enrich", 2);
    const r = await built(a);
    assert.equal(r.selected.length, 2);
    assert.equal(r.coverage.gaps.length, 2);
    for (const g of r.coverage.gaps) assert.match(g.reason, /not verified yet.*verification failed/);
    assert.match(r.coverage.summary, /2 of 4 roles covered; missing/);
    // Backoff elapses; the verification agent retries and coverage fills.
    for (const c of await store.listContacts({ accountId: a.id })) if (c.verification.lastError) await store.patchContact(c.id, (x) => ({ ...x, verification: { ...x.verification, nextAttemptAt: new Date(0).toISOString() } }));
    const r2 = await built(r.account);
    assert.equal(r2.selected.length, 4);
    assert.equal(r2.coverage.gaps.length, 0);
  });

  it("suppressed, duplicate and stale people never verify", async () => {
    const domain = `bg-${uuid().slice(0, 6)}.example`;
    await suppressions.put({ id: uuid(), target: `pia@${domain}`, reason: "opt_out", note: null, createdBy: "test", at: new Date().toISOString() });
    const a = await makeAccount(store, { domain, contact: null });
    await store.patchAccount(a.id, (cur) => ({ ...cur, facts: { ...cur.facts, people: people(domain) } }));
    const r = await built((await store.getAccountById(a.id))!);
    const pia = byName(await store.listContacts({ accountId: a.id }), "Pia");
    assert.equal(pia.ready, false);
    assert.equal(pia.verification.suppressed, true);
    assert.ok(r.coverage.gaps.some((g) => g.role === "supporting"));
  });

  it("legacy single-contact accounts migrate: the contact becomes primary and keeps their tasks", async () => {
    const a = await makeAccount(store);
    const launched = await launchCampaign(a, await agentCtx(store));
    await store.upsertAccount(launched);
    const before = await store.listOutreach({ accountId: a.id });
    assert.ok(before.every((t) => !t.contactId), "pre-migration tasks have no person");
    const created = await mapCandidates(store, (await store.getAccountById(a.id))!);
    const nina = created.find((c) => c.person.name === "Nina Park")!;
    assert.equal(nina.source, "legacy");
    assert.equal((await store.getAccountById(a.id))!.primaryContactId, nina.id);
    assert.ok((await store.listOutreach({ accountId: a.id })).every((t) => t.contactId === nina.id), "history attributed to the person");
  });
});

describe("buying group: coordinated outreach", () => {
  it("staggers, personalizes by role and keeps account-wide limits", async () => {
    const r = await built(await groupAccount());
    const launched = await launchCampaign(r.account, await agentCtx(store));
    const tasks = (await store.listOutreach({ accountId: launched.id })).filter((t) => t.source === "sequence");
    const ids = new Set(r.selected.map((c) => c.id));
    assert.ok(tasks.length >= 20);
    assert.ok(tasks.every((t) => t.contactId && ids.has(t.contactId)), "every task belongs to one person");
    assert.equal(new Set(tasks.map((t) => t.step)).size, tasks.length, "steps are unique across the group");
    // Stagger: each person starts in plan order, never before their offset.
    const starts = r.selected.map((c) => Math.min(...tasks.filter((t) => t.contactId === c.id).map((t) => new Date(t.scheduledFor).getTime())));
    for (let i = 1; i < starts.length; i++) assert.ok(starts[i] > starts[i - 1], "later people start later");
    // No two people at the company get a message the same day; at most N per 7 days.
    const msgs = tasks.filter((t) => MESSAGE_CHANNELS.includes(t.channel));
    const perDay = new Map<number, Set<string>>();
    for (const t of msgs) perDay.set(dayOf(t.scheduledFor), new Set([...(perDay.get(dayOf(t.scheduledFor)) ?? []), t.contactId!]));
    assert.ok([...perDay.values()].every((s) => s.size <= ACCOUNT_LIMITS.messagesPerDay), "one person per day");
    const days = msgs.map((t) => dayOf(t.scheduledFor));
    for (const d of days) assert.ok(days.filter((x) => x >= d && x < d + 7).length <= ACCOUNT_LIMITS.messagesPerWeek, "weekly cap");
    // Personalized by responsibility.
    const cfoEmail = tasks.filter((t) => t.contactId === byName(r.selected, "Carla").id && t.channel === "email").sort((x, y) => x.step - y.step)[0];
    assert.match(cfoEmail.body, /^Carla,/);
    assert.match(cfoEmail.body, /leadership/);
    assert.match(cfoEmail.title ?? "", /Carla \(economic buyer\)/);
    // Each non-primary person launches under their own durable operation.
    for (const c of r.selected.filter((c) => c.id !== launched.primaryContactId)) assert.equal((await store.getOperation(`launch:${launched.id}:c:${c.id}`))?.status, "succeeded");
  });

  it("delivers each message to its own person", async () => {
    const r = await built(await groupAccount());
    await store.upsertAccount(await launchCampaign(r.account, await agentCtx(store)));
    const tom = byName(r.selected, "Tom");
    const first = (await store.listOutreach({ accountId: r.account.id })).filter((t) => t.contactId === tom.id && t.channel === "email").sort((x, y) => x.step - y.step)[0];
    await store.updateOutreach({ ...first, scheduledFor: new Date(Date.now() - 60_000).toISOString() });
    await processDueTouches(store, getProviders());
    const sent = effectsOf("send", r.account.id).find((e) => e.detail?.includes(tom.person.email!));
    assert.ok(sent, "sent to Tom, not the primary contact");
    assert.equal((await store.getContact(tom.id))!.outreach.touchesSent, 1);
  });

  it("a reply from one person stops their sequence, holds the others and asks the rep to coordinate", async () => {
    const r = await built(await groupAccount());
    await store.upsertAccount(await launchCampaign(r.account, await agentCtx(store)));
    const tom = byName(r.selected, "Tom");
    const tomTask = (await store.listOutreach({ accountId: r.account.id })).find((t) => t.contactId === tom.id)!;
    const res = await recordEngagement(store, getProviders(), (await store.getAccountById(r.account.id))!, { eventType: "email_reply", properties: { touchId: tomTask.id }, source: "provider" });
    assert.equal(res.events[0].properties.contactId, tom.id, "event attributed to Tom");
    const after = await store.listContacts({ accountId: r.account.id });
    assert.equal(byName(after, "Tom").engagement.replied, true);
    for (const o of after.filter((c) => c.id !== tom.id)) assert.equal(o.status, "paused", `${o.person.name} held`);
    const tasks = await store.listOutreach({ accountId: r.account.id });
    assert.ok(tasks.filter((t) => t.contactId === tom.id && t.source === "sequence").every((t) => t.status === "skipped"));
    const coord = tasks.find((t) => t.title?.startsWith("Coordinate: Tom replied"));
    assert.ok(coord && coord.contactId === tom.id && coord.status === "manual");
    // A held person's due task is moved, not sent.
    const devTask = tasks.filter((t) => t.contactId === byName(after, "Dev").id && t.status === "scheduled")[0];
    await store.updateOutreach({ ...devTask, scheduledFor: new Date(Date.now() - 60_000).toISOString() });
    const due = await processDueTouches(store, getProviders());
    assert.ok(due.held >= 1);
    assert.equal(effectsOf("send", r.account.id).length, 0);
  });

  it("an opt-out stops only that person; the group continues", async () => {
    const r = await built(await groupAccount());
    const account = await launchCampaign(r.account, await agentCtx(store));
    await store.upsertAccount(account);
    const pia = byName(r.selected, "Pia");
    await logConversation(store, getProviders(), (await store.getAccountById(account.id))!, { channel: "call", outcome: "opted_out", notes: "take me off your list", contactId: pia.id }, rep);
    assert.equal((await store.getContact(pia.id))!.status, "opted_out");
    assert.ok((await suppressions.list()).some((s) => s.target === pia.person.email));
    const tasks = await store.listOutreach({ accountId: account.id });
    assert.ok(tasks.filter((t) => t.contactId === pia.id && t.source === "sequence").every((t) => t.status === "skipped"));
    assert.ok(tasks.some((t) => t.contactId !== pia.id && t.status === "scheduled"), "others continue");
    assert.ok((await store.getAccountById(account.id))!.buyingGroup!.gaps.some((g) => g.role === "supporting"));
  });

  it("a referral becomes a verified candidate", async () => {
    const r = await built(await groupAccount());
    const tom = byName(r.selected, "Tom");
    const conv = await logConversation(store, getProviders(), r.account, { channel: "call", outcome: "referred", notes: "talk to Sam about lanes", contactId: tom.id, referral: { name: "Sam Ortiz", title: "Logistics Coordinator" } }, rep);
    assert.equal(conv.contactId, tom.id);
    const sam = (await store.listContacts({ accountId: r.account.id })).find((c) => c.person.name === "Sam Ortiz")!;
    assert.equal(sam.source, "referral");
    assert.equal(sam.referredBy, tom.id);
    assert.ok(sam.verification.checkedAt);
  });
});

describe("buying group: replace without losing history", () => {
  it("replaces a wrong contact, keeps their history and gives the replacement their own sequence", async () => {
    const domain = `bg-${uuid().slice(0, 6)}.example`;
    const r = await built(await groupAccount([{ name: "Ari Bloom", title: "VP of Logistics", seniority: "vp", email: `ari@${domain}` }]));
    let account = await launchCampaign(r.account, await agentCtx(store));
    await store.upsertAccount(account);
    const owner = r.selected.find((c) => c.role === "operational_owner")!;
    const ownerTasks = (await store.listOutreach({ accountId: account.id })).filter((t) => t.contactId === owner.id);
    await completeManually(store, ownerTasks.find((t) => t.channel === "email")!.id, rep, "sent from Gmail");
    await recordEngagement(store, getProviders(), (await store.getAccountById(account.id))!, { eventType: "email_open", properties: { contactId: owner.id }, source: "provider" });

    const res = await replaceContactCmd(store, getProviders(), owner.id, "left the company", rep.name, null);
    assert.ok(res.replacement, "the other operational owner takes the role");
    assert.equal(res.replacement!.role, "operational_owner");
    assert.notEqual(res.replacement!.id, owner.id);

    const old = (await store.getContact(owner.id))!;
    assert.equal(old.status, "replaced");
    assert.equal(old.replacedBy, res.replacement!.id);
    assert.equal(old.outreach.touchesSent, 1, "outreach history kept");
    const tasks = await store.listOutreach({ accountId: account.id });
    assert.ok(tasks.some((t) => t.contactId === owner.id && t.status === "sent"), "sent task kept and attributed");
    assert.ok(tasks.filter((t) => t.contactId === owner.id && t.source === "sequence" && t.status !== "sent").every((t) => t.status === "skipped"), "open tasks held");
    assert.ok((await store.listEvents({ accountId: account.id })).some((e) => e.properties.contactId === owner.id), "events kept");
    account = (await store.getAccountById(account.id))!;
    assert.ok(account.rejectedContacts?.some((x) => x.name === owner.person.name));
    assert.equal(account.primaryContactId, res.replacement!.id, "primary moves to the replacement");

    assert.equal(await extendGroupOutreach(account, await agentCtx(store)), 1);
    const theirs = (await store.listOutreach({ accountId: account.id })).filter((t) => t.contactId === res.replacement!.id);
    assert.ok(theirs.length >= 4, "replacement gets a sequence");
    assert.ok(theirs.every((t) => t.scheduledFor >= new Date(Date.now() - DAY).toISOString()), "starting now, not in the past");
    // Never re-selected.
    const again = await built(account);
    assert.ok(!again.selected.some((c) => c.id === owner.id));
    const view = await coverageView(store, account);
    assert.ok(view.history.some((v) => v.contact.id === owner.id));
  });
});

describe("buying group: attribution", () => {
  it("attributes conversations, tasks, outcomes, events and CRM sync to the right person", async () => {
    const prev = config.providers.crm;
    Object.assign(config.providers, { crm: "test" });
    resetProviders();
    try {
      const r = await built(await groupAccount());
      const account = await launchCampaign(r.account, await agentCtx(store));
      await store.upsertAccount(account);
      const carla = byName(r.selected, "Carla");
      const conv = await logConversation(store, getProviders(), (await store.getAccountById(account.id))!, { channel: "call", outcome: "meeting_booked", notes: "CFO wants a cost review", contactId: carla.id }, rep);
      assert.equal(conv.contactId, carla.id);
      const tasks = await store.listOutreach({ accountId: account.id });
      assert.ok(tasks.filter((t) => t.conversationId === conv.id).every((t) => t.contactId === carla.id));
      assert.ok(tasks.filter((t) => t.source === "sequence").every((t) => t.status !== "scheduled"), "meeting stops the group sequence");
      const outcome = (await store.listOutcomes({ accountId: account.id })).find((o) => o.outcomeType === "meeting_booked")!;
      assert.equal(outcome.contactId, carla.id);
      const crm = effectsOf("crm", account.id).at(-1)!;
      assert.match(crm.detail ?? "", new RegExp(`contact=${carla.id} email=${carla.person.email}`));
      // Provider event by email reference.
      const ev = await recordEngagement(store, getProviders(), (await store.getAccountById(account.id))!, { eventType: "linkedin_accept", properties: { personRef: byName(r.selected, "Tom").person.email }, source: "provider" });
      assert.equal(ev.events[0].properties.contactId, byName(r.selected, "Tom").id);
      // The learning loop sees the group: contacted vs helped the deal progress.
      const won = await recordOutcome(store, getProviders(), (await store.getAccountById(account.id))!, { outcomeType: "deal_won", value: 90_000, contactId: carla.id });
      const hist = (await store.getHistorical(`loop_${account.id}`))!;
      assert.ok(won.fedBack);
      assert.ok(hist.contacts && hist.contacts.length >= 4);
      assert.ok(hist.contacts.some((c) => c.role === "economic_buyer" && c.influenced && c.inWin));
      assert.ok(hist.contacts.some((c) => !c.influenced), "contacted is not the same as influenced");
    } finally {
      Object.assign(config.providers, { crm: prev });
      resetProviders();
    }
  });
});

describe("buying group: historical optimization", () => {
  it("learns group size and roles per segment as associations, and plans with it", () => {
    const m = learnBuyingGroups(generateHistorical(600, 42))!;
    assert.match(m.caveat, /not proven causes/);
    const big = m.segments.find((s) => s.segment === "*|1000-4999|*")!;
    const small = m.segments.find((s) => s.segment === "*|50-199|*")!;
    assert.ok(big.recommended.size > 4, `expands for large companies (${big.recommended.size})`);
    assert.ok(small.recommended.size < 4, `reduces for small companies (${small.recommended.size})`);
    assert.ok(m.overall.contactsBefore.win !== null);
    const model = { buyingGroup: m } as ScoringModel;
    const plan = planFor({ industry: "None", employeeCount: 2000, signals: [] } as unknown as Account, model);
    assert.equal(plan.source, "learned");
    assert.equal(plan.targetSize, big.recommended.size);
    assert.ok(plan.evidence.some((e) => /Associations, not proven causes/.test(e)));
    assert.equal(planFor({ industry: "None", employeeCount: 300, signals: [] } as unknown as Account, null).source, "default");
  });

  it("schedules around existing messages without breaking a person's own gaps", () => {
    const at = (d: number) => new Date(Date.UTC(2026, 10, 2 + d, 14)).toISOString();
    const t = (contactId: string, step: number, d: number, channel: Task["channel"] = "email") => ({ id: uuid(), accountId: "a", contactId, channel, step, body: "", status: "scheduled", scheduledFor: at(d), provider: "pending" }) as Task;
    const out = coordinateSchedule([{ contactId: "x", touches: [t("x", 1, 0), t("x", 2, 2)] }], [{ channel: "email", scheduledFor: at(0), status: "sent", sentAt: at(0) }]);
    assert.equal(dayOf(out[0].scheduledFor) - dayOf(at(0)), 1, "moved off the busy day");
    assert.equal(dayOf(out[1].scheduledFor) - dayOf(out[0].scheduledFor), 2, "their own gap kept");
  });
});

describe("buying group: API and MCP contracts", () => {
  it("inspects coverage, replaces people and manages contact tasks with scopes and idempotency", async () => {
    const r = await built(await groupAccount([{ name: "Ari Bloom", title: "VP of Logistics", seniority: "vp" }]));
    const ctx = (scopes: string[]) => ({ store, providers: getProviders(), actor: machine(scopes), user: asUser });
    const cov = (await invoke("get_coverage", { accountId: r.account.id }, ctx(["read"]))) as { group: { contactId: string; role: string }[]; gaps: unknown[]; nextAction: string };
    assert.equal(cov.group.length, 4);
    assert.ok(cov.nextAction);
    const listed = (await invoke("list_contacts", { accountId: r.account.id, status: ["selected"] }, ctx(["read"]))) as { items: unknown[] };
    assert.equal(listed.items.length, 4);

    const target = cov.group.find((c) => c.role === "operational_owner")!.contactId;
    await assert.rejects(invoke("replace_contact", { contactId: target, reason: "wrong person", idempotencyKey: "replace-0001" }, ctx(["read"])), (e: ContractError) => e.code === "forbidden");
    const first = (await invoke("replace_contact", { contactId: target, reason: "wrong person", idempotencyKey: "replace-0001" }, ctx(["contacts:write"]))) as { replacement: { contactId: string } | null };
    const retry = (await invoke("replace_contact", { contactId: target, reason: "wrong person", idempotencyKey: "replace-0001" }, ctx(["contacts:write"]))) as { replacement: { contactId: string } | null };
    assert.deepEqual(retry, first, "same key, same result, acted once");
    assert.ok(first.replacement);
    await assert.rejects(invoke("replace_contact", { contactId: target, reason: "wrong person", idempotencyKey: "replace-0002" }, ctx(["contacts:write"])), (e: ContractError) => e.code === "conflict");

    const champ = cov.group.find((c) => c.role === "champion")!.contactId;
    const task = (await invoke("create_contact_task", { contactId: champ, channel: "call", title: "Call about lanes", idempotencyKey: "task-00001" }, ctx(["tasks:write"]))) as { task: { taskId: string; contactId: string } };
    assert.equal(task.task.contactId, champ);
    const theirs = (await invoke("list_tasks", { accountId: r.account.id, contactId: champ }, ctx(["read"]))) as { items: { taskId: string }[] };
    assert.ok(theirs.items.some((t) => t.taskId === task.task.taskId));

    const conv = (await invoke("log_conversation", { accountId: r.account.id, contactId: champ, channel: "call", outcome: "connected", notes: "good call", idempotencyKey: "conv-000001" }, ctx(["conversations:write"]))) as { contactId: string };
    assert.equal(conv.contactId, champ);
    const held = (await invoke("set_contact_hold", { contactId: cov.group.find((c) => c.role === "supporting")!.contactId, action: "resume", idempotencyKey: "hold-000001" }, ctx(["contacts:write"]))) as { contact: { status: string } };
    assert.equal(held.contact.status, "selected", "a colleague's reply held them; the rep resumes");
    await assert.rejects(invoke("log_outcome", { accountId: r.account.id, contactId: "nope", outcomeType: "replied", idempotencyKey: "out-0000001" }, ctx(["outcomes:write"])), (e: ContractError) => e.code === "not_found");
  });
});
