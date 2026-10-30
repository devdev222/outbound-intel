import { z } from "zod";
import { config } from "@/lib/config";
import { generateStructured } from "@/lib/llm";
import type { Providers } from "@/lib/providers";
import type { Store } from "@/lib/store";
import { conversations as convCol, getSettings, suppressions } from "@/lib/store/collections";
import type { Account, Conversation, ConversationChannel, ConversationOutcome, NextAction, Signal, Task, User } from "@/lib/types";
import { nowIso, uuid } from "@/lib/util";
import { logActivity } from "./activity";
import { recordOutcome } from "./outcomes";
import { markWrongContact } from "./contact";
import { coordinateSignal } from "./coordination";
import { pauseAccount } from "./pause";
import { getPlaybook, matchingObjections, playbookPrompt } from "./playbook";
import { approveTask, createTask, providerCanSend } from "./tasks";
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
  /** "Not now": how long to defer all outreach (default 30 days). */
  pauseDays?: number;
  /** A callback time the rep agreed with the prospect; becomes a committed task. */
  callbackAt?: string;
  /** The buying-group contact the rep spoke with (defaults to the primary contact). */
  contactId?: string | null;
  /** outcome "referred": the person they pointed the rep to. */
  referral?: { name: string; title: string; email?: string | null; linkedin?: string | null } | null;
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
    referred: {
      summary: `${account.contact?.name ?? "The contact"} referred us to ${input.referral?.name ?? "someone else"}${input.referral?.title ? ` (${input.referral.title})` : ""}. ${input.notes.slice(0, 140)}`,
      next: { type: "email", label: `Reach out to ${input.referral?.name ?? "the referral"}`, reason: "a warm referral inside the buying group", dueAt: nowIso() },
      subject: `Thanks for the pointer, ${account.companyName}`,
      body: `${first}, thanks for pointing me to ${input.referral?.name ?? "the right person"}. I will keep it short with them and mention you suggested it, unless you would rather I didn't.`,
    },
    opted_out: {
      summary: `${account.contact?.name ?? "The contact"} asked not to be contacted again.`,
      next: { type: "review", label: "Continue with the rest of the group", reason: "one person opted out; others are unaffected", dueAt: nowIso() },
      subject: "",
      body: "",
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

export async function logConversation(store: Store, providers: Providers, accountIn: Account, input: LogConversationInput, user: User | null): Promise<Conversation> {
  // The person the rep spoke with. Templates, tasks, outcomes and the record are attributed to them.
  const contact = input.contactId ? await store.getContact(input.contactId) : accountIn.primaryContactId ? await store.getContact(accountIn.primaryContactId) : null;
  if (input.contactId && (!contact || contact.accountId !== accountIn.id)) throw new Error(`contact ${input.contactId} is not on this account`);
  const account: Account = contact ? { ...accountIn, contact: contact.person } : accountIn;
  const contactId = contact?.id ?? null;
  const settings = await getSettings();
  const playbook = await getPlaybook();
  const template = templateIntel(account, input);
  // Without Claude, answer objections the notes mention with your playbook's responses.
  const answers = matchingObjections(playbook, input.notes);
  if (answers.length) template.followUp = { ...template.followUp, body: `${template.followUp.body}\n\n${answers.map((o) => o.response).join("\n\n")}` };
  const team = playbookPrompt(playbook, { contactTitle: account.contact?.title, objections: true });
  let intel: { summary: string; objections: string[]; signalKeys: string[]; followUp: { subject: string; body: string }; nextAction: NextAction; generatedBy: "llm" | "template" } = { ...template, generatedBy: "template" };

  const r = await generateStructured({
    schema: Schema,
    effort: "low",
    system:
      `You are the conversation intelligence layer for ${config.brandName}'s outbound team. From a rep's notes you produce a crisp summary, the objections, the buying signals the conversation confirmed (only keys from the catalog), a follow-up the rep can send as-is, and the next action. Ground everything in the notes; never invent facts about the prospect.` +
      (team ? `\n\n${team}` : ""),
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

  // Pauses and commitments are decided by the outcome, not by the model.
  const now = nowIso();
  const pauseDays = input.outcome === "not_now" ? (input.pauseDays ?? 30) : null;
  const pausedUntil = pauseDays ? new Date(Date.now() + pauseDays * 86_400_000).toISOString() : null;
  if (pausedUntil) {
    intel = { ...intel, nextAction: { type: "wait", label: `Paused until ${pausedUntil.slice(0, 10)}`, reason: "prospect asked to reconnect later; no outreach until then", dueAt: pausedUntil } };
  }
  if (input.callbackAt) {
    intel = { ...intel, nextAction: { type: "call", label: "Call back as agreed", reason: "callback time agreed on the call", dueAt: input.callbackAt } };
  }

  const conversationId = uuid();
  const repId = input.repId ?? user?.repId ?? account.ownerRepId ?? null;

  // Follow-up email: a task. Never sent by logging alone; approval and delivery are separate steps.
  let followUp: Task | null = null;
  // No follow-up to a person the rep just said is the wrong contact; the account goes back to research.
  if (input.outcome !== "not_interested" && input.outcome !== "wrong_contact" && input.outcome !== "opted_out") {
    const status: Task["status"] = settings.automation.requireFollowUpApproval ? "awaiting_approval" : providerCanSend(providers, "email") ? "scheduled" : "manual";
    followUp = await createTask(store, {
      account,
      channel: "email",
      title: pausedUntil ? `Check back with ${account.contact?.name.split(" ")[0] ?? "the contact"} after the pause` : `Follow up after the ${input.channel} (${input.outcome.replace(/_/g, " ")})`,
      subject: intel.followUp.subject,
      body: intel.followUp.body,
      // A deferred follow-up is due when the pause ends, never before.
      dueAt: pausedUntil ?? now,
      status,
      source: "conversation",
      step: 90,
      conversationId,
      contactId,
      assigneeRepId: repId,
      note: pausedUntil ? `due when the pause ends (${pausedUntil.slice(0, 10)})` : status === "awaiting_approval" ? "drafted from the conversation; review & approve to schedule" : undefined,
    });
  }

  // Committed next step (callback, meeting prep): a task the rep owns. Rescoring never replaces it.
  let commitment: Task | null = null;
  if (input.outcome !== "wrong_contact" && input.outcome !== "opted_out" && (input.callbackAt || intel.nextAction.type === "call" || intel.nextAction.type === "meeting_prep")) {
    const meeting = intel.nextAction.type === "meeting_prep";
    commitment = await createTask(store, {
      account,
      channel: meeting ? "meeting" : "call",
      title: meeting ? "Prepare for the meeting" : input.callbackAt ? `Call back ${account.contact?.name.split(" ")[0] ?? "the contact"} (agreed)` : intel.nextAction.label,
      body: `${intel.nextAction.reason}.\n\n${intel.summary}`,
      dueAt: intel.nextAction.dueAt,
      status: "manual",
      source: input.callbackAt ? "rep" : "conversation",
      conversationId,
      contactId,
      assigneeRepId: repId,
    });
  }

  const conversation: Conversation = {
    id: conversationId,
    accountId: account.id,
    repId,
    channel: input.channel,
    outcome: input.outcome,
    notes: input.notes,
    summary: intel.summary,
    objections: intel.objections,
    signalsExtracted: intel.signalKeys,
    followUpDraft: followUp ? intel.followUp : null,
    followUpTouchId: followUp?.id ?? null,
    contactId,
    nextAction: intel.nextAction,
    approved: followUp ? followUp.status !== "awaiting_approval" : true,
    generatedBy: intel.generatedBy,
    at: now,
  };
  await convCol.put(conversation);

  // Account updates: confirmed signals, next action, status by outcome.
  const newSignals: Signal[] = intel.signalKeys
    .filter((k) => !account.signals.some((s) => s.key === k))
    .map((k) => {
      const def = SIGNAL_CATALOG.find((s) => s.key === k)!;
      return { key: k, type: def.type, label: def.label, status: "verified", confidence: 0.95, detectedAt: now, agent: "research", evidence: [{ title: `Confirmed in ${input.channel} with ${account.contact?.name ?? "contact"}`, url: "", source: "conversation" }] };
    });
  // Atomic patch of only what the conversation changes, applied to the latest account.
  let updated: Account =
    (await store.patchAccount(account.id, (cur) => {
      const merged = [...cur.signals, ...newSignals.filter((n) => !cur.signals.some((s) => s.key === n.key))];
      const status = (input.outcome === "connected" || input.outcome === "replied") && (cur.status === "campaign_live" || cur.status === "qualified") ? "engaged" : cur.status;
      return { ...cur, signals: merged, nextAction: intel.nextAction, pendingActivation: null, status };
    })) ?? account;
  // Buying group: what this person said is coordinated across the group. Legacy single-contact accounts keep the account-level hold.
  const by = user?.name ?? "rep";
  if (contact && accountIn.buyingGroup) {
    const signal =
      input.outcome === "wrong_contact" ? ({ kind: "wrong_contact", detail: input.notes.trim() || "rep marked the contact as wrong" } as const)
      : input.outcome === "replied" || input.outcome === "connected" ? ({ kind: "replied", detail: intel.summary } as const)
      : input.outcome === "meeting_booked" ? ({ kind: "meeting", detail: intel.summary } as const)
      : input.outcome === "opted_out" ? ({ kind: "opted_out", detail: input.notes } as const)
      : input.outcome === "referred" && input.referral?.name ? ({ kind: "referred", detail: input.notes, referral: input.referral } as const)
      : null;
    if (signal) await coordinateSignal(store, providers, contact.id, signal, by);
    updated = (await store.getAccountById(account.id)) ?? updated;
  } else if (input.outcome === "wrong_contact") updated = (await markWrongContact(store, providers, account.id, by, input.notes.trim() || "rep marked the contact as wrong")) ?? updated;
  if (input.outcome === "opted_out" && account.contact?.email) {
    const email = account.contact.email.toLowerCase();
    if (!(await suppressions.list()).some((s) => s.target.toLowerCase() === email)) await suppressions.put({ id: uuid(), target: email, reason: "opt_out", note: `said on a ${input.channel}`, createdBy: by, at: now });
  }
  if (pausedUntil) updated = (await pauseAccount(store, providers, updated, pausedUntil, `not now: ${intel.objections.join(", ") || "timing"}`, user?.name ?? "rep")).account;

  // Outcomes the learning loop should see. A rep-logged meeting_booked is a confirmed appointment.
  const source = user ? `rep:${user.name}` : "rep";
  if (input.outcome === "meeting_booked") await recordOutcome(store, providers, updated, { outcomeType: "meeting_booked", notes: intel.summary, source, contactId });
  else if (input.outcome === "not_interested") await recordOutcome(store, providers, updated, { outcomeType: "deal_lost", notes: `not interested: ${intel.objections.join(", ") || intel.summary}`, source, contactId });
  else if (input.outcome === "replied") await recordOutcome(store, providers, updated, { outcomeType: "replied", notes: intel.summary, source, contactId });

  await logActivity(store, account.id, "rep", "conversation_logged", `${input.channel}${contact ? ` with ${contact.person.name}` : ""}: ${input.outcome.replace(/_/g, " ")} (${intel.generatedBy})`, [
    intel.summary,
    intel.objections.length ? `objections: ${intel.objections.join("; ")}` : "",
    intel.signalKeys.length ? `signals confirmed: ${intel.signalKeys.join(", ")}` : "",
    `next: ${intel.nextAction.label} (${intel.nextAction.reason})`,
    pausedUntil ? `outreach paused until ${pausedUntil.slice(0, 10)}` : "",
    followUp ? (followUp.status === "awaiting_approval" ? "follow-up drafted, awaiting approval (not sent)" : followUp.status === "scheduled" ? "follow-up scheduled for delivery" : "follow-up is a manual task") : "no follow-up (closed)",
    commitment ? `committed: ${commitment.title} due ${commitment.scheduledFor.slice(0, 16).replace("T", " ")}` : "",
  ]);
  return conversation;
}

/** Review & approve the follow-up (optionally edited). It becomes scheduled; approval never sends it. */
export async function approveFollowUp(store: Store, providers: Providers, conversationId: string, edits: { subject?: string; body?: string } | undefined, user: User): Promise<Conversation | null> {
  const conv = await convCol.get(conversationId);
  if (!conv) return null;
  if (conv.followUpTouchId) {
    const task = await store.getOutreach(conv.followUpTouchId);
    if (task && task.status === "awaiting_approval") await approveTask(store, providers, task.id, user, edits);
  }
  const updated: Conversation = { ...conv, approved: true, followUpDraft: { subject: edits?.subject ?? conv.followUpDraft?.subject ?? "", body: edits?.body ?? conv.followUpDraft?.body ?? "" } };
  await convCol.put(updated);
  return updated;
}
