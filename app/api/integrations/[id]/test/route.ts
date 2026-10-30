import { z } from "zod";
import { jerryMcp } from "@/lib/agents/jerry-mcp";
import { audit, requireApiRole } from "@/lib/auth";
import { error, json, readJson } from "@/lib/api";
import { config } from "@/lib/config";
import { fingerprintFor, saveTestResult, specFor } from "@/lib/integrations";
import { getLlmClient, LLM_MODEL } from "@/lib/llm";
import { getProviders } from "@/lib/providers";
import { httpJson } from "@/lib/providers/http";
import { getStore } from "@/lib/store";
import { EXPECTED_SCHEMA_VERSION } from "@/lib/store/schema";
import type { HotLeadAlert } from "@/lib/types";
import { nowIso } from "@/lib/util";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.object({ to: z.email().optional(), confirmSideEffect: z.boolean().optional() }).default({});

/**
 * Connection tests. Each does the smallest real call that proves the ACTIVE
 * adapter works, names that provider in the result, and is saved so the
 * Integrations page can show Verified / Degraded. Tests with a real side effect
 * must be confirmed. A mock adapter can never produce a verified result.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole(["admin"]);
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const spec = specFor(id);
  if (!spec || !spec.test?.available) return error(`no test available for "${id}" with the current configuration`, 404);
  const body = await readJson(req, Body);
  if (!body.ok) return body.response;
  if (spec.test.sideEffect && !body.data.confirmSideEffect) return error(`this test ${spec.test.sideEffect}; confirm to run it`, 409);

  let ok = false;
  let message = "";
  try {
    const r = await runTest(id, body.data.to);
    ok = r.ok;
    message = r.message;
  } catch (err) {
    ok = false;
    message = (err as Error).message;
  }
  const verified = ok && !spec.mock && spec.missing.length === 0;
  const fullMessage = `${spec.provider}: ${message}`;
  const store = getStore();
  await saveTestResult(store, { id, provider: spec.provider, fingerprint: fingerprintFor(spec), ok, verified, message: fullMessage.slice(0, 500), at: nowIso(), by: auth.user.name });
  await audit(auth.user, "integration_test", id, `${spec.provider} ${ok ? "ok" : "failed"}`);
  return json({ ok, verified, provider: spec.provider, message: fullMessage });
}

async function runTest(id: string, to: string | undefined): Promise<{ ok: boolean; message: string }> {
  const providers = getProviders();
  switch (id) {
    case "anthropic": {
      const client = getLlmClient();
      if (!client) return { ok: false, message: "ANTHROPIC_API_KEY is not set" };
      const r = await client.messages.countTokens({ model: LLM_MODEL, messages: [{ role: "user", content: "ping" }] });
      return { ok: true, message: `authenticated; countTokens on ${LLM_MODEL} returned ${r.input_tokens} tokens` };
    }
    case "jerry":
    case "enrichment": {
      if (config.jerry.mode !== "mcp") return { ok: false, message: "JERRY_MODE is not mcp" };
      return jerryMcp.test();
    }
    case "alerts": {
      if (providers.alerts.name !== "slack") return { ok: false, message: `active alert provider is ${providers.alerts.name}, not Slack` };
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
      return { ok: r.delivered, message: r.delivered ? `delivered via ${r.via}` : `not delivered via ${r.via}: ${r.note ?? "unknown"}` };
    }
    case "outreach": {
      if (config.providers.outreach !== "resend") return { ok: false, message: `active outreach provider is ${config.providers.outreach}; only Resend has a test` };
      if (!config.resend.apiKey || !config.resend.from) return { ok: false, message: "RESEND_API_KEY / RESEND_FROM not set" };
      const recipient = to ?? config.resend.testTo;
      if (!recipient) return { ok: false, message: "enter a recipient (or set RESEND_TEST_TO)" };
      const { data } = await httpJson<unknown>("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${config.resend.apiKey}` },
        body: { from: config.resend.from, to: [recipient], subject: "Outbound intelligence engine: test email", text: "Resend is wired. This was sent from the Integrations page." },
      });
      const parsed = z.object({ id: z.string().min(1) }).safeParse(data);
      if (!parsed.success) return { ok: false, message: "Resend answered without an email id" };
      return { ok: true, message: `sent to ${recipient} (id ${parsed.data.id})` };
    }
    case "store": {
      const store = getStore();
      const [n, version] = await Promise.all([store.listAccounts().then((a) => a.length), store.schemaVersion()]);
      if (store.kind === "supabase" && version !== EXPECTED_SCHEMA_VERSION) {
        return { ok: false, message: `reachable, but schema version is ${version ?? "missing"}; expected ${EXPECTED_SCHEMA_VERSION}. Apply supabase/migrations in order.` };
      }
      return { ok: true, message: `${store.kind} store reachable; ${n} accounts; schema v${version ?? "?"}` };
    }
    case "video": {
      if (!config.tavus.apiKey) return { ok: false, message: "TAVUS_API_KEY not set" };
      const { data } = await httpJson<unknown>("https://tavusapi.com/v2/videos?limit=1", { headers: { "x-api-key": config.tavus.apiKey } });
      const parsed = z.object({ data: z.array(z.unknown()) }).safeParse(data);
      if (!parsed.success) return { ok: false, message: "unexpected response shape from Tavus" };
      return { ok: true, message: `authenticated; ${parsed.data.data.length} video(s) listed` };
    }
    case "analytics": {
      if (providers.analytics.name !== "posthog") return { ok: false, message: `active analytics provider is ${providers.analytics.name}` };
      await providers.analytics.capture({ event: "integration_test", distinctId: "integrations-page", properties: { source: "dashboard" } });
      return { ok: true, message: "test event accepted (check PostHog live events)" };
    }
    case "discovery": {
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
      return { ok: r.accepted, message: r.note };
    }
    case "crm": {
      const rows = await providers.crm.exportHistorical();
      return { ok: true, message: `${rows.length} historical records exported` };
    }
    default:
      return { ok: false, message: `no test for "${id}"` };
  }
}
