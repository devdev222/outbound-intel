import { INDUSTRIES, PERSONAS, SIGNAL_CATALOG, SIGNAL_BY_KEY } from "@/lib/engine/signal-catalog";
import type { CompanyFacts, HistoricalContact, HistoricalRecord, JobPosting, NewsItem, PainEvidence, Person, TechStackItem } from "@/lib/types";
import { daysAgoIso, makeRng, pickMany, pickOne, slugify } from "@/lib/util";

/**
 * Synthetic data generator. Stands in for (a) Clay discovery output and (b) a
 * CRM export of historical prospects. Everything is deterministic per seed.
 *
 * The historical set has PLANTED correlations (see PLANTED_LIFT) so the LEARN
 * step has real structure to find. Planted values live only in this file; the
 * engine never reads them. When the real CRM export is wired in, this file is
 * simply not used.
 */

// --- Hidden ground truth used only to generate plausible history -------------

const PLANTED_LIFT: Record<string, number> = {
  "hiring:transportation_coordinator": 2.6,
  "hiring:logistics_manager": 1.9,
  "hiring:dispatcher": 1.6,
  "hiring:supply_chain_analyst": 1.15,
  "hiring:warehouse_associate": 0.95,
  "expansion:new_facility": 2.1,
  "expansion:new_market": 1.5,
  "expansion:acquisition": 1.3,
  "funding:raised_round": 1.0,
  "leadership:new_ops_leader": 1.4,
  "technology:no_tms": 1.8,
  "technology:legacy_tms": 1.3,
  "technology:spreadsheet_ops": 1.7,
  "technology:modern_tms": 0.6,
  "technology:erp_sap": 1.0,
  "pain:manual_coordination": 2.3,
  "pain:carrier_issues": 1.6,
  "pain:late_shipments": 1.5,
  "pain:freight_cost_pressure": 1.4,
};

const SIGNAL_PREVALENCE: Record<string, number> = {
  "hiring:transportation_coordinator": 0.22,
  "hiring:logistics_manager": 0.15,
  "hiring:dispatcher": 0.14,
  "hiring:supply_chain_analyst": 0.12,
  "hiring:warehouse_associate": 0.3,
  "expansion:new_facility": 0.18,
  "expansion:new_market": 0.12,
  "expansion:acquisition": 0.08,
  "funding:raised_round": 0.1,
  "leadership:new_ops_leader": 0.12,
  "technology:no_tms": 0.35,
  "technology:legacy_tms": 0.2,
  "technology:spreadsheet_ops": 0.3,
  "technology:modern_tms": 0.2,
  "technology:erp_sap": 0.25,
  "pain:manual_coordination": 0.25,
  "pain:carrier_issues": 0.2,
  "pain:late_shipments": 0.18,
  "pain:freight_cost_pressure": 0.22,
};

const INDUSTRY_FACTOR: Record<string, number> = {
  "Steel Fabrication": 1.6,
  "Food & Beverage Distribution": 1.5,
  "Building Materials": 1.35,
  "Industrial Equipment": 1.2,
  "Automotive Parts": 1.1,
  Chemicals: 0.9,
  "Consumer Packaged Goods": 1.0,
  "Paper & Packaging": 1.05,
  Agriculture: 0.7,
  "Furniture Manufacturing": 0.75,
  "Electronics Distribution": 1.0,
  "Plastics & Rubber": 0.95,
};

const PERSONA_FACTOR: Record<string, number> = {
  "VP of Transportation": 1.7,
  "VP of Supply Chain": 1.5,
  "Director of Logistics": 1.6,
  "Director of Operations": 1.2,
  "Supply Chain Manager": 1.1,
  "Transportation Manager": 1.3,
  COO: 1.0,
  CFO: 0.6,
  "Plant Manager": 0.7,
  "Procurement Manager": 0.8,
  "Logistics Coordinator": 0.5,
};

