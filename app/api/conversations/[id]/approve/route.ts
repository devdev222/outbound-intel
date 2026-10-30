import { z } from "zod";
import { audit, requireApiRole } from "@/lib/auth";
import { error, json, readJson } from "@/lib/api";
import { approveFollowUp } from "@/lib/engine/conversations";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole(["bdr", "exec", "admin"]);
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const body = await readJson(req, z.object({ subject: z.string().optional(), body: z.string().optional() }).default({}));
  const edits = body.ok ? body.data : undefined;
  const conv = await approveFollowUp(getStore(), id, edits, auth.user);
  if (!conv) return error("unknown conversation", 404);
  await audit(auth.user, "approve_follow_up", id, conv.followUpDraft?.subject ?? "");
  return json({ ok: true, conversation: conv });
}
