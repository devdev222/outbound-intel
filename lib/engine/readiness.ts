import type { Store } from "@/lib/store";
import { isSuppressed, reps as repCol } from "@/lib/store/collections";
import type { Account, AutomationSettings, NextAction, ReadinessCheck, ReadinessReport, Rep, ScoringModel } from "@/lib/types";
import { nowIso } from "@/lib/util";
import { icpScore } from "./scoring";

/**
 * Prospect Readiness Engine. Before an account can enter a BDR's queue it must
 * pass every check below; otherwise it goes back to enrichment with explicit
 * blockers the agents (and reps) can act on. Readiness is re-evaluated every
 * time the Scoring Agent runs, so a verified phone from Jerry or a new signal
 * from Research flips the account into the queue automatically.
 */

export interface ReadinessContext {
  model: ScoringModel;
  settings: AutomationSettings;
  crmOwner: string | null;
  suppressed: boolean;
}

export function daysSince(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / 86_400_000;
}

export function evaluateReadiness(account: Account, ctx: ReadinessContext): ReadinessReport {
  const checks: ReadinessCheck[] = [];
  const c = account.contact;
  const fit = icpScore(
    { signals: account.signals, industry: account.industry, employeeCount: account.employeeCount, contact: c, peopleCount: account.facts.people.length, painEvidenceCount: account.facts.painEvidence.length },
    ctx.model,
  );
  checks.push({ key: "icp_fit", label: "ICP fit", pass: fit >= 35, detail: `ICP similarity ${Math.round(fit)}/100${fit < 35 ? " (below the 35 floor)" : ""}` });
  checks.push({
    key: "decision_maker",
    label: "Decision-maker identified",
    pass: Boolean(c && (c.seniority === "vp" || c.seniority === "director" || c.seniority === "c_level" || c.seniority === "manager")),
    detail: c ? `${c.name}, ${c.title}` : "no contact selected",
  });
  const usableContact = Boolean(c && (c.email || (c.phone && c.phoneVerified) || c.linkedin));
  checks.push({
    key: "contact",
    label: "Usable contact information",
    pass: usableContact,
    detail: c ? [c.email ? "email" : null, c.phone ? (c.phoneVerified ? "verified phone" : "unverified phone") : null, c.linkedin ? "LinkedIn" : null].filter(Boolean).join(", ") || "no channel on file" : "no contact",
  });
  const fresh = account.signals.filter((s) => s.status === "verified" && s.type !== "intent" && s.evidence.some((e) => e.url) && daysSince(s.detectedAt) <= ctx.settings.signalFreshnessDays);
  const stale = account.signals.filter((s) => s.status === "verified" && s.type !== "intent" && daysSince(s.detectedAt) > ctx.settings.signalFreshnessDays).length;
  checks.push({
    key: "evidence",
    label: "Buying-signal evidence",
    pass: fresh.length >= 1,
    detail: fresh.length ? `${fresh.length} verified signal${fresh.length === 1 ? "" : "s"} with sources within ${ctx.settings.signalFreshnessDays} days${stale ? `, ${stale} stale` : ""}` : stale ? `${stale} signals are older than ${ctx.settings.signalFreshnessDays} days` : "no verified signal with a source",
  });
  checks.push({
    key: "hypothesis",
    label: "Outreach hypothesis",
    pass: Boolean(account.painHypothesis && account.messagingAngle),
    detail: account.painHypothesis ? `pain: ${account.painHypothesis}` : "no pain hypothesis / angle yet",
  });
  checks.push({ key: "crm", label: "CRM ownership", pass: !ctx.crmOwner, detail: ctx.crmOwner ? `owned by ${ctx.crmOwner} in the CRM` : "unowned in the CRM" });
  checks.push({ key: "suppression", label: "Not suppressed", pass: !ctx.suppressed, detail: ctx.suppressed ? "contact or domain is on the suppression list" : "no suppression match" });

  const blockers = checks.filter((k) => !k.pass).map((k) => `${k.label}: ${k.detail}`);
  const ready = blockers.length === 0;
  checks.push({ key: "next_action", label: "Recommended next action", pass: true, detail: ready ? "call queued" : "return to enrichment" });
  return { ready, checks, blockers, evaluatedAt: nowIso() };
}

export function nextActionFor(account: Account, report: ReadinessReport): NextAction {
  const now = Date.now();
  const inDays = (d: number) => new Date(now + d * 86_400_000).toISOString();
  if (["won", "lost", "disqualified"].includes(account.status)) return { type: "close", label: "Closed", reason: `account is ${account.status}`, dueAt: nowIso() };
  if (account.status === "meeting_booked") return { type: "meeting_prep", label: "Prepare for the meeting", reason: "meeting booked; review signals and the assessment before the call", dueAt: inDays(1) };
  if (!report.ready) {
    const blocker = report.blockers[0] ?? "missing information";
    if (report.checks.find((c) => c.key === "suppression" && !c.pass) || report.checks.find((c) => c.key === "crm" && !c.pass)) {
      return { type: "review", label: "Review ownership / suppression", reason: blocker, dueAt: inDays(1) };
    }
    return { type: "enrich", label: "Back to enrichment", reason: blocker, dueAt: inDays(2) };
  }
  if (account.pendingActivation || account.status === "hot") return { type: "call", label: "Call now", reason: account.pendingActivation ?? "high-intent engagement", dueAt: nowIso() };
  if (account.contact?.phone && account.contact.phoneVerified) return { type: "call", label: "Call", reason: account.messagingAngle ?? "verified phone and a live signal", dueAt: inDays(0) };
  if (account.contact?.email) return { type: "email", label: "Send the first touch", reason: "email on file; verified phone pending", dueAt: inDays(0) };
  return { type: "linkedin", label: "Connect on LinkedIn", reason: "no email or verified phone yet", dueAt: inDays(0) };
}

/** Round-robin assignment to the active rep with the fewest open accounts. */
export async function assignOwner(store: Store, account: Account): Promise<string | null> {
  if (account.ownerRepId) return account.ownerRepId;
  const active = (await repCol.list()).filter((r: Rep) => r.active);
  if (!active.length) return null;
  const all = await store.listAccounts();
  const load = new Map(active.map((r) => [r.id, 0]));
  for (const a of all) if (a.ownerRepId && load.has(a.ownerRepId) && !["won", "lost", "disqualified"].includes(a.status)) load.set(a.ownerRepId, (load.get(a.ownerRepId) ?? 0) + 1);
  return [...load.entries()].sort((x, y) => x[1] - y[1])[0][0];
}

/** Lookup helpers the Scoring Agent calls (kept async so real CRM / suppression sources slot in). */
export async function readinessContextFor(store: Store, account: Account, model: ScoringModel, settings: AutomationSettings, crmOwnerLookup?: (a: Account) => Promise<string | null>): Promise<ReadinessContext> {
  const suppressed = Boolean(await isSuppressed(account.contact?.email, account.domain));
  const crmOwner = account.crmOwner ?? (crmOwnerLookup ? await crmOwnerLookup(account) : null);
  void store;
  return { model, settings, crmOwner, suppressed };
}
