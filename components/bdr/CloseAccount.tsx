"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { requestJson } from "@/lib/client/request";

export function CloseAccount({ slug }: { slug: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function close() {
    setBusy(true);
    setError(null);
    const r = await requestJson(`/api/accounts/${slug}/assign`, { body: { status: "disqualified", note } });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setOpen(false);
    router.refresh();
  }
  if (!open)
    return (
      <button className="btn btn-sm" onClick={() => setOpen(true)}>
        Suppress / close
      </button>
    );
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input className="field max-w-xs" placeholder="Reason (e.g. existing customer, wrong fit)" value={note} onChange={(e) => setNote(e.target.value)} />
      <button className="btn btn-sm" onClick={close} disabled={busy}>
        {busy ? "Closing…" : error ? "Try again" : "Confirm close"}
      </button>
      <button className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>
        Cancel
      </button>
      {error && <span className="text-[12px] text-[var(--bad)]" role="alert">{error}</span>}
    </div>
  );
}
