"use client";

import { useEffect, useRef, useState } from "react";
import type { RoiDefaults } from "@/lib/types";
import { track } from "./Tracker";

const WEEKS_PER_MONTH = 4.33;
const SAVINGS_RATE = 0.6;

function fmtInt(n: number): string {
  return Math.round(n).toLocaleString();
}

function fmtMoney(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}

/**
 * Interactive ROI calculator prefilled with the account's defaults. Inputs are
 * tracked (debounced) so reps see what the prospect actually entered.
 */
export default function ROICalculator({ slug, defaults }: { slug: string; defaults: RoiDefaults }) {
  const [shipments, setShipments] = useState(defaults.shipmentsPerMonth);
  const [minutes, setMinutes] = useState(defaults.minutesPerShipment);
  const [hourly, setHourly] = useState(defaults.hourlyCost);
  const [coordinators, setCoordinators] = useState(defaults.coordinators);
  const [showAssumptions, setShowAssumptions] = useState(false);

  const touchedRef = useRef(false);
  const completedRef = useRef(false);
  const pricingRef = useRef(false);
  const inputTimer = useRef<number | null>(null);
  const completeTimer = useRef<number | null>(null);

  const hoursPerWeek = (shipments * minutes) / 60 / WEEKS_PER_MONTH;
  const hoursSaved = hoursPerWeek * SAVINGS_RATE;
  const annualSaved = hoursSaved * 52 * hourly;
  const headcountAvoided = Math.round((hoursSaved / 40) * 10) / 10;
  const coveragePct = coordinators > 0 ? Math.min(100, Math.round((hoursPerWeek / (coordinators * 40)) * 100)) : 0;

  const onChange = (field: string, value: number, setter: (n: number) => void) => {
    setter(value);
    touchedRef.current = true;
    if (inputTimer.current) window.clearTimeout(inputTimer.current);
    inputTimer.current = window.setTimeout(() => track(slug, "calculator_input", { field, value }), 600);
  };

  useEffect(() => {
    if (!touchedRef.current || completedRef.current) return;
    if (completeTimer.current) window.clearTimeout(completeTimer.current);
    completeTimer.current = window.setTimeout(() => {
      if (completedRef.current) return;
      completedRef.current = true;
      track(slug, "calculator_completed", { shipmentsPerMonth: shipments, hoursSaved: Math.round(hoursSaved) });
    }, 1500);
    return () => {
      if (completeTimer.current) window.clearTimeout(completeTimer.current);
    };
  }, [slug, shipments, minutes, hourly, coordinators, hoursSaved]);

  const toggleAssumptions = () => {
    const next = !showAssumptions;
    setShowAssumptions(next);
    if (next && !pricingRef.current) {
      pricingRef.current = true;
      track(slug, "pricing_viewed", { source: "roi_assumptions" });
    }
  };

  const field = (label: string, value: number, setter: (n: number) => void, key: string, opts: { min?: number; step?: number; prefix?: string; suffix?: string } = {}) => (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-slate-700">{label}</span>
      <div className="flex items-center rounded-lg border border-slate-300 bg-white focus-within:border-orange-500 focus-within:ring-2 focus-within:ring-orange-500/20">
        {opts.prefix && <span className="pl-3 text-slate-500">{opts.prefix}</span>}
        <input
          type="number"
          inputMode="decimal"
          min={opts.min ?? 0}
          step={opts.step ?? 1}
          value={Number.isFinite(value) ? value : ""}
          onChange={(e) => onChange(key, Math.max(0, Number(e.target.value) || 0), setter)}
          className="w-full bg-transparent px-3 py-2.5 text-base text-slate-900 outline-none"
        />
        {opts.suffix && <span className="pr-3 text-sm text-slate-500">{opts.suffix}</span>}
      </div>
    </label>
  );

  return (
    <div className="grid gap-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm md:grid-cols-5 md:p-8">
      <div className="grid gap-4 md:col-span-3 md:grid-cols-2">
        {field("Shipments per month", shipments, setShipments, "shipmentsPerMonth", { step: 10 })}
        {field("Coordination minutes per shipment", minutes, setMinutes, "minutesPerShipment", { suffix: "min" })}
        {field("Loaded hourly cost of coordination", hourly, setHourly, "hourlyCost", { prefix: "$", suffix: "/hr" })}
        {field("Coordinators on the team today", coordinators, setCoordinators, "coordinators", { step: 1 })}
        <div className="md:col-span-2">
          <button type="button" onClick={toggleAssumptions} className="text-sm font-medium text-orange-600 underline-offset-4 hover:underline" aria-expanded={showAssumptions}>
            {showAssumptions ? "Hide" : "How we estimate this"}
          </button>
          {showAssumptions && (
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm leading-6 text-slate-600">
              <li>Current coordination hours per week = shipments x minutes per shipment / 60 / 4.33 weeks.</li>
              <li>We assume a managed program removes about 60% of that time (tendering, tracking, exception follow-up). Customers in the case studies on this page landed between 55% and 70%.</li>
              <li>Annual cost saved = hours saved per week x 52 x loaded hourly cost.</li>
              <li>Headcount avoided = hours saved per week / 40. Most teams redeploy rather than reduce.</li>
              <li>Freight cost savings (typically 8 to 12% per shipment) are not included in these numbers.</li>
            </ul>
          )}
        </div>
      </div>

      <div className="rounded-xl bg-slate-50 p-5 md:col-span-2">
        <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Your estimate</div>
        <dl className="mt-4 space-y-4">
          <div>
            <dt className="text-sm text-slate-600">Coordination hours today</dt>
            <dd className="text-2xl font-semibold text-slate-900">
              {fmtInt(hoursPerWeek)} <span className="text-sm font-normal text-slate-500">hrs / week</span>
            </dd>
            <div className="mt-1 text-xs text-slate-500">{coveragePct}% of your coordinators&apos; capacity</div>
          </div>
          <div>
            <dt className="text-sm text-slate-600">Hours back per week</dt>
            <dd className="text-3xl font-bold text-orange-600">{fmtInt(hoursSaved)}</dd>
          </div>
          <div>
            <dt className="text-sm text-slate-600">Annual coordination cost saved</dt>
            <dd className="text-2xl font-semibold text-slate-900">{fmtMoney(annualSaved)}</dd>
          </div>
          <div>
            <dt className="text-sm text-slate-600">Coordinator headcount avoided</dt>
            <dd className="text-2xl font-semibold text-slate-900">{headcountAvoided.toFixed(1)} FTE</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
