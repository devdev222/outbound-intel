"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { track } from "./Tracker";

export interface VideoPlayerProps {
  slug: string;
  script: string;
  videoUrl?: string;
  streamUrl?: string;
  status: "pending" | "rendering" | "ready" | "failed";
  thumbnailUrl?: string;
  contactFirstName: string;
  companyName: string;
}

const MOCK_DURATION_MS = 20_000;
const TICK_MS = 100;

function isMockUrl(url?: string): boolean {
  return !url || url.includes("/for/");
}

/**
 * Personalized video. Mock mode plays the script as captions over a poster so
 * engagement tracking works without a Tavus account; real mode plays the
 * rendered video. Both fire video_play / video_25 / video_50 / video_75 /
 * video_complete once, and video_rewatch on a replay after completion.
 */
export default function VideoPlayer(props: VideoPlayerProps) {
  const { slug, script, videoUrl, streamUrl, status, thumbnailUrl, companyName, contactFirstName } = props;
  const mock = isMockUrl(videoUrl) && !streamUrl;
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

  if (!mock && status === "ready") {
    return <RealPlayer src={streamUrl ?? videoUrl ?? ""} poster={thumbnailUrl} onPlayStart={onPlayStart} onProgress={fireThreshold} />;
  }

  if (!mock && (status === "pending" || status === "rendering")) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-6">
        <div className="flex items-center gap-3 text-sm text-slate-600">
          <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-orange-500" />
          Video rendering. The transcript is below while it finishes.
        </div>
        <p className="mt-4 text-base leading-7 text-slate-800">{script}</p>
      </div>
    );
  }

  return <MockPlayer script={script} companyName={companyName} contactFirstName={contactFirstName} onPlayStart={onPlayStart} onProgress={fireThreshold} />;
}

// --- Real <video> -------------------------------------------------------------

function RealPlayer({
  src,
  poster,
  onPlayStart,
  onProgress,
}: {
  src: string;
  poster?: string;
  onPlayStart: () => void;
  onProgress: (percent: number) => void;
}) {
  return (
    <video
      className="aspect-video w-full rounded-xl border border-slate-200 bg-black"
      controls
      playsInline
      preload="metadata"
      src={src}
      poster={poster}
      onPlay={onPlayStart}
      onTimeUpdate={(e) => {
        const v = e.currentTarget;
        if (!v.duration || !Number.isFinite(v.duration)) return;
        onProgress((v.currentTime / v.duration) * 100);
      }}
      onEnded={() => onProgress(100)}
    />
  );
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
    timerRef.current = window.setInterval(() => {
      setElapsed((prev) => {
        const next = Math.min(MOCK_DURATION_MS, prev + TICK_MS);
        return next;
      });
    }, TICK_MS);
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
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-950 shadow-sm">
      <div
        className="relative aspect-video w-full select-none"
        style={{ background: "radial-gradient(120% 90% at 20% 10%, #1f2937 0%, #0b0f14 60%, #000 100%)" }}
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
        {/* Speaker placeholder */}
        <div className="absolute left-5 top-5 flex items-center gap-3 text-xs uppercase tracking-wider text-slate-400">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-orange-500/90 text-[11px] font-bold text-slate-950">AI</span>
          <span>Personal note for {companyName}</span>
        </div>

        {!playing && !done && elapsed === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-white/95 shadow-lg transition hover:scale-105">
              <svg width="30" height="30" viewBox="0 0 24 24" fill="#0b0f14" aria-hidden="true">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
            <div className="text-sm text-slate-300">Hi {contactFirstName}, 20 seconds on what we noticed</div>
          </div>
        )}

        {(playing || elapsed > 0) && (
          <div className="absolute inset-x-0 bottom-0 p-5 sm:p-8">
            <p className="text-balance text-lg font-medium leading-relaxed text-white drop-shadow sm:text-2xl">
              {words.slice(0, visibleWords).join(" ")}
              {playing && <span className="ml-1 inline-block h-5 w-[2px] animate-pulse bg-orange-400 align-middle" />}
            </p>
          </div>
        )}

        {!playing && elapsed > 0 && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white/90 shadow-lg">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="#0b0f14" aria-hidden="true">
                {done ? <path d="M12 5V1L7 6l5 5V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z" /> : <path d="M8 5v14l11-7z" />}
              </svg>
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center gap-3 bg-slate-900 px-4 py-3 text-xs text-slate-300">
        <button
          type="button"
          onClick={toggle}
          className="rounded-md bg-white/10 px-2.5 py-1 font-medium text-white hover:bg-white/20"
          aria-label={playing ? "Pause" : done ? "Replay" : "Play"}
        >
          {playing ? "Pause" : done ? "Replay" : "Play"}
        </button>
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
          <div className="h-full rounded-full bg-orange-500 transition-[width] duration-100" style={{ width: `${percent}%` }} />
        </div>
        <span className="tabular-nums">
          0:{String(seconds).padStart(2, "0")} / 0:{String(total).padStart(2, "0")}
        </span>
      </div>
    </div>
  );
}
