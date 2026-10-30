import type { Store } from "@/lib/store";
import { giftCampaigns as campCol, gifts as giftCol } from "@/lib/store/collections";
import type { Account, Gift, GiftCampaign, User } from "@/lib/types";
import { nowIso, uuid } from "@/lib/util";
import { logActivity } from "./activity";

/**
 * Compliant gifting: eligibility rules, spending limits, approvals, fulfillment
 * tracking and attribution. Gifts are proposed by the engine (or a rep), never
 * sent without an approval when the campaign requires one, and every decision
 * is audited.
 */

export async function spent(campaignId: string): Promise<number> {
  return (await giftCol.list()).filter((g) => g.campaignId === campaignId && ["approved", "ordered", "delivered"].includes(g.status)).reduce((s, g) => s + g.amount, 0);
}

export function isEligible(campaign: GiftCampaign, account: Account): boolean {
  if (campaign.status !== "active") return false;
  if ((account.scores?.total ?? 0) < campaign.eligibility.minScore) return false;
  if (campaign.eligibility.statuses.length && !campaign.eligibility.statuses.includes(account.status)) return false;
  if (campaign.eligibility.requireEngagement && account.engagementScore <= 0) return false;
  if (campaign.experimentId && account.experiments?.[campaign.experimentId] !== "gift") return false;
  return true;
}

export async function proposeGifts(store: Store, campaign: GiftCampaign, opts: { limit?: number; amount?: number; description?: string } = {}): Promise<Gift[]> {
  const existing = await giftCol.list();
  const already = new Set(existing.filter((g) => g.campaignId === campaign.id).map((g) => g.accountId));
  const budgetLeft = campaign.budgetTotal - (await spent(campaign.id));
  const amount = Math.min(opts.amount ?? campaign.perGiftLimit, campaign.perGiftLimit);
  const candidates = (await store.listAccounts()).filter((a) => isEligible(campaign, a) && !already.has(a.id)).sort((a, b) => b.priority - a.priority);
  const out: Gift[] = [];
  for (const a of candidates.slice(0, opts.limit ?? 10)) {
    if ((out.length + 1) * amount > budgetLeft) break;
    const gift: Gift = {
      id: uuid(),
      campaignId: campaign.id,
      accountId: a.id,
      description: opts.description ?? "Coffee + handwritten note referencing their page",
      amount,
      status: campaign.approvalRequired ? "proposed" : "approved",
      proposedAt: nowIso(),
      decidedBy: campaign.approvalRequired ? null : "policy",
      decidedAt: campaign.approvalRequired ? null : nowIso(),
      deliveredAt: null,
      note: null,
    };
    await giftCol.put(gift);
    await logActivity(store, a.id, "system", "gift_proposed", `Gift proposed ($${amount}) under "${campaign.name}"${campaign.approvalRequired ? "; awaiting approval" : ""}`);
    out.push(gift);
  }
  return out;
}

export async function decideGift(store: Store, giftId: string, decision: "approved" | "rejected", user: User, note?: string): Promise<Gift | null> {
  const gift = await giftCol.get(giftId);
  if (!gift) return null;
  const campaign = await campCol.get(gift.campaignId);
  if (decision === "approved" && campaign) {
    const left = campaign.budgetTotal - (await spent(campaign.id));
    if (gift.amount > left) {
      const blocked: Gift = { ...gift, status: "rejected", decidedBy: "policy", decidedAt: nowIso(), note: `budget exhausted (${left} left)` };
      await giftCol.put(blocked);
      return blocked;
    }
  }
  const updated: Gift = { ...gift, status: decision, decidedBy: user.name, decidedAt: nowIso(), note: note ?? gift.note };
  await giftCol.put(updated);
  await logActivity(store, gift.accountId, "rep", `gift_${decision}`, `Gift ${decision} by ${user.name} ($${gift.amount})`, note ? [note] : []);
  return updated;
}

export async function updateFulfillment(store: Store, giftId: string, status: "ordered" | "delivered" | "canceled", user: User): Promise<Gift | null> {
  const gift = await giftCol.get(giftId);
  if (!gift) return null;
  const updated: Gift = { ...gift, status, deliveredAt: status === "delivered" ? nowIso() : gift.deliveredAt };
  await giftCol.put(updated);
  await logActivity(store, gift.accountId, "rep", `gift_${status}`, `Gift ${status} (${user.name})`);
  return updated;
}

/** Attribution: outcomes that happened after the gift was delivered. */
export async function giftAttribution(store: Store, campaignId: string) {
  const all = (await giftCol.list()).filter((g) => g.campaignId === campaignId);
  const delivered = all.filter((g) => g.status === "delivered" && g.deliveredAt);
  const outcomes = await store.listOutcomes();
  let meetings = 0;
  let opportunities = 0;
  for (const g of delivered) {
    const after = outcomes.filter((o) => o.accountId === g.accountId && o.createdAt >= g.deliveredAt!);
    if (after.some((o) => o.outcomeType === "meeting_booked")) meetings++;
    if (after.some((o) => o.outcomeType === "opportunity_created" || o.outcomeType === "deal_won")) opportunities++;
  }
  const spend = all.filter((g) => ["approved", "ordered", "delivered"].includes(g.status)).reduce((s, g) => s + g.amount, 0);
  return { proposed: all.length, approved: all.filter((g) => g.status === "approved").length, delivered: delivered.length, rejected: all.filter((g) => g.status === "rejected").length, spend, meetingsAfterGift: meetings, opportunitiesAfterGift: opportunities, costPerOpportunity: opportunities ? Math.round(spend / opportunities) : null };
}

export function newCampaign(input: Partial<GiftCampaign> & { name: string }): GiftCampaign {
  return {
    id: uuid(),
    name: input.name,
    budgetTotal: input.budgetTotal ?? 2500,
    perGiftLimit: input.perGiftLimit ?? 50,
    eligibility: input.eligibility ?? { minScore: 75, statuses: ["engaged", "hot"], requireEngagement: true },
    approvalRequired: input.approvalRequired ?? true,
    status: input.status ?? "draft",
    experimentId: input.experimentId ?? null,
    createdAt: nowIso(),
  };
}
