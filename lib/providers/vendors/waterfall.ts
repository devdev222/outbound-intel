import { config } from "@/lib/config";
import { PermanentError } from "@/lib/engine/operations";
import type { Account, Person } from "@/lib/types";
import { ClayEnrichmentProvider } from "../enrichment";
import type { EnrichmentProvider, EnrichmentResult } from "../types";
import { AmplemarketEnrichmentProvider } from "./amplemarket";
import { WizaEnrichmentProvider } from "./wiza";

/**
 * Enrichment waterfall (ENRICHMENT_PROVIDER=waterfall, order from
 * ENRICHMENT_WATERFALL, default "wiza,amplemarket"). Each source is asked in
 * turn with what the earlier ones found, and the waterfall stops as soon as
 * the person has an email and a verified phone, so later (paid) lookups only
 * run for the gaps. A source that errors is skipped and noted; if every
 * source errors, the last error is raised so the verification retry applies.
 */

const SOURCES: Record<string, () => EnrichmentProvider> = {
  wiza: () => new WizaEnrichmentProvider(),
  amplemarket: () => new AmplemarketEnrichmentProvider(),
  clay: () => new ClayEnrichmentProvider(),
};

export class WaterfallEnrichmentProvider implements EnrichmentProvider {
  readonly name: string;
  private readonly sources: EnrichmentProvider[];

  constructor(order: string[] = config.enrichmentWaterfall) {
    const known = order.filter((id) => SOURCES[id]);
    if (!known.length) throw new PermanentError(`ENRICHMENT_WATERFALL has no known sources (use ${Object.keys(SOURCES).join(", ")})`);
    this.sources = known.map((id) => SOURCES[id]());
    this.name = `waterfall:${known.join("+")}`;
  }

  async enrichContact(person: Person, account: Account, opts: { contactId?: string } = {}): Promise<EnrichmentResult> {
    let current = person;
    let phoneVerified = Boolean(person.phoneVerified);
    let linkedinMatched = Boolean(person.linkedin);
    let complete = true;
    let lastError: Error | null = null;
    let answered = 0;
    const notes: string[] = [];
    const used: string[] = [];
    for (const src of this.sources) {
      if (current.email && phoneVerified) break;
      try {
        const r = await src.enrichContact(current, account, opts);
        answered++;
        used.push(src.name);
        notes.push(...r.notes.map((n) => `${src.name}: ${n}`));
        complete = complete && r.complete;
        // Keep what earlier sources found; a verified phone is never replaced by an unverified one.
        const keepPhone = phoneVerified && current.phone;
        current = {
          ...current,
          email: current.email ?? r.contact.email,
          linkedin: current.linkedin ?? r.contact.linkedin,
          title: current.title || r.contact.title,
          phone: keepPhone ? current.phone : (r.phoneVerified ? r.contact.phone : (current.phone ?? r.contact.phone)),
          phoneVerified: phoneVerified || r.phoneVerified,
          verifiedBy: r.phoneVerified || (!current.email && r.contact.email) ? src.name : current.verifiedBy,
        };
        phoneVerified = phoneVerified || r.phoneVerified;
        linkedinMatched = linkedinMatched || r.linkedinMatched;
      } catch (err) {
        lastError = err as Error;
        notes.push(`${src.name} failed: ${(err as Error).message}`);
      }
    }
    if (!answered && lastError) throw lastError;
    return { contact: current, phoneVerified, linkedinMatched, recentNews: [], techStack: [], notes: [`sources used: ${used.join(" → ") || "none"}`, ...notes], complete, provider: this.name, provenance: "provider" };
  }
}
