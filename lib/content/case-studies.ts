/**
 * Customer proof.
 *
 * Two shapes live here:
 *  - CASE_STUDIES: metric-led stories used by the campaign copy, emails, video
 *    scripts and the dashboard (ids are stable; analytics key on them).
 *  - TESTIMONIALS: the cartage-pages testimonial library (quotes verbatim from
 *    cartage.ai case studies) used by the prospect page's proof section, with
 *    the same `approved` semantics: unapproved assets render only when the
 *    environment allows provisional content (dev / demo), never in production.
 *
 * Replace the placeholder copy with real customer stories and keep the ids.
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
  // --- Ported from cartage-pages (public cartage.ai case studies) --------------
  {
    id: "sundays-01",
    industry: "Furniture Manufacturing",
    title: "Sundays: AI at the Heart of Furniture Operations",
    summary: "A direct-to-consumer furniture brand put Wilson on quoting, booking and tracking for its outbound freight.",
    metrics: [
      { label: "Workflows handled", value: "3" },
      { label: "Channel", value: "Email" },
      { label: "Story", value: "cartage.ai" },
    ],
    quote: "We want to be the first furniture company to put AI at the heart of our operations.",
    quoteBy: "Sara Samieian, Co-CEO at Sundays Furniture",
  },
  {
    id: "bpwood-01",
    industry: "Building Materials",
    title: "BPWood: A Full Logistics Team Without the Overhead",
    summary: "A wood products trader moved shipment management to Wilson so its team could focus on selling.",
    metrics: [
      { label: "Workflows handled", value: "2" },
      { label: "Capacity", value: "Better rates" },
      { label: "Story", value: "cartage.ai" },
    ],
    quote: "Wilson has completely transformed our freight operations. Our team no longer spends hours managing shipments.",
    quoteBy: "Paul Bouchard, Chairman, BPWood",
  },
  {
    id: "isfab-01",
    industry: "Steel Fabrication",
    title: "International Steel Fabrication: Quoting, Booking and Carrier Coordination",
    summary: "A steel fabricator handed quoting, booking and carrier coordination to Wilson, saving time and cutting costs.",
    metrics: [
      { label: "Workflows handled", value: "3" },
      { label: "Cost", value: "Cut" },
      { label: "Story", value: "cartage.ai" },
    ],
    quote: "Wilson is the logistics team I never knew I needed.",
    quoteBy: "Mitch Philpott, President, International Steel Fabrication",
  },
];

export function caseStudyFor(industry: string): CaseStudy {
  return CASE_STUDIES.find((c) => c.industry === industry) ?? CASE_STUDIES[4];
}

export function caseStudyById(id: string): CaseStudy {
  return CASE_STUDIES.find((c) => c.id === id) ?? CASE_STUDIES[4];
}

// ---------------------------------------------------------------------------
// Testimonial library (cartage-pages src/data/testimonials.json)
// ---------------------------------------------------------------------------

/** cartage-pages industry taxonomy used for proof matching. */
export type PageIndustryTag = "furniture" | "commodities" | "food-beverage" | "specialized";
export type PageWorkflowTag = "quoting" | "booking" | "tracking" | "follow-ups";

export interface Testimonial {
  testimonial_id: string;
  customer: string;
  quote: string;
  attribution: string;
  logo: string;
  screenshot: string;
  screenshot_alt: string;
  industry: PageIndustryTag;
  workflow_tags: PageWorkflowTag[];
  source_url: string;
  /** Marketing sign-off. Unapproved assets render only when provisional content is allowed. */
  approved: boolean;
}

export const DEFAULT_TESTIMONIAL_ID = "isfab-01";

export const TESTIMONIALS: Testimonial[] = [
  {
    testimonial_id: "sundays-01",
    customer: "Sundays",
    quote: "We want to be the first furniture company to put AI at the heart of our operations.",
    attribution: "Sara Samieian, Co-CEO at Sundays Furniture",
    logo: "",
    screenshot: "https://framerusercontent.com/images/LpqmRNfnVmlrzRR5RnoVizCh2U.png",
    screenshot_alt: "A Sundays living room: a white modular sectional sofa, a low wooden coffee table and a checkered rug under a wood-panelled ceiling.",
    industry: "furniture",
    workflow_tags: ["quoting", "booking", "tracking"],
    source_url: "https://www.cartage.ai/sundays-ai-furniture",
    approved: false,
  },
  {
    testimonial_id: "bpwood-01",
    customer: "BPWood",
    quote:
      "Wilson has completely transformed our freight operations. Our team no longer spends hours managing shipments—instead, they focus on driving sales. Wilson secures reliable capacity at better rates, acting as a full logistics team without the overhead.",
    attribution: "Paul Bouchard, Chairman",
    logo: "",
    screenshot: "https://framerusercontent.com/images/cIBbHaEXdw5RitZBheiczaS2Vc.jpg",
    screenshot_alt: "A woodworker planing timber at an outdoor workbench, seen through an open doorway in late-afternoon light.",
    industry: "commodities",
    workflow_tags: ["quoting", "booking"],
    source_url: "https://www.cartage.ai/bpwood-trader-tools",
    approved: false,
  },
  {
    testimonial_id: "isfab-01",
    customer: "International Steel Fabrication",
    quote:
      "I was skeptical about using AI for freight, but Wilson changed my mind. He handles quoting, booking, and carrier coordination—saving time and cutting costs while letting me focus on growing the business. Wilson is the logistics team I never knew I needed.",
    attribution: "Mitch Philpott, President",
    logo: "",
    screenshot: "https://framerusercontent.com/images/v6DmvjccZzZosUbHjTg5Q4OLtek.jpg",
    screenshot_alt: "Blue structural steel equipment strapped to a flatbed trailer marked Oversize Load, parked outside a fabrication shop.",
    industry: "commodities",
    workflow_tags: ["quoting", "booking", "follow-ups"],
    source_url: "https://www.cartage.ai/steel-fabrication-freight",
    approved: false,
  },
];

/**
 * Deterministic, in order: explicit testimonial ids; else same industry; else
 * overlapping workflow tag; else the library default. Only approved assets are
 * eligible unless allowUnapproved is set (dev / demo / preview).
 * Mirrors cartage-pages src/lib/records.ts selectTestimonials().
 */
export function selectTestimonials(
  r: { industry: PageIndustryTag | string; testimonial_ids?: string[]; workflow_tags?: PageWorkflowTag[] },
  { allowUnapproved = false, max = 2 }: { allowUnapproved?: boolean; max?: number } = {},
): Testimonial[] {
  const pool = TESTIMONIALS.filter((t) => t.approved || allowUnapproved);
  const explicit = (r.testimonial_ids ?? []).map((id) => pool.find((t) => t.testimonial_id === id)).filter((t): t is Testimonial => Boolean(t));
  if (explicit.length) return explicit.slice(0, max);

  const industry = String(r.industry ?? "").trim().toLowerCase();
  const sameIndustry = pool.filter((t) => industry && t.industry.toLowerCase() === industry);
  if (sameIndustry.length) return sameIndustry.slice(0, max);

  const tags = r.workflow_tags ?? [];
  const overlap = (t: Testimonial) => t.workflow_tags.filter((x) => tags.includes(x)).length;
  const byTag = pool.filter((t) => overlap(t) > 0).sort((a, b) => overlap(b) - overlap(a));
  if (byTag.length) return byTag.slice(0, max);

  const fallback = pool.find((t) => t.testimonial_id === DEFAULT_TESTIMONIAL_ID);
  return fallback ? [fallback] : [];
}
