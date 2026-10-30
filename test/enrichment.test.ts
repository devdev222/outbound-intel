import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { config } from "@/lib/config";
import { enrichAccountContact } from "@/lib/engine/enrichment";
import { evaluateReadiness, nextActionFor } from "@/lib/engine/readiness";
import { MockEnrichmentProvider } from "@/lib/providers/enrichment";
import { getProviders } from "@/lib/providers";
import { failNext } from "@/lib/providers/testing";
import { getOrBootstrapModel } from "@/lib/agents/runtime";
import { DEFAULT_SETTINGS } from "@/lib/store/collections";
import type { Store } from "@/lib/store";
import { fresh, makeAccount } from "./helpers";

let store: Store;
beforeEach(async () => {
  store = await fresh();
});

describe("contact enrichment", () => {
  it("a failed enrichment leaves a visible blocker with the error and the retry time", async () => {
    const a = await makeAccount(store, { status: "needs_enrichment" });
    failNext("enrich", 1, "timeout");
    const r = await enrichAccountContact(store, getProviders(), a, a.contact!);
    assert.equal(r.ok, false);
    const saved = (await store.getAccountById(a.id))!;
    assert.match(saved.enrichment?.lastError ?? "", /timed out/);
    assert.ok(saved.enrichment?.nextAttemptAt, "a bounded retry is scheduled");
    const model = await getOrBootstrapModel(store);
    const report = evaluateReadiness(saved, { model, settings: DEFAULT_SETTINGS.automation, crmOwner: null, suppressed: false });
    assert.equal(report.ready, false);
    assert.ok(report.blockers.some((b) => b.startsWith("Contact enrichment")));
    assert.equal(nextActionFor(saved, report).label, "Enrichment failed");
  });

  it("synthetic contacts never pass readiness in live mode", async () => {
    const a = await makeAccount(store, { contact: { name: "Nina Park", title: "VP Logistics", seniority: "vp", email: "nina@x.example", verifiedBy: "synthetic" } });
    const model = await getOrBootstrapModel(store);
    const live = evaluateReadiness(a, { model, settings: DEFAULT_SETTINGS.automation, crmOwner: null, suppressed: false, live: true });
    assert.equal(live.checks.find((c) => c.key === "contact")?.pass, false);
    const demo = evaluateReadiness(a, { model, settings: DEFAULT_SETTINGS.automation, crmOwner: null, suppressed: false, live: false });
    assert.equal(demo.checks.find((c) => c.key === "contact")?.pass, true);
  });

  it("the mock enrichment adapter refuses to run in live mode", async () => {
    const a = await makeAccount(store);
    const prev = config.mode;
    Object.assign(config, { mode: "live" });
    try {
      await assert.rejects(() => new MockEnrichmentProvider().enrichContact(a.contact!, a));
    } finally {
      Object.assign(config, { mode: prev });
    }
  });
});
