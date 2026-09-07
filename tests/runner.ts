// Reference test runner: reads tests/**/*.test.json (spec section 15).
// Usage: node tests/runner.ts [tier-or-name-filter ...]
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { parseDocument } from "../src/parser.ts";
import { MarkError } from "../src/diagnostics.ts";
import { runCheckTest, runEvalTest, runBuildTest, runRunTest } from "./tiers.ts";

const root = new URL(".", import.meta.url).pathname;
const filters = process.argv.slice(2);

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (name.endsWith(".test.json")) yield p;
  }
}

export function deepEqual(a: unknown, b: unknown, path = "$"): string | null {
  if (a === b) return null;
  if (typeof a === "number" && typeof b === "number" && Number.isNaN(a) && Number.isNaN(b)) return null;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") {
    return `${path}: expected ${JSON.stringify(b)} got ${JSON.stringify(a)}`;
  }
  if (Array.isArray(a) !== Array.isArray(b)) return `${path}: array mismatch`;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return `${path}: expected length ${b.length} got ${a.length}`;
    for (let i = 0; i < a.length; i++) { const r = deepEqual(a[i], b[i], `${path}[${i}]`); if (r) return r; }
    return null;
  }
  const ao = a as Record<string, unknown>, bo = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(ao), ...Object.keys(bo)]);
  for (const k of keys) {
    if (!(k in bo)) return `${path}.${k}: unexpected key (value ${JSON.stringify(ao[k])})`;
    if (!(k in ao)) return `${path}.${k}: missing key`;
    const r = deepEqual(ao[k], bo[k], `${path}.${k}`);
    if (r) return r;
  }
  return null;
}

async function runParseTest(t: any): Promise<string | null> {
  try {
    const ast = parseDocument(t.src);
    if (t.error) return `expected error ${t.error} but parsed OK: ${JSON.stringify(ast)}`;
    const norm = JSON.parse(JSON.stringify(ast));
    return deepEqual(norm, t.ast);
  } catch (e) {
    if (!(e instanceof MarkError)) throw e;
    if (!t.error) return `unexpected ${e.code} at line ${e.line}: ${e.message}`;
    if (t.error !== e.code && !(t.error === "SYNTAX" && e.code === "SYNTAX")) return `expected ${t.error} got ${e.code}: ${e.message}`;
    return null;
  }
}

const tiers: Record<string, (t: any) => Promise<string | null>> = {
  parse: runParseTest, check: runCheckTest, eval: runEvalTest, build: runBuildTest, run: runRunTest,
};

let pass = 0, fail = 0, skipped = 0;
const failures: string[] = [];
for (const file of walk(root)) {
  const rel = relative(root, file);
  const tier = rel.split("/")[0];
  const runner = tiers[tier];
  if (!runner) continue;
  const raw = JSON.parse(readFileSync(file, "utf8"));
  const tests = Array.isArray(raw) ? raw : [raw];
  for (const t of tests) {
    const label = `${tier}/${t.name}`;
    if (filters.length && !filters.some((f) => label.includes(f))) { skipped++; continue; }
    let result: string | null;
    try { result = await runner(t); }
    catch (e: any) { result = `threw ${e?.stack ?? e}`; }
    if (result === null) { pass++; }
    else { fail++; failures.push(`✗ ${label}\n    ${result.split("\n").join("\n    ")}`); }
  }
}
for (const f of failures) console.log(f);
console.log(`\n${pass} passed, ${fail} failed${skipped ? `, ${skipped} skipped` : ""}`);
process.exit(fail ? 1 : 0);
