import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { config } from "@/lib/config";
import { angleFor, launchCampaign } from "@/lib/engine/campaign";
import { buildArms, computeResults, conflictFor, ExperimentError, newExperiment, rolloutArm, verdictFor } from "@/lib/engine/experiments";
import { BUILTIN_SEQUENCE_ID, allSequences, loadSequencePlan, newSequence, resolveSequence, setDefaultSequence } from "@/lib/engine/sequences";
import { parseTemplateFile, renderText, TemplateParseError, unknownVariables, validateTemplate } from "@/lib/engine/templates";
import { recordOutcome } from "@/lib/engine/outcomes";
import { getProviders } from "@/lib/providers";
import type { Store } from "@/lib/store";
import { companyPlaybook, experiments as expCol, getSettings, messageTemplates, sequences } from "@/lib/store/collections";
import type { MessageTemplate, Sequence } from "@/lib/types";
import { nowIso, uuid } from "@/lib/util";
import { agentCtx, fresh, makeAccount } from "./helpers";

let store: Store;
beforeEach(async () => {
  store = await fresh();
});

function tpl(patch: Partial<MessageTemplate>): MessageTemplate {
  const now = nowIso();
  return { id: uuid(), name: "T", channel: "email", subject: "Hi {{first_name}}", body: "Body for {{company}}", tags: [], status: "approved", source: "manual", createdBy: "t", updatedBy: "t", createdAt: now, updatedAt: now, ...patch };
}

async function saveSeq(name: string, steps: Sequence["steps"], patch: Partial<Sequence> = {}): Promise<Sequence> {
  const s = { ...newSequence({ name, steps, status: "active" }, "test"), ...patch };
  await sequences.put(s);
  return s;
}

describe("template uploads", () => {
  it("parses .txt with a Subject line, .html, .eml, .csv and .json", () => {
    const txt = parseTemplateFile("intro_email.txt", "Subject: Hello {{first_name}}\n\nHi {{first_name}},\nLine two.");
    assert.equal(txt[0].name, "intro email");
    assert.equal(txt[0].subject, "Hello {{first_name}}");
    assert.equal(txt[0].body, "Hi {{first_name}},\nLine two.");

    const html = parseTemplateFile("a.html", "<html><head><title>From title</title></head><body><p>Hi <b>{{first_name}}</b>,</p><p>See <a href=\"{{page_url}}\">your page</a></p></body></html>");
    assert.equal(html[0].subject, "From title");
    assert.match(html[0].body, /Hi \{\{first_name\}\},\n\nSee your page \(\{\{page_url\}\}\)/);

    const eml = parseTemplateFile("x.eml", 'Subject: From eml\nContent-Type: multipart/alternative; boundary="b1"\n\n--b1\nContent-Type: text/plain\n\nPlain body {{company}}\n--b1\nContent-Type: text/html\n\n<p>html</p>\n--b1--');
    assert.equal(eml[0].subject, "From eml");
    assert.equal(eml[0].body, "Plain body {{company}}");

    const csv = parseTemplateFile("set.csv", 'name,subject,body,channel,tags\nIntro,"Hi, {{first_name}}","Line one\nLine ""two""",email,intro;q4\nNote,,Connect?,linkedin,');
    assert.equal(csv.length, 2);
    assert.equal(csv[0].subject, "Hi, {{first_name}}");
    assert.equal(csv[0].body, 'Line one\nLine "two"');
    assert.deepEqual(csv[0].tags, ["intro", "q4"]);
    assert.equal(csv[1].channel, "linkedin");

    const json = parseTemplateFile("t.json", JSON.stringify([{ name: "J", subject: "S", body: "B", channel: "inmail" }]));
    assert.equal(json[0].channel, "inmail");
    assert.throws(() => parseTemplateFile("x.docx", "..."), TemplateParseError);
  });

  it("flags unknown variables and drops lines whose variables are all empty", () => {
    assert.deepEqual(unknownVariables("Hi {{first_name}} {{frist_name}}"), ["frist_name"]);
    assert.ok(validateTemplate({ channel: "email", subject: "S", body: "{{nope}}" }).some((p) => p.includes("unknown")));
    assert.ok(validateTemplate({ channel: "email", subject: null, body: "x" }).some((p) => p.includes("subject")));
    const out = renderText("Hi {{first_name}},\n\nRelevant: {{proof}}\n\nPage: {{page_url}}", { first_name: "Nina", proof: "", page_url: "https://x" });
    assert.equal(out, "Hi Nina,\n\nPage: https://x");
  });
});

