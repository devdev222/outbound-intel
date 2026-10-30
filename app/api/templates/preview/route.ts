import { z } from "zod";
import { requireApiRole } from "@/lib/auth";
import { json, readJson } from "@/lib/api";
import { angleFor, loadProofLine, pageUrlFor, roiDefaultsFor, signalPhrase, topSignal } from "@/lib/engine/campaign";
import { getPlaybook } from "@/lib/engine/playbook";
import { exampleContext, renderTemplate, templateContext, unknownVariables } from "@/lib/engine/templates";
import { getOrBootstrapModel } from "@/lib/agents/runtime";
import { getStore } from "@/lib/store";
import { reps } from "@/lib/store/collections";

export const dynamic = "force-dynamic";

const Body = z.object({ subject: z.string().max(300).nullable().optional(), body: z.string().max(20_000), slug: z.string().max(120).optional() });

/** Render a template against a real account (or the documented example values). No side effects. */
export async function POST(req: Request) {
  const auth = await requireApiRole(["bdr", "exec", "admin"]);
  if ("response" in auth) return auth.response;
  const body = await readJson(req, Body);
  if (!body.ok) return body.response;
  const store = getStore();
  const account = body.data.slug ? await store.getAccountBySlug(body.data.slug) : null;
  let ctx = exampleContext();
  if (account) {
    const [model, playbook] = await Promise.all([getOrBootstrapModel(store), getPlaybook()]);
    const proof = await loadProofLine(account, "matched");
    ctx = templateContext({
      account,
      signal: signalPhrase(topSignal(account), account),
      angle: angleFor(account, model, "A", playbook),
      proof: proof?.sentence ?? "",
      pageUrl: account.campaign?.pageUrl ?? pageUrlFor(account),
      repName: account.ownerRepId ? ((await reps.get(account.ownerRepId))?.name ?? null) : null,
      shipmentsPerMonth: roiDefaultsFor(account).shipmentsPerMonth,
    });
  }
  const rendered = renderTemplate({ subject: body.data.subject ?? null, body: body.data.body }, ctx);
  return json({ ok: true, rendered, account: account ? { slug: account.slug, company: account.companyName } : null, unknown: unknownVariables(`${body.data.subject ?? ""}\n${body.data.body}`) });
}
