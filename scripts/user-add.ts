import "./_env";
import { users } from "@/lib/store/collections";
import type { Role, User } from "@/lib/types";

/**
 * Provision a user for single sign-on: `npm run user:add -- <email> <exec|bdr|admin> [repId] [name]`.
 * The identity provider proves the email; this record decides the role.
 */
const [email, role, repId, ...nameParts] = process.argv.slice(2);
const roles: Role[] = ["exec", "bdr", "admin"];
if (!email || !email.includes("@") || !roles.includes(role as Role)) {
  console.error("usage: npm run user:add -- <email> <exec|bdr|admin> [repId] [name]");
  process.exit(1);
}
const existing = (await users.list()).find((u) => u.email.toLowerCase() === email.toLowerCase());
const user: User = {
  id: existing?.id ?? `u_${email.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
  email: email.toLowerCase(),
  name: nameParts.join(" ") || existing?.name || email.split("@")[0],
  role: role as Role,
  repId: role === "bdr" ? (repId || existing?.repId) : undefined,
};
await users.put(user);
console.log(`${existing ? "updated" : "added"} ${user.email} as ${user.role}${user.repId ? ` (rep ${user.repId})` : ""}`);
process.exit(0);
