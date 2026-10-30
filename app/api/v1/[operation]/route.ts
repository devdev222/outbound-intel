import { audit, requireActor } from "@/lib/auth";
import { ContractError, HTTP_STATUS, invoke, OPERATION_BY_NAME } from "@/lib/contracts/operations";
import { getProviders } from "@/lib/providers";
import { getStore } from "@/lib/store";
import type { Role } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Contract-backed HTTP API: POST /api/v1/<operation> with a JSON body.
 * Auth: Authorization: Bearer <machine token> with the operation's scope, or a
 * signed-in user whose role grants it. Errors: { ok: false, error: { code, message } }.
 * Catalog with JSON Schemas: GET /api/v1.
 */
export async function POST(req: Request, { params }: { params: Promise<{ operation: string }> }) {
  const { operation } = await params;
  const o = OPERATION_BY_NAME.get(operation);
  if (!o) return Response.json({ ok: false, error: { code: "not_found", message: `unknown operation ${operation}` } }, { status: 404 });
  const roles: Role[] = o.scope === "agents:run" || o.scope === "engagement:write" ? ["admin"] : ["bdr", "exec", "admin"];
  const auth = await requireActor(req, { roles, scope: o.scope });
  if ("response" in auth) return auth.response;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  try {
    const result = await invoke(operation, body, { store: getStore(), providers: getProviders(), actor: auth.actor, user: auth.user });
    if (o.mutates) await audit(auth.actor, `api:${operation}`, String((body as Record<string, unknown>)?.accountId ?? (body as Record<string, unknown>)?.taskId ?? (body as Record<string, unknown>)?.slug ?? ""), (body as Record<string, unknown>)?.idempotencyKey ? `key ${String((body as Record<string, unknown>).idempotencyKey).slice(0, 40)}` : "");
    return Response.json({ ok: true, result });
  } catch (err) {
    if (err instanceof ContractError) return Response.json({ ok: false, error: { code: err.code, message: err.message } }, { status: HTTP_STATUS[err.code] });
    console.error(`[api/v1/${operation}]`, err);
    return Response.json({ ok: false, error: { code: "internal", message: "internal error; safe to retry with the same idempotencyKey" } }, { status: 500 });
  }
}
