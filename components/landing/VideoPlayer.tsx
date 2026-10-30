"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { track } from "./Tracker";

export type VideoState = "pending" | "script_ready" | "awaiting_recording" | "rendering" | "ready" | "failed";

export interface VideoPlayerProps {
  slug: string;
  script: string;
  videoUrl?: string;
  streamUrl?: string;
  status: VideoState;
  thumbnailUrl?: string;
  contactFirstName: string;
  companyName: string;
  repName?: string;
}

const MOCK_DURATION_MS = 20_000;
const TICK_MS = 100;

function isMockUrl(url?: string): boolean {
  return !url || url.includes("/for/");
}

/** Loom / YouTube / Vimeo links become iframes; anything else is treated as a direct video file (mirrors Opening.astro). */
function embedFor(url: string): { kind: "iframe" | "video"; src: string } {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    if (host === "loom.com") return { kind: "iframe", src: `https://www.loom.com/embed/${u.pathname.split("/").pop()}` };
    if (host === "youtu.be") return { kind: "iframe", src: `https://www.youtube-nocookie.com/embed${u.pathname}` };
    if (host === "youtube.com" && u.searchParams.get("v")) return { kind: "iframe", src: `https://www.youtube-nocookie.com/embed/${u.searchParams.get("v")}` };
    if (host === "vimeo.com") return { kind: "iframe", src: `https://player.vimeo.com/video${u.pathname}` };
  } catch {
    /* fall through */
  }
  return { kind: "video", src: url };
}

/**
 * The video slot of the opening section. Real mode plays the rendered or
 * rep-recorded clip; mock mode plays the script as captions so engagement
 * tracking works before Tavus is connected. Both fire video_play /
 * video_25 / video_50 / video_75 / video_complete once, and video_rewatch on
 * a replay after completion.
 */
export default function VideoPlayer(props: VideoPlayerProps) {
  const { slug, script, videoUrl, streamUrl, status, thumbnailUrl, companyName, contactFirstName, repName } = props;
  const real = !isMockUrl(videoUrl) || Boolean(streamUrl);
  const firedRef = useRef<Set<string>>(new Set());
  const completedOnceRef = useRef(false);

  const fireThreshold = useCallback(
    (percent: number) => {
      const fired = firedRef.current;
      const fire = (ev: string, extra: Record<string, unknown> = {}) => {
        if (fired.has(ev)) return;
        fired.add(ev);
        track(slug, ev, extra);
      };
      if (percent >= 25) fire("video_25");
      if (percent >= 50) fire("video_50");
      if (percent >= 75) fire("video_75", { percent: 75 });
      if (percent >= 99) {
        fire("video_complete");
        completedOnceRef.current = true;
      }
    },
    [slug],
  );

  const onPlayStart = useCallback(() => {
    const fired = firedRef.current;
    if (!fired.has("video_play")) {
      fired.add("video_play");
      track(slug, "video_play");
    } else if (completedOnceRef.current && !fired.has("video_rewatch")) {
      fired.add("video_rewatch");
      track(slug, "video_rewatch");
    }
  }, [slug]);

  if (real && status === "ready") {
    const embed = embedFor(streamUrl ?? videoUrl ?? "");
    if (embed.kind === "iframe") {
      return (
        <div className="cp-video">
          <iframe src={embed.src} title={`A short video for ${companyName}`} loading="lazy" allow="autoplay; fullscreen; picture-in-picture" allowFullScreen />
        </div>
      );
    }
    return (
      <div className="cp-video">
        <video
          controls
          playsInline
          preload="metadata"
          src={embed.src}
          poster={thumbnailUrl}
          aria-label={`A short video for ${companyName}`}
          onPlay={onPlayStart}
          onTimeUpdate={(e) => {
            const v = e.currentTarget;
            if (!v.duration || !Number.isFinite(v.duration)) return;
            fireThreshold((v.currentTime / v.duration) * 100);
          }}
          onEnded={() => fireThreshold(100)}
        />
      </div>
    );
  }

  if (status === "awaiting_recording") {
    return (
      <div className="cp-video" aria-label={`A video for ${companyName} is on its way`}>
        <div className="cp-video__state">
          <span className="cp-video__dot" aria-hidden="true" />
          <p>A short video from {repName || "your Cartage contact"} is on its way. Here is what it covers:</p>
          <p className="cp-video__transcript">{script}</p>
        </div>
      </div>
    );
  }

  if (real && (status === "pending" || status === "script_ready" || status === "rendering")) {
    return (
      <div className="cp-video" aria-label="Video rendering">
        <div className="cp-video__state">
          <span className="cp-video__dot" aria-hidden="true" />
          <p>Video rendering. The transcript is here while it finishes.</p>
          <p className="cp-video__transcript">{script}</p>
        </div>
      </div>
    );
  }

  return <MockPlayer script={script} companyName={companyName} contactFirstName={contactFirstName} onPlayStart={onPlayStart} onProgress={fireThreshold} />;
}

