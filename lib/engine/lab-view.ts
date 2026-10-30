import { config } from "@/lib/config";
import type { Store } from "@/lib/store";
import { messageTemplates } from "@/lib/store/collections";
import type { Experiment, MessageTemplate, Sequence } from "@/lib/types";
import { describeArm, EXPERIMENT_TYPES, forecast, listExperiments, ownedKeys } from "./experiments";
import { allSequences, cadenceSummary } from "./sequences";
import { INDUSTRIES, SIGNAL_CATALOG } from "./signal-catalog";

/** Everything the Lab pages need besides results: wizard options, names for arm descriptions, pace. */
export async function labContext(store: Store) {
  const [experiments, sequences, templates] = await Promise.all([listExperiments(), allSequences(), messageTemplates.list()]);
  const tplMap = new Map<string, MessageTemplate>(templates.map((t) => [t.id, t]));
  const active = sequences.filter((s) => s.status === "active");
  const def = active.find((s) => s.isDefault) ?? sequences[0];
  const running = experiments.filter((e) => e.status === "running");
  const pace = await forecast(store, { segment: { industries: [], sizeBands: [], signalKeys: [], minScore: 0 }, arms: [{ key: "a", name: "", share: 1, config: {}, control: true }] });

  const busyWith = (type: string) => {
    const owns = new Set(EXPERIMENT_TYPES.find((t) => t.type === type)?.owns as string[]);
    return running.find((e) => ownedKeys(e).some((k) => owns.has(k)))?.name ?? null;
  };
  const blocked = (type: string): string | null => {
    if (type === "sequence" && active.filter((s) => !s.isDefault).length === 0) return "Needs a second active sequence";
    if (type === "template" && templates.filter((t) => t.status !== "archived").length === 0) return "Needs at least one template";
    if (type === "landing_page" && !config.calendly.url) return "Needs a Calendly link for the direct-link arm";
    return null;
  };

  const wizard = {
    types: EXPERIMENT_TYPES.map((t) => ({ type: t.type, label: t.label, question: t.question, suggestedMetric: t.suggestedMetric, blocked: blocked(t.type), busyWith: busyWith(t.type) })),
    sequences: active.map((s) => ({ id: s.id, name: s.name, isDefault: s.isDefault, summary: cadenceSummary(s.steps) })),
    defaultSequence: {
      name: def.name,
      steps: def.steps.map((s, i) => ({ step: i + 1, title: s.title, channel: s.channel, current: s.templateId ? (tplMap.get(s.templateId)?.name ?? "missing template") : "engine-written" })),
    },
    templates: templates.filter((t) => t.status !== "archived").map((t) => ({ id: t.id, name: t.name, channel: t.channel, status: t.status })),
    industries: [...INDUSTRIES],
    signals: SIGNAL_CATALOG.filter((s) => s.type !== "intent").map((s) => ({ key: s.key, label: s.label })),
    launchesPerWeek: pace.launchesPerWeek,
  };

  const describe = (e: Experiment): Record<string, string> => Object.fromEntries(e.arms.map((a) => [a.key, describeArm(e, a, { sequences: sequences as Sequence[], templates: tplMap })]));
  return { experiments, wizard, describe };
}
