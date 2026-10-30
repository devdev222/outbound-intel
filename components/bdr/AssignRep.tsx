"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function AssignRep({ slug, reps, current }: { slug: string; reps: { id: string; name: string }[]; current: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function assign(repId: string) {
    setBusy(true);
    await fetch(`/api/accounts/${slug}/assign`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ repId: repId || null }) });
    setBusy(false);
    router.refresh();
  }
  return (
    <select className="field max-w-[200px]" value={current ?? ""} onChange={(e) => assign(e.target.value)} disabled={busy} aria-label="Assign to rep">
      <option value="">Unassigned</option>
      {reps.map((r) => (
        <option key={r.id} value={r.id}>
          {r.name}
        </option>
      ))}
    </select>
  );
}
