import { z } from "zod";
import { audit, requireApiRole } from "@/lib/auth";
import { error, json, readJson } from "@/lib/api";
import { parseTemplateFile, TEMPLATE_VARIABLES, TemplateParseError, validateTemplate } from "@/lib/engine/templates";
import { messageTemplates } from "@/lib/store/collections";
import type { MessageTemplate } from "@/lib/types";
import { nowIso, uuid } from "@/lib/util";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireApiRole(["bdr", "exec", "admin"]);
  if ("response" in auth) return auth.response;
  const list = (await messageTemplates.list()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return json({ templates: list, variables: TEMPLATE_VARIABLES });
}

const Channel = z.enum(["email", "linkedin", "inmail", "call"]);
const One = z.object({
  name: z.string().trim().min(1).max(120),
  channel: Channel,
  subject: z.string().trim().max(300).nullable().optional(),
  body: z.string().max(20_000),
  tags: z.array(z.string().trim().min(1).max(40)).max(12).default([]),
});
const Body = z.union([
  z.object({ template: One }),
  z.object({ files: z.array(z.object({ name: z.string().min(1).max(200), content: z.string().max(200_000) })).min(1).max(20) }),
]);

/**
 * Create one template, or upload files (.txt, .md, .html, .eml, .csv, .json).
 * Uploads arrive as drafts; approve them before they can reach prospects in live mode.
 */
export async function POST(req: Request) {
  const auth = await requireApiRole(["exec", "admin"]);
  if ("response" in auth) return auth.response;
  const body = await readJson(req, Body);
  if (!body.ok) return body.response;
  const now = nowIso();
  const make = (t: { name: string; channel: MessageTemplate["channel"]; subject?: string | null; body: string; tags: string[] }, source: MessageTemplate["source"], fileName: string | null): MessageTemplate => ({
    id: uuid(),
    name: t.name,
    channel: t.channel,
    subject: t.channel === "email" ? (t.subject?.trim() || null) : null,
    body: t.body.trim(),
    tags: t.tags,
    status: "draft",
    source,
    fileName,
    createdBy: auth.user.name,
    updatedBy: auth.user.name,
    createdAt: now,
    updatedAt: now,
  });

  if ("template" in body.data) {
    const t = make(body.data.template, "manual", null);
    const problems = validateTemplate(t);
    if (problems.length) return error(problems.join("; "), 422);
    await messageTemplates.put(t);
    await audit(auth.user, "template_create", t.id, t.name);
    return json({ ok: true, template: t });
  }

  const created: MessageTemplate[] = [];
  const rejected: { file: string; name?: string; problem: string }[] = [];
  for (const f of body.data.files) {
    try {
      for (const p of parseTemplateFile(f.name, f.content)) {
        const t = make(p, "upload", f.name);
        const problems = validateTemplate(t);
        if (problems.length) rejected.push({ file: f.name, name: p.name, problem: problems.join("; ") });
        else created.push(t);
      }
    } catch (err) {
      rejected.push({ file: f.name, problem: err instanceof TemplateParseError ? err.message : `could not read: ${(err as Error).message}` });
    }
  }
  if (created.length > 100) return error("at most 100 templates per upload", 413);
  for (const t of created) await messageTemplates.put(t);
  if (created.length) await audit(auth.user, "template_upload", created.map((t) => t.id).join(","), `${created.length} from ${body.data.files.map((f) => f.name).join(", ")}`);
  return json({ ok: rejected.length === 0, created, rejected }, created.length ? 200 : 422);
}
