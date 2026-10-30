// Load .env then .env.local (local overrides) for scripts and the MCP server,
// mirroring Next.js precedence, without depending on Next internals.
// Existing process.env values always win.
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
for (const f of files) {
  try {
    const vars = parse(readFileSync(path.resolve(process.cwd(), f), "utf8"));
    for (const [k, v] of Object.entries(vars)) if (process.env[k] === undefined) process.env[k] = v;
  } catch {
    /* file absent */
  }
}
