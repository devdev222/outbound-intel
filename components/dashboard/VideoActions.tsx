"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Spinner } from "./PipelineControls";

async function readError(res: Response): Promise<string> {
  try {
    const j = (await res.json()) as { error?: string };
    return j.error ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

/** Rep arm: attach a human-recorded clip (hosted URL) to the campaign. */
export function AttachRecordingForm({ slug }: { slug: string }) {
  const router = useRouter();
  const [videoUrl, setVideoUrl] = useState("");
  const [thumbnailUrl, setThumbnailUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!videoUrl.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/accounts/${encodeURIComponent(slug)}/video`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ videoUrl: videoUrl.trim(), ...(thumbnailUrl.trim() ? { thumbnailUrl: thumbnailUrl.trim() } : {}) }),
      });
      if (!res.ok) {
        setMsg(await readError(res));
        return;
      }
      setMsg("Recording attached.");
      setVideoUrl("");
      setThumbnailUrl("");
      router.refresh();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-1.5 text-xs">
      <input
        type="url"
        required
        value={videoUrl}
        onChange={(e) => setVideoUrl(e.target.value)}
        placeholder="https://… hosted video URL (mp4 or stream)"
        className="w-full rounded-md border border-[var(--border)] bg-[var(--panel)] px-2 py-1.5"
      />
      <input
        type="url"
        value={thumbnailUrl}
        onChange={(e) => setThumbnailUrl(e.target.value)}
        placeholder="https://… thumbnail URL (optional)"
        className="w-full rounded-md border border-[var(--border)] bg-[var(--panel)] px-2 py-1.5"
      />
      <div className="flex items-center gap-2">
        <button type="submit" className="btn btn-accent px-2 py-1 text-xs" disabled={busy || !videoUrl.trim()}>
          {busy ? <Spinner /> : null} Attach recording
        </button>
        {msg && <span className="text-[var(--muted)]">{msg}</span>}
      </div>
    </form>
  );
}

/** Ask the Video Agent to rewrite beats + script now (and resubmit if AI arm). */
export function RewriteScriptButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/agents/video/run", { method: "POST" });
      if (!res.ok) {
        setMsg(await readError(res));
        return;
      }
      const j = (await res.json()) as { run?: { summary?: string } };
      setMsg(j.run?.summary ?? "done");
      router.refresh();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="flex items-center gap-2">
      <button className="btn px-2 py-1 text-xs" disabled={busy} onClick={run}>
        {busy ? <Spinner /> : null} Rewrite script
      </button>
      {msg && <span className="text-xs text-[var(--muted)]">{msg}</span>}
    </span>
  );
}
