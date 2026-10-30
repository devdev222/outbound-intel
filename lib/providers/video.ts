import { config } from "@/lib/config";
import { httpJson } from "./http";
import type { VideoCreateRequest, VideoProvider, VideoRecord } from "./types";

/**
 * Mock video: the landing page renders a scripted "video" placeholder (the
 * script plays as captions over a poster with a progress bar) so engagement
 * tracking (25/50/75/100%) works end to end without a Tavus account.
 */
export class MockVideoProvider implements VideoProvider {
  readonly name = "mock";

  async createVideo(req: VideoCreateRequest): Promise<VideoRecord> {
    const videoId = `mock_${req.accountSlug}`;
    return {
      videoId,
      status: "ready",
      hostedUrl: `${config.appUrl}/for/${req.accountSlug}#video`,
      thumbnailUrl: `${config.appUrl}/api/thumb/${req.accountSlug}`,
      statusDetails: "mock video: script rendered as captions on the landing page",
    };
  }

  async getVideo(videoId: string): Promise<VideoRecord> {
    return { videoId, status: "ready" };
  }
}

/**
 * Tavus adapter. Verified against the official docs on 2026-10-29:
 *  - POST https://tavusapi.com/v2/videos  (header x-api-key; body replica_id + script | audio_url,
 *    optional video_name, callback_url, background_url, fast, properties)
 *    -> { video_id, video_name, status: queued|generating|ready|deleted|error, hosted_url, created_at }
 *  - GET  https://tavusapi.com/v2/videos/{video_id}?verbose=true
 *    -> adds download_url, stream_url, status_details, still_image_thumbnail_url, gif_thumbnail_url
 *  - Completion callback POSTs { video_id, status, hosted_url, download_url, stream_url, status_details, ... }
 *    to callback_url; handled by /api/webhooks/tavus.
 *  Docs: https://docs.tavus.io/api-reference/video-request/create-video ,
 *        https://docs.tavus.io/api-reference/video-request/get-video ,
 *        https://docs.tavus.io/sections/webhooks-and-callbacks.md
 *  Faces/replicas are trained once with model_name phoenix-4.5 (current default); the
 *  resulting face_id is what TAVUS_REPLICA_ID holds.
 */
interface TavusVideo {
  video_id: string;
  video_name?: string;
  status: "queued" | "generating" | "ready" | "deleted" | "error";
  hosted_url?: string;
  download_url?: string | null;
  stream_url?: string | null;
  status_details?: string;
  still_image_thumbnail_url?: string;
  gif_thumbnail_url?: string;
}

function mapTavusStatus(s: TavusVideo["status"]): VideoRecord["status"] {
  if (s === "ready") return "ready";
  if (s === "error" || s === "deleted") return "failed";
  if (s === "generating") return "rendering";
  return "pending";
}

export function tavusToRecord(v: TavusVideo): VideoRecord {
  return {
    videoId: v.video_id,
    status: mapTavusStatus(v.status),
    hostedUrl: v.hosted_url ?? undefined,
    streamUrl: v.stream_url ?? undefined,
    downloadUrl: v.download_url ?? undefined,
    thumbnailUrl: v.still_image_thumbnail_url ?? v.gif_thumbnail_url,
    statusDetails: v.status_details,
  };
}

export class TavusVideoProvider implements VideoProvider {
  readonly name = "tavus";
  private readonly base = "https://tavusapi.com/v2";

  private headers() {
    return { "x-api-key": config.tavus.apiKey };
  }

  async createVideo(req: VideoCreateRequest): Promise<VideoRecord> {
    if (!config.tavus.apiKey || !config.tavus.replicaId) {
      throw new Error("TAVUS_API_KEY and TAVUS_REPLICA_ID are required for VIDEO_PROVIDER=tavus");
    }
    const { data } = await httpJson<TavusVideo>(`${this.base}/videos`, {
      method: "POST",
      headers: this.headers(),
      body: {
        replica_id: config.tavus.replicaId,
        script: req.script,
        video_name: req.name,
        callback_url: req.callbackUrl ?? `${config.appUrl}/api/webhooks/tavus`,
      },
    });
    return tavusToRecord(data);
  }

  async getVideo(videoId: string): Promise<VideoRecord> {
    const { data } = await httpJson<TavusVideo>(`${this.base}/videos/${encodeURIComponent(videoId)}?verbose=true`, {
      headers: this.headers(),
    });
    return tavusToRecord(data);
  }
}
