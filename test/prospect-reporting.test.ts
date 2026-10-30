import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { applyExperiments, newExperiment, computeResults } from "@/lib/engine/experiments";
import { canonicalOpportunities, pipelineOf } from "@/lib/engine/opportunities";
import { recordOutcome } from "@/lib/engine/outcomes";
import { requestEstimate, requestMeeting } from "@/lib/engine/prospect";
import { getProviders } from "@/lib/providers";
import type { Store } from "@/lib/store";
import { experiments as expCol } from "@/lib/store/collections";
import { fresh, makeAccount } from "./helpers";

let store: Store;
beforeEach(async () => {
  store = await fresh();
});

describe("prospect requests", () => {
  it("a meeting request is recorded as requested with an assigned scheduling task, not as booked", async () => {
    const a = await makeAccount(store);
    const { task, replayed } = await requestMeeting(store, getProviders(), a, { requestId: "req-meeting-0001", name: "Nina Park", email: "nina@example.com" });
    assert.equal(replayed, false);
    assert.equal(task.channel, "meeting");
    assert.equal(task.status, "manual");
    assert.equal(task.assigneeRepId, "rep_test");
    const outcomes = await store.listOutcomes({ accountId: a.id });
    assert.deepEqual(
      outcomes.map((o) => o.outcomeType),
      ["meeting_requested"],
    );
    assert.notEqual((await store.getAccountById(a.id))?.status, "meeting_booked");
  });

  it("a retried submission returns the original task instead of duplicating it", async () => {
    const a = await makeAccount(store);
    const first = await requestMeeting(store, getProviders(), a, { requestId: "req-meeting-0002", name: "Nina", email: "nina@example.com" });
    const again = await requestMeeting(store, getProviders(), a, { requestId: "req-meeting-0002", name: "Nina", email: "nina@example.com" });
    assert.equal(again.replayed, true);
    assert.equal(again.task.id, first.task.id);
    assert.equal((await store.listOutreach({ accountId: a.id })).length, 1);
    assert.equal((await store.listOutcomes({ accountId: a.id })).length, 1);
  });

  it("a confirmed booking is the only thing that records meeting_booked and closes the scheduling task", async () => {
    const a = await makeAccount(store);
    const { task } = await requestMeeting(store, getProviders(), a, { requestId: "req-meeting-0003", name: "Nina", email: "nina@example.com" });
    await recordOutcome(store, getProviders(), (await store.getAccountById(a.id))!, { outcomeType: "meeting_booked", source: "calendly" });
    assert.equal((await store.getAccountById(a.id))?.status, "meeting_booked");
    assert.equal((await store.getOutreach(task.id))?.status, "done");
  });

  it("an estimate request becomes an approval task, never an automatic send", async () => {
    const a = await makeAccount(store);
    const { task } = await requestEstimate(store, a, { requestId: "req-estimate-01", name: "", email: "nina@example.com", inputs: { shipmentsPerMonth: 1200 }, results: { hoursSaved: 31 } });
    assert.equal(task.status, "awaiting_approval");
    assert.match(task.body, /1200/);
  });

  it("two concurrent outcomes are both preserved", async () => {
    const a = await makeAccount(store);
    await Promise.all([
      recordOutcome(store, getProviders(), a, { outcomeType: "replied", source: "test" }),
      recordOutcome(store, getProviders(), a, { outcomeType: "meeting_booked", source: "test" }),
    ]);
    const types = (await store.listOutcomes({ accountId: a.id })).map((o) => o.outcomeType).sort();
    assert.deepEqual(types, ["meeting_booked", "replied"]);
    assert.equal((await store.getAccountById(a.id))?.status, "meeting_booked", "the stronger status wins regardless of order");
  });
});

describe("opportunity reporting", () => {
  it("$100k created then won is one opportunity worth $100k", async () => {
    const a = await makeAccount(store);
    await recordOutcome(store, getProviders(), a, { outcomeType: "opportunity_created", value: 100_000, source: "crm" });
    await recordOutcome(store, getProviders(), (await store.getAccountById(a.id))!, { outcomeType: "deal_won", value: 100_000, source: "crm" });
    const opps = canonicalOpportunities(await store.listOutcomes());
    assert.equal(opps.length, 1);
    assert.equal(opps[0].stage, "won");
    const p = pipelineOf(opps, [a], 50_000);
    assert.equal(p.count, 1);
    assert.equal(p.value, 100_000);
    assert.equal(p.estimated, false);
  });

  it("distinct CRM opportunity ids on one account are counted separately", async () => {
    const a = await makeAccount(store);
    await recordOutcome(store, getProviders(), a, { outcomeType: "opportunity_created", value: 40_000, source: "crm", opportunityId: "crm-1" });
    await recordOutcome(store, getProviders(), a, { outcomeType: "opportunity_created", value: 60_000, source: "crm", opportunityId: "crm-2" });
    const p = pipelineOf(canonicalOpportunities(await store.listOutcomes()), [a], 0);
    assert.equal(p.count, 2);
    assert.equal(p.value, 100_000);
  });

  it("experiment controls apply their configuration too", async () => {
    const exp = newExperiment({
      name: "Angle test",
      hypothesis: "B beats A",
      type: "angle",
      segment: { industries: [], sizeBands: [], signalKeys: [], minScore: 0 },
      arms: [
        { key: "a", name: "Control", share: 0.5, config: { angleVariant: "A" }, control: true },
        { key: "b", name: "Treatment", share: 0.5, config: { angleVariant: "B" }, control: false },
      ],
      primaryMetric: "qualified_pipeline",
      createdBy: "test",
      status: "running",
    });
    await expCol.put(exp);
    let sawControl = false;
    for (let i = 0; i < 20 && !sawControl; i++) {
      const a = await makeAccount(store);
      const r = await applyExperiments(a);
      if (r.assignments[exp.id] === "a") {
        sawControl = true;
        assert.equal(r.overrides.angleVariant, "A");
      }
    }
    assert.ok(sawControl, "at least one account landed in the control arm");
    const results = await computeResults(store, exp);
    assert.ok(results.comparisons.every((c) => !c.significant && c.sampleWarning?.startsWith("significance not computed")), "no significance claim on a pipeline-value metric");
  });
});
