"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export interface PanelContext {
  slug: string;
  company: string;
  opener: string;
  painHypothesis: string | null;
  proofLine: string | null;
  proofPlaceholder?: boolean;
  contact: { name: string; title: string; phone?: string; phoneVerified?: boolean; email?: string; linkedin?: string } | null;
  preparedFollowUp: { subject: string; body: string } | null;
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
  { key: "not_now", label: "Not now" },
  { key: "wrong_contact", label: "Wrong contact" },
];

/** Start conversation → log outcome → review the engine's summary, follow-up and next action. */
export function ConversationPanel({ ctx, onClose, autoOpen = false }: { ctx: PanelContext; onClose?: () => void; autoOpen?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(autoOpen);
  const [channel, setChannel] = useState<(typeof CHANNELS)[number]>("call");
  const [outcome, setOutcome] = useState("connected");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<LoggedConversation | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [approved, setApproved] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/conversations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug: ctx.slug, channel, outcome, notes }) });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error ?? "Could not log the conversation");
    const c: LoggedConversation = data.conversation;
    setResult(c);
    setSubject(c.followUpDraft?.subject ?? "");
    setBody(c.followUpDraft?.body ?? "");
    setApproved(c.approved);
    router.refresh();
  }

  async function approve() {
    if (!result) return;
    setBusy(true);
    const res = await fetch(`/api/conversations/${result.id}/approve`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ subject, body }) });
    setBusy(false);
    if (res.ok) {
      setApproved(true);
      router.refresh();
    } else setError("Could not approve the follow-up");
  }

  if (!open) {
    return (
      <button className="btn btn-accent" onClick={() => setOpen(true)}>
        Start conversation
      </button>
    );
  }

  return (
    <div className="card mt-3 border-[var(--border-strong)] p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-[13px] font-semibold">{result ? "Conversation logged" : `Conversation with ${ctx.contact?.name ?? ctx.company}`}</div>
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
            <Ref label="Open with">
              <span className="italic">“{ctx.opener}”</span>
            </Ref>
            {ctx.painHypothesis && <Ref label="Problem we think they have">{ctx.painHypothesis}</Ref>}
            {ctx.proofLine && (
              <Ref label="Proof to cite">
                {ctx.proofLine} {ctx.proofPlaceholder && <span className="pill pill-warn ml-1">placeholder</span>}
              </Ref>
            )}
            {ctx.contact && (
              <Ref label="Contact">
                {ctx.contact.name}, {ctx.contact.title}
                {ctx.contact.phone && (
                  <span className="ml-2 mono">
                    {ctx.contact.phone} {ctx.contact.phoneVerified ? <span className="pill pill-good ml-1">verified</span> : <span className="pill ml-1">unverified</span>}
                  </span>
                )}
              </Ref>
            )}
            {ctx.preparedFollowUp && (
              <Ref label="Prepared follow-up">
                <div className="font-medium">{ctx.preparedFollowUp.subject}</div>
                <div className="whitespace-pre-wrap text-[var(--text-2)]">{ctx.preparedFollowUp.body}</div>
              </Ref>
            )}
          </div>
          <div className="space-y-3">
            <div className="text-[12px] font-semibold uppercase tracking-wide text-[var(--muted)]">Log the outcome</div>
            <div className="flex flex-wrap gap-1.5">
              {CHANNELS.map((c) => (
                <button key={c} className={`btn btn-sm ${channel === c ? "btn-primary" : ""}`} onClick={() => setChannel(c)}>
                  {c}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {OUTCOMES.map((o) => (
                <button key={o.key} className={`btn btn-sm ${outcome === o.key ? "btn-primary" : ""}`} onClick={() => setOutcome(o.key)}>
                  {o.label}
                </button>
              ))}
            </div>
            <textarea className="field min-h-[110px]" placeholder="What did you hear? Objections, numbers, who owns freight, timing…" value={notes} onChange={(e) => setNotes(e.target.value)} />
            {error && <div className="text-[12px] text-[var(--bad)]">{error}</div>}
            <button className="btn btn-accent" onClick={submit} disabled={busy}>
              {busy ? "Analyzing…" : "Log outcome"}
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
                <input className="field" value={subject} onChange={(e) => setSubject(e.target.value)} disabled={approved} />
                <textarea className="field min-h-[140px]" value={body} onChange={(e) => setBody(e.target.value)} disabled={approved} />
                {approved ? (
                  <div className="pill pill-good">Approved and queued</div>
                ) : (
                  <button className="btn btn-primary" onClick={approve} disabled={busy}>
                    Approve & send
                  </button>
                )}
              </>
            ) : (
              <div className="text-[13px] text-[var(--muted)]">No follow-up needed.</div>
            )}
            {error && <div className="text-[12px] text-[var(--bad)]">{error}</div>}
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
