import { z } from "zod";
import { config } from "@/lib/config";
import { generateStructured } from "@/lib/llm";
import type { Providers } from "@/lib/providers";
import type { Store } from "@/lib/store";
import { conversations as convCol, getSettings } from "@/lib/store/collections";
import type { Account, Conversation, ConversationChannel, ConversationOutcome, NextAction, OutreachTouch, Signal, User } from "@/lib/types";
import { nowIso, uuid } from "@/lib/util";
import { logActivity } from "./activity";
import { recordOutcome } from "./outcomes";
import { SIGNAL_CATALOG } from "./signal-catalog";

/**
 * Conversation Intelligence. After a call, email reply or meeting the rep logs
 * the outcome and notes; the engine summarizes, pulls objections and buying
 * signals, drafts the follow-up, sets the next action, updates the account
 * (and CRM through the outcome write-back) and feeds the learning loop.
 * Follow-ups wait for human approval when the automation settings say so.
 */

export interface LogConversationInput {
  channel: ConversationChannel;
  outcome: ConversationOutcome;
  notes: string;
  repId?: string | null;
}

const Schema = z.object({
  summary: z.string().describe("2-3 sentences: what happened and what matters"),
  objections: z.array(z.string()).describe("Objections raised, verbatim-ish, empty if none"),
  signalKeys: z.array(z.string()).describe("Buying-signal keys from the provided catalog that the conversation confirmed"),
  followUpSubject: z.string(),
  followUpBody: z.string().describe("4-7 short lines, plain text, references what was said, one concrete next step"),
  nextActionType: z.enum(["call", "email", "linkedin", "wait", "enrich", "review", "meeting_prep", "close"]),
  nextActionLabel: z.string(),
  nextActionReason: z.string(),
  nextActionInDays: z.number().min(0).max(90),
});

const OBJECTION_RULES: { test: RegExp; label: string }[] = [
  { test: /\b(already have|have a tms|use a broker|work with|under contract)\b/i, label: "Already has a provider / system" },
  { test: /\b(budget|too expensive|cost|price|pricing)\b/i, label: "Budget / pricing" },
  { test: /\b(not a priority|not right now|later|next quarter|q[1-4])\b/i, label: "Timing" },
  { test: /\b(not the right person|talk to|owns that|someone else)\b/i, label: "Wrong contact" },
  { test: /\b(send (me )?(info|information|something)|email me)\b/i, label: "Send information" },
];

