import { after, before, beforeEach, describe, it } from "node:test";
import { config } from "@/lib/config";
import { resetProviders } from "@/lib/providers";
import { fresh } from "./helpers";
import { runJourney } from "./journey";

describe("definition-of-done journey (memory store + test adapters)", () => {
  const prevCrm = config.providers.crm;
  before(() => {
    Object.assign(config.providers, { crm: "test" });
    resetProviders();
  });
  after(() => {
    Object.assign(config.providers, { crm: prevCrm });
    resetProviders();
  });
  beforeEach(async () => {
    await fresh();
  });

  it("completes import through outcome sync", async () => {
    const store = await fresh();
    const r = await runJourney(store, { faults: false });
    console.log(r.steps.join(" -> "));
  });

  it("completes with provider timeouts and two workers, with one effect per step", async () => {
    const store = await fresh();
    await runJourney(store, { faults: true });
  });
});