describe("sequences", () => {
  it("resolves experiment arm, then segment rule, then default, then built-in", async () => {
    const a = await makeAccount(store, { industry: "3PL" });
    let list = await allSequences();
    assert.equal(resolveSequence(a, {}, list).sequence.id, BUILTIN_SEQUENCE_ID);
    const def = await saveSeq("Team default", [{ id: "s1", day: 0, channel: "email", title: "Intro", templateId: null }]);
    await setDefaultSequence(def.id);
    list = await allSequences();
    assert.equal(resolveSequence(a, {}, list).sequence.id, def.id);
    const seg = await saveSeq("3PL only", [{ id: "s2", day: 0, channel: "email", title: "Intro", templateId: null }], { appliesTo: { industries: ["3PL"], sizeBands: [], signalKeys: [] }, priority: 5 });
    list = await allSequences();
    assert.equal(resolveSequence(a, {}, list).sequence.id, seg.id);
    assert.equal(resolveSequence(a, { sequenceId: def.id }, list).sequence.id, def.id, "experiment arm wins");
  });

  it("a launch builds tasks from the default sequence's steps and renders your templates", async () => {
    const t = tpl({ name: "Signal intro", subject: "{{company}} question", body: "Hi {{first_name}},\n\nAbout {{company}}.\n\n{{page_url}}" });
    await messageTemplates.put(t);
    const seq = await saveSeq("Two-step", [
      { id: "a", day: 0, channel: "email", title: "Intro from template", templateId: t.id },
      { id: "b", day: 2, channel: "call", title: "Call", templateId: null },
    ]);
    await setDefaultSequence(seq.id);
    const a = await makeAccount(store);
    const launched = await launchCampaign(a, await agentCtx(store));
    assert.equal(launched.campaign?.sequence?.id, seq.id);
    const tasks = (await store.listOutreach({ accountId: a.id })).sort((x, y) => x.step - y.step);
    assert.equal(tasks.length, 2);
    assert.equal(tasks[0].title, "Intro from template");
    assert.equal(tasks[0].subject, `${a.companyName} question`);
    assert.match(tasks[0].body, new RegExp(`Hi Nina,\\n\\nAbout ${a.companyName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    assert.match(tasks[0].body, /\/for\//);
    assert.equal(tasks[1].channel, "call");
    const days = Math.round((new Date(tasks[1].scheduledFor).getTime() - new Date(tasks[0].scheduledFor).getTime()) / 86_400_000);
    assert.equal(days, 2);
  });

  it("in live mode an unapproved template is never sent; the engine writes that step", async () => {
    const t = tpl({ status: "draft", body: "DRAFT {{company}}" });
    await messageTemplates.put(t);
    const seq = await saveSeq("Uses a draft", [{ id: "a", day: 0, channel: "email", title: "Intro", templateId: t.id }], { status: "active" });
    await setDefaultSequence(seq.id);
    const a = await makeAccount(store);
    const prev = config.mode;
    Object.assign(config, { mode: "live" });
    try {
      const plan = await loadSequencePlan(a, (await getSettings()).defaults as never);
      assert.equal(plan.templates.size, 0);
      assert.match(plan.skipped[0].reason, /not approved/);
    } finally {
      Object.assign(config, { mode: prev });
    }
  });
});

describe("playbook and defaults", () => {
  it("your angle for a signal beats the learned one; an explicit override beats both", async () => {
    const a = await makeAccount(store, { signals: [{ key: "technology:spreadsheet_ops", type: "technology", label: "Spreadsheet ops", status: "verified", confidence: 0.9, detectedAt: nowIso(), agent: "research", evidence: [] }] });
    const ctx = await agentCtx(store);
    const pb = { id: "global" as const, positioning: "", toneRules: [], avoid: [], signalAngles: [{ signalKey: "technology:spreadsheet_ops", angle: "Our own angle", talkingPoints: [] }], personas: [], objections: [], updatedAt: nowIso(), updatedBy: "t" };
    assert.equal(angleFor(a, ctx.model, "A", pb), "Our own angle");
    assert.equal(angleFor(a, ctx.model, "A", pb, "Fixed angle"), "Fixed angle");
    assert.notEqual(angleFor(a, ctx.model, "A", null), "Our own angle");
  });

  it("without experiments every campaign launches with the same defaults (no random arms)", async () => {
    const ctx = await agentCtx(store);
    const arms = [];
    for (let i = 0; i < 6; i++) arms.push((await launchCampaign(await makeAccount(store), ctx)).campaign!.arms);
    const d = (await getSettings()).defaults;
    for (const x of arms) {
      assert.equal(x.videoType, d.videoType);
      assert.equal(x.angleVariant, d.angleVariant);
      assert.equal(x.contentFormat, d.contentFormat);
      assert.equal(x.gifting, d.gifting);
    }
  });

  it("assessment invite and no-proof settings change what is actually sent", async () => {
    const ctx = await agentCtx(store);
    const { updateSettings } = await import("@/lib/store/collections");
    await updateSettings({ defaults: { assessmentInvite: true, proofMode: "none" } as never }, "t");
    const a = await makeAccount(store);
    const launched = await launchCampaign(a, ctx);
    assert.equal(launched.campaign?.proofStoryId, null);
    const first = (await store.listOutreach({ accountId: a.id })).sort((x, y) => x.step - y.step)[0];
    assert.match(first.body, /\/assess\//);
  });
});

describe("experimentation lab", () => {
  it("builds a template experiment whose control pins today's step and whose arm changes only that step", async () => {
    const t = tpl({ name: "Challenger intro", subject: "Challenger", body: "CHALLENGER {{company}}" });
    await messageTemplates.put(t);
    const built = await buildArms("template", { templateStep: 1, templateIds: [t.id] }, (await getSettings()).defaults);
    assert.equal(built.arms[0].control, true);
    assert.equal(built.arms[0].config.templateId, null, "control keeps the engine-written step");
    const exp = newExperiment({ ...built, type: "template", segment: { industries: [], sizeBands: [], signalKeys: [], minScore: 0 }, primaryMetric: "meetings_booked", createdBy: "t", status: "running" });
    await expCol.put(exp);
    const ctx = await agentCtx(store);
    let saw = { control: false, challenger: false };
    for (let i = 0; i < 24 && !(saw.control && saw.challenger); i++) {
      const a = await makeAccount(store);
      const launched = await launchCampaign(a, ctx);
      const first = (await store.listOutreach({ accountId: a.id })).sort((x, y) => x.step - y.step)[0];
      if (launched.experiments?.[exp.id] === built.arms[1].key) {
        saw.challenger = true;
        assert.match(first.body, /^CHALLENGER/);
      } else {
        saw.control = true;
        assert.doesNotMatch(first.body, /CHALLENGER/);
      }
    }
    assert.ok(saw.control && saw.challenger, "both arms were exercised");
  });

  it("refuses two running experiments that change the same setting", async () => {
    const d = (await getSettings()).defaults;
    const one = newExperiment({ ...(await buildArms("angle", { angle: "catalog" }, d)), type: "angle", segment: { industries: [], sizeBands: [], signalKeys: [], minScore: 0 }, primaryMetric: "meetings_booked", createdBy: "t", status: "running" });
    const two = newExperiment({ ...(await buildArms("angle", { angle: "Something else entirely" }, d)), type: "angle", segment: { industries: [], sizeBands: [], signalKeys: [], minScore: 0 }, primaryMetric: "meetings_booked", createdBy: "t" });
    const proof = newExperiment({ ...(await buildArms("proof", {}, d)), type: "proof", segment: { industries: [], sizeBands: [], signalKeys: [], minScore: 0 }, primaryMetric: "meetings_booked", createdBy: "t" });
    assert.equal(conflictFor(two, [one, two])?.id, one.id);
    assert.equal(conflictFor(proof, [one, proof]), null, "different settings can run together");
  });

  it("a sequence experiment needs a second sequence, and rolling out makes it the default", async () => {
    const d = (await getSettings()).defaults;
    await assert.rejects(() => buildArms("sequence", { sequenceIds: [] }, d), ExperimentError);
    const challenger = await saveSeq("Challenger cadence", [{ id: "x", day: 0, channel: "email", title: "Intro", templateId: null }]);
    const built = await buildArms("sequence", { sequenceIds: [challenger.id] }, d);
    const exp = newExperiment({ ...built, type: "sequence", segment: { industries: [], sizeBands: [], signalKeys: [], minScore: 0 }, primaryMetric: "meetings_booked", createdBy: "t", status: "running" });
    await expCol.put(exp);
    const r = await rolloutArm(exp, built.arms[1].key, { name: "Exec" });
    assert.match(r.applied, /default sequence/);
    assert.equal((await allSequences()).find((s) => s.isDefault)?.id, challenger.id);
    assert.equal(r.experiment.status, "completed");
  });

  it("rolling out an angle updates the campaign defaults", async () => {
    const built = await buildArms("angle", { angle: "Cut tender rejections before peak" }, (await getSettings()).defaults);
    const exp = newExperiment({ ...built, type: "angle", segment: { industries: [], sizeBands: [], signalKeys: [], minScore: 0 }, primaryMetric: "meetings_booked", createdBy: "t", status: "running" });
    await expCol.put(exp);
    await rolloutArm(exp, "challenger", { name: "Exec" });
    assert.equal((await getSettings()).defaults.angleOverride, "Cut tender rejections before peak");
  });

  it("reads 'collecting' until every arm reaches its sample size", async () => {
    const built = await buildArms("proof", {}, (await getSettings()).defaults);
    const exp = newExperiment({ ...built, type: "proof", segment: { industries: [], sizeBands: [], signalKeys: [], minScore: 0 }, primaryMetric: "meetings_booked", createdBy: "t", status: "running", targetPerArm: 10 });
    await expCol.put(exp);
    for (let i = 0; i < 4; i++) {
      const a = await makeAccount(store, { experiments: { [exp.id]: i % 2 ? "generic" : "control" } });
      if (i === 1) await recordOutcome(store, getProviders(), a, { outcomeType: "meeting_booked", source: "test" });
    }
    const v = verdictFor(exp, await computeResults(store, exp));
    assert.equal(v.state, "collecting");
    assert.equal(v.enrolled, 4);
    assert.equal(v.needed, 20);
  });

  it("reads old experiment types as today's", async () => {
    const { normalizeExperiment } = await import("@/lib/engine/experiments");
    const legacy = { ...newExperiment({ name: "old", hypothesis: "h", type: "angle", segment: { industries: [], sizeBands: [], signalKeys: [], minScore: 0 }, arms: [], primaryMetric: "meetings_booked", createdBy: "t" }), type: "email" as never };
    assert.equal(normalizeExperiment(legacy).type, "angle");
    void companyPlaybook;
  });
});
