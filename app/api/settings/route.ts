import { z } from "zod";
import { audit, requireApiRole } from "@/lib/auth";
import { json, readJson } from "@/lib/api";
import { getSettings, updateSettings } from "@/lib/store/collections";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireApiRole(["exec", "admin"]);
  if ("response" in auth) return auth.response;
  return json({ settings: await getSettings() });
}

const Body = z.object({
  automation: z
    .object({
      autoSendEmail: z.boolean().optional(),
      autoLaunchCampaigns: z.boolean().optional(),
      autoProposeGifts: z.boolean().optional(),
      requireFollowUpApproval: z.boolean().optional(),
      signalFreshnessDays: z.number().int().min(7).max(365).optional(),
      qualificationThreshold: z.number().min(0).max(100).optional(),
      hotThreshold: z.number().min(0).max(100).optional(),
    })
    .optional(),
  economics: z
    .object({
      repFullyLoadedMonthly: z.number().min(0).optional(),
      toolingMonthly: z.number().min(0).optional(),
      videoCostPerRender: z.number().min(0).optional(),
      avgOpportunityValue: z.number().min(0).optional(),
      meetingHoldRate: z.number().min(0).max(1).optional(),
    })
    .optional(),
});

export async function PATCH(req: Request) {
  const auth = await requireApiRole(["admin"]);
  if ("response" in auth) return auth.response;
  const body = await readJson(req, Body);
  if (!body.ok) return body.response;
  const settings = await updateSettings(body.data as never, auth.user.name);
  await audit(auth.user, "update_settings", "global", JSON.stringify(body.data));
  return json({ ok: true, settings });
}