function templateIntel(account: Account, input: LogConversationInput) {
  const first = account.contact?.name.split(" ")[0] ?? "there";
  const objections = OBJECTION_RULES.filter((r) => r.test.test(input.notes)).map((r) => r.label);
  const signalKeys = SIGNAL_CATALOG.filter((s) => s.type !== "intent" && new RegExp(s.label.split(" ")[0], "i").test(input.notes) && /\b(hiring|facility|spreadsheet|tms|carrier|late|freight cost)\b/i.test(input.notes)).map((s) => s.key).slice(0, 3);
  const page = account.campaign?.pageUrl ?? `${config.appUrl}/for/${account.slug}`;
  const byOutcome: Record<ConversationOutcome, { summary: string; next: NextAction; subject: string; body: string }> = {
    connected: {
      summary: `Spoke with ${account.contact?.name ?? "the contact"} (${input.channel}). ${objections.length ? `Objections: ${objections.join(", ")}.` : "No hard objections."} Notes: ${input.notes.slice(0, 160)}`,
      next: { type: "email", label: "Send the recap and the page", reason: "keep momentum after a live conversation", dueAt: nowIso() },
      subject: `Recap: ${account.companyName} and ${config.brandName}`,
      body: `${first}, thanks for the time today.\n\nWhat I heard: ${input.notes.slice(0, 140) || "you are evaluating how to scale coordination"}.\n\nYour numbers are on the page we built for ${account.companyName}: ${page}\n\nIf it is useful, I will hold 15 minutes next week to walk through them.`,
    },
    voicemail: {
      summary: `Left a voicemail for ${account.contact?.name ?? "the contact"}.`,
      next: { type: "email", label: "Send the voicemail follow-up email", reason: "pair the voicemail with a short note", dueAt: nowIso() },
      subject: `Left you a voicemail, ${account.companyName}`,
      body: `${first}, just left you a short voicemail about ${account.messagingAngle?.toLowerCase() ?? "scaling shipping coordination"}.\n\nYour numbers: ${page}\n\nWorth 15 minutes?`,
    },
    no_answer: {
      summary: `No answer (${input.channel}).`,
      next: { type: "call", label: "Retry at a different time of day", reason: "no answer on the first attempt", dueAt: new Date(Date.now() + 86_400_000).toISOString() },
      subject: `Quick question, ${account.companyName}`,
      body: `${first}, tried you earlier. One question: who owns outbound freight coordination at ${account.companyName} today?\n\n${page}`,
    },
    replied: {
      summary: `${account.contact?.name ?? "The contact"} replied. ${objections.length ? `Objections: ${objections.join(", ")}.` : ""} ${input.notes.slice(0, 160)}`,
      next: { type: "email", label: "Answer the reply and propose a time", reason: "a reply is the best moment to book", dueAt: nowIso() },
      subject: `Re: ${account.companyName}`,
      body: `${first}, thanks for getting back to me.\n\n${objections.includes("Send information") ? `Everything is on one page, with your numbers: ${page}` : `Happy to walk through how teams at your volume handled this.`}\n\nDoes Tuesday or Thursday work for 15 minutes?`,
    },
    meeting_booked: {
      summary: `Meeting booked with ${account.contact?.name ?? "the contact"}.`,
      next: { type: "meeting_prep", label: "Prepare the meeting brief", reason: "review signals, assessment and proof before the call", dueAt: new Date(Date.now() + 86_400_000).toISOString() },
      subject: `Looking forward to it, ${account.companyName}`,
      body: `${first}, confirmed. Before we talk, your page has the numbers we will use: ${page}\n\nIf you can share your monthly load count and who coordinates today, I will tailor the walkthrough.`,
    },
    not_interested: {
      summary: `Not interested. ${objections.length ? `Reason: ${objections.join(", ")}.` : input.notes.slice(0, 160)}`,
      next: { type: "wait", label: "Pause outreach for 90 days", reason: "respect the no; revisit when a new signal appears", dueAt: new Date(Date.now() + 90 * 86_400_000).toISOString() },
      subject: `Understood, ${account.companyName}`,
      body: `${first}, understood, and thanks for the straight answer. If ${account.messagingAngle?.toLowerCase() ?? "coordination load"} becomes a priority, the page stays live: ${page}`,
    },
    not_now: {
      summary: `Interested but not now. ${input.notes.slice(0, 160)}`,
      next: { type: "wait", label: "Follow up in 30 days", reason: "timing objection", dueAt: new Date(Date.now() + 30 * 86_400_000).toISOString() },
      subject: `Checking back in a month, ${account.companyName}`,
      body: `${first}, makes sense. I will check back in a few weeks. In the meantime your numbers are here: ${page}`,
    },
    wrong_contact: {
      summary: `Wrong contact; ${input.notes.slice(0, 160)}`,
      next: { type: "enrich", label: "Find the right owner", reason: "contact does not own freight coordination", dueAt: nowIso() },
      subject: `Who owns freight at ${account.companyName}?`,
      body: `${first}, thanks for pointing me in the right direction. Could you share who owns transportation coordination so I can reach out directly?`,
    },
  };
  const t = byOutcome[input.outcome];
  return { summary: t.summary, objections, signalKeys, followUp: { subject: t.subject, body: t.body }, nextAction: t.next };
}

