import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { auditLog } from "@/lib/store/collections";
import type { Role, User } from "@/lib/types";
import { nowIso, uuid } from "@/lib/util";
import { SESSION_COOKIE, verifySession } from "./session";

export { SESSION_COOKIE, homeFor, canAccess } from "./session";

/** Current user from the session cookie, or null. Server components and route handlers only. */
export async function getSession(): Promise<User | null> {
  if (process.env.AUTH_DISABLED === "true") return { id: "u_local", email: "local@localhost", name: "Local admin", role: "admin" };
  const jar = await cookies();
  const payload = await verifySession(jar.get(SESSION_COOKIE)?.value);
  if (!payload) return null;
  return { id: payload.uid, email: payload.email, name: payload.name, role: payload.role, repId: payload.repId };
}

/** Server-component guard: redirects to login or the user's home when the role may not enter. */
export async function requireRole(roles: Role[]): Promise<User> {
  const user = await getSession();
  if (!user) {
    const h = await headers();
    const path = h.get("x-pathname") ?? "/";
    redirect(`/login?next=${encodeURIComponent(path)}`);
  }
  if (!roles.includes(user.role)) redirect("/forbidden");
  return user;
}

/** Route-handler guard: returns the user or a 401/403 Response. */
export async function requireApiRole(roles: Role[]): Promise<{ user: User } | { response: Response }> {
  const user = await getSession();
  if (!user) return { response: Response.json({ ok: false, error: "sign in required" }, { status: 401 }) };
  if (!roles.includes(user.role)) return { response: Response.json({ ok: false, error: "not permitted for your role" }, { status: 403 }) };
  return { user };
}

/** Record a sensitive action (approvals, suppressions, settings, overrides). */
export async function audit(user: User, action: string, target: string, detail = ""): Promise<void> {
  await auditLog.put({ id: uuid(), userId: user.id, userName: user.name, role: user.role, action, target, detail, at: nowIso() });
}
