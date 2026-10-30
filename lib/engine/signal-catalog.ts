import type { SignalType } from "@/lib/types";

/**
 * Canonical buying-signal keys. Agents emit these keys; the LEARN step measures
 * each key's conversion lift from history; the scoring agent weights them.
 * New keys can be added freely: a key with no history simply has no learned
 * pattern yet (the model flags it as unvalidated).
 */
export interface SignalDefinition {
  key: string;
  type: SignalType;
  label: string;
  /** Default messaging angle variants (A/B) used until the playbook learns better ones. */
  angles: [string, string];
}

export const SIGNAL_CATALOG: SignalDefinition[] = [
  // Hiring
  {
    key: "hiring:transportation_coordinator",
    type: "hiring",
    label: "Hiring transportation / shipping coordinators",
    angles: [
      "Scale shipping operations without proportionally increasing coordination headcount",
      "Give your new coordinators a system instead of a spreadsheet on day one",
    ],
  },
  {
    key: "hiring:logistics_manager",
    type: "hiring",
    label: "Hiring a logistics / transportation manager",
    angles: [
      "Set your incoming logistics leader up with managed capacity from week one",
      "Turn the first 90 days of a new logistics manager into measurable freight savings",
    ],
  },
  {
    key: "hiring:dispatcher",
    type: "hiring",
    label: "Hiring dispatchers",
    angles: ["Reduce dispatch load with automated carrier matching", "Fewer phone calls per load, same on-time rate"],
  },
  {
    key: "hiring:supply_chain_analyst",
    type: "hiring",
    label: "Hiring supply chain analysts",
    angles: ["Give analysts clean freight data instead of reconciliation work", "Freight spend visibility without building it in-house"],
  },
  {
    key: "hiring:warehouse_associate",
    type: "hiring",
    label: "Hiring warehouse associates (volume growth)",
    angles: ["Volume is growing; keep outbound freight from becoming the bottleneck", "Match freight capacity to warehouse throughput"],
  },
  // Expansion
  {
    key: "expansion:new_facility",
    type: "expansion",
    label: "Opening a new facility / distribution center",
    angles: [
      "Stand up freight for the new facility without hiring a second coordination team",
      "Launch the new site with carrier coverage already in place",
    ],
  },
  {
    key: "expansion:new_market",
    type: "expansion",
    label: "Entering a new geographic market",
    angles: ["Enter the new region with lane coverage from day one", "New market, no new carrier onboarding project"],
  },
  {
    key: "expansion:acquisition",
    type: "expansion",
    label: "Acquired or merged with another company",
    angles: ["Consolidate two freight operations into one managed program", "Integrate the acquired plants' shipping without a systems project"],
  },
  // Funding / leadership
  {
    key: "funding:raised_round",
    type: "funding",
    label: "Raised funding",
    angles: ["Put growth capital into product, not freight admin", "Scale operations ahead of the plan"],
  },
  {
    key: "leadership:new_ops_leader",
    type: "leadership",
    label: "New operations / supply chain leader",
    angles: ["A quick win for a new ops leader: freight coordination off the team's plate", "Early-tenure wins in transportation cost and service"],
  },
  // Technology
  {
    key: "technology:no_tms",
    type: "technology",
    label: "No transportation management system detected",
    angles: ["Managed transportation without a TMS implementation", "Get TMS outcomes without a TMS project"],
  },
  {
    key: "technology:legacy_tms",
    type: "technology",
    label: "Legacy / on-prem TMS",
    angles: ["Modern visibility layered on top of the existing TMS", "Keep the TMS, remove the manual work around it"],
  },
  {
    key: "technology:spreadsheet_ops",
    type: "technology",
    label: "Spreadsheet-driven shipment coordination",
    angles: ["Replace the shipment spreadsheet with a managed program", "From spreadsheet to real-time tracking in two weeks"],
  },
  {
    key: "technology:modern_tms",
    type: "technology",
    label: "Modern cloud TMS in place",
    angles: ["Augment the TMS with managed capacity on hard lanes", "Fill the gaps the TMS cannot cover"],
  },
  {
    key: "technology:erp_sap",
    type: "technology",
    label: "SAP / large ERP footprint",
    angles: ["Freight data that reconciles with the ERP", "Integrate once, ship everywhere"],
  },
  // Pain
  {
    key: "pain:manual_coordination",
    type: "pain",
    label: "Evidence of manual shipment coordination workload",
    angles: ["Save 40+ hours a week of manual coordination", "Coordination work that should not be a full-time job"],
  },
  {
    key: "pain:carrier_issues",
    type: "pain",
    label: "Carrier reliability or capacity complaints",
    angles: ["Reliable capacity on the lanes that keep falling through", "Fewer tender rejections, fewer fire drills"],
  },
  {
    key: "pain:late_shipments",
    type: "pain",
    label: "Late shipments / customer complaints",
    angles: ["Protect on-time delivery as volume grows", "Fix the lanes behind the late-shipment complaints"],
  },
  {
    key: "pain:freight_cost_pressure",
    type: "pain",
    label: "Freight cost pressure mentioned publicly",
    angles: ["Take freight cost out without renegotiating every carrier", "Freight savings that show up this quarter"],
  },
  // Intent (engagement-derived; appears only after campaigns launch)
  { key: "intent:visited_pricing", type: "intent", label: "Visited pricing / ROI content", angles: ["Walk through the numbers together", "Your ROI estimate, validated"] },
  { key: "intent:watched_video", type: "intent", label: "Watched most of the personalized video", angles: ["Pick up where the video left off", "A short walkthrough of what the video covered"] },
];