export async function logConversation(store: Store, providers: Providers, account: Account, input: LogConversationInput, user: User | null): Promise<Conversation> {
  const settings = await getSettings();
  const template = templateIntel(account, input);
  let intel: { summary: string; objections: string[]; signalKeys: string[]; followUp: { subject: string; body: string }; nextAction: NextAction; generatedBy: "llm" | "template" } = { ...template, generatedBy: "template" };

  const r = await generateStructured({
    schema: Schema,
    effort: "low",
    system:
      `You are the conversation intelligence layer for ${config.brandName}'s outbound team. From a rep's notes you produce a crisp summary, the objections, the buying signals the conversation confirmed (only keys from the catalog), a follow-up the rep can send as-is, and the next action. Ground everything in the notes; never invent facts about the prospect.`,
    user:
      `Account: ${account.companyName} (${account.industry}). Contact: ${account.contact ? `${account.contact.name}, ${account.contact.title}` : "unknown"}.\n` +
      `Channel: ${input.channel}. Outcome: ${input.outcome}.\nNotes: ${input.notes || "(none)"}\n` +
      `Known signals: ${account.signals.map((s) => s.key).join(", ") || "none"}. Pain hypothesis: ${account.painHypothesis ?? "n/a"}. Angle: ${account.messagingAngle ?? "n/a"}.\n` +
      `Page link to include: ${account.campaign?.pageUrl ?? `${config.appUrl}/for/${account.slug}`}\n` +
      `Signal catalog keys: ${SIGNAL_CATALOG.filter((s) => s.type !== "intent").map((s) => `${s.key} (${s.label})`).join("; ")}\n` +
      `Template draft to improve: ${JSON.stringify(template)}`,
  });
  if (r) {
    intel = {
      summary: r.summary,
      objections: r.objections,
      signalKeys: r.signalKeys.filter((k) => SIGNAL_CATALOG.some((s) => s.key === k)),
      followUp: { subject: r.followUpSubject, body: r.followUpBody },
      nextAction: { type: r.nextActionType, label: r.nextActionLabel, reason: r.nextActionReason, dueAt: new Date(Date.now() + r.nextActionInDays * 86_400_000).toISOString() },
      generatedBy: "llm",
    };
  }

  // Follow-up as an outreach touch: approval-gated or scheduled right away.
  const touch: OutreachTouch = {
    id: uuid(),
    accountId: account.id,
    channel: "email",
    step: 90 + Math.floor(Math.random() * 9),
    subject: intel.followUp.subject,
    body: intel.followUp.body,
    status: settings.automation.requireFollowUpApproval ? "awaiting_rep" : "scheduled",
    scheduledFor: nowIso(),
    provider: "pending",
    note: settings.automation.requireFollowUpApproval ? `follow-up drafted after ${input.outcome}; awaiting rep approval` : `follow-up after ${input.outcome}`,
    taskUrl: account.contact?.email ? `mailto:${account.contact.email}` : undefined,
  };
  await store.insertOutreach([touch]);

  const conversation: Conversation = {
    id: uuid(),
    accountId: account.id,
    repId: input.repId ?? user?.repId ?? null,
    channel: input.channel,
    outcome: input.outcome,
    notes: input.notes,
    summary: intel.summary,
    objections: intel.objections,
    signalsExtracted: intel.signalKeys,
    followUpDraft: intel.followUp,
    followUpTouchId: touch.id,
    nextAction: intel.nextAction,
    approved: !settings.automation.requireFollowUpApproval,
    generatedBy: intel.generatedBy,
    at: nowIso(),
  };
  await convCol.put(conversation);

  // Account updates: confirmed signals, next action, status by outcome.
  const now = nowIso();
  const newSignals: Signal[] = intel.signalKeys
    .filter((k) => !account.signals.some((s) => s.key === k))
    .map((k) => {
      const def = SIGNAL_CATALOG.find((s) => s.key === k)!;
      return { key: k, type: def.type, label: def.label, status: "verified", confidence: 0.95, detectedAt: now, agent: "research", evidence: [{ title: `Confirmed in ${input.channel} with ${account.contact?.name ?? "contact"}`, url: "", source: "conversation" }] };
    });
  let updated: Account = { ...account, signals: [...account.signals, ...newSignals], nextAction: intel.nextAction, pendingActivation: null };
  if (input.outcome === "wrong_contact") updated = { ...updated, status: "needs_enrichment" };
  if (input.outcome === "connected" || input.outcome === "replied") updated = { ...updated, status: updated.status === "campaign_live" || updated.status === "qualified" ? "engaged" : updated.status };
  updated = await store.upsertAccount(updated);

  // Outcomes that the learning loop should see.
  if (input.outcome === "meeting_booked") await recordOutcome(store, providers, updated, { outcomeType: "meeting_booked", notes: intel.summary, source: user ? `rep:${user.name}` : "rep" });
  else if (input.outcome === "not_interested") await recordOutcome(store, providers, updated, { outcomeType: "deal_lost", notes: `not interested: ${intel.objections.join(", ") || intel.summary}`, source: user ? `rep:${user.name}` : "rep" });
  else if (input.outcome === "replied") await recordOutcome(store, providers, updated, { outcomeType: "replied", notes: intel.summary, source: user ? `rep:${user.name}` : "rep" });

  await logActivity(store, account.id, "rep", "conversation_logged", `${input.channel}: ${input.outcome.replace(/_/g, " ")} (${intel.generatedBy})`, [
    intel.summary,
    intel.objections.length ? `objections: ${intel.objections.join("; ")}` : "",
    intel.signalKeys.length ? `signals confirmed: ${intel.signalKeys.join(", ")}` : "",
    `next: ${intel.nextAction.label} (${intel.nextAction.reason})`,
    touch.status === "awaiting_rep" ? "follow-up drafted, awaiting approval" : "follow-up scheduled",
  ]);
  return conversation;
}

/** Rep approves (optionally edits) the follow-up; it becomes a scheduled touch (or a rep task if no sender). */
export async function approveFollowUp(store: Store, conversationId: string, edits: { subject?: string; body?: string } | undefined, user: User): Promise<Conversation | null> {
  const conv = await convCol.get(conversationId);
  if (!conv) return null;
  const touch = conv.followUpTouchId ? await store.getOutreach(conv.followUpTouchId) : null;
  if (touch) {
    await store.updateOutreach({ ...touch, subject: edits?.subject ?? touch.subject, body: edits?.body ?? touch.body, status: "scheduled", scheduledFor: nowIso(), note: `approved by ${user.name}` });
  }
  const updated: Conversation = { ...conv, approved: true, followUpDraft: { subject: edits?.subject ?? conv.followUpDraft?.subject ?? "", body: edits?.body ?? conv.followUpDraft?.body ?? "" } };
  await convCol.put(updated);
  await logActivity(store, conv.accountId, "rep", "follow_up_approved", `Follow-up approved by ${user.name}`);
  return updated;
}
