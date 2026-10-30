import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { Role } from "@/lib/types";

/**
 * Scoped machine identities for the HTTP API and the MCP server.
 *
 * A machine (the Sequencer relay, a CRM sync job, an MCP client) authenticates
 * with `Authorization: Bearer <token>`. Only the SHA-256 of each token is
 * configured, never the token itself:
 *
 *   MACHINE_IDENTITIES='[{"id":"sequencer","name":"Cartage Sequencer","sha256":"<hex>","scopes":["engagement:write"]}]'
 *
 * Scopes are least-privilege; nothing is implied. Every action is audited as
 * `machine:<id>`. Users get scopes from their role (see scopesForRole).
 */

export const SCOPES = ["read", "engagement:write", "outcomes:write", "conversations:write", "tasks:write", "contacts:write", "agents:run"] as const;
export type Scope = (typeof SCOPES)[number];

export const SCOPE_INFO: Record<Scope, string> = {
  read: "Read accounts, briefs, tasks, coverage, model summaries",
  "engagement:write": "Report provider engagement events (email, LinkedIn, identified visitors)",
  "outcomes:write": "Record outcomes (meetings, opportunities, wins, losses) and trigger CRM sync",
  "conversations:write": "Log rep conversations",
  "tasks:write": "Approve, complete or skip tasks",
  "contacts:write": "Research, replace or reject contacts",
  "agents:run": "Run an agent on demand",
};

export interface Actor {
  kind: "user" | "machine";
  id: string;
  name: string;
  role: Role | "machine";
  scopes: Scope[];
  repId?: string | null;
}

const Identity = z.object({ id: z.string().min(1).max(64), name: z.string().min(1).max(120), sha256: z.string().regex(/^[0-9a-f]{64}$/i), scopes: z.array(z.enum(SCOPES)).min(1) });

export function machineIdentities(): z.infer<typeof Identity>[] {
  const raw = process.env.MACHINE_IDENTITIES;
  if (!raw) return [];
  try {
    const parsed = z.array(Identity).safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Resolve a bearer token to a machine actor, or null. Constant-time comparison. */
export function machineFromToken(token: string | null | undefined): Actor | null {
  if (!token) return null;
  const h = Buffer.from(hashToken(token), "hex");
  for (const m of machineIdentities()) {
    const want = Buffer.from(m.sha256.toLowerCase(), "hex");
    if (want.length === h.length && timingSafeEqual(want, h)) return { kind: "machine", id: `machine:${m.id}`, name: m.name, role: "machine", scopes: m.scopes };
  }
  return null;
}

export function bearer(req: Request): string | null {
  const h = req.headers.get("authorization") ?? "";
  return h.toLowerCase().startsWith("bearer ") ? h.slice(7).trim() : null;
}

export function scopesForRole(role: Role): Scope[] {
  if (role === "admin") return [...SCOPES];
  if (role === "exec") return ["read", "outcomes:write", "conversations:write", "tasks:write", "contacts:write"];
  return ["read", "outcomes:write", "conversations:write", "tasks:write", "contacts:write"];
}

/** Scopes for the stdio MCP server process: MCP_SCOPES (comma separated), default read-only. */
export function mcpActor(): Actor {
  const raw = (process.env.MCP_SCOPES ?? "read")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const scopes = raw.filter((s): s is Scope => (SCOPES as readonly string[]).includes(s));
  const name = process.env.MCP_CLIENT_NAME?.trim() || "mcp-stdio";
  return { kind: "machine", id: `mcp:${name}`, name, role: "machine", scopes: scopes.length ? scopes : ["read"] };
}

export function hasScope(actor: Actor, scope: Scope): boolean {
  return actor.scopes.includes(scope);
}
