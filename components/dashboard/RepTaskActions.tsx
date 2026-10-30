"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { OutreachTouch } from "@/lib/types";
import { Spinner } from "./PipelineControls";

/** Actions for a touch the active provider cannot send itself (LinkedIn, InMail, gifts, or email without a sender). */
export function RepTaskActions({ touch }: { touch: OutreachTouch }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(touch.subject ? `${touch.subject}\n\n${touch.body}` : touch.body);
      setMsg("copied");
      setTimeout(() => setMsg(null), 1500);
    } catch {
      setMsg("copy failed");
    }
  }

  async function set(status: "sent" | "skipped") {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/outreach/${encodeURIComponent(touch.id)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        let error = `HTTP ${res.status}`;
        try {
          error = ((await res.json()) as { error?: string }).error ?? error;
        } catch {
          /* ignore */
        }
        setMsg(error);
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      <button className="btn px-2 py-1 text-xs" onClick={copy} disabled={busy}>
        Copy message
      </button>
      {touch.taskUrl && (
        <a href={touch.taskUrl} target="_blank" rel="noreferrer" className="btn px-2 py-1 text-xs no-underline">
          Open ↗
        </a>
      )}
      <button className="btn btn-accent px-2 py-1 text-xs" onClick={() => set("sent")} disabled={busy}>
        {busy ? <Spinner /> : null} Mark sent
      </button>
      <button className="btn px-2 py-1 text-xs text-[var(--muted)]" onClick={() => set("skipped")} disabled={busy}>
        Skip
      </button>
      {msg && <span className="text-xs text-[var(--muted)]">{msg}</span>}
    </div>
  );
}
