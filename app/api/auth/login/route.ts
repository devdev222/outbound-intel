import { z } from "zod";
import { authenticate } from "@/lib/auth/users";
import { audit } from "@/lib/auth";
import { SESSION_COOKIE, homeFor, signSession } from "@/lib/auth/session";
import { error, json, readJson } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await readJson(req, z.object({ email: z.string().email(), password: z.string().min(1) }));
  if (!body.ok) return body.response;
  const user = await authenticate(body.data.email, body.data.password);
  if (!user) return error("invalid email or password", 401);
  const token = await signSession(user);
  await audit(user, "sign_in", user.email, user.role);
  const res = json({ ok: true, user: { name: user.name, role: user.role }, home: homeFor(user.role) });
  res.cookies.set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 12 * 3600 });
  return res;
}
