import assert from "node:assert/strict";
import type { AgentContext } from "@/lib/agents/base";
import { getOrBootstrapModel } from "@/lib/agents/runtime";
import { accountFromFacts } from "@/lib/engine/accounts";
import { getProviders, resetProviders } from "@/lib/providers";
import { resetTestControl } from "@/lib/providers/testing";
import { getStore, type Store } from "@/lib/store";
import type { Account, ReadinessReport, User } from "@/lib/types";
import { nowIso, uuid } from "@/lib/util";

export const rep: User = { id: "u_test_bdr", email: "bdr@test.local", name: "Test Rep", role: "bdr", repId: "rep_test" };

/** Fresh in-memory store and test adapters for every test. */
export async function fresh(opts: { ownsScheduling?: boolean } = {}): Promise<Store> {
  const store = getStore();
  assert.equal(store.kind, "memory", "tests must run on the in-memory store");
  await store.reset();
  resetTestControl(opts);
  resetProviders();
  return store;
}

export const READY: ReadinessReport = { ready: true, checks: [], blockers: [], evaluatedAt: nowIso() };

/** A qualified, rep-ready account with a verified contact. */
export async function makeAccount(store: Store, patch: Partial<Account> = {}): Promise<Account> {
  const n = uuid().slice(0, 6);
  const base = accountFromFacts({
    companyName: `Test Freight ${n}`,
    domain: `test-freight-${n}.example`,
    industry: "3PL",
    employeeCount: 400,
    hqCity: "Chicago",
    hqState: "IL",
    jobPostings: [],
    news: [],
    techStack: [],
    painEvidence: [],
    people: [{ name: "Nina Park", title: "VP Logistics", seniority: "vp" }],
    source: "test",
  });
  return store.upsertAccount({
    ...base,
    status: "qualified",
    contact: { name: "Nina Park", title: "VP Logistics", seniority: "vp", email: `nina@test-freight-${n}.example`, phone: "(555) 010-1234", phoneVerified: true, verifiedBy: "test" },
    readiness: READY,
    ownerRepId: "rep_test",
    painHypothesis: "manual carrier coordination",
    messagingAngle: "coordination at volume",
    ...patch,
  });
}

export async function agentCtx(store: Store): Promise<AgentContext & { lines: string[] }> {
  const lines: string[] = [];
  return {
    store,
    providers: getProviders(),
    model: await getOrBootstrapModel(store),
    batchSize: 20,
    log: (l) => lines.push(l),
    activity: () => undefined,
    lines,
  };
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Fast-forward an operation's backoff without resetting its attempt count (what time passing would do). */
export async function makeDue(store: Store, id: string): Promise<void> {
  const op = await store.getOperation(id);
  assert.ok(op, `operation ${id} exists`);
  await store.finishOperation(id, op.leaseOwner ?? "", { nextAttemptAt: new Date(0).toISOString() });
}
