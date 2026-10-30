"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { newRequestId, requestJson } from "@/lib/client/request";

/** Per-person actions in the buying group: replace (wrong person), pause, resume. History is always kept. */
export function ContactActions({ contactId, name, status }: { contactId: string; name: string; status: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<"idle" | "replace">("idle");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requestId, setRequestId] = useState(newRequestId);

  async function act(action: "replace" | "pause" | "resume") {
    if (busy) return;
    setBusy(true);
    setError(null);
    const r = await requestJson(`/api/contacts/${contactId}`, { requestId, body: { action, ...(reason.trim() ? { reason: reason.trim() } : {}) } });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setRequestId(newRequestId());
    setMode("idle");
    setReason("");
    router.refresh();
  }

  if (mode === "replace") {
    return (
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input className="field max-w-[280px]" placeholder={`Why ${name.split(" ")[0]} is the wrong person`} aria-label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} disabled={busy} />
        <button className="btn btn-sm btn-primary" onClick={() => act("replace")} disabled={busy}>
          {busy ? "Replacing…" : "Replace"}
        </button>
        <button className="btn btn-sm btn-ghost" onClick={() => setMode("idle")} disabled={busy}>
          Cancel
        </button>
        {error && <span className="text-[12px] text-[var(--bad)]">{error}</span>}
      </div>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {status === "selected" && (
        <button className="btn btn-sm btn-ghost" onClick={() => act("pause")} disabled={busy}>
          Pause
        </button>
      )}
      {status === "paused" && (
        <button className="btn btn-sm" onClick={() => act("resume")} disabled={busy}>
          Resume
        </button>
      )}
      {(status === "selected" || status === "paused" || status === "candidate") && (
        <button className="btn btn-sm btn-ghost" onClick={() => setMode("replace")} disabled={busy}>
          Wrong person
        </button>
      )}
      {error && <span className="text-[12px] text-[var(--bad)]">{error}</span>}
    </span>
  );
}

/** Ask the contact research team to look again (new people, pending verifications, gaps). */
export function ResearchContactsButton({ slug }: { slug: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  async function go() {
    if (busy) return;
    setBusy(true);
    const r = await requestJson<{ coverage: { summary: string } }>(`/api/accounts/${slug}/contacts`, { requestId: newRequestId(), body: { action: "research" }, timeoutMs: 60_000 });
    setBusy(false);
    setNote(r.ok ? r.data.coverage.summary : r.error);
    if (r.ok) router.refresh();
  }
  return (
    <span className="inline-flex items-center gap-2">
      <button className="btn btn-sm" onClick={go} disabled={busy}>
        {busy ? "Researching…" : "Research more"}
      </button>
      {note && <span className="text-[12px] text-[var(--muted)]">{note}</span>}
    </span>
  );
}
