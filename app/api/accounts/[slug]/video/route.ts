import { z } from "zod";
import { error, json, readJson, requireAccount } from "@/lib/api";
import { logActivity } from "@/lib/engine/activity";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

/** A rep attaches their recorded clip (rep-video arm) or overrides the AI video. */
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const body = await readJson(req, z.object({ videoUrl: z.string().url(), thumbnailUrl: z.string().url().optional() }));
  if (!body.ok) return body.response;
  const store = getStore();
  const found = await requireAccount(store, slug);
  if ("response" in found) return found.response;
  const a = found.account;
  if (!a.campaign) return error("no campaign for this account yet", 409);
  const updated = await store.upsertAccount({
    ...a,
    campaign: {
      ...a.campaign,
      videoUrl: body.data.videoUrl,
      videoThumbnailUrl: body.data.thumbnailUrl ?? a.campaign.videoThumbnailUrl,
      videoStatus: "ready",
      videoSource: "rep",
      videoStatusDetails: "rep recording attached",
    },
  });
  await logActivity(store, a.id, "rep", "recording_attached", "Rep attached the recorded video", [body.data.videoUrl]);
  return json({ ok: true, campaign: updated.campaign });
}
