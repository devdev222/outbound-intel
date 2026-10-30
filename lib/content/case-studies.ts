/**
 * Case studies shown on personalized pages, chosen by industry. Placeholder
 * copy for the demo; replace with real customer stories (and keep the ids
 * stable so engagement analytics stay comparable).
 */
export interface CaseStudy {
  id: string;
  industry: string;
  title: string;
  summary: string;
  metrics: { label: string; value: string }[];
  quote: string;
  quoteBy: string;
}

export const CASE_STUDIES: CaseStudy[] = [
  {
    id: "steel-fabrication-freight",
    industry: "Steel Fabrication",
    title: "Steel Fabrication Freight",
    summary: "A regional structural steel fabricator moved flatbed and over-dimensional coordination to a managed program during a plant expansion.",
    metrics: [
      { label: "Coordination hours saved / week", value: "42" },
      { label: "On-time delivery", value: "97.8%" },
      { label: "Freight cost per ton", value: "-11%" },
    ],
    quote: "We opened the second plant without hiring a single additional coordinator.",
    quoteBy: "VP of Operations, structural steel fabricator",
  },
  {
    id: "food-distribution-cold-chain",
    industry: "Food & Beverage Distribution",
    title: "Cold Chain Without the Phone Tree",
    summary: "A food distributor replaced spreadsheet tendering with managed temperature-controlled capacity across 14 states.",
    metrics: [
      { label: "Tender rejections", value: "-63%" },
      { label: "Claims rate", value: "0.4%" },
      { label: "Coordinator time on exceptions", value: "-55%" },
    ],
    quote: "Our team stopped chasing reefers and started managing customers.",
    quoteBy: "Director of Logistics, food distributor",
  },
  {
    id: "building-materials-regional-growth",
    industry: "Building Materials",
    title: "Regional Growth, Same Team",
    summary: "A building materials supplier entered three new markets with carrier coverage in place before the first order shipped.",
    metrics: [
      { label: "New-market lanes covered day one", value: "100%" },
      { label: "Spot-market spend", value: "-38%" },
      { label: "Weekly coordination hours", value: "-30" },
    ],
    quote: "Every new branch used to mean a new freight headache. Not anymore.",
    quoteBy: "COO, building materials supplier",
  },
  {
    id: "industrial-equipment-project-freight",
    industry: "Industrial Equipment",
    title: "Project Freight on a Schedule",
    summary: "An industrial equipment manufacturer consolidated inbound components and outbound project shipments under one managed program.",
    metrics: [
      { label: "Late shipments", value: "-71%" },
      { label: "Freight audit variances", value: "-90%" },
      { label: "Hours saved / week", value: "35" },
    ],
    quote: "We finally see every shipment in one place, and nobody re-keys anything.",
    quoteBy: "Supply Chain Manager, equipment manufacturer",
  },
  {
    id: "general-manufacturing-coordination",
    industry: "General",
    title: "From Spreadsheet to Managed Freight",
    summary: "A mid-size manufacturer shipping 600 loads a month replaced manual tendering and tracking with a managed transportation program.",
    metrics: [
      { label: "Hours saved / week", value: "40+" },
      { label: "On-time delivery", value: "96%" },
      { label: "Freight spend", value: "-9%" },
    ],
    quote: "The coordinators we were about to hire became customer success hires instead.",
    quoteBy: "VP of Transportation, manufacturer",
  },
];

export function caseStudyFor(industry: string): CaseStudy {
  return CASE_STUDIES.find((c) => c.industry === industry) ?? CASE_STUDIES[CASE_STUDIES.length - 1];
}

export function caseStudyById(id: string): CaseStudy {
  return CASE_STUDIES.find((c) => c.id === id) ?? CASE_STUDIES[CASE_STUDIES.length - 1];
}
