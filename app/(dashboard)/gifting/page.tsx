import Link from "next/link";
import { CampaignControls, Fulfillment, GiftDecision, NewGiftCampaign } from "@/components/gifting/GiftingActions";
import { Badge, Card, EmptyState, Meter, PageHeader, Stat, fmtDate, fmtMoney } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { giftAttribution, spent } from "@/lib/engine/gifting";
import { getStore } from "@/lib/store";
import { giftCampaigns, gifts } from "@/lib/store/collections";
import type { GiftStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

const TONE: Record<GiftStatus, "neutral" | "good" | "warn" | "bad" | "info"> = { proposed: "warn", approved: "info", rejected: "bad", ordered: "info", delivered: "good", canceled: "neutral" };

export default async function GiftingPage() {
  await requireRole(["exec", "admin"]);
  const store = getStore();
  const [campaigns, all, accounts] = await Promise.all([giftCampaigns.list(), gifts.list(), store.listAccounts()]);
  const acct = new Map(accounts.map((a) => [a.id, a]));
  const detail = await Promise.all(
    campaigns
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(async (c) => ({ c, spent: await spent(c.id), attribution: await giftAttribution(store, c.id), gifts: all.filter((g) => g.campaignId === c.id).sort((a, b) => b.proposedAt.localeCompare(a.proposedAt)) })),
  );
  const pending = all.filter((g) => g.status === "proposed").length;

  return (
    <div className="page">
      <PageHeader eyebrow="Executive" title="Gifting" description="Compliant gifting with eligibility rules, spending limits, approvals, fulfillment tracking and attribution. Nothing ships without an approval when the campaign requires one." actions={<NewGiftCampaign />} />
      {pending > 0 && <div className="mb-4 rounded-lg border border-[#fed7aa] bg-[var(--warn-soft)] px-3 py-2 text-[13px] text-[var(--warn)]">{pending} gift proposal{pending === 1 ? "" : "s"} awaiting approval.</div>}
      {detail.length === 0 ? (
        <EmptyState title="No gifting campaigns" body="Create a campaign with a budget, a per-gift limit and eligibility rules; the engine proposes gifts for eligible accounts and you approve each one." />
      ) : (
        <div className="flex flex-col gap-4">
          {detail.map(({ c, spent: used, attribution, gifts: list }) => (
            <Card
              key={c.id}
              title={c.name}
              hint={`created ${fmtDate(c.createdAt)} · ${c.approvalRequired ? "approval required" : "auto-approved by policy"} · eligible: score ≥ ${c.eligibility.minScore}${c.eligibility.requireEngagement ? ", engaged" : ""}${c.eligibility.statuses.length ? `, status ${c.eligibility.statuses.join("/")}` : ""}`}
              actions={
                <div className="flex items-center gap-2">
                  <Badge tone={c.status === "active" ? "good" : c.status === "paused" ? "warn" : "neutral"}>{c.status}</Badge>
                  <CampaignControls campaignId={c.id} status={c.status} />
                </div>
              }
            >
              <div className="grid gap-4 sm:grid-cols-5">
                <div className="sm:col-span-2">
                  <Stat label="Budget" value={`${fmtMoney(used)} of ${fmtMoney(c.budgetTotal)}`} sub={`per gift up to ${fmtMoney(c.perGiftLimit)}`} />
                  <div className="mt-2">
                    <Meter value={used} max={c.budgetTotal} accent />
                  </div>
                </div>
                <Stat label="Delivered" value={attribution.delivered} sub={`${attribution.proposed} proposed · ${attribution.rejected} rejected`} />
                <Stat label="Meetings after gift" value={attribution.meetingsAfterGift} sub="attributed to delivered gifts" />
                <Stat label="Cost / opportunity" value={attribution.costPerOpportunity != null ? fmtMoney(attribution.costPerOpportunity) : "–"} sub={`${attribution.opportunitiesAfterGift} opportunities after gift`} />
              </div>
              {list.length > 0 && (
                <div className="mt-4 overflow-x-auto">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Account</th>
                        <th>Gift</th>
                        <th>Amount</th>
                        <th>Status</th>
                        <th>Decision</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.map((g) => {
                        const a = acct.get(g.accountId);
                        return (
                          <tr key={g.id}>
                            <td>
                              {a ? (
                                <Link href={`/accounts/${a.slug}`} className="font-medium hover:underline">
                                  {a.companyName}
                                </Link>
                              ) : (
                                g.accountId
                              )}
                              {a && <div className="text-[12px] text-[var(--muted)]">{a.contact ? `${a.contact.name}, ${a.contact.title}` : a.industry}</div>}
                            </td>
                            <td className="max-w-xs text-[12px]">{g.description}</td>
                            <td>{fmtMoney(g.amount)}</td>
                            <td>
                              <Badge tone={TONE[g.status]}>{g.status}</Badge>
                              {g.deliveredAt && <div className="text-[11px] text-[var(--muted)]">{fmtDate(g.deliveredAt)}</div>}
                            </td>
                            <td className="text-[12px] text-[var(--muted)]">
                              {g.decidedBy ? `${g.decidedBy} · ${fmtDate(g.decidedAt)}` : "–"}
                              {g.note && <div>{g.note}</div>}
                            </td>
                            <td>{g.status === "proposed" ? <GiftDecision giftId={g.id} /> : <Fulfillment giftId={g.id} status={g.status} />}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
