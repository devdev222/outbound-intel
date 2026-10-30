import { beforeEach, describe, it } from "node:test";
import { fresh } from "./helpers";
import { runJourney } from "./journey";

describe("definition-of-done journey (memory store + test adapters)", () => {
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