function sizeFactor(employees: number): number {
  if (employees < 200) return 0.8;
  if (employees < 1000) return 1.4;
  if (employees < 5000) return 1.1;
  return 0.6;
}

// --- Naming ------------------------------------------------------------------

const NAME_A = ["Midwest", "Ridgeline", "Harbor", "Summit", "Great Lakes", "Keystone", "Pioneer", "Cascade", "Prairie", "Ironwood", "Bluewater", "Northstar", "Heartland", "Granite", "Redwood", "Lakeshore", "Frontier", "Copperline", "Silverpeak", "Tri-State", "Allied", "Apex", "Vantage", "Meridian", "Atlas", "Beacon", "Crestline", "Delta", "Evergreen", "Foothill"];
const NAME_B: Record<string, string[]> = {
  "Steel Fabrication": ["Steel Works", "Fabrication", "Metal Products", "Structural Steel", "Steel & Iron"],
  "Food & Beverage Distribution": ["Foods", "Food Distribution", "Beverage Co", "Fresh Distributors", "Provisions"],
  "Building Materials": ["Building Supply", "Lumber & Supply", "Materials Co", "Masonry Products", "Roofing Supply"],
  "Industrial Equipment": ["Industrial", "Equipment Co", "Machinery", "Industrial Systems", "Engineered Products"],
  "Automotive Parts": ["Auto Parts", "Automotive Components", "Drivetrain Co", "Motor Parts", "Auto Supply"],
  Chemicals: ["Chemical Co", "Specialty Chemicals", "Coatings", "Chemical Solutions", "Polymers"],
  "Consumer Packaged Goods": ["Brands", "Consumer Products", "Home Goods", "Household Co", "Goods Co"],
  "Paper & Packaging": ["Packaging", "Paper Products", "Container Corp", "Corrugated", "Packaging Solutions"],
  Agriculture: ["Agri Products", "Farms", "Grain Co", "Agricultural Supply", "Seed & Feed"],
  "Furniture Manufacturing": ["Furniture", "Furnishings", "Seating Co", "Casegoods", "Office Furniture"],
  "Electronics Distribution": ["Electronics", "Components Distribution", "Tech Distributors", "Electronic Supply", "Circuit Supply"],
  "Plastics & Rubber": ["Plastics", "Molded Products", "Rubber Co", "Polymer Products", "Injection Molding"],
};
const CITIES: [string, string][] = [
  ["Chicago", "IL"], ["Columbus", "OH"], ["Indianapolis", "IN"], ["Milwaukee", "WI"], ["Detroit", "MI"], ["Nashville", "TN"],
  ["Dallas", "TX"], ["Houston", "TX"], ["Atlanta", "GA"], ["Charlotte", "NC"], ["Kansas City", "MO"], ["St. Louis", "MO"],
  ["Minneapolis", "MN"], ["Pittsburgh", "PA"], ["Cleveland", "OH"], ["Louisville", "KY"], ["Memphis", "TN"], ["Phoenix", "AZ"],
  ["Denver", "CO"], ["Salt Lake City", "UT"], ["Grand Rapids", "MI"], ["Greenville", "SC"], ["Omaha", "NE"], ["Des Moines", "IA"],
];
const FIRST = ["John", "Maria", "David", "Priya", "Michael", "Sarah", "James", "Elena", "Robert", "Aisha", "William", "Grace", "Daniel", "Nina", "Carlos", "Emily", "Marcus", "Hannah", "Kevin", "Laura", "Tom", "Rachel", "Steve", "Monica"];
const LAST = ["Smith", "Garcia", "Johnson", "Patel", "Nguyen", "Miller", "Davis", "Kowalski", "Anderson", "Okafor", "Thompson", "Martinez", "Brown", "Schmidt", "Lee", "Walker", "Hernandez", "Rossi", "Clark", "Young", "Fischer", "Murphy", "Reyes", "Baker"];

// --- Evidence templates ------------------------------------------------------