// --- Mock player (script as captions) ----------------------------------------

function MockPlayer({
  script,
  companyName,
  contactFirstName,
  onPlayStart,
  onProgress,
}: {
  script: string;
  companyName: string;
  contactFirstName: string;
  onPlayStart: () => void;
  onProgress: (percent: number) => void;
}) {
  const words = useMemo(() => script.split(/\s+/).filter(Boolean), [script]);
  const [elapsed, setElapsed] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [done, setDone] = useState(false);
  const timerRef = useRef<number | null>(null);

  const percent = Math.min(100, (elapsed / MOCK_DURATION_MS) * 100);
  const visibleWords = Math.min(words.length, Math.floor((elapsed / MOCK_DURATION_MS) * words.length));

  useEffect(() => {
    if (!playing) return;
    timerRef.current = window.setInterval(() => setElapsed((prev) => Math.min(MOCK_DURATION_MS, prev + TICK_MS)), TICK_MS);
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
      timerRef.current = null;
    };
  }, [playing]);

  useEffect(() => {
    onProgress(percent);
    if (percent >= 100 && playing) {
      setPlaying(false);
      setDone(true);
    }
  }, [percent, playing, onProgress]);

  const toggle = () => {
    if (playing) {
      setPlaying(false);
      return;
    }
    if (done || elapsed >= MOCK_DURATION_MS) {
      setElapsed(0);
      setDone(false);
    }
    onPlayStart();
    setPlaying(true);
  };

  const seconds = Math.round(elapsed / 1000);
  const total = Math.round(MOCK_DURATION_MS / 1000);

  return (
    <div className="cp-video">
      <div
        className="cp-video__stage"
        role="button"
        tabIndex={0}
        aria-label={playing ? "Pause video" : "Play video"}
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key === " " || e.key === "Enter") {
            e.preventDefault();
            toggle();
          }
        }}
      >
        <div className="cp-video__badge">
          <span aria-hidden="true">
            <WilsonGlyph size={16} />
          </span>
          <span>A note for {companyName}</span>
        </div>

        {!playing && !done && elapsed === 0 && (
          <div className="cp-video__center">
            <span className="cp-video__play" aria-hidden="true">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z" />
              </svg>
            </span>
            <span className="cp-video__hint">Hi {contactFirstName}, 20 seconds on what we noticed</span>
          </div>
        )}

        {(playing || elapsed > 0) && (
          <p className="cp-video__caption">
            {words.slice(0, visibleWords).join(" ")}
            {playing && <span className="cp-video__cursor" aria-hidden="true" />}
          </p>
        )}

        {!playing && elapsed > 0 && (
          <div className="cp-video__center">
            <span className="cp-video__play" aria-hidden="true">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                {done ? <path d="M12 5V1L7 6l5 5V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z" /> : <path d="M8 5v14l11-7z" />}
              </svg>
            </span>
          </div>
        )}
      </div>

      <div className="cp-video__bar">
        <button type="button" className="cp-video__ctrl" onClick={toggle} aria-label={playing ? "Pause" : done ? "Replay" : "Play"}>
          {playing ? "Pause" : done ? "Replay" : "Play"}
        </button>
        <div className="cp-video__track">
          <div className="cp-video__fill" style={{ width: `${percent}%` }} />
        </div>
        <span>
          0:{String(seconds).padStart(2, "0")} / 0:{String(total).padStart(2, "0")}
        </span>
      </div>
    </div>
  );
}

export function WilsonGlyph({ size = 40, className }: { size?: number; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 51 51" width={size} height={size} aria-hidden="true">
      <path
        fill="currentColor"
        d="M34.545 11.84h2.625v9.14h-2.625zm-8.265 0h2.715L23.27 28.85h-2.715zm-13.29 0h2.625v9.14H12.99zm12.09 26.14c-4.95 0-9.745-.935-14.265-2.775l1.025-2.33c4.195 1.71 8.65 2.575 13.24 2.575s9.045-.865 13.24-2.575l1.025 2.33A37.6 37.6 0 0 1 25.08 37.98"
      />
    </svg>
  );
}
