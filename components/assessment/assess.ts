/**
 * Client-side port of lib/engine/assessment.ts computeAssessment. Kept in
 * lockstep with the server formula so the live preview and the saved result
 * agree. Everything here is an assumption-based estimate.
 */
export interface AssessInputs {
  shipmentsPerMonth: number;
  quotesPerWeek: number;
  minutesPerQuote: number;
  carriersContactedPerLoad: number;
  minutesPerCarrierContact: number;
  trackingChecksPerDay: number;
  minutesPerTrackingCheck: number;
  exceptionsPerWeek: number;
  minutesPerException: number;
  expectedGrowthPercent: number;
  hourlyCost: number;
}

export interface AssessArea {
  key: "quoting" | "carrier_communication" | "tracking" | "exceptions" | "scalability";
  label: string;
  hoursPerWeek: number;
  automationLow: number;
  automationHigh: number;
  note: string;
}

export interface AssessResults {
  areas: AssessArea[];
  totalHoursPerWeek: number;
  recoverableHoursLow: number;
  recoverableHoursHigh: number;
  annualValueLow: number;
  annualValueHigh: number;
  assumptions: string[];
}

export const ASSUMPTIONS = [
  "Automation ranges reflect what managed transportation programs typically absorb for comparable workflows; your actual share depends on lane mix and systems.",
  "Hours are derived only from the inputs you entered; nothing here is verified against your operations data.",
  "Annual value uses your fully loaded hourly cost and 50 working weeks.",
  "Scalability estimates the added weekly hours if volume grows by the expected percentage and the process stays manual.",
];

const r1 = (n: number) => Math.round(n * 10) / 10;

export function computeAssess(i: AssessInputs): AssessResults {
  const loadsPerWeek = i.shipmentsPerMonth / 4.33;
  const quoting = (i.quotesPerWeek * i.minutesPerQuote) / 60;
  const carrier = (loadsPerWeek * i.carriersContactedPerLoad * i.minutesPerCarrierContact) / 60;
  const tracking = (i.trackingChecksPerDay * 5 * i.minutesPerTrackingCheck) / 60;
  const exceptions = (i.exceptionsPerWeek * i.minutesPerException) / 60;
  const manualBase = quoting + carrier + tracking + exceptions;
  const scalability = manualBase * (i.expectedGrowthPercent / 100);
  const areas: AssessArea[] = [
    { key: "quoting", label: "Freight quoting", hoursPerWeek: r1(quoting), automationLow: 0.5, automationHigh: 0.8, note: "Rate retrieval and quote assembly are highly automatable; approvals stay human." },
    { key: "carrier_communication", label: "Carrier communication", hoursPerWeek: r1(carrier), automationLow: 0.6, automationHigh: 0.9, note: "Tendering, confirmations and check calls move to the managed team and platform." },
    { key: "tracking", label: "Shipment tracking", hoursPerWeek: r1(tracking), automationLow: 0.7, automationHigh: 0.95, note: "Visibility replaces manual status checks; exceptions surface automatically." },
    { key: "exceptions", label: "Exception management", hoursPerWeek: r1(exceptions), automationLow: 0.3, automationHigh: 0.6, note: "Detection and first response are automated; resolution often needs judgment." },
    { key: "scalability", label: "Operational scalability", hoursPerWeek: r1(scalability), automationLow: 0.6, automationHigh: 0.9, note: `Added weekly hours if volume grows ${i.expectedGrowthPercent}% with the same manual process.` },
  ];
  const total = areas.reduce((s, a) => s + a.hoursPerWeek, 0);
  const low = areas.reduce((s, a) => s + a.hoursPerWeek * a.automationLow, 0);
  const high = areas.reduce((s, a) => s + a.hoursPerWeek * a.automationHigh, 0);
  return {
    areas,
    totalHoursPerWeek: r1(total),
    recoverableHoursLow: r1(low),
    recoverableHoursHigh: r1(high),
    annualValueLow: Math.round(low * 50 * i.hourlyCost),
    annualValueHigh: Math.round(high * 50 * i.hourlyCost),
    assumptions: ASSUMPTIONS,
  };
}

export const DEFAULT_INPUTS: AssessInputs = {
  shipmentsPerMonth: 400,
  quotesPerWeek: 50,
  minutesPerQuote: 12,
  carriersContactedPerLoad: 2,
  minutesPerCarrierContact: 6,
  trackingChecksPerDay: 20,
  minutesPerTrackingCheck: 3,
  exceptionsPerWeek: 10,
  minutesPerException: 25,
  expectedGrowthPercent: 20,
  hourlyCost: 38,
};
