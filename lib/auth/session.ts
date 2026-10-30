import type { Role, User } from "@/lib/types";

/**
 * Session tokens: base64url(JSON payload) + "." + base64url(HMAC-SHA256).
 * Implemented with Web Crypto so the same code verifies in the request proxy
 * (edge-compatible) and in server components / route handlers.
 *
 * This is the demo identity layer. Swap `authenticate()` in lib/auth/users.ts
 * for Supabase Auth, Okta or Google Workspace SSO; roles and route gating stay.
 */

export interface SessionPayload {
  uid: string;
  email: string;
  name: string;
  role: Role;
  repId?: string;
  exp: number;
}

export const SESSION_COOKIE = "oi_session";
const DEFAULT_SECRET = "dev-only-secret-set-AUTH_SECRET";

/**
 * Signing secret. In live mode a missing or short AUTH_SECRET returns null and
 * every session is refused (no fallback); demo/test use a fixed dev secret.
 * Reads process.env directly because the proxy may run where lib/config is not loaded.
 */
export function authSecret(): string | null {
  const secret = process.env.AUTH_SECRET ?? "";
  if (process.env.APP_MODE === "live") return secret.length >= 32 ? secret : null;
  return secret || DEFAULT_SECRET;
}

export function authDisabled(): boolean {
  return process.env.AUTH_DISABLED === "true" && process.env.APP_MODE !== "live";
}

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export async function hmac(data: string, secretOverride?: string): Promise<string> {
  const secret = secretOverride ?? authSecret();
  if (!secret) throw new Error("AUTH_SECRET is not configured for live mode");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return b64url(new Uint8Array(sig));
}

export async function signSession(user: User, ttlHours = 12): Promise<string> {
  const payload: SessionPayload = { uid: user.id, email: user.email, name: user.name, role: user.role, repId: user.repId, exp: Date.now() + ttlHours * 3_600_000 };
  const body = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  return `${body}.${await hmac(body)}`;
}

export async function verifySession(token: string | undefined | null): Promise<SessionPayload | null> {
  if (!token || !authSecret()) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = await hmac(body);
  if (expected.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  if (diff !== 0) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(fromB64url(body))) as SessionPayload;
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Which roles may enter each workspace prefix. */
export const ROUTE_ROLES: { prefix: string; roles: Role[] }[] = [
  { prefix: "/console", roles: ["admin"] },
  { prefix: "/integrations", roles: ["admin"] },
  { prefix: "/exec", roles: ["exec", "admin"] },
  { prefix: "/pipeline", roles: ["exec", "admin"] },
  { prefix: "/intelligence", roles: ["exec", "admin"] },
  { prefix: "/lab", roles: ["exec", "admin"] },
  { prefix: "/gifting", roles: ["exec", "admin"] },
  { prefix: "/capacity", roles: ["exec", "admin"] },
  { prefix: "/work", roles: ["bdr", "exec", "admin"] },
  { prefix: "/accounts", roles: ["bdr", "exec", "admin"] },
  { prefix: "/proof", roles: ["bdr", "exec", "admin"] },
  { prefix: "/agents", roles: ["admin"] },
  { prefix: "/alerts", roles: ["bdr", "exec", "admin"] },
];

/** Paths that never require a session (prospect-facing pages, webhooks, tracking, cron). */
export const PUBLIC_PREFIXES = [
  "/login",
  "/for/",
  "/assess/",
  "/api/auth/",
  "/api/track",
  "/api/prospect/",
  "/api/assessments",
  "/api/health",
  "/api/webhooks/",
  "/api/thumb/",
  "/api/agents/tick",
  "/api/create-page",
  "/api/optout",
  "/_next/",
  "/favicon",
];

export function homeFor(role: Role): string {
  return role === "bdr" ? "/work" : role === "exec" ? "/exec" : "/console";
}

export function canAccess(role: Role, pathname: string): boolean {
  const rule = ROUTE_ROLES.find((r) => pathname === r.prefix || pathname.startsWith(r.prefix + "/"));
  return rule ? rule.roles.includes(role) : true;
}
