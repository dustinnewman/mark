// Bundle the CLI into build/mark.cjs with the browser runtime and KaTeX embedded as assets,
// and write a Node SEA config for `scripts/build-binary.sh`.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { build } from "esbuild";

const root = new URL("..", import.meta.url).pathname;
if (!existsSync(join(root, "runtime/runtime.js"))) { console.error("run `npm run runtime` first"); process.exit(1); }
mkdirSync(join(root, "build"), { recursive: true });
const katex = join(root, "node_modules/katex/dist");
const fonts = readdirSync(join(katex, "fonts")).filter((f) => f.endsWith(".woff2"));
const files: Record<string, string> = {
  "runtime.js": join(root, "runtime/runtime.js"),
  "katex.mjs": join(katex, "katex.mjs"),
  "katex.min.css": join(katex, "katex.min.css"),
};
for (const f of fonts) files["fonts/" + f] = join(katex, "fonts", f);
const embedded: Record<string, string> = { "katex-fonts.json": Buffer.from(JSON.stringify(fonts)).toString("base64") };
for (const [k, p] of Object.entries(files)) embedded[k] = readFileSync(p).toString("base64");

await build({
  entryPoints: [join(root, "src/entry.ts")],
  bundle: true, platform: "node", format: "cjs", target: "node22",
  outfile: join(root, "build/mark.cjs"),
  external: ["esbuild", "jsdom"],
  define: { __MARK_ASSETS__: JSON.stringify(embedded) },
  banner: { js: "#!/usr/bin/env node" },
  logLevel: "warning",
});
writeFileSync(join(root, "build/sea-config.json"), JSON.stringify({
  main: "build/mark.cjs", output: "build/mark.blob", disableExperimentalSEAWarning: true,
}, null, 2));
console.log(`wrote build/mark.cjs (${(readFileSync(join(root, "build/mark.cjs")).length / 1024 / 1024).toFixed(1)} MB, assets embedded)`);