const JOB_TITLES: Record<string, string[]> = {
  "hiring:transportation_coordinator": ["Transportation Coordinator", "Shipping Coordinator", "Logistics Coordinator", "Freight Coordinator"],
  "hiring:logistics_manager": ["Logistics Manager", "Transportation Manager", "Manager, Outbound Logistics"],
  "hiring:dispatcher": ["Dispatcher", "Fleet Dispatcher", "Transportation Dispatcher"],
  "hiring:supply_chain_analyst": ["Supply Chain Analyst", "Logistics Analyst", "Freight Analyst"],
  "hiring:warehouse_associate": ["Warehouse Associate", "Forklift Operator", "Shipping & Receiving Associate"],
};
const NOISE_JOBS = ["Accounts Payable Specialist", "Sales Development Representative", "Maintenance Technician", "Quality Inspector", "HR Generalist", "Production Supervisor", "CNC Machinist", "Customer Service Representative"];

const NEWS_TEMPLATES: Record<string, { kind: NewsItem["kind"]; headline: (c: string, city: string, state: string) => string }[]> = {
  "expansion:new_facility": [
    { kind: "facility", headline: (c, city, state) => `${c} to open 240,000 sq ft distribution center in ${city}, ${state}` },
    { kind: "facility", headline: (c, city, state) => `${c} breaks ground on new plant near ${city}` },
  ],
  "expansion:new_market": [
    { kind: "expansion", headline: (c) => `${c} expands into the Southeast with new regional sales team` },
    { kind: "expansion", headline: (c) => `${c} announces West Coast expansion` },
  ],
  "expansion:acquisition": [
    { kind: "acquisition", headline: (c) => `${c} completes acquisition of regional competitor` },
    { kind: "acquisition", headline: (c) => `${c} acquires family-owned manufacturer, adds two plants` },
  ],
  "funding:raised_round": [{ kind: "funding", headline: (c) => `${c} secures $40M growth investment` }],
  "leadership:new_ops_leader": [
    { kind: "leadership", headline: (c) => `${c} names new Vice President of Operations` },
    { kind: "leadership", headline: (c) => `${c} appoints Chief Supply Chain Officer` },
  ],
};
const NOISE_NEWS: ((c: string) => string)[] = [
  (c) => `${c} celebrates 40th anniversary`,
  (c) => `${c} named a top workplace in the region`,
  (c) => `${c} donates to local food bank`,
  (c) => `${c} earns ISO 9001 recertification`,
];

const TECH: Record<string, TechStackItem[]> = {
  "technology:no_tms": [{ name: "No TMS detected", category: "tms", source: "job postings / vendor lists" }],
  "technology:legacy_tms": [{ name: "On-prem TMS (legacy)", category: "tms", source: "job posting requirements" }],
  "technology:spreadsheet_ops": [{ name: "Excel / Google Sheets for load planning", category: "spreadsheet", source: "job posting description" }],
  "technology:modern_tms": [{ name: "Cloud TMS", category: "tms", source: "vendor case study" }],
  "technology:erp_sap": [{ name: "SAP ECC", category: "erp", source: "job posting requirements" }],
};
const NOISE_TECH: TechStackItem[] = [
  { name: "Microsoft 365", category: "other", source: "DNS" },
  { name: "NetSuite", category: "erp", source: "job posting" },
  { name: "Salesforce", category: "other", source: "DNS" },
];

const PAIN_TEXT: Record<string, string[]> = {
  "pain:manual_coordination": [
    "Shipping team spends most of the day on the phone chasing carriers and updating a spreadsheet.",
    "Coordinators manually re-key orders into carrier portals; every rush order is a fire drill.",
  ],
  "pain:carrier_issues": [
    "Tender rejections on our short-haul lanes have doubled this year.",
    "We rotate between a dozen small carriers and still cannot get consistent coverage.",
  ],
  "pain:late_shipments": [
    "Customers keep escalating late deliveries; we find out after the fact.",
    "On-time delivery slipped below 85% last quarter.",
  ],
  "pain:freight_cost_pressure": [
    "Freight was the fastest-growing cost line on the P&L this year.",
    "Management asked us to cut transportation spend 10% without hurting service.",
  ],
};
const PAIN_SOURCES = ["Glassdoor review", "Reddit r/logistics", "earnings call transcript", "industry podcast", "local news interview", "LinkedIn post"];

