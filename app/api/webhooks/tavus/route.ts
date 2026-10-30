import { error, json, safeEqual, callbackSecretMissing } from "@/lib/api";
import { config } from "@/lib/config";
import { logActivity } from "@/lib/engine/activity";
import { tavusToRecord } from "@/lib/providers/video";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * Tavus completion callback. Tavus POSTs to the `callback_url` we passed on
 * create when the video is ready or errored:
 *   { video_id, status: "ready"|"error", hosted_url, download_url, stream_url, status_details, ... }
 * Tavus does not sign callbacks, so we put a token in the callback URL:
 * set TAVUS_WEBHOOK_SECRET and use .../api/webhooks/tavus?token=<secret>.
 * Docs: https://docs.tavus.io/sections/webhooks-and-callbacks.md
 */
export async function POST(req: Request) {
  const blocked = callbackSecretMissing(config.tavus.webhookSecret, "TAVUS_WEBHOOK_SECRET");
  if (blocked) return blocked;
  if (config.tavus.webhookSecret) {
    const token = new URL(req.url).searchParams.get("token") ?? "";
    if (!safeEqual(token, config.tavus.webhookSecret)) return error("unauthorized", 401);
  }
  let body: { video_id?: string; status?: string; hosted_url?: string; download_url?: string | null; stream_url?: string | null; status_details?: string };
  try {
    body = await req.json();
  } catch {
    return error("invalid JSON");
  }
  if (!body.video_id || !body.status) return error("video_id and status are required");

  const store = getStore();
  const account = (await store.listAccounts()).find((a) => a.campaign?.videoId === body.video_id);
  if (!account || !account.campaign) return json({ ok: true, matched: false });

  const rec = tavusToRecord({ video_id: body.video_id, status: body.status as "ready" | "error" | "queued" | "generating" | "deleted", hosted_url: body.hosted_url, download_url: body.download_url, stream_url: body.stream_url, status_details: body.status_details });
  await store.upsertAccount({
    ...account,
    campaign: {
      ...account.campaign,
      videoStatus: rec.status,
      videoUrl: rec.hostedUrl ?? account.campaign.videoUrl,
      videoThumbnailUrl: rec.thumbnailUrl ?? account.campaign.videoThumbnailUrl,
      videoStatusDetails: rec.statusDetails,
    },
  });
  await logActivity(store, account.id, "webhook", rec.status === "ready" ? "video_ready" : "video_failed", `Tavus callback: video ${rec.status}`, [rec.hostedUrl ?? "", rec.statusDetails ?? ""]);
  return json({ ok: true, matched: true, slug: account.slug, status: rec.status });
}
