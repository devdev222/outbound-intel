"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { drafts, newRequestId, requestJson } from "@/lib/client/request";
import { isPhoneVerified } from "@/lib/engine/contact-fields";

export interface PanelContext {
  slug: string;
  company: string;
  /** Why this account, now (one line). */
  whyNow?: string;
  opener: string;
  painHypothesis: string | null;
  proofLine: string | null;
  proofPlaceholder?: boolean;
  contact: { name: string; title: string; phone?: string; phoneVerified?: boolean; phoneVerifiedNumber?: string | null; email?: string; linkedin?: string } | null;
  preparedFollowUp: { subject: string; body: string } | null;
  /** The account's current next action, e.g. "Call back as agreed · due Thu". */
  nextAction?: string | null;
}

interface LoggedConversation {
  id: string;
  summary: string;
  objections: string[];
  signalsExtracted: string[];
  followUpDraft: { subject: string; body: string } | null;
  nextAction: { label: string; reason: string; dueAt: string } | null;
  approved: boolean;
  generatedBy: "llm" | "template";
}

const CHANNELS = ["call", "email", "linkedin", "meeting"] as const;
const OUTCOMES: { key: string; label: string }[] = [
  { key: "connected", label: "Connected" },
  { key: "voicemail", label: "Voicemail" },
  { key: "no_answer", label: "No answer" },
  { key: "replied", label: "Replied" },
  { key: "meeting_booked", label: "Meeting booked" },
  { key: "not_interested", label: "Not interested" },
  { key: "not_now", label: "Not now (pause)" },
  { key: "wrong_contact", label: "Wrong contact" },
];

/**
 * The call workflow: who, why now, what to say, what proof to cite, what's
 * next; then log the outcome. Notes survive failures and reloads; a retry
 * after an error or timeout reuses the same request id, so it never logs twice.
 */
