"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function ApproveFollowUp({ conversationId }: { conversationId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      className="btn btn-sm btn-primary"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await fetch(`/api/conversations/${conversationId}/approve`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
        setBusy(false);
        router.refresh();
      }}
    >
      Approve follow-up
    </button>
  );
}