export const SIGNAL_BY_KEY: Record<string, SignalDefinition> = Object.fromEntries(SIGNAL_CATALOG.map((s) => [s.key, s]));

export function signalLabel(key: string): string {
  return SIGNAL_BY_KEY[key]?.label ?? key;
}

export function signalType(key: string): SignalType {
  return SIGNAL_BY_KEY[key]?.type ?? (key.split(":")[0] as SignalType) ?? "intent";
}

export const PERSONAS: { title: string; seniority: "c_level" | "vp" | "director" | "manager" | "ic" }[] = [
  { title: "VP of Transportation", seniority: "vp" },
  { title: "VP of Supply Chain", seniority: "vp" },
  { title: "Director of Logistics", seniority: "director" },
  { title: "Director of Operations", seniority: "director" },
  { title: "Supply Chain Manager", seniority: "manager" },
  { title: "Transportation Manager", seniority: "manager" },
  { title: "COO", seniority: "c_level" },
  { title: "CFO", seniority: "c_level" },
  { title: "Plant Manager", seniority: "manager" },
  { title: "Procurement Manager", seniority: "manager" },
  { title: "Logistics Coordinator", seniority: "ic" },
];

export const INDUSTRIES = [
  "Steel Fabrication",
  "Food & Beverage Distribution",
  "Building Materials",
  "Industrial Equipment",
  "Automotive Parts",
  "Chemicals",
  "Consumer Packaged Goods",
  "Paper & Packaging",
  "Agriculture",
  "Furniture Manufacturing",
  "Electronics Distribution",
  "Plastics & Rubber",
] as const;

export const SIZE_BANDS: { band: string; min: number; max: number }[] = [
  { band: "50-199", min: 50, max: 199 },
  { band: "200-999", min: 200, max: 999 },
  { band: "1000-4999", min: 1000, max: 4999 },
  { band: "5000+", min: 5000, max: Number.POSITIVE_INFINITY },
];

export function sizeBandFor(employeeCount: number): string {
  return SIZE_BANDS.find((b) => employeeCount >= b.min && employeeCount <= b.max)?.band ?? "50-199";
}
