import { allowPlaceholders } from "@/lib/config";
import { messageTemplates, sequences as seqCol } from "@/lib/store/collections";
import type { Account, ExperimentArms, MessageTemplate, Sequence, SequenceChannel, SequenceStep } from "@/lib/types";
import { nowIso, uuid } from "@/lib/util";
import { sizeBandFor } from "./signal-catalog";
import { validateTemplate } from "./templates";

/**
 * Sequences: the team's own cadences. A sequence is an ordered list of steps
 * (day offset, channel, and either one of your templates or "the engine writes
 * it"). Which sequence an account gets:
 *
 *   1. a Lab sequence experiment the account is enrolled in
 *   2. the highest-priority ACTIVE sequence whose segment rule matches
 *   3. the sequence marked default
 *   4. the built-in engine sequence (5 touches over 10 days)
 */

export const BUILTIN_SEQUENCE_ID = "builtin_engine_default";

export const BUILTIN_SEQUENCE: Sequence = {
  id: BUILTIN_SEQUENCE_ID,
  name: "Engine default (5 touches, 10 days)",
  description: "Intro email with the personalized page, LinkedIn note, follow-up email, InMail, break-up email. Every step written by the engine from research and your playbook.",
  steps: [
    { id: "b1", day: 0, channel: "email", title: "Intro email", templateId: null },
    { id: "b2", day: 1, channel: "linkedin", title: "LinkedIn connection note", templateId: null },
    { id: "b3", day: 4, channel: "email", title: "Follow-up email", templateId: null },
    { id: "b4", day: 6, channel: "inmail", title: "InMail", templateId: null },
    { id: "b5", day: 10, channel: "email", title: "Break-up email", templateId: null },
  ],
  status: "active",
  isDefault: false,
  appliesTo: { industries: [], sizeBands: [], signalKeys: [] },
  priority: 0,
  builtIn: true,
  createdBy: "system",
  createdAt: "1970-01-01T00:00:00.000Z",
  updatedAt: "1970-01-01T00:00:00.000Z",
};

export const SEQUENCE_CHANNELS: SequenceChannel[] = ["email", "linkedin", "inmail", "call", "gift"];
export const MAX_STEPS = 12;

/** Stored sequences plus the built-in one (default when nothing else is). */
export async function allSequences(): Promise<Sequence[]> {
  const stored = (await seqCol.list()).filter((s) => s.id !== BUILTIN_SEQUENCE_ID);
  const builtin = { ...BUILTIN_SEQUENCE, isDefault: !stored.some((s) => s.isDefault && s.status === "active") };
  return [builtin, ...stored].sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || (a.status === b.status ? a.name.localeCompare(b.name) : a.status === "active" ? -1 : 1));
}

export function segmentMatches(rule: Sequence["appliesTo"], account: Account): boolean {
  if (rule.industries.length && !rule.industries.includes(account.industry)) return false;
  if (rule.sizeBands.length && !rule.sizeBands.includes(sizeBandFor(account.employeeCount))) return false;
  if (rule.signalKeys.length && !account.signals.some((s) => rule.signalKeys.includes(s.key) && s.status === "verified")) return false;
  return true;
}

const hasRule = (s: Sequence) => s.appliesTo.industries.length + s.appliesTo.sizeBands.length + s.appliesTo.signalKeys.length > 0;

export function resolveSequence(account: Account, arms: Pick<ExperimentArms, "sequenceId">, list: Sequence[]): { sequence: Sequence; reason: string } {
  if (arms.sequenceId) {
    const exp = list.find((s) => s.id === arms.sequenceId && s.status !== "archived");
    if (exp) return { sequence: exp, reason: "Lab experiment arm" };
  }
  const segment = list
    .filter((s) => s.status === "active" && !s.builtIn && hasRule(s) && segmentMatches(s.appliesTo, account))
    .sort((a, b) => b.priority - a.priority)[0];
  if (segment) return { sequence: segment, reason: "matches the sequence's segment rule" };
  const def = list.find((s) => s.isDefault && s.status === "active");
  if (def) return { sequence: def, reason: "default sequence" };
  return { sequence: BUILTIN_SEQUENCE, reason: "built-in default" };
}

export interface SequencePlan {
  sequence: Sequence;
  reason: string;
  /** Templates referenced by the steps that may be sent (approved, or any non-archived draft in demo mode). */
  templates: Map<string, MessageTemplate>;
  /** Steps whose template could not be used, with why (the engine writes those steps). */
  skipped: { step: number; reason: string }[];
}

