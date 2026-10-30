"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function CloseAccount({ slug }: { slug: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  async function close() {
    setBusy(true);
    await fetch(`/api/accounts/${slug}/assign`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "disqualified", note }) });
    setBusy(false);
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
        Confirm close
      </button>
      <button className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>
        Cancel
      </button>
    </div>
  );
}
