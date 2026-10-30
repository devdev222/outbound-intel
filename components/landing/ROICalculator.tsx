"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useCalcState } from "./CalcState";
import {
  compute,
  currencySymbol,
  explain,
  formatHours,
  formatMoney,
  isCurrency,
  parseField,
  roundOutputs,
  workflowLine,
  type CalcInputs,
  type NumericField,
  type WorkflowTag,
} from "./calc";
import { track } from "./Tracker";

/**
 * Time / value calculator: a React port of cartage-pages' Calculator.astro +
 * scripts/calculator.ts. Same fields, limits, slider ranges, formatting and
 * "Why this estimate" sentence. Engine events:
 *   calculator_input      { field, value, alias: "calc_input_changed" }   (debounced 600ms per field)
 *   calculator_completed  { ...inputs, ...results, alias: "calc_engaged" } (once, on first interaction)
 */

const FIELDS: { field: NumericField; label: string; unit: string; sliderMax: number; step: number }[] = [
  { field: "shipments_per_month", label: "Shipments per month", unit: "per month", sliderMax: 5000, step: 10 },
  { field: "minutes_per_shipment", label: "Manual coordination minutes per shipment", unit: "min", sliderMax: 120, step: 1 },
  { field: "automation_percent", label: "Percent of that work Cartage could handle", unit: "%", sliderMax: 100, step: 1 },
  { field: "hourly_cost", label: "Fully loaded hourly labor cost", unit: "/ hour", sliderMax: 150, step: 1 },
];

const COMMON = ["USD", "CAD", "MXN", "EUR", "GBP", "AUD"];

function currencyOptions(): { code: string; name: string }[] {
  let all: string[] = COMMON;
  try {
    const intl = Intl as unknown as { supportedValuesOf?: (k: string) => string[] };
    if (intl.supportedValuesOf) all = intl.supportedValuesOf("currency");
  } catch {
    /* older runtimes */
  }
  let names: Intl.DisplayNames | null = null;
  try {
    names = new Intl.DisplayNames(["en"], { type: "currency" });
  } catch {
    names = null;
  }
  return [...COMMON, ...all.filter((c) => !COMMON.includes(c))].map((code) => ({ code, name: names?.of(code) ?? code }));
}

function sliderBackground(value: number, max: number): string {
  const pct = (value / (max || 1)) * 100;
  return `linear-gradient(to right, var(--color-ink) ${pct}%, var(--color-surface-strong) ${pct}%) center / 100% 2px no-repeat`;
}

export interface ROICalculatorProps {
  slug: string;
  workflowTags: WorkflowTag[];
}