// --- Shared latent signal sampling -------------------------------------------

function sampleSignalKeys(rng: () => number): string[] {
  const keys: string[] = [];
  for (const [key, p] of Object.entries(SIGNAL_PREVALENCE)) {
    if (rng() < p) keys.push(key);
  }
  // mutually exclusive tech states
  const tech = keys.filter((k) => k.startsWith("technology:") && k !== "technology:erp_sap");
  if (tech.length > 1) {
    const keep = pickOne(rng, tech);
    for (const t of tech) if (t !== keep) keys.splice(keys.indexOf(t), 1);
  }
  return keys;
}

function winProbability(industry: string, employees: number, persona: string, keys: string[]): number {
  // Base rate tuned so the synthetic book lands near a realistic ~8-10% closed-won,
  // ~15-20% won-or-meeting, before signal lifts separate winners from the rest.
  let p = 0.022;
  p *= INDUSTRY_FACTOR[industry] ?? 1;
  p *= sizeFactor(employees);
  p *= PERSONA_FACTOR[persona] ?? 1;
  for (const k of keys) p *= PLANTED_LIFT[k] ?? 1;
  return Math.min(0.7, p);
}

function companyName(rng: () => number, industry: string): string {
  return `${pickOne(rng, NAME_A)} ${pickOne(rng, NAME_B[industry] ?? ["Industries"])}`;
}

function person(rng: () => number, title: string, domain: string): Person {
  const first = pickOne(rng, FIRST);
  const last = pickOne(rng, LAST);
  const seniority = PERSONAS.find((p) => p.title === title)?.seniority ?? "manager";
  return {
    name: `${first} ${last}`,
    title,
    seniority,
    email: rng() < 0.7 ? `${first.toLowerCase()}.${last.toLowerCase()}@${domain}` : undefined,
    linkedin: rng() < 0.8 ? `https://www.linkedin.com/in/${first.toLowerCase()}-${last.toLowerCase()}-${Math.floor(rng() * 9000 + 1000)}` : undefined,
  };
}

// --- Public: companies to prospect -------------------------------------------

