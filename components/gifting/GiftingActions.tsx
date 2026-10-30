"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

async function post(body: Record<string, unknown>) {
  const res = await fetch("/api/gifting", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "failed");
  return data;
}

export function GiftDecision({ giftId }: { giftId: string }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function decide(decision: "approved" | "rejected") {
    setBusy(true);
    setErr(null);
    try {
      await post({ action: "decide", giftId, decision, note: note || undefined });
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input className="field w-40" placeholder="note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
      <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => decide("approved")}>
        Approve
      </button>
      <button className="btn btn-sm" disabled={busy} onClick={() => decide("rejected")}>
        Reject
      </button>
      {err && <span className="text-[12px] text-[var(--bad)]">{err}</span>}
    </div>
  );
}

export function Fulfillment({ giftId, status }: { giftId: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function set(next: "ordered" | "delivered" | "canceled") {
    setBusy(true);
    try {
      await post({ action: "fulfill", giftId, status: next });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex gap-1">
      {status === "approved" && (
        <button className="btn btn-sm" disabled={busy} onClick={() => set("ordered")}>
          Mark ordered
        </button>
      )}
      {(status === "approved" || status === "ordered") && (
        <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => set("delivered")}>
          Mark delivered
        </button>
      )}
      {(status === "approved" || status === "ordered") && (
        <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => set("canceled")}>
          Cancel
        </button>
      )}
    </div>
  );
}

export function CampaignControls({ campaignId, status }: { campaignId: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function run(body: Record<string, unknown>) {
    setBusy(true);
    try {
      await post(body);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-wrap gap-1">
      {status === "active" && (
        <button className="btn btn-sm" disabled={busy} onClick={() => run({ action: "propose", campaignId, limit: 5 })}>
          Propose more
        </button>
      )}
      {status === "active" ? (
        <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => run({ action: "campaign_status", campaignId, status: "paused" })}>
          Pause
        </button>
      ) : status !== "closed" ? (
        <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => run({ action: "campaign_status", campaignId, status: "active" })}>
          Activate
        </button>
      ) : null}
      {status !== "closed" && (
        <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => run({ action: "campaign_status", campaignId, status: "closed" })}>
          Close
        </button>
      )}
    </div>
  );
}

export function NewGiftCampaign() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [budget, setBudget] = useState(2500);
  const [limit, setLimit] = useState(50);
  const [minScore, setMinScore] = useState(75);
  const [requireEngagement, setRequireEngagement] = useState(true);
  const [approval, setApproval] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!open)
    return (
      <button className="btn btn-primary" onClick={() => setOpen(true)}>
        New gifting campaign
      </button>
    );
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await post({ action: "create_campaign", name, budgetTotal: budget, perGiftLimit: limit, eligibility: { minScore, statuses: ["engaged", "hot", "meeting_booked"], requireEngagement }, approvalRequired: approval, status: "active", experimentId: null });
      setOpen(false);
      router.refresh();
    } catch (e2) {
      setErr((e2 as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="card flex flex-col gap-3 p-4">
      <div className="card-title">New gifting campaign</div>
      <label className="text-[12px] font-medium">
        Name
        <input className="field mt-1" value={name} onChange={(e) => setName(e.target.value)} required />
      </label>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-[12px] font-medium">
          Total budget ($)
          <input className="field mt-1" type="number" min={0} value={budget} onChange={(e) => setBudget(Number(e.target.value))} />
        </label>
        <label className="text-[12px] font-medium">
          Per-gift limit ($)
          <input className="field mt-1" type="number" min={1} value={limit} onChange={(e) => setLimit(Number(e.target.value))} />
        </label>
        <label className="text-[12px] font-medium">
          Minimum score
          <input className="field mt-1" type="number" min={0} max={100} value={minScore} onChange={(e) => setMinScore(Number(e.target.value))} />
        </label>
      </div>
      <label className="flex items-center gap-2 text-[13px]">
        <input type="checkbox" checked={requireEngagement} onChange={(e) => setRequireEngagement(e.target.checked)} /> Only accounts that have engaged
      </label>
      <label className="flex items-center gap-2 text-[13px]">
        <input type="checkbox" checked={approval} onChange={(e) => setApproval(e.target.checked)} /> Require approval for every gift
      </label>
      {err && <div className="text-[12px] text-[var(--bad)]">{err}</div>}
      <div className="flex gap-2">
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? "Creating…" : "Create"}
        </button>
        <button className="btn btn-ghost" type="button" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
