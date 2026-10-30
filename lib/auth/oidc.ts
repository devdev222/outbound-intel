import { config } from "@/lib/config";
import { users as userCol } from "@/lib/store/collections";
import type { User } from "@/lib/types";
import { hmac } from "./session";

/**
 * OpenID Connect sign-in (authorization code + PKCE) for live mode.
 *
 * Works with any standards-compliant IdP (Okta, Microsoft Entra ID, Google
 * Workspace, Auth0). The IdP proves who the person is; THIS app decides what
 * they may do: the verified email must match a provisioned user record
 * (`npm run user:add -- <email> <role> [repId]`), which carries the role.
 *
 *   AUTH_PROVIDER=oidc  OIDC_ISSUER  OIDC_CLIENT_ID  OIDC_CLIENT_SECRET
 *   optional: OIDC_REDIRECT_URI (default {NEXT_PUBLIC_APP_URL}/api/auth/oidc/callback), OIDC_ALLOWED_DOMAINS
 *
 * Fails closed: when live mode lacks this configuration nobody can sign in,
 * and demo passwords are never accepted in live mode.
 */

export type AuthProvider = "demo" | "oidc";

export function authProvider(): AuthProvider {
  return process.env.AUTH_PROVIDER === "oidc" ? "oidc" : "demo";
}

/** Demo password sign-in is allowed only outside live mode and only with the demo provider. */
export function demoSignInAllowed(): boolean {
  return config.mode !== "live" && authProvider() === "demo";
}

export function oidcConfig() {
  const issuer = (process.env.OIDC_ISSUER ?? "").replace(/\/$/, "");
  const clientId = process.env.OIDC_CLIENT_ID ?? "";
  const clientSecret = process.env.OIDC_CLIENT_SECRET ?? "";
  const redirectUri = process.env.OIDC_REDIRECT_URI || `${config.appUrl.replace(/\/$/, "")}/api/auth/oidc/callback`;
  const allowedDomains = (process.env.OIDC_ALLOWED_DOMAINS ?? "")
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
  return { issuer, clientId, clientSecret, redirectUri, allowedDomains, configured: Boolean(issuer && clientId && clientSecret) };
}

/** Problems that block sign-in in the current mode (empty = sign-in works). */
export function authProblems(): string[] {
  const out: string[] = [];
  if (config.mode === "live") {
    if (authProvider() !== "oidc") out.push("live mode requires AUTH_PROVIDER=oidc (demo sign-in is disabled)");
    const o = oidcConfig();
    if (authProvider() === "oidc" && !o.configured) out.push("OIDC_ISSUER, OIDC_CLIENT_ID and OIDC_CLIENT_SECRET are required");
  } else if (authProvider() === "oidc" && !oidcConfig().configured) {
    out.push("AUTH_PROVIDER=oidc but OIDC_ISSUER, OIDC_CLIENT_ID or OIDC_CLIENT_SECRET is missing");
  }
  return out;
}

interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

let discoveryCache: { at: number; issuer: string; doc: Discovery } | null = null;

export async function discover(issuer = oidcConfig().issuer, fetchImpl: typeof fetch = fetch): Promise<Discovery> {
  if (discoveryCache && discoveryCache.issuer === issuer && Date.now() - discoveryCache.at < 3_600_000) return discoveryCache.doc;
  const res = await fetchImpl(`${issuer}/.well-known/openid-configuration`);
  if (!res.ok) throw new Error(`OIDC discovery failed (${res.status})`);
  const doc = (await res.json()) as Discovery;
  if (!doc.authorization_endpoint || !doc.token_endpoint || !doc.jwks_uri) throw new Error("OIDC discovery document is missing endpoints");
  if (doc.issuer.replace(/\/$/, "") !== issuer) throw new Error("OIDC issuer mismatch in discovery document");
  discoveryCache = { at: Date.now(), issuer, doc };
  return doc;
}

