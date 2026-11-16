import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, it } from "node:test";
import { config } from "@/lib/config";
import { buildBuyingGroup } from "@/lib/engine/buying-group";
import { launchCampaign } from "@/lib/engine/campaign";
import { resetCallSyncThrottle, syncTrellusCalls } from "@/lib/engine/call-sync";
import { handleAmplemarketEvent, handleAttioEvent, handleWizaReveal } from "@/lib/engine/vendor-events";
import { getProviders } from "@/lib/providers";
import { effectsOf } from "@/lib/providers/testing";
import { AmplemarketOutreachProvider, employeesFromSize, leadData, peopleToCompanies } from "@/lib/providers/vendors/amplemarket";
import { AttioCrmProvider, employeesFromRange, TrellusAttioDialerProvider, verifyAttioSignature } from "@/lib/providers/vendors/attio";
import { rowToCall } from "@/lib/providers/vendors/trellus";
import { WaterfallEnrichmentProvider } from "@/lib/providers/vendors/waterfall";
import { verifyWizaCallback, WizaEnrichmentProvider } from "@/lib/providers/vendors/wiza";
import type { Store } from "@/lib/store";
import { reps } from "@/lib/store/collections";
import type { Account, Outcome, Person } from "@/lib/types";
import { uuid } from "@/lib/util";
import { agentCtx, fresh, makeAccount } from "./helpers";

// --- A tiny HTTP stub: routes by method + URL pattern and records every request. ---------------

interface Call { method: string; url: string; headers: Record<string, string>; body: unknown }
type Handler = (c: Call) => { status?: number; body: unknown };
let calls: Call[] = [];
let routes: [string, RegExp, Handler][] = [];
const realFetch = globalThis.fetch;

