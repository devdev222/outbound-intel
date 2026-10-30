import { z } from "zod";
import { audit, requireActor, requireApiRole } from "@/lib/auth";
import { onceResponse, requestKey } from "@/lib/engine/idempotency";
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
  outcome: z.enum(["connected", "voicemail", "no_answer", "replied", "meeting_booked", "not_interested", "not_now", "wrong_contact", "referred", "opted_out"]),
  notes: z.string().max(5000).default(""),
  pauseDays: z.number().int().min(1).max(365).optional(),
  callbackAt: z.iso.datetime().optional(),
  /** The buying-group person the rep spoke with (defaults to the primary contact). */
  contactId: z.string().min(1).max(200).optional(),
  referral: z.object({ name: z.string().min(1).max(200), title: z.string().min(1).max(200), email: z.email().optional(), linkedin: z.string().max(400).optional() }).optional(),
  /** Idempotency key from the client; a retried submission returns the original conversation. */
  requestId: z.string().min(8).max(200).optional(),
});

/** Log a conversation; the engine summarizes, drafts the follow-up and sets the next action. */
export async function POST(req: Request) {
  const auth = await requireActor(req, { roles: ["bdr", "exec", "admin"], scope: "conversations:write" });
  if ("response" in auth) return auth.response;
  const body = await readJson(req, Body);
  if (!body.ok) return body.response;
  const store = getStore();
  const run = async () => {
    const found = await requireAccount(store, body.data.slug);
    if ("response" in found) return found.response;
    const conversation = await logConversation(store, getProviders(), found.account, { channel: body.data.channel, outcome: body.data.outcome, notes: body.data.notes, repId: auth.user.repId ?? null, pauseDays: body.data.pauseDays, callbackAt: body.data.callbackAt, contactId: body.data.contactId ?? null, referral: body.data.referral ?? null }, auth.user);
    if (auth.actor.kind === "machine") await audit(auth.actor, "conversation_log", found.account.id, body.data.outcome);
    return json({ ok: true, conversation });
  };
  // Persistent idempotency: a double click or a retry after a timeout never logs the call twice.
  const key = requestKey(req, body.data.requestId);
  return key ? onceResponse(store, `conversation:${auth.actor.id}`, key, run) : run();
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
