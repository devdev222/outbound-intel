"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { newRequestId, requestJson } from "@/lib/client/request";
import type { OutcomeType } from "@/lib/types";
import { Spinner } from "./PipelineControls";

const OUTCOMES: { type: OutcomeType; label: string; good?: boolean; bad?: boolean }[] = [
  { type: "replied", label: "Replied" },
  { type: "meeting_booked", label: "Meeting booked", good: true },
  { type: "opportunity_created", label: "Opportunity created", good: true },
  { type: "deal_won", label: "Deal won", good: true },
  { type: "deal_lost", label: "Deal lost", bad: true },
  { type: "no_response", label: "No response", bad: true },
  { type: "disqualified", label: "Disqualified", bad: true },
];

export function OutcomeButtons({ slug }: { slug: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // One request id per click: a retry after a timeout never records the outcome twice.
  async function post(label: string, url: string, body?: unknown) {
    setBusy(label);
    setMessage(null);
    const r = await requestJson<Record<string, unknown>>(url, { body, requestId: newRequestId() });
    setBusy(null);
    if (!r.ok) return setMessage(`${label} failed: ${r.error}`);
    const data = r.data;
    if ("fedBack" in data) setMessage(`${label}: status ${String(data.status)}${data.fedBack ? " · fed back to history; Learning Agent will retrain" : ""}`);
    else if (data.run && typeof data.run === "object") setMessage(`${label}: ${String((data.run as { summary?: string }).summary ?? "done")}`);
    else setMessage(`${label}: done`);
    router.refresh();
  }

  function outcome(o: (typeof OUTCOMES)[number]) {
    let value: number | undefined;
    if (o.type === "deal_won") {
      const raw = window.prompt("Deal value (USD)?", "120000");
      if (raw === null) return;
      value = Number(raw) || undefined;
    }
    void post(o.label, "/api/outcomes", { slug, outcomeType: o.type, value, notes: "dashboard" });
  }

  return (
    <div className="panel p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="font-semibold">Log outcome</h2>
        <span className="text-xs text-[var(--muted)]">terminal outcomes retrain the model</span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {OUTCOMES.map((o) => (
          <button
            key={o.type}
            className={`btn ${o.good ? "text-[var(--good)]" : ""} ${o.bad ? "text-[var(--bad)]" : ""}`}
            disabled={busy !== null}
            onClick={() => outcome(o)}
          >
            {busy === o.label ? <Spinner /> : null} {o.label}
          </button>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-2 border-t border-[var(--border)] pt-3">
        <button className="btn" disabled={busy !== null} onClick={() => post("Re-score", "/api/agents/scoring/run")}>
          {busy === "Re-score" ? <Spinner /> : null} Re-score now
        </button>
        <button className="btn" disabled={busy !== null} onClick={() => post("Activate Jerry", "/api/agents/jerry/run")}>
          {busy === "Activate Jerry" ? <Spinner /> : null} Activate Jerry now
        </button>
      </div>
      {message && <div className="mono mt-3 text-xs text-[var(--muted)]">{message}</div>}
    </div>
  );
}
