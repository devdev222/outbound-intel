import { z } from "zod";
import { audit, requireApiRole } from "@/lib/auth";
import { error, json, readJson } from "@/lib/api";
import { TaskError, approveTask, completeManually, rescheduleTask, sendTaskNow, skipTask } from "@/lib/engine/tasks";
import { getProviders } from "@/lib/providers";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve"), subject: z.string().max(300).optional(), body: z.string().max(20_000).optional(), dueAt: z.iso.datetime().optional() }),
  z.object({ action: z.literal("send") }),
  z.object({ action: z.literal("complete_manual"), note: z.string().max(500).optional() }),
  z.object({ action: z.literal("skip"), reason: z.string().max(500).optional() }),
  z.object({ action: z.literal("reschedule"), dueAt: z.iso.datetime() }),
]);

/**
 * Task commands. The button labels map one-to-one:
 *   Review & approve -> approve (never sends)
 *   Send email       -> send (provider delivery; sent only on acknowledgment)
 *   Mark manually sent / Mark done -> complete_manual
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole(["bdr", "exec", "admin"]);
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const body = await readJson(req, Body);
  if (!body.ok) return body.response;
  const store = getStore();
  const providers = getProviders();
  const cmd = body.data;
  try {
    switch (cmd.action) {
      case "approve": {
        const task = await approveTask(store, providers, id, auth.user, { subject: cmd.subject, body: cmd.body, dueAt: cmd.dueAt });
        await audit(auth.user, "task_approve", id, task.status);
        return json({ ok: true, task });
      }
      case "send": {
        const r = await sendTaskNow(store, providers, id, auth.user);
        await audit(auth.user, "task_send", id, r.state);
        if (r.state === "failed") return json({ ok: false, error: r.error ?? "delivery failed", task: r.task }, 502);
        return json({ ok: true, state: r.state, task: r.task, error: r.error });
      }
      case "complete_manual": {
        const task = await completeManually(store, id, auth.user, cmd.note);
        await audit(auth.user, "task_complete_manual", id, task.status);
        return json({ ok: true, task });
      }
      case "skip": {
        const task = await skipTask(store, id, auth.user, cmd.reason);
        await audit(auth.user, "task_skip", id, cmd.reason ?? "");
        return json({ ok: true, task });
      }
      case "reschedule": {
        const task = await rescheduleTask(store, id, auth.user, cmd.dueAt);
        return json({ ok: true, task });
      }
    }
  } catch (err) {
    if (err instanceof TaskError) return error(err.message, err.status);
    throw err;
  }
}
