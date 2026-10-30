// Load .env then .env.local (local overrides) for scripts and the MCP server,
// mirroring Next.js precedence, without depending on Next internals.
// Values already in the shell environment always win; among files, later files
// override earlier ones (.env < .env.development/.env.production < .env.local).
import { readFileSync } from "node:fs";
import path from "node:path";

function parse(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim().replace(/^export\s+/, "");
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    } else {
      const hash = value.indexOf(" #");
      if (hash >= 0) value = value.slice(0, hash).trim();
    }
    out[key] = value;
  }
  return out;
}

const files = [".env", process.env.NODE_ENV === "production" ? ".env.production" : ".env.development", ".env.local"];
const shell = new Set(Object.keys(process.env));
const merged: Record<string, string> = {};
for (const f of files) {
  try {
    Object.assign(merged, parse(readFileSync(path.resolve(process.cwd(), f), "utf8")));
  } catch {
    /* file absent */
  }
}
for (const [k, v] of Object.entries(merged)) if (!shell.has(k)) process.env[k] = v;
