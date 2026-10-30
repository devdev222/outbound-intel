import { config } from "@/lib/config";
import { mergeContact } from "./contact";
import { jerryMcp } from "@/lib/agents/jerry-mcp";
import type { EnrichmentResult, Providers } from "@/lib/providers";
import type { Store } from "@/lib/store";
import type { Account, EnrichmentState, Person } from "@/lib/types";
import { nowIso } from "@/lib/util";
import { backoffMs } from "./operations";

/**
 * Contact enrichment with honest failure handling. There is no silent fallback:
 * if Jerry-over-MCP or the enrichment provider fails, the account records the
 * error, a bounded retry time, and a readiness blocker the UI shows with the
 * next action. Mock results are labelled synthetic and refused in live mode.
 */

export const MAX_ENRICHMENT_ATTEMPTS = 5;

export type EnrichOutcome =
  | { ok: true; account: Account; result: EnrichmentResult }
  | { ok: false; account: Account; error: string; retryable: boolean };

function nextState(prev: EnrichmentState | null | undefined, patch: Partial<EnrichmentState>): EnrichmentState {
  return {
    attempts: prev?.attempts ?? 0,
    lastAttemptAt: prev?.lastAttemptAt ?? null,
    lastSuccessAt: prev?.lastSuccessAt ?? null,
    lastError: prev?.lastError ?? null,
    provider: prev?.provider ?? null,
    nextAttemptAt: prev?.nextAttemptAt ?? null,
    ...patch,
  };
}

export function enrichmentDue(account: Account, at = nowIso()): boolean {
  const e = account.enrichment;
  if (!e) return true;
  if (e.attempts >= MAX_ENRICHMENT_ATTEMPTS && e.lastError) return false;
  return !e.nextAttemptAt || e.nextAttemptAt <= at;
}

export async function enrichAccountContact(store: Store, providers: Providers, account: Account, person: Person): Promise<EnrichOutcome> {
  const attempts = (account.enrichment?.attempts ?? 0) + 1;
  const via = config.jerry.mode === "mcp" ? "jerry-mcp" : providers.enrichment.name;
  try {
    let result: EnrichmentResult;
    if (config.jerry.mode === "mcp") {
      // Jerry over MCP is the configured enrichment path; its outage is a blocker, never a cue to use mock data.
      result = await jerryMcp.enrichContactOrThrow(person, account);
    } else {
      result = await providers.enrichment.enrichContact(person, account);
    }
    // Field-level merge: phone verification is bound to the exact number the provider verified.
    const source = result.provenance === "synthetic" ? "synthetic" : result.provider;
    const prev = account.contact && account.contact.name === person.name ? account.contact : person;
    const merged = mergeContact(prev, { name: result.contact.name, title: result.contact.title, seniority: result.contact.seniority, email: result.contact.email, phone: result.contact.phone, linkedin: result.contact.linkedin, phoneVerified: result.phoneVerified === true }, source);
    const contact: Person = { ...merged, verifiedBy: result.provenance === "synthetic" ? "synthetic" : (merged.verifiedBy ?? result.provider) };
    const updated = await store.upsertAccount({
      ...account,
      contact,
      enrichment: nextState(account.enrichment, { attempts: 0, lastAttemptAt: nowIso(), lastSuccessAt: nowIso(), lastError: null, provider: result.provider, nextAttemptAt: null }),
    });
    return { ok: true, account: updated, result: { ...result, contact } };
  } catch (err) {
    const message = (err as Error).message ?? String(err);
    const permanent = Boolean((err as { permanent?: boolean }).permanent);
    const exhausted = attempts >= MAX_ENRICHMENT_ATTEMPTS;
    const updated = await store.upsertAccount({
      ...account,
      enrichment: nextState(account.enrichment, {
        attempts,
        lastAttemptAt: nowIso(),
        lastError: `${via}: ${message}`.slice(0, 400),
        provider: via,
        nextAttemptAt: permanent || exhausted ? null : new Date(Date.now() + backoffMs(attempts)).toISOString(),
      }),
    });
    return { ok: false, account: updated, error: message, retryable: !permanent && !exhausted };
  }
}
