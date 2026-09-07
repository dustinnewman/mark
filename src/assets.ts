// Bundled assets (runtime, KaTeX) are read from the package during development and
// from the single-executable blob (`node:sea`) in the compiled binary.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

interface SeaApi { isSea(): boolean; getAsset(key: string, enc?: string): ArrayBuffer | string }
let sea: SeaApi | null = null;
try {
  const api = (process.getBuiltinModule as ((id: string) => unknown) | undefined)?.("node:sea") as SeaApi | undefined;
  sea = api && api.isSea() ? api : null;
} catch { sea = null; }

declare const __dirname: string | undefined;
export const pkgDir = (): string => {
  try { if (import.meta.url) return join(dirname(fileURLToPath(import.meta.url)), ".."); } catch { /* bundled */ }
  return typeof __dirname === "string" ? join(__dirname, "..") : process.cwd();
};

/** Assets embedded (base64) by scripts/bundle-cli.ts via an esbuild `define`. */
declare const __MARK_ASSETS__: Record<string, string> | undefined;
const embedded: Record<string, string> | null = typeof __MARK_ASSETS__ !== "undefined" ? __MARK_ASSETS__ : null;

export function hasSeaAssets(): boolean { return sea !== null || embedded !== null; }

export function textAsset(key: string, fallbackPath: string): string | null {
  if (sea) { try { return sea.getAsset(key, "utf8") as string; } catch { return null; } }
  if (embedded) return key in embedded ? Buffer.from(embedded[key], "base64").toString("utf8") : null;
  const p = join(pkgDir(), fallbackPath);
  return existsSync(p) ? readFileSync(p, "utf8") : null;
}

export function binaryAsset(key: string, fallbackPath: string): Buffer | null {
  if (sea) { try { return Buffer.from(sea.getAsset(key) as ArrayBuffer); } catch { return null; } }
  if (embedded) return key in embedded ? Buffer.from(embedded[key], "base64") : null;
  const p = join(pkgDir(), fallbackPath);
  return existsSync(p) ? readFileSync(p) : null;
}

export const KATEX_DIST = "node_modules/katex/dist";

/** KaTeX font file names (woff2 only; the stylesheet lists woff2 first). */
export function katexFontNames(): string[] {
  const list = textAsset("katex-fonts.json", "__none__");
  if (list) return JSON.parse(list);
  const dir = join(pkgDir(), KATEX_DIST, "fonts");
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".woff2")) : [];
}
