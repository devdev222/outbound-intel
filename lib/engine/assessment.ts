import type { Account, AssessmentArea, AssessmentInputs, AssessmentResults } from "@/lib/types";
import { round } from "@/lib/util";

/**
 * Freight Operations Efficiency Assessment. Converts a prospect's answers into
 * hours per week per workflow and an automation range. Everything is an
 * assumption-based estimate and is labelled as such; it is never presented as
 * verified customer data.
 */

export const ASSESSMENT_ASSUMPTIONS = [
  "Automation ranges reflect what managed transportation programs typically absorb for comparable workflows; your actual share depends on lane mix and systems.",
  "Hours are derived only from the inputs you entered; nothing here is verified against your operations data.",
  "Annual value uses your fully loaded hourly cost and 50 working weeks.",
  "Scalability estimates the added weekly hours if volume grows by the expected percentage and the process stays manual.",
];

export function defaultInputsFor(account: Account | null): AssessmentInputs {
  const shipments = account?.campaign?.roiDefaults.shipmentsPerMonth ?? account?.facts.estimatedShipmentsPerMonth ?? 400;
  return {
    shipmentsPerMonth: shipments,
    quotesPerWeek: Math.max(5, Math.round(shipments / 8)),
    minutesPerQuote: 12,
    carriersContactedPerLoad: 2,
    minutesPerCarrierContact: 6,
    trackingChecksPerDay: Math.max(5, Math.round(shipments / 20)),
    minutesPerTrackingCheck: 3,
    exceptionsPerWeek: Math.max(2, Math.round(shipments / 40)),
    minutesPerException: 25,
    expectedGrowthPercent: 20,
    hourlyCost: account?.campaign?.roiDefaults.hourlyCost ?? 38,
  };
}

export function computeAssessment(i: AssessmentInputs): AssessmentResults {
  const loadsPerWeek = i.shipmentsPerMonth / 4.33;
  const quoting = (i.quotesPerWeek * i.minutesPerQuote) / 60;
  const carrier = (loadsPerWeek * i.carriersContactedPerLoad * i.minutesPerCarrierContact) / 60;
  const tracking = (i.trackingChecksPerDay * 5 * i.minutesPerTrackingCheck) / 60;
  const exceptions = (i.exceptionsPerWeek * i.minutesPerException) / 60;
  const manualBase = quoting + carrier + tracking + exceptions;
  const scalability = manualBase * (i.expectedGrowthPercent / 100);

  const areas: AssessmentArea[] = [
    { key: "quoting", label: "Freight quoting", hoursPerWeek: round(quoting, 1), automationLow: 0.5, automationHigh: 0.8, note: "Rate retrieval and quote assembly are highly automatable; approvals stay human." },
    { key: "carrier_communication", label: "Carrier communication", hoursPerWeek: round(carrier, 1), automationLow: 0.6, automationHigh: 0.9, note: "Tendering, confirmations and check calls move to the managed team and platform." },
    { key: "tracking", label: "Shipment tracking", hoursPerWeek: round(tracking, 1), automationLow: 0.7, automationHigh: 0.95, note: "Visibility replaces manual status checks; exceptions surface automatically." },
    { key: "exceptions", label: "Exception management", hoursPerWeek: round(exceptions, 1), automationLow: 0.3, automationHigh: 0.6, note: "Detection and first response are automated; resolution often needs judgment." },
    { key: "scalability", label: "Operational scalability", hoursPerWeek: round(scalability, 1), automationLow: 0.6, automationHigh: 0.9, note: `Added weekly hours if volume grows ${i.expectedGrowthPercent}% with the same manual process.` },
  ];
  const total = areas.reduce((s, a) => s + a.hoursPerWeek, 0);
  const low = areas.reduce((s, a) => s + a.hoursPerWeek * a.automationLow, 0);
  const high = areas.reduce((s, a) => s + a.hoursPerWeek * a.automationHigh, 0);
  return {
    areas,
    totalHoursPerWeek: round(total, 1),
    recoverableHoursLow: round(low, 1),
    recoverableHoursHigh: round(high, 1),
    annualValueLow: Math.round(low * 50 * i.hourlyCost),
    annualValueHigh: Math.round(high * 50 * i.hourlyCost),
    assumptions: ASSESSMENT_ASSUMPTIONS,
  };
}
