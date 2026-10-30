import { z } from "zod";
import { audit, requireApiRole } from "@/lib/auth";
import { error, json, readJson } from "@/lib/api";
import { validateTemplate } from "@/lib/engine/templates";
import { messageTemplates, sequences } from "@/lib/store/collections";
import { nowIso } from "@/lib/util";

export const dynamic = "force-dynamic";

const Body = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  channel: z.enum(["email", "linkedin", "inmail", "call"]).optional(),
  subject: z.string().trim().max(300).nullable().optional(),
  body: z.string().max(20_000).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(12).optional(),
  status: z.enum(["draft", "approved", "archived"]).optional(),
});

/** Edit, approve, return to draft, or archive a template. Editing an approved template returns it to draft. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole(["exec", "admin"]);
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const current = await messageTemplates.get(id);
  if (!current) return error("unknown template", 404);
  const body = await readJson(req, Body);
  if (!body.ok) return body.response;
  const d = body.data;
  const contentChanged = d.body !== undefined || d.subject !== undefined || d.channel !== undefined;
  const next = {
    ...current,
    ...(d.name !== undefined ? { name: d.name } : {}),
    ...(d.channel !== undefined ? { channel: d.channel } : {}),
    ...(d.subject !== undefined ? { subject: d.subject || null } : {}),
    ...(d.body !== undefined ? { body: d.body.trim() } : {}),
    ...(d.tags !== undefined ? { tags: d.tags } : {}),
    status: d.status ?? (contentChanged && current.status === "approved" ? ("draft" as const) : current.status),
    updatedBy: auth.user.name,
    updatedAt: nowIso(),
  };
  if (next.channel !== "email") next.subject = null;
  if (next.status !== "archived") {
    const problems = validateTemplate(next);
    if (problems.length) return error(problems.join("; "), 422);
  }
  if (next.status === "archived") {
    const using = (await sequences.list()).filter((s) => s.status === "active" && s.steps.some((st) => st.templateId === id));
    if (using.length) return error(`used by active sequence${using.length > 1 ? "s" : ""} ${using.map((s) => `"${s.name}"`).join(", ")}; change those steps first`, 409);
  }
  await messageTemplates.put(next);
  await audit(auth.user, d.status ? `template_${d.status}` : "template_edit", id, next.name);
  return json({ ok: true, template: next, returnedToDraft: contentChanged && current.status === "approved" && !d.status });
}
