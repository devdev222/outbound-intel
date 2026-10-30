import { createHash, timingSafeEqual } from "node:crypto";
import { users as userCol, reps as repCol } from "@/lib/store/collections";
import type { Rep, User } from "@/lib/types";

/**
 * Demo identity provider: three users (exec, BDR, admin) with one shared
 * password from DEMO_PASSWORD (default "demo"). Users and reps are seeded into
 * the store so the rest of the platform treats them like real records.
 * Replace `authenticate()` with a real IdP; everything else keys off User.role.
 */

export const DEMO_REPS: Rep[] = [
  { id: "rep_sam", name: "Sam Rivera", email: "sam@cartage.demo", capacityPerDay: 35, active: true },
  { id: "rep_jordan", name: "Jordan Lee", email: "jordan@cartage.demo", capacityPerDay: 35, active: true },
  { id: "rep_priya", name: "Priya Shah", email: "priya@cartage.demo", capacityPerDay: 30, active: true },
];

export const DEMO_USERS: User[] = [
  { id: "u_exec", email: "exec@cartage.demo", name: "Dana Whitfield", role: "exec" },
  { id: "u_bdr", email: "bdr@cartage.demo", name: "Sam Rivera", role: "bdr", repId: "rep_sam" },
  { id: "u_admin", email: "admin@cartage.demo", name: "Avery Chen", role: "admin" },
];

export function demoPassword(): string {
  return process.env.DEMO_PASSWORD || "demo";
}

export async function ensureDemoIdentities(): Promise<void> {
  const existingUsers = await userCol.list();
  if (existingUsers.length === 0) for (const u of DEMO_USERS) await userCol.put(u);
  const existingReps = await repCol.list();
  if (existingReps.length === 0) for (const r of DEMO_REPS) await repCol.put(r);
}

function safeEq(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

export async function authenticate(email: string, password: string): Promise<User | null> {
  await ensureDemoIdentities();
  const user = (await userCol.list()).find((u) => u.email.toLowerCase() === email.trim().toLowerCase());
  if (!user) return null;
  if (!safeEq(password, demoPassword())) return null;
  return user;
}