export function ConversationPanel({ ctx, onClose, autoOpen = false }: { ctx: PanelContext; onClose?: () => void; autoOpen?: boolean }) {
  const router = useRouter();
  const draftKey = `conversation:${ctx.slug}`;
  const [open, setOpen] = useState(autoOpen);
  const [channel, setChannel] = useState<(typeof CHANNELS)[number]>("call");
  const [outcome, setOutcome] = useState("connected");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; retryable: boolean } | null>(null);
  const [result, setResult] = useState<LoggedConversation | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [approved, setApproved] = useState(false);
  const [pauseDays, setPauseDays] = useState(30);
  const [callbackAt, setCallbackAt] = useState("");
  const [requestId, setRequestId] = useState(newRequestId);

  useEffect(() => {
    const saved = drafts.get(draftKey);
    if (saved) setNotes(saved);
  }, [draftKey]);

  function editNotes(v: string) {
    setNotes(v);
    drafts.set(draftKey, v);
  }

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const r = await requestJson<{ conversation: LoggedConversation }>("/api/conversations", {
      requestId,
      body: { slug: ctx.slug, channel, outcome, notes, requestId, ...(outcome === "not_now" ? { pauseDays } : {}), ...(callbackAt && !["not_now", "not_interested", "wrong_contact"].includes(outcome) ? { callbackAt: new Date(callbackAt).toISOString() } : {}) },
      timeoutMs: 60_000,
    });
    setBusy(false);
    if (!r.ok) return setError({ text: r.error, retryable: r.retryable });
    const c = r.data.conversation;
    drafts.set(draftKey, "");
    setRequestId(newRequestId());
    setResult(c);
    setSubject(c.followUpDraft?.subject ?? "");
    setBody(c.followUpDraft?.body ?? "");
    setApproved(c.approved);
    router.refresh();
  }

  async function approve() {
    if (!result || busy) return;
    setBusy(true);
    setError(null);
    const r = await requestJson(`/api/conversations/${result.id}/approve`, { body: { subject, body } });
    setBusy(false);
    if (!r.ok) return setError({ text: r.error, retryable: r.retryable });
    setApproved(true);
    router.refresh();
  }

  if (!open) {
    return (
      <button className="btn btn-accent" onClick={() => setOpen(true)}>
        Start conversation
      </button>
    );
  }

  const c = ctx.contact;
  const verified = isPhoneVerified(c);
  return (
    <div className="card mt-3 border-[var(--border-strong)] p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-[13px] font-semibold">{result ? "Conversation logged" : `Conversation with ${c?.name ?? ctx.company}`}</div>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => {
            setOpen(false);
            onClose?.();
          }}
        >
          Close
        </button>
      </div>

      {!result && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-3 text-[13px]">
            <Ref label="Contact">
              {c ? (
                <>
                  <span className="font-medium">{c.name}</span>, {c.title}
                  <div className="mt-0.5 flex flex-wrap items-center gap-2">
                    {c.phone &&
                      (verified ? (
                        <a className="mono" href={`tel:${c.phone.replace(/[^\d+]/g, "")}`}>
                          {c.phone} <span className="pill pill-good ml-1">verified</span>
                        </a>
                      ) : (
                        <span className="mono">
                          {c.phone} <span className="pill ml-1">unverified number</span>
                        </span>
                      ))}
                    {c.email && <span className="mono text-[var(--text-2)]">{c.email}</span>}
                  </div>
                </>
              ) : (
                <span className="text-[var(--muted)]">No contact on file</span>
              )}
            </Ref>
            {ctx.whyNow && <Ref label="Why now">{ctx.whyNow}</Ref>}
            <Ref label="Open with">
              <span className="italic">“{ctx.opener}”</span>
            </Ref>
            {ctx.proofLine && (
              <Ref label="Proof to cite">
                {ctx.proofLine} {ctx.proofPlaceholder && <span className="pill pill-warn ml-1">placeholder</span>}
              </Ref>
            )}
            {ctx.nextAction && <Ref label="Next action">{ctx.nextAction}</Ref>}
            {(ctx.painHypothesis || ctx.preparedFollowUp) && (
              <details className="text-[12.5px]">
                <summary className="cursor-pointer text-[var(--muted)]">More context</summary>
                {ctx.painHypothesis && <div className="mt-1">Problem we think they have: {ctx.painHypothesis}</div>}
                {ctx.preparedFollowUp && (
                  <div className="mt-1">
                    <div className="font-medium">Prepared follow-up: {ctx.preparedFollowUp.subject}</div>
                    <div className="whitespace-pre-wrap text-[var(--text-2)]">{ctx.preparedFollowUp.body}</div>
                  </div>
                )}
              </details>
            )}
          </div>
          <div className="space-y-3">
            <div className="text-[12px] font-semibold uppercase tracking-wide text-[var(--muted)]">Log the outcome</div>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Channel">
              {CHANNELS.map((ch) => (
                <button key={ch} className={`btn btn-sm ${channel === ch ? "btn-primary" : ""}`} aria-pressed={channel === ch} onClick={() => setChannel(ch)} disabled={busy}>
                  {ch}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Outcome">
              {OUTCOMES.map((o) => (
                <button key={o.key} className={`btn btn-sm ${outcome === o.key ? "btn-primary" : ""}`} aria-pressed={outcome === o.key} onClick={() => setOutcome(o.key)} disabled={busy}>
                  {o.label}
                </button>
              ))}
            </div>
            {outcome === "wrong_contact" && <div className="rounded-md bg-[var(--warn-soft)] p-2 text-[12px]">This removes {c?.name ?? "the contact"}, holds their outreach and sends the account back to research for the right person.</div>}
            {outcome === "not_now" ? (
              <label className="flex items-center gap-2 text-[12.5px]">
                Pause all outreach for
                <select className="field max-w-[120px]" value={pauseDays} onChange={(e) => setPauseDays(Number(e.target.value))} disabled={busy}>
                  {[14, 30, 60, 90].map((d) => (
                    <option key={d} value={d}>
                      {d} days
                    </option>
                  ))}
                </select>
              </label>
            ) : outcome !== "not_interested" && outcome !== "wrong_contact" ? (
              <label className="flex flex-wrap items-center gap-2 text-[12.5px]">
                Agreed callback (your local time, optional)
                <input className="field max-w-[220px]" type="datetime-local" value={callbackAt} onChange={(e) => setCallbackAt(e.target.value)} disabled={busy} />
              </label>
            ) : null}
            <textarea className="field min-h-[110px]" placeholder="What did you hear? Objections, numbers, who owns freight, timing…" value={notes} onChange={(e) => editNotes(e.target.value)} aria-label="Notes" />
            {error && (
              <div className="text-[12px] text-[var(--bad)]" role="alert">
                {error.text} {error.retryable && "Your notes are saved; pressing Log outcome again is safe."}
              </div>
            )}
            <button className="btn btn-accent" onClick={submit} disabled={busy}>
              {busy ? "Analyzing…" : error?.retryable ? "Try again" : "Log outcome"}
            </button>
          </div>
        </div>
      )}

      {result && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-3 text-[13px]">
            <Ref label="Summary">{result.summary}</Ref>
            <Ref label="Objections">{result.objections.length ? result.objections.join("; ") : "None noted"}</Ref>
            <Ref label="Signals confirmed">{result.signalsExtracted.length ? result.signalsExtracted.join(", ") : "None"}</Ref>
            {result.nextAction && (
              <Ref label="Next action">
                <span className="font-medium">{result.nextAction.label}</span> <span className="text-[var(--muted)]">· {result.nextAction.reason}</span>
              </Ref>
            )}
            <div className="text-[11.5px] text-[var(--muted)]">Written by {result.generatedBy === "llm" ? "Claude" : "templates (no API key)"}.</div>
          </div>
          <div className="space-y-2">
            <div className="text-[12px] font-semibold uppercase tracking-wide text-[var(--muted)]">Follow-up draft</div>
            {result.followUpDraft ? (
              <>
                <input className="field" value={subject} onChange={(e) => setSubject(e.target.value)} disabled={approved || busy} aria-label="Subject" />
                <textarea className="field min-h-[140px]" value={body} onChange={(e) => setBody(e.target.value)} disabled={approved || busy} aria-label="Follow-up body" />
                {approved ? (
                  <div className="pill pill-good">Approved; it counts as sent once delivered or marked sent</div>
                ) : (
                  <button className="btn btn-primary" onClick={approve} disabled={busy}>
                    {busy ? "Approving…" : error ? "Try again" : "Review & approve"}
                  </button>
                )}
              </>
            ) : (
              <div className="text-[13px] text-[var(--muted)]">No follow-up needed.</div>
            )}
            {error && (
              <div className="text-[12px] text-[var(--bad)]" role="alert">
                {error.text}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Ref({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">{label}</div>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}