/** Resolve the sequence for an account (with a template-step experiment applied) and load usable templates. */
export async function loadSequencePlan(account: Account, arms: ExperimentArms): Promise<SequencePlan> {
  const list = await allSequences();
  const { sequence: base, reason } = resolveSequence(account, arms, list);
  let steps = base.steps;
  if (arms.templateStep && arms.templateId !== undefined) {
    steps = steps.map((s, i) => (i + 1 === arms.templateStep ? { ...s, templateId: arms.templateId ?? null } : s));
  }
  const sequence = { ...base, steps };
  const all = new Map((await messageTemplates.list()).map((t) => [t.id, t]));
  const templates = new Map<string, MessageTemplate>();
  const skipped: SequencePlan["skipped"] = [];
  steps.forEach((s, i) => {
    if (!s.templateId) return;
    const t = all.get(s.templateId);
    if (!t || t.status === "archived") skipped.push({ step: i + 1, reason: "template missing or archived" });
    else if (t.status !== "approved" && !allowPlaceholders()) skipped.push({ step: i + 1, reason: `template "${t.name}" is not approved` });
    else if (validateTemplate(t).length) skipped.push({ step: i + 1, reason: `template "${t.name}": ${validateTemplate(t).join("; ")}` });
    else templates.set(t.id, t);
  });
  return { sequence, reason, templates, skipped };
}

// --- Editing --------------------------------------------------------------------------

export interface SequenceInput {
  name: string;
  description?: string;
  steps: Omit<SequenceStep, "id">[] & Partial<Pick<SequenceStep, "id">>[];
  appliesTo?: Sequence["appliesTo"];
  priority?: number;
  status?: Sequence["status"];
}

/** Problems that block saving or activating a sequence. */
export async function validateSequence(input: { steps: SequenceStep[] | SequenceInput["steps"]; status?: Sequence["status"] }): Promise<string[]> {
  const problems: string[] = [];
  const steps = input.steps as SequenceStep[];
  if (!steps.length) problems.push("add at least one step");
  if (steps.length > MAX_STEPS) problems.push(`at most ${MAX_STEPS} steps`);
  const templates = new Map((await messageTemplates.list()).map((t) => [t.id, t]));
  steps.forEach((s, i) => {
    if (s.day < 0 || s.day > 90) problems.push(`step ${i + 1}: day must be between 0 and 90`);
    if (i > 0 && s.day < steps[i - 1].day) problems.push(`step ${i + 1}: days must not go backwards`);
    if (!s.title?.trim()) problems.push(`step ${i + 1}: needs a title`);
    if (s.templateId) {
      const t = templates.get(s.templateId);
      if (!t || t.status === "archived") problems.push(`step ${i + 1}: template not found`);
      else if (t.channel !== s.channel && !(t.channel === "email" && s.channel === "email")) problems.push(`step ${i + 1}: "${t.name}" is a ${t.channel} template, step is ${s.channel}`);
      else if (input.status === "active" && t.status !== "approved" && !allowPlaceholders()) problems.push(`step ${i + 1}: approve "${t.name}" before activating`);
    }
    if (s.channel === "gift" && s.templateId) problems.push(`step ${i + 1}: gift steps do not use templates`);
  });
  return problems;
}

export function normalizeSteps(steps: SequenceInput["steps"]): SequenceStep[] {
  return (steps as Partial<SequenceStep>[]).map((s) => ({
    id: s.id || uuid(),
    day: Math.round(Number(s.day ?? 0)),
    channel: (s.channel ?? "email") as SequenceChannel,
    title: (s.title ?? "").trim(),
    templateId: s.templateId || null,
    note: s.note ?? null,
  }));
}

export function newSequence(input: SequenceInput, by: string): Sequence {
  const now = nowIso();
  return {
    id: uuid(),
    name: input.name.trim(),
    description: input.description?.trim() ?? "",
    steps: normalizeSteps(input.steps),
    status: input.status ?? "draft",
    isDefault: false,
    appliesTo: input.appliesTo ?? { industries: [], sizeBands: [], signalKeys: [] },
    priority: input.priority ?? 0,
    createdBy: by,
    createdAt: now,
    updatedAt: now,
  };
}

/** Make one sequence the default (or clear the stored default to fall back to the built-in one). */
export async function setDefaultSequence(id: string): Promise<void> {
  for (const s of await seqCol.list()) {
    const isDefault = s.id === id;
    if (s.isDefault !== isDefault) await seqCol.put({ ...s, isDefault, updatedAt: nowIso() });
  }
}

/** Human-readable description of a sequence's cadence, e.g. "Email d0 · LinkedIn d1 · Email d4". */
export function cadenceSummary(steps: SequenceStep[]): string {
  const label: Record<SequenceChannel, string> = { email: "Email", linkedin: "LinkedIn", inmail: "InMail", call: "Call", gift: "Gift" };
  return steps.map((s) => `${label[s.channel]} d${s.day}`).join(" · ");
}