const b64url = (buf: ArrayBuffer | Uint8Array) => Buffer.from(buf instanceof Uint8Array ? buf : new Uint8Array(buf)).toString("base64url");
export const randomToken = (bytes = 32) => b64url(crypto.getRandomValues(new Uint8Array(bytes)));

export async function pkceChallenge(verifier: string): Promise<string> {
  return b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
}

/** Signed, short-lived state cookie: state, nonce, PKCE verifier, return path. */
export async function sealState(data: { state: string; nonce: string; verifier: string; next: string }): Promise<string> {
  const body = Buffer.from(JSON.stringify({ ...data, exp: Date.now() + 10 * 60_000 })).toString("base64url");
  return `${body}.${await hmac(body)}`;
}

export async function openState(sealed: string | undefined): Promise<{ state: string; nonce: string; verifier: string; next: string } | null> {
  if (!sealed) return null;
  const [body, sig] = sealed.split(".");
  if (!body || !sig || (await hmac(body)) !== sig) return null;
  const data = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  return data.exp > Date.now() ? data : null;
}

interface Jwk {
  kid?: string;
  kty: string;
  alg?: string;
  n?: string;
  e?: string;
  crv?: string;
  x?: string;
  y?: string;
}

/** Verify an ID token's signature (RS256 or ES256) against the IdP's JWKS, then its claims. */
export async function verifyIdToken(idToken: string, opts: { issuer: string; clientId: string; nonce: string; jwks: { keys: Jwk[] }; now?: number }): Promise<Record<string, unknown>> {
  const [h, p, s] = idToken.split(".");
  if (!h || !p || !s) throw new Error("malformed ID token");
  const header = JSON.parse(Buffer.from(h, "base64url").toString("utf8")) as { alg: string; kid?: string };
  const claims = JSON.parse(Buffer.from(p, "base64url").toString("utf8")) as Record<string, unknown>;
  const jwk = opts.jwks.keys.find((k) => (header.kid ? k.kid === header.kid : true) && (header.alg === "RS256" ? k.kty === "RSA" : k.kty === "EC"));
  if (!jwk) throw new Error("no matching signing key");
  const data = new TextEncoder().encode(`${h}.${p}`);
  const sig = Buffer.from(s, "base64url");
  let ok: boolean;
  if (header.alg === "RS256") {
    const key = await crypto.subtle.importKey("jwk", jwk as JsonWebKey, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, sig, data);
  } else if (header.alg === "ES256") {
    const key = await crypto.subtle.importKey("jwk", jwk as JsonWebKey, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, sig, data);
  } else throw new Error(`unsupported ID token algorithm ${header.alg}`);
  if (!ok) throw new Error("ID token signature is invalid");
  const now = Math.floor((opts.now ?? Date.now()) / 1000);
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (String(claims.iss).replace(/\/$/, "") !== opts.issuer) throw new Error("ID token issuer mismatch");
  if (!aud.includes(opts.clientId)) throw new Error("ID token audience mismatch");
  if (typeof claims.exp !== "number" || claims.exp < now - 60) throw new Error("ID token expired");
  if (claims.nonce !== opts.nonce) throw new Error("ID token nonce mismatch");
  return claims;
}

/** Map verified claims to a provisioned user. Returns null (sign-in refused) when not provisioned. */
export async function userForClaims(claims: Record<string, unknown>): Promise<{ user: User | null; reason?: string }> {
  const email = String(claims.email ?? "").toLowerCase();
  if (!email) return { user: null, reason: "the identity provider did not return an email" };
  if (claims.email_verified === false) return { user: null, reason: "the email is not verified at the identity provider" };
  const domains = oidcConfig().allowedDomains;
  if (domains.length && !domains.includes(email.split("@")[1] ?? "")) return { user: null, reason: "this email domain is not allowed" };
  const user = (await userCol.list()).find((u) => u.email.toLowerCase() === email && !u.email.endsWith("@cartage.demo"));
  return user ? { user } : { user: null, reason: `${email} is not provisioned; ask an admin to add you` };
}
