import { config } from "@/lib/config";
import { generateHistorical } from "@/lib/synthetic/generate";
import type { Account, HistoricalRecord, Outcome } from "@/lib/types";
import { z } from "zod";
import { PermanentError } from "@/lib/engine/operations";
import { httpJson } from "./http";

const CrmAck = z.object({ id: z.union([z.string(), z.number()]).transform(String).optional() }).passthrough();
import type { CrmProvider } from "./types";

/**
 * Synthetic CRM: a historical book of business with won, lost, meeting-only and
 * no-response prospects, generated with planted signal correlations so the
 * LEARN step has something real to discover (and so the demo can show the
 * difference between winners and non-converters, not just winners).
 */
export class MockCrmProvider implements CrmProvider {
  readonly name: string = "mock";
  constructor(private readonly seed = 7, private readonly size = 320) {}

  async exportHistorical(): Promise<HistoricalRecord[]> {
    return generateHistorical(this.size, this.seed);
  }

  async logOutcome(_account?: Account, _outcome?: Outcome, _key?: string): Promise<{ remoteId?: string | null } | void> {}
}

/**
 * Generic HTTP CRM adapter. Contract:
 *   GET  {CRM_EXPORT_URL}  -> HistoricalRecord[] (same JSON shape as lib/types.ts HistoricalRecord,
 *                             or snake_case equivalents)
 *   POST {CRM_EXPORT_URL}/outcomes { account_slug, company, domain, outcome_type, value, notes, at }
 * Point it at a thin export endpoint in front of HubSpot/Salesforce, or at
 * Cartage's internal CRM. Mapping lives in one place so the field names of the
 * real CRM only matter here.
 */
export class HttpCrmProvider implements CrmProvider {
  readonly name = "http";

  private headers() {
    return (config.crm.apiKey ? { authorization: `Bearer ${config.crm.apiKey}` } : {}) as Record<string, string>;
  }

  async exportHistorical(): Promise<HistoricalRecord[]> {
    if (!config.crm.exportUrl) throw new Error("CRM_EXPORT_URL is required for CRM_PROVIDER=http");
    const { data } = await httpJson<Array<Record<string, unknown>>>(config.crm.exportUrl, { headers: this.headers() });
    return data.map((r, i) => ({
      id: String(r.id ?? `crm_${i}`),
      companyName: String(r.companyName ?? r.company_name ?? ""),
      industry: String(r.industry ?? "Unknown"),
      employeeCount: Number(r.employeeCount ?? r.employee_count ?? 0),
      signalKeys: (r.signalKeys ?? r.signal_keys ?? []) as string[],
      persona: String(r.persona ?? ""),
      seniority: (r.seniority as HistoricalRecord["seniority"]) ?? "manager",
      messagingAngle: (r.messagingAngle ?? r.messaging_angle) as string | undefined,
      outcome: (r.outcome as HistoricalRecord["outcome"]) ?? "no_response",
      dealValue: (r.dealValue ?? r.deal_value) as number | undefined,
      firstTouchAt: String(r.firstTouchAt ?? r.first_touch_at ?? new Date().toISOString()),
      outcomeAt: String(r.outcomeAt ?? r.outcome_at ?? new Date().toISOString()),
      source: "crm_export",
    }));
  }

  /**
   * POST {CRM_EXPORT_URL}/outcomes with an Idempotency-Key. outcome_id is the
   * stable external id; opportunity_id groups created -> won; contact_id is the
   * stable buying-group person id (with their name/title/email when known). A 4xx other than
   * 408/409/429 is permanent; anything else is retried by the durable crm_sync
   * operation. Response: optional { id } (the CRM record id), validated.
   */
  async logOutcome(account: Account, outcome: Outcome, idempotencyKey?: string): Promise<{ remoteId?: string | null }> {
    if (!config.crm.exportUrl) throw new PermanentError("CRM_EXPORT_URL is not set");
    try {
      const { data } = await httpJson<unknown>(`${config.crm.exportUrl.replace(/\/$/, "")}/outcomes`, {
        method: "POST",
        headers: { ...this.headers(), ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}) },
        body: {
          outcome_id: outcome.id,
          opportunity_id: outcome.opportunityId ?? null,
          account_id: account.id,
          contact_id: outcome.contactId ?? null,
          contact: account.contact ? { name: account.contact.name, title: account.contact.title, email: account.contact.email ?? null } : null,
          account_slug: account.slug,
          company: account.companyName,
          domain: account.domain,
          outcome_type: outcome.outcomeType,
          value: outcome.value,
          notes: outcome.notes,
          source: outcome.source,
          at: outcome.createdAt,
        },
      });
      const parsed = CrmAck.safeParse(data ?? {});
      return { remoteId: parsed.success ? (parsed.data.id ?? null) : null };
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status && status >= 400 && status < 500 && ![408, 409, 429].includes(status)) throw new PermanentError(`CRM rejected the outcome (${status}): ${(err as Error).message}`);
      throw err;
    }
  }
}

/**
 * Test CRM (CRM_PROVIDER=test): records each write keyed by idempotency key and
 * can be told to fail (failNext("crm")). Used by the tests and the journey.
 */
export class TestCrmProvider extends MockCrmProvider {
  override readonly name: string = "test";
  async logOutcome(account: Account, outcome: Outcome, idempotencyKey?: string): Promise<{ remoteId?: string | null }> {
    const { testStep } = await import("./testing");
    await testStep("crm", idempotencyKey ?? `crm:${outcome.id}`, account.id, `${outcome.outcomeType} contact=${outcome.contactId ?? "none"} email=${account.contact?.email ?? "none"}`);
    return { remoteId: `crm_${outcome.id.slice(0, 8)}` };
  }
}
