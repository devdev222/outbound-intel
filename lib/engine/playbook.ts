import { companyPlaybook } from "@/lib/store/collections";
import type { CompanyPlaybook, ScoringModel } from "@/lib/types";

/**
 * The team's own playbook. Precedence wherever the engine needs an answer:
 *   your playbook  >  the learned playbook (from won/lost history)  >  the signal catalog
 * It feeds the messaging angle, every Claude prompt that writes copy, talk
 * tracks and follow-ups, and the objection notes reps see on Today.
 */

export const EMPTY_PLAYBOOK: CompanyPlaybook = {
  id: "global",
  positioning: "",
  toneRules: [],
  avoid: [],
  signalAngles: [],
  personas: [],
  objections: [],
  updatedAt: "1970-01-01T00:00:00.000Z",
  updatedBy: "nobody",
};

export async function getPlaybook(): Promise<CompanyPlaybook> {
  const p = await companyPlaybook.get("global");
  return p ? { ...EMPTY_PLAYBOOK, ...p } : EMPTY_PLAYBOOK;
}

export function isPlaybookEmpty(p: CompanyPlaybook): boolean {
  return !p.positioning.trim() && !p.toneRules.length && !p.avoid.length && !p.signalAngles.length && !p.personas.length && !p.objections.length;
}

/** Your angle for a signal, if you wrote one. */
export function playbookAngle(p: CompanyPlaybook | null | undefined, signalKey: string | undefined): string | null {
  if (!p || !signalKey) return null;
  return p.signalAngles.find((a) => a.signalKey === signalKey && a.angle.trim())?.angle.trim() ?? null;
}

/** Where an account's angle comes from, for display. */
export function angleSource(p: CompanyPlaybook | null, model: ScoringModel, signalKey: string | undefined): "playbook" | "learned" | "catalog" {
  if (playbookAngle(p, signalKey)) return "playbook";
  if (signalKey && model.playbook.angles.some((a) => a.signalKey === signalKey)) return "learned";
  return "catalog";
}

/** Persona notes for a contact title (simple keyword match on the persona title). */
export function personaFor(p: CompanyPlaybook | null, title: string | undefined) {
  if (!p || !title) return null;
  const t = title.toLowerCase();
  return p.personas.find((x) => x.title.trim() && t.includes(x.title.trim().toLowerCase())) ?? null;
}

/** The playbook as prompt context for Claude. Empty string when there is nothing to add. */
export function playbookPrompt(p: CompanyPlaybook | null, opts: { signalKey?: string; contactTitle?: string; objections?: boolean } = {}): string {
  if (!p || isPlaybookEmpty(p)) return "";
  const parts: string[] = ["The team's own playbook (follow it; it overrides general advice):"];
  if (p.positioning.trim()) parts.push(`Positioning: ${p.positioning.trim()}`);
  if (p.toneRules.length) parts.push(`Tone rules: ${p.toneRules.join("; ")}`);
  if (p.avoid.length) parts.push(`Never say or do: ${p.avoid.join("; ")}`);
  const sa = opts.signalKey ? p.signalAngles.find((a) => a.signalKey === opts.signalKey) : null;
  if (sa) parts.push(`For this signal, lead with: ${sa.angle}${sa.talkingPoints.length ? `. Talking points: ${sa.talkingPoints.join("; ")}` : ""}`);
  const persona = personaFor(p, opts.contactTitle);
  if (persona) parts.push(`Persona (${persona.title}): cares about ${persona.pains}; angle: ${persona.angle}`);
  if (opts.objections && p.objections.length) parts.push(`Objection handling: ${p.objections.map((o) => `"${o.objection}" -> ${o.response}`).join(" | ")}`);
  return parts.join("\n");
}

/** Objections whose words appear in the notes (for template follow-ups and the rep's view). */
export function matchingObjections(p: CompanyPlaybook | null, text: string): CompanyPlaybook["objections"] {
  if (!p || !text) return [];
  const t = text.toLowerCase();
  return p.objections.filter((o) =>
    o.objection
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 3)
      .some((w) => t.includes(w)),
  );
}
