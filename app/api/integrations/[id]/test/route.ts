import { z } from "zod";
import { error, json, readJson } from "@/lib/api";
import { config } from "@/lib/config";
import { getLlmClient, LLM_MODEL } from "@/lib/llm";
import { getProviders } from "@/lib/providers";
import { httpJson } from "@/lib/providers/http";
import { getStore } from "@/lib/store";
import type { HotLeadAlert } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Safe connection tests for the Integrations page. Each test does the smallest
 * real call that proves the credentials work.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await readJson(req, z.object({ to: z.string().email().optional() }).default({}));
  const to = body.ok ? body.data.to : undefined;
  const providers = getProviders();

  try {
    switch (id) {
      case "anthropic": {
        const client = getLlmClient();
        if (!client) return json({ ok: false, message: "ANTHROPIC_API_KEY is not set" });
        const r = await client.messages.countTokens({ model: LLM_MODEL, messages: [{ role: "user", content: "ping" }] });
        return json({ ok: true, message: `Authenticated. countTokens on ${LLM_MODEL} returned ${r.input_tokens} input tokens.` });
      }
      case "slack": {
        const alert: HotLeadAlert = {
          accountId: "test",
          slug: "integration-test",
          companyName: "Integration test",
          contact: { name: "Test Contact", title: "VP of Transportation", seniority: "vp", phone: "(555) 010-0000", phoneVerified: true },
          originalSignals: ["This is a test alert from the Integrations page"],
          engagement: ["No real engagement"],
          priorityBefore: 70,
          priorityAfter: 75,
          enrichment: ["Nothing enriched"],
          talkTrack: "If you can read this in Slack, alerts are wired.",
          action: "No action",
          pageUrl: `${config.appUrl}/`,
          triggeredBy: "integration test",
        };
        const r = await providers.alerts.sendHotLead(alert);
        return json({ ok: r.delivered, message: r.delivered ? `Delivered via ${r.via}` : `Not delivered via ${r.via}: ${r.note ?? "unknown"}` });
      }
      case "resend": {
        if (!config.resend.apiKey || !config.resend.from) return json({ ok: false, message: "RESEND_API_KEY / RESEND_FROM not set" });
        const recipient = to ?? config.resend.testTo;
        if (!recipient) return json({ ok: false, message: "Enter a recipient (or set RESEND_TEST_TO)" });
        const { data } = await httpJson<{ id: string }>("https://api.resend.com/emails", {
          method: "POST",
          headers: { authorization: `Bearer ${config.resend.apiKey}` },
          body: { from: config.resend.from, to: [recipient], subject: "Outbound intelligence engine: test email", text: "Resend is wired. This was sent from the Integrations page." },
        });
        return json({ ok: true, message: `Sent to ${recipient} (id ${data.id})` });
      }
      case "supabase": {
        const store = getStore();
        const n = (await store.listAccounts()).length;
        return json({ ok: true, message: `${store.kind} store reachable; ${n} accounts` });
      }
      case "tavus": {
        if (!config.tavus.apiKey) return json({ ok: false, message: "TAVUS_API_KEY not set" });
        const { data } = await httpJson<{ data?: unknown[] }>("https://tavusapi.com/v2/videos?limit=1", { headers: { "x-api-key": config.tavus.apiKey } });
        return json({ ok: true, message: `Authenticated; ${Array.isArray(data?.data) ? data!.data!.length : 0} video(s) returned` });
      }
      case "posthog": {
        await providers.analytics.capture({ event: "integration_test", distinctId: "integrations-page", properties: { source: "dashboard" } });
        return json({ ok: true, message: "Test event captured (check PostHog live events)" });
      }
      case "clay": {
        const r = await providers.discovery.submit({
          companyName: "Integration Test Co",
          domain: "integration-test.example",
          industry: "Test",
          employeeCount: 1,
          hqCity: "Nowhere",
          hqState: "NA",
          jobPostings: [],
          news: [],
          techStack: [],
          painEvidence: [],
          people: [],
          source: "test",
        });
        return json({ ok: r.accepted, message: r.note });
      }
      case "crm": {
        const rows = await providers.crm.exportHistorical();
        return json({ ok: true, message: `${rows.length} historical records exported` });
      }
      default:
        return error(`no test for "${id}"`, 404);
    }
  } catch (err) {
    return json({ ok: false, message: (err as Error).message });
  }
}
