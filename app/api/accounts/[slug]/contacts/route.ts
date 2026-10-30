import { z } from "zod";
import { audit, requireActor } from "@/lib/auth";
import { json, readJson, requireAccount } from "@/lib/api";
import { addContact, ContactError, coverageView, researchContacts } from "@/lib/engine/contact-commands";
import { onceResponse, requestKey } from "@/lib/engine/idempotency";
import { getProviders } from "@/lib/providers";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** The account's buying group: coverage, people, candidates, history and the next action. */
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const auth = await requireActor(req, { roles: ["bdr", "exec", "admin"], scope: "read" });
  if ("response" in auth) return auth.response;
  const store = getStore();
  const found = await requireAccount(store, (await params).slug);
  if ("response" in found) return found.response;
  return json({ ok: true, ...(await coverageView(store, found.account)) });
}

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("research") }),
  z.object({
    action: z.literal("add"),
    person: z.object({ name: z.string().min(1).max(200), title: z.string().min(1).max(200), email: z.email().optional(), phone: z.string().max(40).optional(), linkedin: z.string().max(400).optional(), seniority: z.enum(["c_level", "vp", "director", "manager", "ic"]).optional() }),
  }),
]);

/** Research more people, or add a person the rep knows (verified like anyone else). Idempotent with Idempotency-Key. */
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const auth = await requireActor(req, { roles: ["bdr", "exec", "admin"], scope: "contacts:write" });
  if ("response" in auth) return auth.response;
  const body = await readJson(req, Body);
  if (!body.ok) return body.response;
  const store = getStore();
  const slug = (await params).slug;
  const run = async () => {
    const found = await requireAccount(store, slug);
    if ("response" in found) return found.response;
    const model = await store.getLatestModel();
    try {
      if (body.data.action === "research") {
        const r = await researchContacts(store, getProviders(), found.account, model, auth.user.name);
        await audit(auth.actor, "contacts_research", found.account.id, r.coverage.summary);
        return json({ ok: true, coverage: r.coverage, verified: r.verified });
      }
      const c = await addContact(store, getProviders(), found.account, body.data.person, auth.user.name, model);
      await audit(auth.actor, "contact_add", c.id, `${c.person.name} (${c.role})`);
      return json({ ok: true, contact: c });
    } catch (err) {
      if (err instanceof ContactError) return json({ ok: false, error: err.message }, err.status);
      throw err;
    }
  };
  const key = requestKey(req);
  return key ? onceResponse(store, `contacts:${auth.actor.id}`, key, run) : run();
}
