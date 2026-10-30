"use client";

import { useEffect, useMemo, useState } from "react";
import { newRequestId, submitProspect } from "@/components/landing/prospect-submit";
import { getVisitorId, track } from "@/components/landing/Tracker";
import { type AssessInputs, computeAssess, DEFAULT_INPUTS } from "./assess";

type Field = { key: keyof AssessInputs; label: string; unit: string; min: number; max: number; step: number };

const STEPS: { key: string; title: string; blurb: string; fields: Field[] }[] = [
  {
    key: "volume",
    title: "Your volume",
    blurb: "Everything below scales from these two numbers.",
    fields: [
      { key: "shipmentsPerMonth", label: "Shipments per month", unit: "per month", min: 0, max: 20000, step: 10 },
      { key: "hourlyCost", label: "Fully loaded hourly cost of coordination", unit: "$ / hour", min: 10, max: 250, step: 1 },
    ],
  },
  {
    key: "quoting",
    title: "Freight quoting",
    blurb: "Requesting rates, assembling quotes, getting them approved.",
    fields: [
      { key: "quotesPerWeek", label: "Quotes handled per week", unit: "per week", min: 0, max: 2000, step: 1 },
      { key: "minutesPerQuote", label: "Minutes per quote", unit: "min", min: 0, max: 120, step: 1 },
    ],
  },
  {
    key: "carrier",
    title: "Carrier communication",
    blurb: "Tendering, confirmations, check calls per load.",
    fields: [
      { key: "carriersContactedPerLoad", label: "Carriers contacted per load", unit: "carriers", min: 0, max: 20, step: 1 },
      { key: "minutesPerCarrierContact", label: "Minutes per contact", unit: "min", min: 0, max: 60, step: 1 },
    ],
  },
  {
    key: "tracking",
    title: "Shipment tracking",
    blurb: "Status checks across portals, emails and calls.",
    fields: [
      { key: "trackingChecksPerDay", label: "Tracking checks per day", unit: "per day", min: 0, max: 1000, step: 1 },
      { key: "minutesPerTrackingCheck", label: "Minutes per check", unit: "min", min: 0, max: 30, step: 1 },
    ],
  },
  {
    key: "exceptions",
    title: "Exceptions and growth",
    blurb: "Late trucks, rejections, re-books, and what happens when volume grows.",
    fields: [
      { key: "exceptionsPerWeek", label: "Exceptions per week", unit: "per week", min: 0, max: 500, step: 1 },
      { key: "minutesPerException", label: "Minutes per exception", unit: "min", min: 0, max: 240, step: 5 },
      { key: "expectedGrowthPercent", label: "Expected volume growth over 12 months", unit: "%", min: 0, max: 200, step: 5 },
    ],
  },
];

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;

