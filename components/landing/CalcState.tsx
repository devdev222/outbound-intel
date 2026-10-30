"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { compute, type CalcInputs, type CalcOutputs } from "./calc";

/**
 * Shares the visitor's current calculator inputs between the calculator and
 * the "Send me my estimate" form further down the page (the Astro project
 * does this with a module-level `currentEstimate()`).
 */
interface CalcStateValue {
  inputs: CalcInputs;
  outputs: CalcOutputs;
  setInputs: (next: CalcInputs) => void;
}

const CalcStateContext = createContext<CalcStateValue | null>(null);

export function CalcStateProvider({ defaults, children }: { defaults: CalcInputs; children: ReactNode }) {
  const [inputs, setInputsState] = useState<CalcInputs>(defaults);
  const setInputs = useCallback((next: CalcInputs) => setInputsState({ ...next }), []);
  const value = useMemo(() => ({ inputs, outputs: compute(inputs), setInputs }), [inputs, setInputs]);
  return <CalcStateContext.Provider value={value}>{children}</CalcStateContext.Provider>;
}

export function useCalcState(): CalcStateValue {
  const ctx = useContext(CalcStateContext);
  if (!ctx) throw new Error("useCalcState must be used inside CalcStateProvider");
  return ctx;
}
