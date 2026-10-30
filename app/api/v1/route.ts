import { z } from "zod";
import { requireActor } from "@/lib/auth";
import { SCOPE_INFO } from "@/lib/auth/machine";
import { OPERATIONS } from "@/lib/contracts/operations";

export const dynamic = "force-dynamic";

/** Operation catalog: names, scopes, side effects, JSON Schemas for input and output. */
export async function GET(req: Request) {
  const auth = await requireActor(req, { roles: ["bdr", "exec", "admin"], scope: "read" });
  if ("response" in auth) return auth.response;
  return Response.json({
    ok: true,
    actor: { id: auth.actor.id, scopes: auth.actor.scopes },
    scopes: SCOPE_INFO,
    operations: OPERATIONS.map((o) => ({
      name: o.name,
      title: o.title,
      description: o.description,
      scope: o.scope,
      mutates: o.mutates,
      destructive: o.destructive,
      openWorld: o.openWorld,
      idempotency: o.mutates ? "required idempotencyKey (or eventId); retries return the first result" : "read-only",
      pagination: o.pagination ?? null,
      retry: o.retry,
      errors: o.errors,
      input: z.toJSONSchema(o.input, { io: "input" }),
      output: z.toJSONSchema(o.output),
    })),
  });
}
