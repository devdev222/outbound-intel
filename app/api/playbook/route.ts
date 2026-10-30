import { z } from "zod";
import { audit, requireApiRole } from "@/lib/auth";
import { json, readJson } from "@/lib/api";
import { getPlaybook } from "@/lib/engine/playbook";
import { companyPlaybook, getSettings, updateSettings } from "@/lib/store/collections";
import { nowIso, uuid } from "@/lib/util";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireApiRole(["bdr", "exec", "admin"]);
  if ("response" in auth) return auth.response;
  return json({ playbook: await getPlaybook(), defaults: (await getSettings()).defaults });
}

const line = z.string().trim().min(1).max(300);
const Playbook = z.object({
  positioning: z.string().max(2000).default(""),
  toneRules: z.array(line).max(20).default([]),
  avoid: z.array(line).max(20).default([]),
  signalAngles: z.array(z.object({ signalKey: z.string().min(1).max(80), angle: z.string().trim().min(1).max(300), talkingPoints: z.array(line).max(8).default([]) })).max(40).default([]),
  personas: z.array(z.object({ id: z.string().max(64).optional(), title: z.string().trim().min(1).max(80), pains: z.string().max(300).default(""), angle: z.string().max(300).default("") })).max(20).default([]),
  objections: z.array(z.object({ id: z.string().max(64).optional(), objection: z.string().trim().min(1).max(200), response: z.string().trim().min(1).max(1000) })).max(30).default([]),
});
const Defaults = z.object({
  contentFormat: z.enum(["landing_page", "direct_link"]).optional(),
  videoType: z.enum(["ai", "rep"]).optional(),
  personalization: z.enum(["deep", "conventional"]).optional(),
  angleVariant: z.enum(["A", "B"]).optional(),
  gifting: z.enum(["gift", "control"]).optional(),
  proofMode: z.enum(["matched", "generic", "none"]).optional(),
  assessmentInvite: z.boolean().optional(),
  angleOverride: z.string().trim().max(300).nullable().optional(),
});
const Body = z.object({ playbook: Playbook.optional(), defaults: Defaults.optional() });

/** Save the team playbook and/or the campaign defaults. Applies to campaigns launched from now on. */
export async function PUT(req: Request) {
  const auth = await requireApiRole(["exec", "admin"]);
  if ("response" in auth) return auth.response;
  const body = await readJson(req, Body);
  if (!body.ok) return body.response;
  if (body.data.playbook) {
    const p = body.data.playbook;
    const dedup = new Map(p.signalAngles.map((a) => [a.signalKey, a]));
    await companyPlaybook.put({
      id: "global",
      positioning: p.positioning.trim(),
      toneRules: p.toneRules,
      avoid: p.avoid,
      signalAngles: [...dedup.values()],
      personas: p.personas.map((x) => ({ id: x.id || uuid(), title: x.title, pains: x.pains, angle: x.angle })),
      objections: p.objections.map((x) => ({ id: x.id || uuid(), objection: x.objection, response: x.response })),
      updatedAt: nowIso(),
      updatedBy: auth.user.name,
    });
    await audit(auth.user, "playbook_update", "global", `${p.signalAngles.length} angles, ${p.objections.length} objections`);
  }
  if (body.data.defaults) {
    const d = body.data.defaults;
    if (d.contentFormat === "direct_link" && !process.env.NEXT_PUBLIC_CALENDLY_URL) {
      return json({ ok: false, error: "set NEXT_PUBLIC_CALENDLY_URL before defaulting to a direct booking link" }, 422);
    }
    await updateSettings({ defaults: { ...d, angleOverride: d.angleOverride === undefined ? undefined : d.angleOverride || null } as never }, auth.user.name);
    await audit(auth.user, "campaign_defaults_update", "global", JSON.stringify(d));
  }
  return json({ ok: true, playbook: await getPlaybook(), defaults: (await getSettings()).defaults });
}
