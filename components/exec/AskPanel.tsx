"use client";

import { useState } from "react";

interface Answer {
  question: string;
  answer: string;
  evidence: { label: string; value: string }[];
  caveats: string[];
  source: "llm" | "rules";
}

const SUGGESTED = ["How are we doing on pipeline this month?", "Which buying signals convert best?", "Do we need another BDR?", "What is our cost per qualified opportunity?", "Which experiments are winning?"];

export function AskPanel() {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [answer, setAnswer] = useState<Answer | null>(null);

  async function ask(question: string) {
    if (!question.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setAnswer(data as Answer);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card p-4">
      <div className="card-title">Ask about performance</div>
      <div className="card-hint mt-0.5">Answers come from the underlying data and show their evidence.</div>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(q);
        }}
      >
        <input className="field" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. Which industries should we double down on?" aria-label="Question" />
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? "Thinking…" : "Ask"}
        </button>
      </form>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {SUGGESTED.map((s) => (
          <button key={s} type="button" className="pill hover:bg-[var(--surface)]" onClick={() => { setQ(s); void ask(s); }} disabled={busy}>
            {s}
          </button>
        ))}
      </div>
      {error && <div className="mt-3 text-[12px] text-[var(--bad)]">{error}</div>}
      {answer && (
        <div className="mt-4 border-t border-[var(--border)] pt-3">
          <div className="flex items-start justify-between gap-2">
            <p className="text-[13.5px] leading-relaxed">{answer.answer}</p>
            <span className={`pill ${answer.source === "llm" ? "pill-info" : ""}`} title={answer.source === "llm" ? "Written by Claude from the data pack" : "Rule-based analysis (no API key)"}>
              {answer.source === "llm" ? "Claude" : "rules"}
            </span>
          </div>
          {answer.evidence.length > 0 && (
            <table className="table mt-3">
              <thead>
                <tr>
                  <th>Evidence</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                {answer.evidence.slice(0, 12).map((e, i) => (
                  <tr key={i}>
                    <td className="text-[var(--text-2)]">{e.label}</td>
                    <td className="mono">{e.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {answer.caveats.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-[12px] text-[var(--muted)]">
              {answer.caveats.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