export default function AssessmentForm({ slug, token, companyName, contactEmail }: { slug: string; token: string; companyName: string; contactEmail?: string }) {
  const [inputs, setInputs] = useState<AssessInputs>(DEFAULT_INPUTS);
  const [step, setStep] = useState(0);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [email, setEmail] = useState(contactEmail ?? "");
  const [requestId] = useState(newRequestId);
  const [assessmentSaved, setAssessmentSaved] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const results = useMemo(() => computeAssess(inputs), [inputs]);

  useEffect(() => {
    fetch(`/api/assessments?slug=${encodeURIComponent(slug)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.defaults && setInputs((cur) => ({ ...cur, ...d.defaults })))
      .catch(() => undefined);
  }, [slug]);

  const current = STEPS[step];
  const last = step === STEPS.length - 1;

  const set = (key: keyof AssessInputs, raw: string, f: Field) => {
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    setInputs((cur) => ({ ...cur, [key]: Math.min(f.max, Math.max(f.min, n)) }));
  };

  const save = async () => {
    if (state === "saving" || state === "saved") return;
    setState("saving");
    track(slug, "section_view", { section: "assessment_submit" });
    setFailure(null);
    try {
      // Step 1: save the assessment once (a retry after a later failure does not save it twice).
      if (!assessmentSaved) {
        const res = await fetch("/api/assessments", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ slug, inputs, source: "prospect", visitorId: getVisitorId() }),
        });
        if (!res.ok) {
          setState("error");
          return;
        }
        setAssessmentSaved(true);
      }
      // Step 2: with an email, ask for the written assessment (awaited, idempotent by requestId).
      const value = email.trim().toLowerCase();
      if (value) {
        const r = await submitProspect("/api/prospect/estimate", {
          slug,
          token,
          requestId,
          email: value,
          inputs: Object.fromEntries(Object.entries(inputs).filter(([, v]) => typeof v === "number")),
          results: { totalHoursPerWeek: results.totalHoursPerWeek, recoverableHoursHigh: results.recoverableHoursHigh, annualValueHigh: results.annualValueHigh },
          source: "assessment",
        });
        if (!r.ok) {
          setFailure(r.message);
          setState("error");
          return;
        }
      }
      setState("saved");
    } catch {
      setState("error");
    }
  };

  return (
    <div className="cp-assess">
      <div className="cp-assess__grid">
        <form className="cp-assess__form" onSubmit={(e) => e.preventDefault()} noValidate>
          <ol className="cp-assess__steps" aria-label="Steps">
            {STEPS.map((s, i) => (
              <li key={s.key}>
                <button type="button" className={`cp-assess__step${i === step ? " is-active" : ""}${i < step ? " is-done" : ""}`} onClick={() => setStep(i)}>
                  <span>{i + 1}</span> {s.title}
                </button>
              </li>
            ))}
          </ol>
          <h2 className="cp-assess__title">{current.title}</h2>
          <p className="cp-assess__blurb">{current.blurb}</p>
          {current.fields.map((f) => (
            <label className="cp-field" key={f.key}>
              <span className="cp-field__label">{f.label}</span>
              <span className="cp-field__control">
                <input className="cp-field__input" type="number" inputMode="decimal" min={f.min} max={f.max} step={f.step} value={inputs[f.key]} onChange={(e) => set(f.key, e.target.value, f)} />
                <span className="cp-field__unit">{f.unit}</span>
              </span>
              <input className="cp-field__slider" type="range" min={f.min} max={f.max} step={f.step} value={inputs[f.key]} onChange={(e) => set(f.key, e.target.value, f)} aria-label={`${f.label} slider`} />
            </label>
          ))}
          <div className="cp-assess__nav">
            <button type="button" className="cp-btn cp-btn--outline-dark cp-btn--compact" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
              Back
            </button>
            {!last ? (
              <button type="button" className="cp-btn cp-btn--primary cp-btn--compact" onClick={() => setStep((s) => s + 1)}>
                Next <span className="cp-arrow" aria-hidden="true">→</span>
              </button>
            ) : (
              <div className="cp-assess__save">
                <input className="cp-send__input" type="email" placeholder="you@company.com" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email for your assessment" />
                <button type="button" className="cp-btn cp-btn--primary cp-btn--compact" onClick={save} disabled={state === "saving" || state === "saved"}>
                  {state === "saved" ? "Saved" : state === "saving" ? "Saving…" : state === "error" ? "Try again" : "Save and send me this assessment"}
                </button>
              </div>
            )}
          </div>
          {state === "saved" && (
            <p className="cp-send__success-text">
              Saved. Your Cartage contact will send the written assessment{email ? ` to ${email}` : ""}. Want to walk through it live?{" "}
              <a href={`/for/${slug}-${token}#talk`}>Book 15 minutes</a>.
            </p>
          )}
          {state === "error" && (
            <p className="cp-send__error" role="alert">
              {assessmentSaved ? `Your numbers are saved, but the email request didn't go through${failure ? ` (${failure})` : ""}. Press the button to try again.` : "Could not save right now. Your numbers are still on this page; try again in a moment."}
            </p>
          )}
        </form>

        <aside className="cp-assess__results" aria-live="polite">
          <p className="cp-assess__flag">Estimate, not verified data</p>
          <p className="cp-label">Manual coordination today</p>
          <p className="cp-stat__value">{results.totalHoursPerWeek} hrs / week</p>
          <p className="cp-label">Potentially recoverable with Wilson</p>
          <p className="cp-stat__value">
            {results.recoverableHoursLow}–{results.recoverableHoursHigh} hrs / week
          </p>
          <p className="cp-label">Annual value of that time</p>
          <p className="cp-stat__value">
            {money(results.annualValueLow)}–{money(results.annualValueHigh)}
          </p>
          <ul className="cp-assess__areas">
            {results.areas.map((a) => (
              <li key={a.key}>
                <div className="cp-assess__area-head">
                  <span>{a.label}</span>
                  <span>{a.hoursPerWeek} hrs</span>
                </div>
                <div className="cp-assess__bar" aria-hidden="true">
                  <span style={{ width: `${results.totalHoursPerWeek ? Math.min(100, (a.hoursPerWeek / results.totalHoursPerWeek) * 100) : 0}%` }} />
                </div>
                <p className="cp-assess__area-note">
                  {Math.round(a.automationLow * 100)}–{Math.round(a.automationHigh * 100)}% automatable. {a.note}
                </p>
              </li>
            ))}
          </ul>
          <details className="cp-assess__assumptions">
            <summary>How this is estimated for {companyName}</summary>
            <ul>
              {results.assumptions.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </details>
        </aside>
      </div>
    </div>
  );
}
