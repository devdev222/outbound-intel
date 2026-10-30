import { z } from "zod";
import { requireApiRole } from "@/lib/auth";
import { error, json, readJson } from "@/lib/api";
import { TaskError, completeManually, skipTask } from "@/lib/engine/tasks";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * Legacy alias for /api/tasks/[id]: "sent" records work done outside the
 * platform (completionMode manual), "skipped" skips. Prefer /api/tasks/[id].
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole(["bdr", "exec", "admin"]);
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const body = await readJson(req, z.object({ status: z.enum(["sent", "skipped"]) }));
  if (!body.ok) return body.response;
  try {
    const touch = body.data.status === "sent" ? await completeManually(getStore(), id, auth.user) : await skipTask(getStore(), id, auth.user);
    return json({ ok: true, touch });
  } catch (err) {
    if (err instanceof TaskError) return error(err.message, err.status);
    throw err;
  }
}
