import { z } from "zod";
import { error, json, readJson } from "@/lib/api";
import { completeRepTask } from "@/lib/engine/outreach";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

/** Rep completes or skips a task (LinkedIn message, InMail, gift, manual email). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await readJson(req, z.object({ status: z.enum(["sent", "skipped"]) }));
  if (!body.ok) return body.response;
  const touch = await completeRepTask(getStore(), id, body.data.status);
  if (!touch) return error("unknown touch", 404);
  return json({ ok: true, touch });
}
