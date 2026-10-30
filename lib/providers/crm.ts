import { config } from "@/lib/config";
import { generateHistorical } from "@/lib/synthetic/generate";
import type { Account, HistoricalRecord, Outcome } from "@/lib/types";
import { httpJson } from "./http";
import type { CrmProvider } from "./types";

/**
 * Synthetic CRM: a historical book of business with won, lost, meeting-only and
 * no-response prospects, generated with planted signal correlations so the
 * LEARN step has something real to discover (and so the demo can show the
 * difference between winners and non-converters, not just winners).
 */
export class MockCrmProvider implements CrmProvider {
  readonly name = "mock";
  constructor(private readonly seed = 7, private readonly size = 320) {}

  async exportHistorical(): Promise<HistoricalRecord[]> {
    return generateHistorical(this.size, this.seed);
  }

  async logOutcome(): Promise<void> {}
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

  async logOutcome(account: Account, outcome: Outcome): Promise<void> {
    if (!config.crm.exportUrl) return;
    await httpJson(`${config.crm.exportUrl.replace(/\/$/, "")}/outcomes`, {
      method: "POST",
      headers: this.headers(),
      body: {
        account_slug: account.slug,
        company: account.companyName,
        domain: account.domain,
        outcome_type: outcome.outcomeType,
        value: outcome.value,
        notes: outcome.notes,
        at: outcome.createdAt,
      },
    });
  }
}
