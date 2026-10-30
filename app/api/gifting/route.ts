import { z } from "zod";
import { audit, requireApiRole } from "@/lib/auth";
import { error, json, readJson } from "@/lib/api";
import { GiftTransitionError, decideGift, giftAttribution, newCampaign, proposeGifts, updateFulfillment } from "@/lib/engine/gifting";
import { getStore } from "@/lib/store";
import { giftCampaigns, gifts } from "@/lib/store/collections";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireApiRole(["exec", "admin", "bdr"]);
  if ("response" in auth) return auth.response;
  const store = getStore();
  const campaigns = await giftCampaigns.list();
  const all = await gifts.list();
  const accounts = new Map((await store.listAccounts()).map((a) => [a.id, { slug: a.slug, company: a.companyName }]));
  const detail = await Promise.all(campaigns.map(async (c) => ({ campaign: c, attribution: await giftAttribution(store, c.id), gifts: all.filter((g) => g.campaignId === c.id).map((g) => ({ ...g, account: accounts.get(g.accountId) ?? null })) })));
  return json({ campaigns: detail });
}

const CampaignBody = z.object({
  action: z.literal("create_campaign"),
  name: z.string().min(3),
  budgetTotal: z.number().min(0),
  perGiftLimit: z.number().min(1),
  eligibility: z.object({ minScore: z.number().min(0).max(100), statuses: z.array(z.string()), requireEngagement: z.boolean() }),
  approvalRequired: z.boolean().default(true),
  status: z.enum(["draft", "active", "paused", "closed"]).default("active"),
  experimentId: z.string().nullable().default(null),
});
const ProposeBody = z.object({ action: z.literal("propose"), campaignId: z.string(), limit: z.number().int().min(1).max(50).default(10) });
const DecideBody = z.object({ action: z.literal("decide"), giftId: z.string(), decision: z.enum(["approved", "rejected"]), note: z.string().optional() });
const FulfillBody = z.object({ action: z.literal("fulfill"), giftId: z.string(), status: z.enum(["ordered", "delivered", "canceled"]) });
const StatusBody = z.object({ action: z.literal("campaign_status"), campaignId: z.string(), status: z.enum(["draft", "active", "paused", "closed"]) });

export async function POST(req: Request) {
  const auth = await requireApiRole(["exec", "admin"]);
  if ("response" in auth) return auth.response;
  const body = await readJson(req, z.discriminatedUnion("action", [CampaignBody, ProposeBody, DecideBody, FulfillBody, StatusBody]));
  if (!body.ok) return body.response;
  const store = getStore();
  const d = body.data;
  switch (d.action) {
    case "create_campaign": {
      const c = newCampaign({ ...d, eligibility: { ...d.eligibility, statuses: d.eligibility.statuses as never[] } });
      await giftCampaigns.put(c);
      await audit(auth.user, "create_gift_campaign", c.id, `${c.name} budget ${c.budgetTotal}`);
      return json({ ok: true, campaign: c });
    }
    case "propose": {
      const c = await giftCampaigns.get(d.campaignId);
      if (!c) return error("unknown campaign", 404);
      const proposed = await proposeGifts(store, c, { limit: d.limit });
      return json({ ok: true, proposed });
    }
    case "decide": {
      const g = await decideGift(store, d.giftId, d.decision, auth.user, d.note).catch((e) => (e instanceof GiftTransitionError ? e : Promise.reject(e)));
      if (g instanceof GiftTransitionError) return error(g.message, 409);
      if (!g) return error("unknown gift", 404);
      await audit(auth.user, `gift_${d.decision}`, g.id, `${g.amount} ${d.note ?? ""}`);
      return json({ ok: true, gift: g });
    }
    case "fulfill": {
      const g = await updateFulfillment(store, d.giftId, d.status, auth.user).catch((e) => (e instanceof GiftTransitionError ? e : Promise.reject(e)));
      if (g instanceof GiftTransitionError) return error(g.message, 409);
      if (!g) return error("unknown gift", 404);
      return json({ ok: true, gift: g });
    }
    case "campaign_status": {
      const c = await giftCampaigns.get(d.campaignId);
      if (!c) return error("unknown campaign", 404);
      const next = { ...c, status: d.status };
      await giftCampaigns.put(next);
      await audit(auth.user, "gift_campaign_status", c.id, d.status);
      return json({ ok: true, campaign: next });
    }
  }
}