function stub(method: string, url: RegExp, h: Handler | unknown) {
  routes.push([method, url, typeof h === "function" ? (h as Handler) : () => ({ body: h })]);
}
function installFetch() {
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    const call: Call = { method, url, headers, body: init?.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(call);
    const r = routes.find(([m, re]) => m === method && re.test(url));
    if (!r) return new Response(JSON.stringify({ error: `no stub for ${method} ${url}` }), { status: 599 });
    const out = r[2](call);
    return new Response(JSON.stringify(out.body), { status: out.status ?? 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

const saved = { attio: { ...config.attio }, amplemarket: { ...config.amplemarket }, wiza: { ...config.wiza }, trellus: { ...config.trellus }, waterfall: [...config.enrichmentWaterfall] };
let store: Store;
beforeEach(async () => {
  store = await fresh();
  calls = [];
  routes = [];
  installFetch();
  Object.assign(config.attio, { apiKey: "attio_test", webhookSecret: "whsec_attio", defaultOwnerEmail: "owner@cartage.test" });
  Object.assign(config.amplemarket, { apiKey: "amp_test", sequenceId: "seq_123", webhookSecret: "amp_secret" });
  Object.assign(config.wiza, { apiKey: "wiza_test", pollSeconds: 3 });
  Object.assign(config.trellus, { apiKey: "trellus_test", syncHours: 24 });
  resetCallSyncThrottle();
});
afterEach(() => {
  globalThis.fetch = realFetch;
  Object.assign(config.attio, saved.attio);
  Object.assign(config.amplemarket, saved.amplemarket);
  Object.assign(config.wiza, saved.wiza);
  Object.assign(config.trellus, saved.trellus);
  config.enrichmentWaterfall.splice(0, config.enrichmentWaterfall.length, ...saved.waterfall);
});

const rec = (id: string, values: Record<string, unknown[]> = {}, extra: Record<string, unknown> = {}) => ({ data: { id: { record_id: id, object_id: "obj" }, values, ...extra } });

/** A qualified account with a verified four-person buying group. */
async function groupAccount(): Promise<Account> {
  const domain = `ss-${uuid().slice(0, 6)}.example`;
  const a = await makeAccount(store, { domain, contact: null });
  const people: Person[] = [
    { name: "Carla Chen", title: "CFO", seniority: "c_level", email: `carla@${domain}`, phone: "(555) 201-0001" },
    { name: "Dev Patel", title: "Director of Logistics", seniority: "director", email: `dev@${domain}`, phone: "(555) 201-0002" },
    { name: "Tom Ruiz", title: "Transportation Manager", seniority: "manager", email: `tom@${domain}`, phone: "(555) 201-0003" },
    { name: "Pia Moss", title: "Procurement Manager", seniority: "manager", email: `pia@${domain}`, phone: "(555) 201-0004" },
  ];
  const withPeople = (await store.patchAccount(a.id, (cur) => ({ ...cur, facts: { ...cur.facts, people } })))!;
  return (await buildBuyingGroup(store, getProviders(), withPeople, null)).account;
}

// --- Attio ---------------------------------------------------------------------------------

describe("Attio CRM", () => {
  it("writes an outcome as company + person + deal upserts keyed by our opportunity id, plus a note", async () => {
    stub("PUT", /\/objects\/companies\/records\?matching_attribute=domains$/, rec("comp_1"));
    stub("PUT", /\/objects\/people\/records\?matching_attribute=email_addresses$/, rec("person_1"));
    stub("PUT", /\/objects\/deals\/records\?matching_attribute=external_deal_id$/, rec("deal_1"));
    stub("POST", /\/notes$/, { data: { id: { note_id: "note_1" } } });
    const a = await makeAccount(store);
    const outcome: Outcome = { id: "out_1", accountId: a.id, outcomeType: "meeting_booked", value: null, notes: "Booked for Tuesday", source: "rep:Sam", createdAt: new Date().toISOString(), opportunityId: null, contactId: "c_1" };
    const r = await new AttioCrmProvider().logOutcome(a, outcome);
    assert.equal(r.remoteId, "deal_1");
    assert.equal(calls[0].headers.authorization, "Bearer attio_test");
    assert.deepEqual((calls[0].body as { data: { values: { domains: string[] } } }).data.values.domains, [a.domain]);
    const deal = calls.find((c) => c.url.includes("/objects/deals/"))!.body as { data: { values: Record<string, unknown> } };
    assert.equal(deal.data.values.external_deal_id, `opp_${a.id}`);
    assert.deepEqual(deal.data.values.stage, [{ status: "In Progress" }]);
    assert.deepEqual(deal.data.values.associated_people, [{ target_object: "people", target_record_id: "person_1" }]);
    assert.deepEqual(deal.data.values.owner, [{ workspace_member_email_address: "owner@cartage.test" }]);
    const note = calls.find((c) => c.url.endsWith("/notes"))!.body as { data: { parent_object: string; parent_record_id: string; content: string } };
    assert.equal(note.data.parent_object, "deals");
    assert.equal(note.data.parent_record_id, "deal_1");
    assert.match(note.data.content, /Booked for Tuesday/);
  });

  it("a reply is a note on the company, with no deal", async () => {
    stub("PUT", /companies\/records/, rec("comp_1"));
    stub("PUT", /people\/records/, rec("person_1"));
    stub("POST", /\/notes$/, { data: { id: { note_id: "note_9" } } });
    const a = await makeAccount(store);
    await new AttioCrmProvider().logOutcome(a, { id: "o", accountId: a.id, outcomeType: "replied", value: null, notes: null, source: "api", createdAt: new Date().toISOString() });
    assert.ok(!calls.some((c) => c.url.includes("/deals/")));
    assert.equal((calls.at(-1)!.body as { data: { parent_object: string } }).data.parent_object, "companies");
  });

  it("turns past deals into training history with the deal's people as the buying group", async () => {
    stub("POST", /\/objects\/deals\/records\/query$/, {
      data: [
        { id: { record_id: "d1" }, created_at: "2026-01-02T00:00:00Z", values: { stage: [{ status: { title: "Won 🎉" }, active_from: "2026-03-01T00:00:00Z" }], value: [{ currency_value: 120000 }], associated_company: [{ target_record_id: "c1" }], associated_people: [{ target_record_id: "p1" }, { target_record_id: "p2" }] } },
        { id: { record_id: "d2" }, created_at: "2026-02-02T00:00:00Z", values: { stage: [{ status: { title: "Lost" } }], associated_company: [{ target_record_id: "c1" }], associated_people: [] } },
        { id: { record_id: "d3" }, values: { stage: [{ status: { title: "Some custom stage" } }] } },
      ],
    });
    stub("GET", /\/objects\/companies\/records\/c1$/, rec("c1", { name: [{ value: "Acme Steel" }], categories: [{ option: { title: "Steel Fabrication" } }], employee_range: [{ option: { title: "251-1K" } }] }));
    stub("GET", /\/objects\/people\/records\/p1$/, rec("p1", { job_title: [{ value: "VP of Supply Chain" }] }));
    stub("GET", /\/objects\/people\/records\/p2$/, rec("p2", { job_title: [{ value: "Transportation Manager" }] }));
    const h = await new AttioCrmProvider().exportHistorical();
    assert.equal(h.length, 2, "unknown stages are skipped");
    const won = h.find((r) => r.id === "attio_d1")!;
    assert.equal(won.outcome, "won");
    assert.equal(won.industry, "Steel Fabrication");
    assert.equal(won.employeeCount, 626);
    assert.equal(won.dealValue, 120000);
    assert.deepEqual(won.contacts!.map((c) => c.role).sort(), ["champion", "economic_buyer"]);
    assert.ok(won.contacts!.every((c) => c.influenced && c.inWin && c.contactedOrder === null));
    assert.equal(h.find((r) => r.id === "attio_d2")!.outcome, "lost");
    assert.equal(employeesFromRange("11-50"), 31);
  });

  it("finds the owner from an open deal created outside this app", async () => {
    stub("POST", /\/objects\/companies\/records\/query$/, { data: [{ id: { record_id: "c1" }, values: {} }] });
    stub("POST", /\/objects\/deals\/records\/query$/, { data: [{ id: { record_id: "d1" }, values: { stage: [{ status: { title: "In Progress" } }], owner: [{ referenced_actor_type: "workspace-member", referenced_actor_id: "wm_1" }] } }] });
    stub("GET", /\/workspace_members$/, { data: [{ id: { workspace_member_id: "wm_1" }, first_name: "Jordan", last_name: "Lee", email_address: "jordan@cartage.test" }] });
    const owner = await new AttioCrmProvider().ownerOf({ domain: "acme.example" });
    assert.equal(owner, "Jordan Lee");
  });

  it("verifies webhook signatures and records won deals once, without writing them back", async () => {
    const raw = JSON.stringify({ events: [] });
    const sig = createHmac("sha256", "whsec_attio").update(raw).digest("hex");
    assert.ok(verifyAttioSignature(raw, sig));
    assert.ok(!verifyAttioSignature(raw, sig.replace(/.$/, "0")));
    assert.ok(!verifyAttioSignature(raw, null));

    const a = await makeAccount(store);
    stub("GET", /\/objects\/obj_deals\/records\/d1$/, rec("d1", { stage: [{ status: { title: "Won 🎉" } }], external_deal_id: [{ value: `opp_${a.id}` }], value: [{ currency_value: 90000 }] }));
    const ev = { event_type: "record.updated", id: { object_id: "obj_deals", record_id: "d1" } };
    assert.equal((await handleAttioEvent(store, getProviders(), ev)).handled, "deal_won recorded");
    assert.equal((await handleAttioEvent(store, getProviders(), ev)).handled, "already recorded");
    const outs = await store.listOutcomes({ accountId: a.id });
    assert.equal(outs.length, 1);
    assert.equal(outs[0].value, 90000);
    assert.equal((await store.getAccountById(a.id))!.status, "won");
    assert.equal(effectsOf("crm").length, 0, "an outcome from Attio is not synced back to Attio");
  });

  it("queues a Trellus call as an Attio task assigned to the account's rep", async () => {
    await reps.put({ id: "rep_test", name: "Sam Rivera", email: "sam@cartage.test", capacityPerDay: 40, active: true });
    stub("PUT", /companies\/records/, rec("comp_1"));
    stub("PUT", /people\/records/, rec("person_1"));
    stub("POST", /\/tasks$/, { data: { id: { task_id: "task_1" } } });
    const a = await makeAccount(store);
    const r = await new TrellusAttioDialerProvider().queueCall({ account: a, contact: a.contact!, context: "Opened the ROI calculator twice", idempotencyKey: "k" });
    assert.equal(r.externalId, "task_1");
    const task = calls.find((c) => c.url.endsWith("/tasks"))!.body as { data: { content: string; assignees: unknown[]; linked_records: unknown[]; is_completed: boolean } };
    assert.match(task.data.content, /^Call Nina Park \(VP Logistics\)/);
    assert.deepEqual(task.data.assignees, [{ workspace_member_email_address: "sam@cartage.test" }]);
    assert.equal(task.data.linked_records.length, 2);
    assert.equal(task.data.is_completed, false);
  });
});

// --- Amplemarket -----------------------------------------------------------------------------

describe("Amplemarket", () => {
  it("adds each person to the sequence with the engine's copy as lead data", async () => {
    const a = await groupAccount();
    const tom = (await store.listContacts({ accountId: a.id })).find((c) => c.person.name === "Tom Ruiz")!;
    stub("POST", /\/sequences\/seq_123\/leads$/, { total: 1, total_added_to_sequence: 1, already_in_sequence_and_skipped: [] });
    const touches = [
      { id: "t1", accountId: a.id, contactId: tom.id, channel: "email" as const, step: 1, subject: "Acme + spreadsheets", body: "Tom, saw the spreadsheets.", status: "scheduled" as const, scheduledFor: new Date().toISOString(), provider: "pending" },
      { id: "t2", accountId: a.id, contactId: tom.id, channel: "linkedin" as const, step: 2, body: "Tom, sent you a note.", status: "scheduled" as const, scheduledFor: new Date().toISOString(), provider: "pending" },
      { id: "t3", accountId: a.id, contactId: tom.id, channel: "call" as const, step: 3, body: "Call Tom", status: "scheduled" as const, scheduledFor: new Date().toISOString(), provider: "pending" },
    ];
    const r = await new AmplemarketOutreachProvider().launchSequence({ ...a, contact: tom.person }, touches);
    assert.equal(r.sequenceId, "seq_123");
    const body = calls[0].body as { leads: { email: string; data: Record<string, string> }[] };
    assert.equal(body.leads[0].email, tom.person.email);
    assert.equal(body.leads[0].data.first_name, "Tom");
    assert.equal(body.leads[0].data.oi_contact_id, tom.id);
    assert.equal(body.leads[0].data.oi_step_1_subject, "Acme + spreadsheets");
    assert.equal(body.leads[0].data.oi_step_2_body, "Tom, sent you a note.");
    assert.ok(Object.keys(body.leads[0].data).every((k) => /^[a-z][a-z0-9_]*$/.test(k)), "snake_case keys");
    assert.equal(r.touches.find((t) => t.id === "t3")!.provider, "pending", "calls stay with the rep");
    assert.equal(leadData({ ...a, contact: tom.person }, [{ ...touches[0], body: "x".repeat(2000) }]).oi_step_1_body.length, 1024);
  });

  it("reports leads Amplemarket skipped instead of pretending they are scheduled", async () => {
    const a = await groupAccount();
    stub("POST", /\/leads$/, { total: 1, total_added_to_sequence: 0, recently_contacted_and_skipped: [{ email: "x" }] });
    const r = await new AmplemarketOutreachProvider().launchSequence(a, [{ id: "t1", accountId: a.id, channel: "email", step: 1, body: "b", status: "scheduled", scheduledFor: new Date().toISOString(), provider: "pending" }]);
    assert.equal(r.touches[0].status, "skipped");
    assert.match(r.touches[0].note ?? "", /recently contacted/);
  });

  it("refuses to pretend it can pause a lead", async () => {
    const a = await makeAccount(store);
    await assert.rejects(new AmplemarketOutreachProvider().pauseSequence(a), /cannot pause a lead/);
  });

  it("routes replies, out-of-office and wrong-person labels to the right person", async () => {
    const a = await groupAccount();
    await store.upsertAccount(await launchCampaign(a, await agentCtx(store)));
    const group = await store.listContacts({ accountId: a.id });
    const tom = group.find((c) => c.person.name === "Tom Ruiz")!;
    const pia = group.find((c) => c.person.name === "Pia Moss")!;
    const dev = group.find((c) => c.person.name === "Dev Patel")!;

    const ooo = await handleAmplemarketEvent(store, getProviders(), { is_reply: true, labels: ["OOO"], from: pia.person.email, additional_info: { return_date: "2026-12-01" } });
    assert.equal(ooo.handled, "out of office");
    assert.equal((await store.getContact(pia.id))!.engagement.replied, false, "an auto-reply is not a reply");
    assert.equal((await store.getContact(pia.id))!.status, "paused");

    const reply = await handleAmplemarketEvent(store, getProviders(), { is_reply: true, labels: ["interested"], dynamic_fields: { oi_contact_id: tom.id }, subject: "Re: hi" });
    assert.equal(reply.contactId, tom.id);
    assert.equal((await store.getContact(tom.id))!.engagement.replied, true);
    assert.ok((await store.listEvents({ accountId: a.id })).some((e) => e.eventType === "email_reply" && e.properties.contactId === tom.id));

    const wrong = await handleAmplemarketEvent(store, getProviders(), { is_reply: true, labels: ["not_the_right_person"], from: `Dev <${dev.person.email}>` });
    assert.equal(wrong.handled, "wrong person replaced");
    assert.ok(["rejected", "replaced"].includes((await store.getContact(dev.id))!.status));

    const unknown = await handleAmplemarketEvent(store, getProviders(), { is_reply: true, from: "stranger@nowhere.example" });
    assert.equal(unknown.matched, false);
  });

  it("marks the matching task sent when Amplemarket runs a step", async () => {
    const a = await groupAccount();
    await store.upsertAccount(await launchCampaign(a, await agentCtx(store)));
    const carla = (await store.listContacts({ accountId: a.id })).find((c) => c.person.name === "Carla Chen")!;
    const r = await handleAmplemarketEvent(store, getProviders(), { is_reply: false, to: [carla.person.email], sequence_stage: { index: 1, type: "email" }, date: "2026-11-16T15:00:00Z", subject: "Hello" });
    assert.equal(r.handled, "email step sent");
    const first = (await store.listOutreach({ accountId: a.id })).filter((t) => t.contactId === carla.id && t.channel === "email").sort((x, y) => x.step - y.step)[0];
    assert.equal(first.status, "sent");
    assert.equal((await store.getContact(carla.id))!.outreach.touchesSent, 1);
  });

  it("groups people search results into companies with their buying-group candidates", () => {
    const facts = peopleToCompanies([
      { name: "Ana Ruiz", title: "VP of Supply Chain", email: "ana@acme.com", company: { name: "Acme", website: "https://www.acme.com/", industry: "Food", size: "201-500 employees" }, phone_numbers: [{ number: "+15550001", type: "office", is_wrong_number: false }, { number: "+15550002", type: "mobile", is_dnc_listed: true }] },
      { name: "Bo Lee", title: "Transportation Manager", company: { name: "Acme", website: "acme.com" } },
      { name: "No Company", title: "CFO" },
    ]);
    assert.equal(facts.length, 1);
    assert.equal(facts[0].domain, "acme.com");
    assert.equal(facts[0].employeeCount, 351);
    assert.equal(facts[0].people.length, 2);
    assert.equal(facts[0].people[0].phone, "+15550001", "do-not-call numbers are dropped");
    assert.equal(facts[0].people[0].seniority, "vp");
    assert.equal(employeesFromSize("10001+ employees"), 10001);
  });
});

// --- Wiza ----------------------------------------------------------------------------------

describe("Wiza", () => {
  const finished = { id: 77, status: "finished", is_complete: true, email: "dev@acme.com", email_status: "valid", email_type: "work", mobile_phone: "+1 555 777 0001", phone_status: "found", linkedin_profile_url: "https://linkedin.com/in/dev" };

  it("starts a reveal, polls until finished and counts only a valid email and a found phone", async () => {
    let polls = 0;
    stub("POST", /wiza\.co\/api\/individual_reveals$/, { data: { id: 77, status: "queued" } });
    stub("GET", /wiza\.co\/api\/individual_reveals\/77$/, () => ({ body: { data: polls++ ? finished : { id: 77, status: "resolving" } } }));
    const a = await makeAccount(store);
    const r = await new WizaEnrichmentProvider().enrichContact({ name: "Dev Patel", title: "Director of Logistics", seniority: "director" }, a, { contactId: "c_1" });
    const start = calls[0].body as { individual_reveal: Record<string, string>; enrichment_level: string };
    assert.deepEqual(start.individual_reveal, { full_name: "Dev Patel", domain: a.domain });
    assert.equal(start.enrichment_level, "full");
    assert.equal(r.complete, true);
    assert.equal(r.contact.email, "dev@acme.com");
    assert.equal(r.phoneVerified, true);
    assert.equal(r.contact.phone, "+1 555 777 0001");
  });

  it("does not trust a risky email, and stops on billing problems", async () => {
    stub("POST", /individual_reveals$/, { data: { ...finished, email_status: "risky", phone_status: "unfound", mobile_phone: null } });
    const a = await makeAccount(store);
    const r = await new WizaEnrichmentProvider().enrichContact({ name: "X Y", title: "CFO", seniority: "c_level" }, a);
    assert.equal(r.contact.email, undefined);
    assert.equal(r.phoneVerified, false);
    routes = [];
    stub("POST", /individual_reveals$/, { data: { id: 1, status: "failed", fail_error: "billing_issue" } });
    await assert.rejects(new WizaEnrichmentProvider().enrichContact({ name: "X Y", title: "CFO", seniority: "c_level" }, a), /billing issue/);
  });

  it("checks the callback key and applies a late reveal to the person", async () => {
    const key = createHash("sha256").update("wiza_test").digest("hex");
    assert.ok(verifyWizaCallback(key));
    assert.ok(!verifyWizaCallback("nope"));
    const a = await groupAccount();
    const dev = (await store.listContacts({ accountId: a.id })).find((c) => c.person.name === "Dev Patel")!;
    const r = await handleWizaReveal(store, getProviders(), dev.id, { ...finished, id: "77", email: dev.person.email } as never);
    assert.equal(r.handled, "verified");
    const after = (await store.getContact(dev.id))!;
    assert.equal(after.person.phone, "+1 555 777 0001");
    assert.equal(after.person.fieldSources?.phone?.source, "wiza");
  });
});

// --- Waterfall --------------------------------------------------------------------------------

describe("Enrichment waterfall", () => {
  it("asks Amplemarket only for what Wiza missed", async () => {
    stub("POST", /individual_reveals$/, { data: { id: 5, status: "finished", email: "tom@acme.com", email_status: "valid", phone_status: "unfound" } });
    stub("GET", /api\.amplemarket\.com\/people\/find/, { name: "Tom Ruiz", email: "tom@acme.com", phone_numbers: [{ number: "+15550009", type: "mobile" }] });
    const a = await makeAccount(store);
    const r = await new WaterfallEnrichmentProvider(["wiza", "amplemarket"]).enrichContact({ name: "Tom Ruiz", title: "Transportation Manager", seniority: "manager" }, a);
    assert.equal(r.contact.email, "tom@acme.com");
    assert.equal(r.contact.phone, "+15550009");
    assert.equal(r.phoneVerified, true);
    assert.match(r.notes[0], /wiza → amplemarket/);
    assert.match(calls.find((c) => c.url.includes("/people/find"))!.url, /email=tom%40acme\.com/, "Amplemarket gets the email Wiza found");
  });

  it("stops at Wiza when it finds both, and survives one source failing", async () => {
    stub("POST", /individual_reveals$/, { data: { id: 6, status: "finished", email: "a@acme.com", email_status: "valid", mobile_phone: "+1555", phone_status: "found" } });
    const a = await makeAccount(store);
    await new WaterfallEnrichmentProvider(["wiza", "amplemarket"]).enrichContact({ name: "A B", title: "CFO", seniority: "c_level" }, a);
    assert.ok(!calls.some((c) => c.url.includes("amplemarket")), "no paid lookup when nothing is missing");

    routes = [];
    calls = [];
    stub("POST", /individual_reveals$/, () => ({ status: 500, body: { error: "down" } }));
    stub("GET", /people\/find/, { name: "A B", email: "a@acme.com", phone_numbers: [] });
    const r = await new WaterfallEnrichmentProvider(["wiza", "amplemarket"]).enrichContact({ name: "A B", title: "CFO", seniority: "c_level" }, a);
    assert.equal(r.contact.email, "a@acme.com");
    assert.ok(r.notes.some((n) => /wiza failed/.test(n)));
  });
});

// --- Trellus ------------------------------------------------------------------------------------

describe("Trellus call sync", () => {
  it("maps positional rows and credits each call to the right person once", async () => {
    const a = await groupAccount();
    const tom = (await store.listContacts({ accountId: a.id })).find((c) => c.person.name === "Tom Ruiz")!;
    const row = ["sess_1", 1794700000, 312, "Tom Ruiz", "+1 (555) 201-0003", "Connected", "Wants pricing for 3 lanes", true, "u_9"];
    assert.equal(rowToCall(row)!.startedAt.slice(0, 4), "2026");
    stub("POST", /rpt-2\.trellus\.ai\/session-list-v6$/, [row, ["sess_2", 1794700000, 20, "Somebody Else", "+1 555 999 9999", "No answer", null, false, "u_9"]]);
    const r = await syncTrellusCalls(store, getProviders(), { force: true });
    assert.deepEqual({ fetched: r.fetched, recorded: r.recorded, unmatched: r.unmatched }, { fetched: 2, recorded: 1, unmatched: 1 });
    assert.equal(calls[0].headers.authorization, "Bearer trellus_test");
    const ev = (await store.listEvents({ accountId: a.id })).find((e) => e.eventType === "call_completed")!;
    assert.equal(ev.properties.contactId, tom.id);
    assert.equal(ev.properties.disposition, "Connected");
    const task = (await store.listOutreach({ accountId: a.id })).find((t) => t.title?.startsWith("Confirm the meeting with Tom"));
    assert.ok(task && task.contactId === tom.id, "a detected meeting becomes a rep task, not a booking");
    const again = await syncTrellusCalls(store, getProviders(), { force: true });
    assert.equal(again.recorded, 0, "the same session is never recorded twice");
  });
});
