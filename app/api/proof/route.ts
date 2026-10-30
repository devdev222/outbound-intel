import { z } from "zod";
import { audit, requireApiRole } from "@/lib/auth";
import { config } from "@/lib/config";
import { error, json, readJson, requireAccount } from "@/lib/api";
import { ensureProofSeeded, rankProof } from "@/lib/engine/proof";
import { getStore } from "@/lib/store";
import { proofStories } from "@/lib/store/collections";
import { nowIso, uuid } from "@/lib/util";

export const dynamic = "force-dynamic";

/** GET /api/proof            -> all stories (admin/exec/bdr).  GET /api/proof?slug=x -> ranked matches for an account. */
export async function GET(req: Request) {
  const auth = await requireApiRole(["bdr", "exec", "admin"]);
  if ("response" in auth) return auth.response;
  const stories = await ensureProofSeeded();
  const slug = new URL(req.url).searchParams.get("slug");
  if (!slug) return json({ stories });
  const found = await requireAccount(getStore(), slug);
  if ("response" in found) return found.response;
  return json({ matches: rankProof(found.account, stories, { allowPlaceholders: config.demoBanner }).slice(0, 5) });
}

const Outcome = z.object({ metric: z.string(), value: z.string(), verified: z.boolean().default(false), source: z.string().default("") });
const Body = z.object({
  id: z.string().optional(),
  customer: z.string().min(2),
  industry: z.string(),
  sizeBand: z.string(),
  challenges: z.array(z.string()).default([]),
  capabilities: z.array(z.string()).default([]),
  outcomes: z.array(Outcome).default([]),
  quote: z.string().optional(),
  quoteBy: z.string().optional(),
  approved: z.boolean().default(false),
});

/** Create or update a story (admin). Approval is a separate, audited action. */
export async function POST(req: Request) {
  const auth = await requireApiRole(["admin", "exec"]);
  if ("response" in auth) return auth.response;
  const body = await readJson(req, Body);
  if (!body.ok) return body.response;
  const existing = body.data.id ? await proofStories.get(body.data.id) : null;
  if (body.data.approved && body.data.outcomes.some((o) => o.verified && !o.source)) return error("verified outcomes need a source before approval");
  const story = { ...(existing ?? {}), ...body.data, id: existing?.id ?? body.data.id ?? uuid(), placeholder: existing?.placeholder ?? false, updatedAt: nowIso() };
  await proofStories.put(story);
  await audit(auth.user, existing ? "update_proof" : "create_proof", story.id, `${story.customer}${body.data.approved ? " (approved)" : ""}`);
  return json({ ok: true, story });
}
