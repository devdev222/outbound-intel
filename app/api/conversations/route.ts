import { z } from "zod";
import { requireApiRole } from "@/lib/auth";
import { json, readJson, requireAccount } from "@/lib/api";
import { logConversation } from "@/lib/engine/conversations";
import { getProviders } from "@/lib/providers";
import { getStore } from "@/lib/store";
import { conversations } from "@/lib/store/collections";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.object({
  slug: z.string(),
  channel: z.enum(["call", "email", "linkedin", "meeting"]),
  outcome: z.enum(["connected", "voicemail", "no_answer", "replied", "meeting_booked", "not_interested", "not_now", "wrong_contact"]),
  notes: z.string().max(5000).default(""),
});

/** Log a conversation; the engine summarizes, drafts the follow-up and sets the next action. */
export async function POST(req: Request) {
  const auth = await requireApiRole(["bdr", "exec", "admin"]);
  if ("response" in auth) return auth.response;
  const body = await readJson(req, Body);
  if (!body.ok) return body.response;
  const store = getStore();
  const found = await requireAccount(store, body.data.slug);
  if ("response" in found) return found.response;
  const conversation = await logConversation(store, getProviders(), found.account, { channel: body.data.channel, outcome: body.data.outcome, notes: body.data.notes, repId: auth.user.repId ?? null }, auth.user);
  return json({ ok: true, conversation });
}

export async function GET(req: Request) {
  const auth = await requireApiRole(["bdr", "exec", "admin"]);
  if ("response" in auth) return auth.response;
  const slug = new URL(req.url).searchParams.get("slug");
  let rows = await conversations.list();
  if (slug) {
    const a = await getStore().getAccountBySlug(slug);
    rows = a ? rows.filter((c) => c.accountId === a.id) : [];
  }
  return json({ conversations: rows.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 200) });
}
