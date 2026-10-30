"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { requestJson } from "@/lib/client/request";

export function ApproveFollowUp({ conversationId }: { conversationId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        className="btn btn-sm btn-primary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const r = await requestJson(`/api/conversations/${conversationId}/approve`, { body: {} });
          setBusy(false);
          if (!r.ok) return setError(r.error);
          router.refresh();
        }}
      >
        {busy ? "Approving…" : error ? "Try again" : "Approve follow-up"}
      </button>
      {error && <span className="text-[12px] text-[var(--bad)]" role="alert">{error}</span>}
    </span>
  );
}
