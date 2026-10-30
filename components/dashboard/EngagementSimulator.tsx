"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Spinner } from "./PipelineControls";

type Scenario = "visit" | "video" | "calculator" | "case_study" | "return" | "reply" | "booking" | "hot";

const BUTTONS: { scenario: Scenario; label: string; accent?: boolean }[] = [
  { scenario: "visit", label: "Visit page" },
  { scenario: "video", label: "Watch 85% of video" },
  { scenario: "calculator", label: "Use ROI calculator (500/mo)" },
  { scenario: "case_study", label: "View case study" },
  { scenario: "return", label: "Return visit" },
  { scenario: "reply", label: "Reply to email" },
  { scenario: "booking", label: "Click book" },
  { scenario: "hot", label: "Run hot-lead scenario", accent: true },
];

interface SimulateResult {
  ok: boolean;
  events: string[];
  engagementScore: number;
  priority: number;
  status: string;
  activationTriggered: boolean;
  alertDelivered: boolean;
  error?: string;
}

export function EngagementSimulator({ slug }: { slug: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<Scenario | null>(null);
  const [result, setResult] = useState<SimulateResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function fire(scenario: Scenario) {
    setBusy(scenario);
    setError(null);
    try {
      const res = await fetch("/api/simulate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug, scenario }),
      });
      const data = (await res.json()) as SimulateResult;
      if (!res.ok || data.ok === false) throw new Error(data.error ?? `HTTP ${res.status}`);
      setResult(data);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="panel p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="font-semibold">Engagement simulator</h2>
        <span className="text-xs text-[var(--muted)]">fires real events through /api/track logic</span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {BUTTONS.map((b) => (
          <button key={b.scenario} className={`btn ${b.accent ? "btn-accent" : ""}`} disabled={busy !== null} onClick={() => fire(b.scenario)}>
            {busy === b.scenario ? <Spinner /> : null} {b.label}
          </button>
        ))}
      </div>
      {error && <div className="mt-3 text-sm text-[var(--bad)]">{error}</div>}
      {result && (
        <div className="mt-3 grid gap-2 rounded-md bg-[var(--panel-2)] p-3 text-xs sm:grid-cols-5">
          <Stat label="events" value={result.events.join(", ") || "-"} wide />
          <Stat label="engagement" value={String(result.engagementScore)} />
          <Stat label="priority" value={String(result.priority)} />
          <Stat label="status" value={result.status.replace(/_/g, " ")} />
          <Stat label="activation" value={result.activationTriggered ? (result.alertDelivered ? "triggered · alert delivered" : "triggered · alert pending") : "not triggered"} highlight={result.activationTriggered} />
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, wide, highlight }: { label: string; value: string; wide?: boolean; highlight?: boolean }) {
  return (
    <div className={wide ? "sm:col-span-5" : ""}>
      <div className="text-[10px] uppercase tracking-wider text-[var(--muted)]">{label}</div>
      <div className={`mono ${highlight ? "text-[var(--accent-2)]" : ""}`}>{value}</div>
    </div>
  );
}
