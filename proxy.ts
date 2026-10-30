import { NextResponse, type NextRequest } from "next/server";
import { PUBLIC_PREFIXES, SESSION_COOKIE, canAccess, homeFor, verifySession } from "@/lib/auth/session";

/**
 * Optimistic auth gate (Next.js 16 proxy): unauthenticated users go to /login,
 * users outside their workspace go to their home. Handlers and pages still
 * verify the session themselves; this only shapes navigation.
 */
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (process.env.AUTH_DISABLED === "true") return NextResponse.next();
  if (PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p)) || pathname === "/favicon.ico") return NextResponse.next();

  const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pathname", pathname);

  if (!session) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ ok: false, error: "sign in required" }, { status: 401 });
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }

  if (pathname === "/") {
    const url = request.nextUrl.clone();
    url.pathname = homeFor(session.role);
    url.search = "";
    return NextResponse.redirect(url);
  }

  if (!pathname.startsWith("/api/") && !canAccess(session.role, pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/forbidden";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
