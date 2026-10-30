import { NextResponse } from "next/server";
import { authProblems, authProvider, discover, oidcConfig, pkceChallenge, randomToken, sealState } from "@/lib/auth/oidc";

export const dynamic = "force-dynamic";

/** Begin OIDC sign-in: state + nonce + PKCE, then redirect to the identity provider. Fails closed. */
export async function GET(req: Request) {
  const problems = authProblems();
  if (authProvider() !== "oidc" || problems.length) return NextResponse.json({ ok: false, error: `single sign-on is not configured: ${problems.join("; ") || "AUTH_PROVIDER is not oidc"}` }, { status: 503 });
  const cfg = oidcConfig();
  const doc = await discover(cfg.issuer);
  const nextParam = new URL(req.url).searchParams.get("next") ?? "/";
  const state = randomToken();
  const nonce = randomToken();
  const verifier = randomToken(48);
  const url = new URL(doc.authorization_endpoint);
  url.search = new URLSearchParams({ response_type: "code", client_id: cfg.clientId, redirect_uri: cfg.redirectUri, scope: "openid email profile", state, nonce, code_challenge: await pkceChallenge(verifier), code_challenge_method: "S256" }).toString();
  const res = NextResponse.redirect(url.toString());
  res.cookies.set("oi_oidc", await sealState({ state, nonce, verifier, next: nextParam.startsWith("/") ? nextParam : "/" }), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/api/auth/oidc", maxAge: 600 });
  return res;
}
