"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { TaskAction } from "@/lib/engine/tasks";
import type { Task } from "@/lib/types";
import { Spinner } from "./PipelineControls";

/**
 * The buttons for one task. The primary action comes from the server
 * (primaryActionFor), because only the server knows which adapter can send:
 *   review_approve -> "Review & approve" (approval never sends)
 *   send_email     -> "Send email" (sent only when the provider acknowledges)
 *   mark_sent      -> "Mark manually sent" (you sent it outside the platform)
 *   mark_done      -> "Mark done"
 *   retry          -> "Retry delivery"
 */
const LABEL: Record<TaskAction, string> = {
  review_approve: "Review & approve",
  send_email: "Send email",
  mark_sent: "Mark manually sent",
  mark_done: "Mark done",
  retry: "Retry delivery",
  none: "",
};

async function post(id: string, body: Record<string, unknown>): Promise<{ ok: boolean; error?: string; state?: string }> {
  const res = await fetch(`/api/tasks/${encodeURIComponent(id)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; state?: string };
  return { ok: res.ok && data.ok !== false, error: data.error ?? (res.ok ? undefined : `HTTP ${res.status}`), state: data.state };
}

export function TaskActions({ task, action, compact = false, minimal = false }: { task: Task; action: TaskAction; compact?: boolean; minimal?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [subject, setSubject] = useState(task.subject ?? "");
  const [body, setBody] = useState(task.body);

  async function run(payload: Record<string, unknown>, done?: string) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await post(task.id, payload);
      if (!r.ok) {
        setMsg(r.error ?? "failed");
        return;
      }
      if (r.state === "retry_scheduled") setMsg("provider did not confirm; retry scheduled");
      else if (done) setMsg(done);
      setReviewing(false);
      router.refresh();
    } catch {
      setMsg("network error; try again");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(task.subject ? `${task.subject}\n\n${task.body}` : task.body);
      setMsg("copied");
      setTimeout(() => setMsg(null), 1500);
    } catch {
      setMsg("copy failed");
    }
  }

  const primary = () => {
    if (action === "review_approve") setReviewing((v) => !v);
    else if (action === "send_email" || action === "retry") void run({ action: "send" });
    else if (action === "mark_sent" || action === "mark_done") void run({ action: "complete_manual" });
  };

  const size = compact ? "px-2 py-1 text-xs" : "px-3 py-1.5 text-sm";
  const isMessage = task.channel === "email" || task.channel === "linkedin" || task.channel === "inmail";

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {action !== "none" && (
          <button className={`btn btn-accent ${size}`} onClick={primary} disabled={busy}>
            {busy ? <Spinner /> : null} {LABEL[action]}
          </button>
        )}
        {action === "none" && task.status === "scheduled" && <span className="text-xs text-[var(--muted)]">Approved; the scheduler delivers it {task.scheduledFor.slice(0, 10)}</span>}
        {action === "none" && task.status === "sending" && <span className="text-xs text-[var(--muted)]">Delivering; waiting for the provider</span>}
        {isMessage && !minimal && (
          <button className={`btn ${size}`} onClick={copy} disabled={busy}>
            Copy message
          </button>
        )}
        {task.taskUrl && (
          <a href={task.taskUrl} target="_blank" rel="noreferrer" className={`btn ${size} no-underline`}>
            Open {task.channel === "email" ? "email" : task.channel === "linkedin" || task.channel === "inmail" ? "LinkedIn" : ""} ↗
          </a>
        )}
        {(action === "retry" || action === "send_email") && !minimal && (
          <button className={`btn ${size}`} onClick={() => run({ action: "complete_manual" })} disabled={busy}>
            Mark manually sent
          </button>
        )}
        {task.status !== "sending" && !minimal && (
          <button className={`btn ${size} text-[var(--muted)]`} onClick={() => run({ action: "skip" })} disabled={busy}>
            Skip
          </button>
        )}
        {msg && <span className="text-xs text-[var(--muted)]">{msg}</span>}
      </div>
      {task.status === "failed" && task.lastError && <p className="text-xs text-[var(--danger,#b42318)]">Last delivery error: {task.lastError}</p>}
      {reviewing && (
        <div className="space-y-2 rounded-md border border-[var(--border)] p-2">
          {task.channel === "email" && <input className="input w-full text-sm" value={subject} onChange={(e) => setSubject(e.target.value)} aria-label="Subject" />}
          <textarea className="input min-h-32 w-full text-sm" value={body} onChange={(e) => setBody(e.target.value)} aria-label="Message" />
          <div className="flex items-center gap-2">
            <button className={`btn btn-accent ${size}`} onClick={() => run({ action: "approve", subject: task.channel === "email" ? subject : undefined, body }, "approved; not sent yet")} disabled={busy || !body.trim()}>
              {busy ? <Spinner /> : null} Approve
            </button>
            <span className="text-xs text-[var(--muted)]">Approving schedules it. It counts as sent only after delivery or when you mark it sent.</span>
          </div>
        </div>
      )}
    </div>
  );
}
