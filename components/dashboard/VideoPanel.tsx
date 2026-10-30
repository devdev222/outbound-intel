import type { Campaign } from "@/lib/types";
import { AttachRecordingForm, RewriteScriptButton } from "./VideoActions";

function videoPillClass(status: Campaign["videoStatus"]): string {
  switch (status) {
    case "ready":
      return "pill pill-good";
    case "failed":
      return "pill pill-bad";
    case "rendering":
    case "script_ready":
      return "pill pill-info";
    case "awaiting_recording":
      return "pill pill-warn";
    default:
      return "pill";
  }
}

function isRealUrl(url: string | undefined): url is string {
  return Boolean(url) && !url!.includes("/for/");
}

/** Video state for one campaign: status, beats, script, player / rep brief, and actions. */
export function VideoPanel({ slug, campaign }: { slug: string; campaign: Campaign }) {
  const c = campaign;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5 text-xs uppercase tracking-wider text-[var(--muted)]">
        Video <span className={videoPillClass(c.videoStatus)}>{c.videoStatus.replace(/_/g, " ")}</span>
        {c.videoSource && <span className="pill">{c.videoSource === "ai" ? "AI render" : "rep recording"}</span>}
        {c.scriptVersion !== undefined && <span className="pill">script v{c.scriptVersion}</span>}
        {c.videoAttempts ? <span className="pill">{c.videoAttempts} attempt{c.videoAttempts === 1 ? "" : "s"}</span> : null}
        {c.videoId && <span className="mono normal-case tracking-normal">{c.videoId}</span>}
      </div>
      {c.videoStatusDetails && <div className="text-xs text-[var(--muted)]">{c.videoStatusDetails}</div>}

      {c.videoStatus === "ready" && isRealUrl(c.videoUrl) && (
        <video controls src={c.videoUrl} poster={c.videoThumbnailUrl} className="w-full rounded-md border border-[var(--border)] bg-black" />
      )}

      {c.videoBeats && (
        <dl className="grid gap-1 rounded-md bg-[var(--panel-2)] p-2 text-xs">
          <div className="grid grid-cols-[52px_1fr] gap-2">
            <dt className="uppercase tracking-wider text-[var(--muted)]">hook</dt>
            <dd>{c.videoBeats.hook}</dd>
          </div>
          <div className="grid grid-cols-[52px_1fr] gap-2">
            <dt className="uppercase tracking-wider text-[var(--muted)]">proof</dt>
            <dd>{c.videoBeats.proof}</dd>
          </div>
          <div className="grid grid-cols-[52px_1fr] gap-2">
            <dt className="uppercase tracking-wider text-[var(--muted)]">ask</dt>
            <dd>{c.videoBeats.ask}</dd>
          </div>
        </dl>
      )}

      <div>
        <div className="text-[10px] uppercase tracking-wider text-[var(--muted)]">Script</div>
        <p className="mt-0.5 whitespace-pre-wrap rounded-md bg-[var(--panel-2)] p-2 text-xs leading-relaxed">{c.videoScript}</p>
      </div>

      {c.videoStatus === "awaiting_recording" && (
        <div className="space-y-2 rounded-md border border-[rgba(234,179,8,0.4)] bg-[rgba(234,179,8,0.06)] p-2">
          <div className="text-[10px] uppercase tracking-wider text-[var(--warn)]">Recording brief for the rep</div>
          <p className="whitespace-pre-wrap text-xs leading-relaxed">{c.videoBrief ?? "Record a 15-25 second clip following the script above, then attach the hosted URL."}</p>
          <AttachRecordingForm slug={slug} />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <a href={`${c.pageUrl}#video`} target="_blank" rel="noreferrer" className="pill pill-info no-underline">
          Open on the page ↗
        </a>
        <RewriteScriptButton />
      </div>
    </div>
  );
}
