import { z } from "zod";
import { runAgent } from "@/lib/agents/runtime";
import { json, readJson, requireAccount } from "@/lib/api";
import { caseStudyById } from "@/lib/content/case-studies";
import { recordEngagement } from "@/lib/engine/engagement";
import { getProviders } from "@/lib/providers";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const SCENARIOS = ["visit", "video", "calculator", "case_study", "return", "reply", "booking", "hot"] as const;

/**
 * Engagement simulator for demos: replays the events a real prospect would
 * generate on the personalized page (or in their inbox) and lets the normal
 * pipeline react, including Jerry's activation, synchronously so the UI can
 * show the result right away.
 */
export async function POST(req: Request) {
  const body = await readJson(req, z.object({ slug: z.string(), scenario: z.enum(SCENARIOS), visitorId: z.string().optional() }));
  if (!body.ok) return body.response;
  const store = getStore();
  const providers = getProviders();
  const found = await requireAccount(store, body.data.slug);
  if ("response" in found) return found.response;
  let account = found.account;
  const visitorId = body.data.visitorId ?? "simulator";
  const study = caseStudyById(account.campaign?.caseStudyId ?? "general-manufacturing-coordination");

  const steps: Record<(typeof SCENARIOS)[number], { eventType: string; properties: Record<string, unknown> }[]> = {
    visit: [{ eventType: "page_view", properties: { referrer: "email step 1", simulated: true } }],
    video: [
      { eventType: "video_play", properties: { simulated: true } },
      { eventType: "video_25", properties: { simulated: true } },
      { eventType: "video_50", properties: { simulated: true } },
      { eventType: "video_75", properties: { percent: 85, simulated: true } },
    ],
    calculator: [
      { eventType: "calculator_input", properties: { field: "shipmentsPerMonth", value: 500, simulated: true } },
      { eventType: "calculator_completed", properties: { shipmentsPerMonth: 500, hoursSaved: 42, simulated: true } },
    ],
    case_study: [{ eventType: "case_study_viewed", properties: { caseStudyId: study.id, title: study.title, simulated: true } }],
    return: [{ eventType: "return_visit_24h", properties: { visitNumber: "3rd", simulated: true } }],
    reply: [{ eventType: "email_reply", properties: { step: 1, simulated: true } }],
    booking: [{ eventType: "booking_clicked", properties: { simulated: true } }],
    hot: [],
  };
  steps.hot = [...steps.visit, ...steps.video, ...steps.calculator, ...steps.case_study, ...steps.return];

  const startedAt = new Date().toISOString();
  const fired: string[] = [];
  let activationTriggered = false;
  for (const step of steps[body.data.scenario]) {
    const r = await recordEngagement(store, providers, account, { ...step, visitorId });
    account = r.account;
    fired.push(...r.events.map((e) => e.eventType));
    activationTriggered = activationTriggered || r.activationTriggered;
  }

  let alertDelivered = false;
  if (activationTriggered || account.pendingActivation) {
    await runAgent("jerry", { force: true });
    const latest = (await store.listAlerts({ accountId: account.id, limit: 1 }))[0];
    alertDelivered = Boolean(latest && latest.createdAt >= startedAt && latest.deliveredVia.length > 0);
    account = (await store.getAccountById(account.id)) ?? account;
  }

  return json({
    ok: true,
    events: fired,
    engagementScore: account.engagementScore,
    priority: account.priority,
    status: account.status,
    activationTriggered,
    alertDelivered,
  });
}