export function generateCompanies(count: number, seed: number): CompanyFacts[] {
  const rng = makeRng(seed);
  const out: CompanyFacts[] = [];
  const seen = new Set<string>();

  while (out.length < count) {
    const industry = pickOne(rng, INDUSTRIES);
    const name = companyName(rng, industry);
    if (seen.has(name)) continue;
    seen.add(name);
    const domain = `${slugify(name)}.com`;
    const [city, state] = pickOne(rng, CITIES);
    const employees = Math.round(Math.exp(4 + rng() * 4.5)); // ~55 .. ~5000
    const keys = sampleSignalKeys(rng);

    const jobPostings: JobPosting[] = [];
    const news: NewsItem[] = [];
    const techStack: TechStackItem[] = [];
    const painEvidence: PainEvidence[] = [];

    for (const key of keys) {
      const def = SIGNAL_BY_KEY[key];
      if (!def) continue;
      if (def.type === "hiring") {
        const n = key === "hiring:transportation_coordinator" ? 1 + Math.floor(rng() * 3) : 1;
        for (let i = 0; i < n; i++) {
          const title = pickOne(rng, JOB_TITLES[key]);
          jobPostings.push({
            title,
            department: "Supply Chain & Logistics",
            postedAt: daysAgoIso(Math.floor(rng() * 45)),
            url: `https://${domain}/careers/${slugify(title)}-${i + 1}`,
            location: `${city}, ${state}`,
            description:
              key === "hiring:transportation_coordinator"
                ? "Coordinate daily outbound shipments, tender loads to carriers, track in-transit freight and resolve exceptions."
                : undefined,
          });
        }
      } else if (def.type === "expansion" || def.type === "funding" || def.type === "leadership") {
        const t = pickOne(rng, NEWS_TEMPLATES[key] ?? []);
        if (t) {
          news.push({
            headline: t.headline(name, pickOne(rng, CITIES)[0], state),
            kind: t.kind,
            publishedAt: daysAgoIso(Math.floor(rng() * 120)),
            url: `https://news.example.com/${slugify(name)}/${slugify(key)}`,
          });
        }
      } else if (def.type === "technology") {
        techStack.push(...(TECH[key] ?? []));
      } else if (def.type === "pain") {
        painEvidence.push({
          text: pickOne(rng, PAIN_TEXT[key]),
          theme: key.split(":")[1],
          source: pickOne(rng, PAIN_SOURCES),
          url: `https://reviews.example.com/${slugify(name)}/${Math.floor(rng() * 1000)}`,
          capturedAt: daysAgoIso(Math.floor(rng() * 90)),
        });
      }
    }

    // noise so the agents have to discriminate
    for (const j of pickMany(rng, NOISE_JOBS, Math.floor(rng() * 3))) {
      jobPostings.push({ title: j, department: "General", postedAt: daysAgoIso(Math.floor(rng() * 60)), url: `https://${domain}/careers/${slugify(j)}` });
    }
    if (rng() < 0.5) {
      news.push({ headline: pickOne(rng, NOISE_NEWS)(name), kind: "other", publishedAt: daysAgoIso(Math.floor(rng() * 200)), url: `https://news.example.com/${slugify(name)}/community` });
    }
    techStack.push(...pickMany(rng, NOISE_TECH, Math.floor(rng() * 2)));

    const personaTitles = pickMany(rng, PERSONAS.map((p) => p.title), 2 + Math.floor(rng() * 3));
    const people = personaTitles.map((t) => person(rng, t, domain));
    // Buying group: 4-7 people per company. A separate stream keeps every other generated field unchanged.
    const groupRng = makeRng(seed * 31 + out.length + 1);
    const extra = pickMany(groupRng, PERSONAS.map((p) => p.title).filter((t) => !personaTitles.includes(t)), Math.max(0, 4 + Math.floor(groupRng() * 4) - people.length));
    people.push(...extra.map((t) => person(groupRng, t, domain)));

    out.push({
      companyName: name,
      domain,
      industry,
      employeeCount: employees,
      hqCity: city,
      hqState: state,
      founded: 1950 + Math.floor(rng() * 65),
      description: `${name} is a ${industry.toLowerCase()} company headquartered in ${city}, ${state}, shipping to customers across North America.`,
      jobPostings,
      news,
      techStack,
      painEvidence,
      people,
      estimatedShipmentsPerMonth: Math.round(employees * (0.6 + rng() * 1.2)),
      source: "synthetic",
    });
  }
  return out;
}

// --- Public: historical CRM export -------------------------------------------

