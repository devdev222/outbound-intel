import "./_env";
import { checkReadiness } from "@/lib/readiness-check";

/**
 * `npm run check`: configuration and schema readiness for this environment.
 * Exits 1 when anything would make a live deployment unsafe or broken.
 */
const r = await checkReadiness();
console.log(`mode=${r.mode} store=${r.store} schema=${r.schema.actual ?? "missing"} (expected ${r.schema.expected})`);
if (r.ok) {
  console.log("ready: no configuration or schema problems");
  process.exit(0);
}
for (const p of r.problems) console.log(`- ${p.key}: ${p.problem}\n    fix: ${p.fix}`);
process.exit(1);
