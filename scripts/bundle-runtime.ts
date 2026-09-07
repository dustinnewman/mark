// Bundle the browser runtime to runtime/runtime.js and report its size (A-6: < 15 kB min+gz).
import { mkdirSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join } from "node:path";
import { build } from "esbuild";

const root = new URL("..", import.meta.url).pathname;
const r = await build({
  entryPoints: [join(root, "src/runtime/index.ts")],
  bundle: true, format: "esm", write: false, minify: true, target: "es2022", legalComments: "none",
});
const js = r.outputFiles[0].text;
mkdirSync(join(root, "runtime"), { recursive: true });
writeFileSync(join(root, "runtime/runtime.js"), js);
const gz = gzipSync(js).length;
console.log(`runtime.js: ${(js.length / 1024).toFixed(1)} kB min, ${(gz / 1024).toFixed(1)} kB gz`);
if (gz > 15 * 1024) { console.error("runtime exceeds 15 kB min+gz"); process.exit(1); }
