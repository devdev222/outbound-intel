import { requireApiRole } from "@/lib/auth";
import { z } from "zod";
import { json, readJson } from "@/lib/api";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

/** Update a call-queue item (rep marks it called / skipped). The Dialer would call this back in production. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole(["bdr", "exec", "admin"]);
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const body = await readJson(req, z.object({ status: z.enum(["queued", "called", "skipped"]) }));
  if (!body.ok) return body.response;
  await getStore().updateCallStatus(id, body.data.status);
  return json({ ok: true });
}