export default function ROICalculator({ slug, workflowTags }: ROICalculatorProps) {
  const { inputs, outputs, setInputs } = useCalcState();
  const [drafts, setDrafts] = useState<Record<NumericField, string>>({
    shipments_per_month: String(inputs.shipments_per_month),
    minutes_per_shipment: String(inputs.minutes_per_shipment),
    automation_percent: String(inputs.automation_percent),
    hourly_cost: String(inputs.hourly_cost),
  });
  const engagedRef = useRef(false);
  const timersRef = useRef<Map<string, number>>(new Map());
  const currencies = useMemo(currencyOptions, []);
  const symbol = currencySymbol(inputs.currency);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const t of timers.values()) window.clearTimeout(t);
    };
  }, []);

  const changed = (field: string, value: number | string, next: CalcInputs) => {
    if (!engagedRef.current) {
      engagedRef.current = true;
      track(slug, "calculator_completed", { ...next, ...roundOutputs(compute(next)), alias: "calc_engaged" });
    }
    window.clearTimeout(timersRef.current.get(field));
    timersRef.current.set(
      field,
      window.setTimeout(() => track(slug, "calculator_input", { field, value, alias: "calc_input_changed" }), 600),
    );
  };

  const commit = (field: NumericField, value: number) => {
    if (value === inputs[field]) return;
    const next = { ...inputs, [field]: value };
    setInputs(next);
    changed(field, value, next);
  };

  const onText = (field: NumericField, raw: string) => {
    setDrafts((d) => ({ ...d, [field]: raw }));
    // Mid-edit states (cleared field, a lone ".") keep the last valid value until the visitor finishes.
    if (raw.trim() === "" || raw.trim() === ".") return;
    const parsed = parseField(field, raw);
    if (parsed === null) {
      setDrafts((d) => ({ ...d, [field]: String(inputs[field]) }));
      return;
    }
    const typed = Number(raw.replace(/[,\s]/g, ""));
    if (Number.isFinite(typed) && typed > parsed) setDrafts((d) => ({ ...d, [field]: String(parsed) })); // clamped
    commit(field, parsed);
  };

  const onBlur = (field: NumericField) => {
    if (parseField(field, drafts[field]) === null) setDrafts((d) => ({ ...d, [field]: String(inputs[field]) }));
  };

  const onSlider = (field: NumericField, raw: string) => {
    const v = Number(raw);
    setDrafts((d) => ({ ...d, [field]: String(v) }));
    commit(field, v);
  };

  const onCurrency = (code: string) => {
    if (!isCurrency(code)) return;
    const next = { ...inputs, currency: code.toUpperCase() };
    setInputs(next);
    changed("currency", next.currency, next);
  };

  const stats = [
    { key: "monthly_hours_recovered", label: "Hours recovered per month", value: formatHours(outputs.monthly_hours_recovered) },
    { key: "annual_hours_recovered", label: "Hours recovered per year", value: formatHours(outputs.annual_hours_recovered) },
    { key: "monthly_capacity_value", label: "Monthly capacity value", value: formatMoney(outputs.monthly_capacity_value, inputs.currency) },
    { key: "annual_capacity_value", label: "Annual capacity value", value: formatMoney(outputs.annual_capacity_value, inputs.currency) },
  ];

  return (
    <div className="cp-calc__grid" data-calculator>
      <form className="cp-calc__inputs" noValidate onSubmit={(e) => e.preventDefault()}>
        {FIELDS.map((f) => {
          const max = Math.max(f.sliderMax, inputs[f.field]);
          return (
            <div className="cp-field" key={f.field}>
              <label className="cp-field__label" htmlFor={`calc-${f.field}`}>
                {f.label}
              </label>
              <div className="cp-field__control">
                {f.field === "hourly_cost" && <span className="cp-field__prefix">{symbol}</span>}
                <input
                  id={`calc-${f.field}`}
                  className="cp-field__input"
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  spellCheck={false}
                  value={drafts[f.field]}
                  onChange={(e) => onText(f.field, e.target.value)}
                  onBlur={() => onBlur(f.field)}
                />
                <span className="cp-field__unit">{f.unit}</span>
              </div>
              <input
                className="cp-field__slider"
                type="range"
                min={0}
                max={max}
                step={f.step}
                value={Math.min(inputs[f.field], max)}
                onChange={(e) => onSlider(f.field, e.target.value)}
                aria-label={`${f.label} slider`}
                tabIndex={-1}
                style={{ background: sliderBackground(Math.min(inputs[f.field], max), max) }}
              />
            </div>
          );
        })}
        <div className="cp-field">
          <label className="cp-field__label" htmlFor="calc-currency">
            Currency
          </label>
          <div className="cp-field__control cp-field__control--select">
            <select id="calc-currency" className="cp-field__input" value={inputs.currency} onChange={(e) => onCurrency(e.target.value)}>
              {currencies.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} · {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </form>

      <div className="cp-calc__results">
        <div className="cp-calc__outputs">
          {stats.map((o, i) => (
            <div className={`cp-stat${i === 3 ? " cp-stat--feature" : ""}`} key={o.key}>
              <p className="cp-stat__label">{o.label}</p>
              <p className="cp-stat__value" data-output={o.key}>
                {o.value}
              </p>
            </div>
          ))}
        </div>
        <div className="cp-why-box">
          <p className="cp-why-box__title">Why this estimate</p>
          <p className="cp-why-box__text" aria-live="polite">
            {explain(inputs, outputs)}
          </p>
          <p className="cp-why-box__tags">{workflowLine(workflowTags)}</p>
        </div>
      </div>
    </div>
  );
}
