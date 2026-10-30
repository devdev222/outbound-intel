import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { audit } from "@/lib/auth";
import { authProblems, authProvider, discover, oidcConfig, openState, userForClaims, verifyIdToken } from "@/lib/auth/oidc";
import { SESSION_COOKIE, homeFor, signSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

function fail(req: Request, message: string) {
  const url = new URL("/login", req.url);
  url.searchParams.set("error", message);
  return NextResponse.redirect(url);
}

/** OIDC callback: verify state, exchange the code (PKCE), verify the ID token, map to a provisioned user. */
export async function GET(req: Request) {
  if (authProvider() !== "oidc" || authProblems().length) return fail(req, "Single sign-on is not configured.");
  const url = new URL(req.url);
  const jar = await cookies();
  const saved = await openState(jar.get("oi_oidc")?.value);
  if (!saved || url.searchParams.get("state") !== saved.state) return fail(req, "Sign-in expired or was tampered with. Try again.");
  if (url.searchParams.get("error")) return fail(req, `The identity provider refused sign-in: ${url.searchParams.get("error_description") ?? url.searchParams.get("error")}`);
  const code = url.searchParams.get("code");
  if (!code) return fail(req, "No authorization code returned.");

  try {
    const cfg = oidcConfig();
    const doc = await discover(cfg.issuer);
    const tokenRes = await fetch(doc.token_endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: cfg.redirectUri, client_id: cfg.clientId, client_secret: cfg.clientSecret, code_verifier: saved.verifier }),
    });
    if (!tokenRes.ok) return fail(req, `Token exchange failed (${tokenRes.status}).`);
    const tokens = (await tokenRes.json()) as { id_token?: string };
    if (!tokens.id_token) return fail(req, "The identity provider returned no ID token.");
    const jwks = (await (await fetch(doc.jwks_uri)).json()) as { keys: [] };
    const claims = await verifyIdToken(tokens.id_token, { issuer: cfg.issuer, clientId: cfg.clientId, nonce: saved.nonce, jwks });
    const { user, reason } = await userForClaims(claims);
    if (!user) return fail(req, reason ?? "Not permitted.");
    const res = NextResponse.redirect(new URL(saved.next && saved.next !== "/" ? saved.next : homeFor(user.role), req.url));
    res.cookies.set(SESSION_COOKIE, await signSession(user), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 12 * 3600 });
    res.cookies.delete({ name: "oi_oidc", path: "/api/auth/oidc" });
    await audit(user, "sign_in_sso", user.email, user.role);
    return res;
  } catch (err) {
    return fail(req, `Sign-in failed: ${(err as Error).message}`);
  }
}
