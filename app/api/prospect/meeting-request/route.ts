import { z } from "zod";
import { json, readJson } from "@/lib/api";
import { recordEngagement } from "@/lib/engine/engagement";
import { requestMeeting } from "@/lib/engine/prospect";
import { accountForPage } from "@/lib/engine/prospect-auth";
import { getProviders } from "@/lib/providers";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

const Body = z.object({
  slug: z.string().min(1).max(120),
  token: z.string().length(8),
  requestId: z.string().min(8).max(64),
  name: z.string().trim().max(120).default(""),
  email: z.email().max(254),
  note: z.string().max(1000).optional(),
  preferredTimes: z.string().max(300).optional(),
  website: z.string().max(200).optional(), // honeypot
  visitorId: z.string().max(200).optional().nullable(),
});

/**
 * "Send me times" from a personalized page. Records `meeting_requested` and an
 * assigned scheduling task due now; the page shows success only after this
 * returns 200. Retries with the same requestId return the original task.
 */
export async function POST(req: Request) {
  const body = await readJson(req, Body);
  if (!body.ok) return body.response;
  const d = body.data;
  if (d.website) return json({ ok: true }); // bot: pretend success, store nothing
  const store = getStore();
  const found = await accountForPage(store, d.slug, d.token);
  if ("response" in found) return found.response;
  const providers = getProviders();
  const { task, replayed } = await requestMeeting(store, providers, found.account, { requestId: d.requestId, name: d.name, email: d.email.toLowerCase(), note: d.note, preferredTimes: d.preferredTimes });
  if (!replayed) {
    const fresh = (await store.getAccountById(found.account.id)) ?? found.account;
    await recordEngagement(store, providers, fresh, { eventType: "booking_clicked", properties: { source: "request-form", taskId: task.id }, visitorId: d.visitorId ?? null, source: "page" });
  }
  return json({ ok: true, taskId: task.id, replayed });
}
