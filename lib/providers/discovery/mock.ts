import { generateCompanies } from "@/lib/synthetic/generate";
import type { CompanyFacts } from "@/lib/types";
import type { DiscoveryProvider, SignalCollector } from "../types";

/**
 * Synthetic discovery. Generates realistic shipper profiles (manufacturers,
 * distributors) with job postings, news, tech stack and pain evidence so the
 * agents have something to interpret. Deterministic per seed.
 */
export class MockDiscoveryProvider implements DiscoveryProvider {
  readonly name = "mock";
  private cursor = 0;

  constructor(private readonly seed = 42) {}

  async discover(limit: number): Promise<CompanyFacts[]> {
    const batch = generateCompanies(limit, this.seed + this.cursor);
    this.cursor += limit;
    return batch;
  }

  async refresh(facts: CompanyFacts): Promise<CompanyFacts> {
    return facts;
  }

  async submit(): Promise<{ accepted: boolean; note: string }> {
    return { accepted: true, note: "mock discovery: nothing to submit" };
  }

  reset(): void {
    this.cursor = 0;
  }
}

/** Collector that reads signals straight out of the synthetic facts. */
export class MockSignalCollector implements SignalCollector {
  readonly name = "mock";
  async collect(facts: CompanyFacts): Promise<Partial<CompanyFacts>> {
    return facts;
  }
}