export function generateHistorical(count: number, seed: number): HistoricalRecord[] {
  const rng = makeRng(seed);
  const out: HistoricalRecord[] = [];
  for (let i = 0; i < count; i++) {
    const industry = pickOne(rng, INDUSTRIES);
    const employees = Math.round(Math.exp(4 + rng() * 4.5));
    const persona = pickOne(rng, PERSONAS);
    const keys = sampleSignalKeys(rng);
    const p = winProbability(industry, employees, persona.title, keys);
    const r = rng();
    let outcome: HistoricalRecord["outcome"];
    if (r < p) outcome = "won";
    else if (r < p + 0.12 * (0.5 + p)) outcome = "meeting";
    else if (r < p + 0.12 * (0.5 + p) + 0.18) outcome = "lost";
    else outcome = "no_response";

    const firstTouchDays = 60 + Math.floor(rng() * 480);
    const topKey = keys.find((k) => (PLANTED_LIFT[k] ?? 1) >= 1.5) ?? keys[0];
    const angle = topKey ? SIGNAL_BY_KEY[topKey]?.angles[rng() < 0.6 ? 0 : 1] : undefined;

    out.push({
      id: `hist_${seed}_${i}`,
      companyName: companyName(rng, industry),
      industry,
      employeeCount: employees,
      signalKeys: keys,
      persona: persona.title,
      seniority: persona.seniority,
      messagingAngle: outcome === "won" || outcome === "meeting" ? angle : undefined,
      outcome,
      dealValue: outcome === "won" ? Math.round(40_000 + rng() * 360_000) : undefined,
      firstTouchAt: daysAgoIso(firstTouchDays),
      outcomeAt: daysAgoIso(Math.max(5, firstTouchDays - 20 - Math.floor(rng() * 40))),
      source: "crm_export",
      contacts: historicalGroup(makeRng(seed * 7919 + i + 1), outcome, employees, industry),
    });
  }
  return out;
}

/**
 * Planted buying-group history (hidden ground truth, like PLANTED_LIFT): won
 * deals usually involved an operational owner and the economic buyer, with a
 * champion who engaged; larger companies needed more people; most stalled
 * deals only ever reached one or two people.
 */
const GROUP_ROLE: Record<string, HistoricalContact["role"]> = {
  "VP of Transportation": "operational_owner",
  "Director of Logistics": "operational_owner",
  "Director of Operations": "operational_owner",
  "VP of Supply Chain": "economic_buyer",
  COO: "economic_buyer",
  CFO: "economic_buyer",
  "Transportation Manager": "champion",
  "Supply Chain Manager": "champion",
  "Plant Manager": "champion",
  "Procurement Manager": "supporting",
  "Logistics Coordinator": "supporting",
};

function historicalGroup(rng: () => number, outcome: HistoricalRecord["outcome"], employees: number, industry: string): HistoricalContact[] {
  const big = employees >= 1000 || (industry === "Automotive Parts" && employees >= 500);
  const progressed = outcome === "won" || outcome === "meeting";
  const size = progressed ? (big ? 4 + Math.floor(rng() * 3) : 3 + Math.floor(rng() * 2)) : 1 + Math.floor(rng() * (rng() < 0.3 ? 4 : 2));
  const byRole = (role: HistoricalContact["role"]) => PERSONAS.filter((p) => GROUP_ROLE[p.title] === role);
  const wanted: HistoricalContact["role"][] = progressed ? ["operational_owner", "champion", rng() < 0.8 ? "economic_buyer" : "supporting", "supporting", "champion", "economic_buyer"] : [pickOne(rng, ["champion", "supporting", "operational_owner", "champion"] as const), "supporting", "champion", "economic_buyer"];
  return wanted.slice(0, size).map((role, i) => {
    const persona = pickOne(rng, byRole(role));
    const champion = role === "champion" && i < 3;
    const influenced = progressed ? (role === "operational_owner" || champion || (role === "economic_buyer" && rng() < 0.75) || rng() < 0.25) : rng() < 0.1;
    const replied = influenced || rng() < (progressed ? 0.2 : 0.05);
    return {
      role,
      title: persona.title,
      seniority: persona.seniority,
      contactedOrder: i + 1,
      replied,
      influenced,
      bookedMeeting: progressed && influenced && (role === "operational_owner" || role === "champion") && rng() < 0.6,
      inWin: outcome === "won" && influenced,
    };
  });
}

/** Exposed for tests and the README: which keys the generator knows about. */
export const SYNTHETIC_SIGNAL_KEYS = SIGNAL_CATALOG.filter((s) => s.key in SIGNAL_PREVALENCE).map((s) => s.key);
