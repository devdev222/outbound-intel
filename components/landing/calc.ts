/**
 * Time / value calculator math, ported verbatim from cartage-pages
 * (src/lib/calc.ts) so the engine's page and the Astro pages agree to the cent.
 * Reference inputs (400 / 15 / 40% / $35) must yield 100 / 40 / 480 / $1,400 / $16,800.
 * Pure functions only: safe for the browser, server routes and tests.
 */

export type CalcInputs = {
  shipments_per_month: number;
  minutes_per_shipment: number;
  automation_percent: number;
  hourly_cost: number;
  currency: string;
};

export type CalcOutputs = {
  current_monthly_hours: number;
  monthly_hours_recovered: number;
  annual_hours_recovered: number;
  monthly_capacity_value: number;
  annual_capacity_value: number;
};

export type NumericField = Exclude<keyof CalcInputs, "currency">;

export const FIELD_LIMITS: Record<NumericField, { min: number; max: number }> = {
  shipments_per_month: { min: 0, max: 100_000 },
  minutes_per_shipment: { min: 0, max: 480 },
  automation_percent: { min: 0, max: 100 },
  hourly_cost: { min: 0, max: 500 },
};

export const REFERENCE_DEFAULTS: CalcInputs = {
  shipments_per_month: 400,
  minutes_per_shipment: 15,
  automation_percent: 40,
  hourly_cost: 35,
  currency: "USD",
};

export function compute(i: CalcInputs): CalcOutputs {
  const current_monthly_hours = (i.shipments_per_month * i.minutes_per_shipment) / 60;
  const monthly_hours_recovered = (current_monthly_hours * i.automation_percent) / 100;
  const annual_hours_recovered = monthly_hours_recovered * 12;
  const monthly_capacity_value = monthly_hours_recovered * i.hourly_cost;
  const annual_capacity_value = monthly_capacity_value * 12;
  return { current_monthly_hours, monthly_hours_recovered, annual_hours_recovered, monthly_capacity_value, annual_capacity_value };
}

/**
 * Parses what a visitor typed. Returns null for anything that should revert
 * to the last valid value: empty, non-numeric, or negative. Values above the
 * field's range are clamped (the percent field's 0-100 clamp included).
 */
export function parseField(field: NumericField, raw: string): number | null {
  const cleaned = raw.replace(/[,\s$€£%]/g, "");
  if (!/^-?(\d+(\.\d*)?|\.\d+)$/.test(cleaned)) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.min(n, FIELD_LIMITS[field].max);
}

export function sanitizeInputs(raw: Partial<Record<keyof CalcInputs, unknown>>, fallback = REFERENCE_DEFAULTS): CalcInputs {
  const out = { ...fallback };
  for (const field of Object.keys(FIELD_LIMITS) as NumericField[]) {
    const v = raw[field];
    const parsed = typeof v === "number" ? parseField(field, String(v)) : typeof v === "string" ? parseField(field, v) : null;
    if (parsed !== null) out[field] = parsed;
  }
  if (typeof raw.currency === "string" && isCurrency(raw.currency)) out.currency = raw.currency.toUpperCase();
  return out;
}

export function isCurrency(code: string): boolean {
  if (!/^[A-Za-z]{3}$/.test(code)) return false;
  try {
    new Intl.NumberFormat("en-US", { style: "currency", currency: code });
    return true;
  } catch {
    return false;
  }
}

/** Hours: one decimal under 100 (trailing .0 dropped), whole numbers from 100 up. */
export function formatHours(h: number): string {
  const v = Number.isFinite(h) && h > 0 ? h : 0;
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: v < 100 ? 1 : 0,
    minimumFractionDigits: 0,
  }).format(v < 100 ? Math.round(v * 10) / 10 : Math.round(v));
}

/** Currency totals: whole units with thousands separators and the currency's symbol. */
export function formatMoney(amount: number, currency: string): string {
  const v = Number.isFinite(amount) && amount > 0 ? amount : 0;
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0, minimumFractionDigits: 0 }).format(Math.round(v));
}

/** Hourly rate: keeps cents only when the visitor entered them. */
export function formatRate(amount: number, currency: string): string {
  const cents = Math.round(amount * 100) % 100 !== 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: cents ? 2 : 0,
    minimumFractionDigits: cents ? 2 : 0,
  }).format(amount);
}

export function formatCount(n: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(n);
}

export function currencySymbol(currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).formatToParts(0).find((p) => p.type === "currency")?.value ?? currency;
  } catch {
    return currency;
  }
}

export function explain(i: CalcInputs, o: CalcOutputs = compute(i)): string {
  return (
    `At ${formatCount(i.shipments_per_month)} shipments per month and ${formatCount(i.minutes_per_shipment)} minutes ` +
    `of manual coordination per shipment, your team spends approximately ${formatHours(o.current_monthly_hours)} hours ` +
    `monthly on this work. If Cartage handles ${formatCount(i.automation_percent)}%, that could recover ` +
    `${formatHours(o.monthly_hours_recovered)} hours per month. At ${formatRate(i.hourly_cost, i.currency)}/hour, ` +
    `that represents ${formatMoney(o.monthly_capacity_value, i.currency)} in monthly labor capacity value.`
  );
}

export const WORKFLOW_LABELS = {
  quoting: "quoting",
  booking: "booking",
  tracking: "tracking",
  "follow-ups": "carrier follow-ups",
} as const;

export type WorkflowTag = keyof typeof WORKFLOW_LABELS;
export const WORKFLOW_TAGS = Object.keys(WORKFLOW_LABELS) as WorkflowTag[];

export function workflowLine(tags: readonly WorkflowTag[]): string {
  const labels = (tags.length ? tags : WORKFLOW_TAGS).map((t) => WORKFLOW_LABELS[t]);
  const list = labels.length <= 2 ? labels.join(" and ") : `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;
  return `Work that contributes to this estimate: ${list}.`;
}

/** Rounded outputs for analytics payloads and the estimate form. */
export function roundOutputs(o: CalcOutputs): CalcOutputs {
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v * 100) / 100])) as CalcOutputs;
}
