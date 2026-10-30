import { z } from "zod";
import { audit, requireActor } from "@/lib/auth";
import { json, readJson } from "@/lib/api";
import { ContactError, contactNextAction, loadContact, pauseContactCmd, replaceContactCmd, resumeContactCmd } from "@/lib/engine/contact-commands";
import { onceResponse, requestKey } from "@/lib/engine/idempotency";
import { isOpen } from "@/lib/engine/tasks";
import { getProviders } from "@/lib/providers";
import { getStore } from "@/lib/store";
import { conversationsFor } from "@/lib/store/collections";

export const dynamic = "force-dynamic";

/** One person: their record, tasks, conversations and outcomes, all attributed by contactId. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireActor(req, { roles: ["bdr", "exec", "admin"], scope: "read" });
  if ("response" in auth) return auth.response;
  const store = getStore();
  try {
    const { contact, account } = await loadContact(store, (await params).id);
    const [tasks, outcomes, conversations] = await Promise.all([store.listOutreach({ accountId: account.id }), store.listOutcomes({ accountId: account.id }), conversationsFor(account.id)]);
    const mine = tasks.filter((t) => t.contactId === contact.id);
    return json({
      ok: true,
      contact,
      account: { id: account.id, slug: account.slug, companyName: account.companyName },
      nextAction: contactNextAction(contact, mine.filter(isOpen)),
      tasks: mine,
      outcomes: outcomes.filter((o) => o.contactId === contact.id),
      conversations: conversations.filter((c) => c.contactId === contact.id),
    });
  } catch (err) {
    if (err instanceof ContactError) return json({ ok: false, error: err.message }, err.status);
    throw err;
  }
}

const Body = z.object({ action: z.enum(["replace", "pause", "resume"]), reason: z.string().max(500).optional() });

/** Replace (wrong person; history kept), pause or resume one person. Idempotent with Idempotency-Key. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireActor(req, { roles: ["bdr", "exec", "admin"], scope: "contacts:write" });
  if ("response" in auth) return auth.response;
  const body = await readJson(req, Body);
  if (!body.ok) return body.response;
  const store = getStore();
  const id = (await params).id;
  const run = async () => {
    try {
      const by = auth.user.name;
      const reason = body.data.reason?.trim() || (body.data.action === "replace" ? "not the right person" : "rep decision");
      if (body.data.action === "replace") {
        const r = await replaceContactCmd(store, getProviders(), id, reason, by, await store.getLatestModel());
        await audit(auth.actor, "contact_replace", id, reason);
        return json({ ok: true, replacement: r.replacement, coverage: r.account?.buyingGroup ?? null });
      }
      const c = body.data.action === "pause" ? await pauseContactCmd(store, id, reason, by) : await resumeContactCmd(store, id, by);
      await audit(auth.actor, `contact_${body.data.action}`, id, reason);
      return json({ ok: true, contact: c });
    } catch (err) {
      if (err instanceof ContactError) return json({ ok: false, error: err.message }, err.status);
      throw err;
    }
  };
  const key = requestKey(req);
  return key ? onceResponse(store, `contact:${auth.actor.id}`, key, run) : run();
}
