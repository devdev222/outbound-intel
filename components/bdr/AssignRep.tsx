"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { requestJson } from "@/lib/client/request";

export function AssignRep({ slug, reps, current }: { slug: string; reps: { id: string; name: string }[]; current: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [value, setValue] = useState(current ?? "");
  const [error, setError] = useState<string | null>(null);
  async function assign(repId: string) {
    const previous = value;
    setValue(repId);
    setBusy(true);
    setError(null);
    const r = await requestJson(`/api/accounts/${slug}/assign`, { body: { repId: repId || null } });
    setBusy(false);
    if (!r.ok) {
      setValue(previous);
      setError(r.error);
      return;
    }
    router.refresh();
  }
  return (
    <span className="inline-flex flex-col gap-1">
      <select className="field max-w-[200px]" value={value} onChange={(e) => assign(e.target.value)} disabled={busy} aria-label="Assign to rep">
        <option value="">Unassigned</option>
        {reps.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </select>
      {error && <span className="text-[12px] text-[var(--bad)]" role="alert">{error}</span>}
    </span>
  );
}
