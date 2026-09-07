// Bundle the CLI sources into lib/cli.js (plain ESM, dependencies external). Node refuses to strip
// types under node_modules, so this is what runs when Mark is installed as a package (see bin/mark.js).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { build } from "esbuild";

const root = new URL("..", import.meta.url).pathname;
await build({
  entryPoints: [join(root, "src/cli.ts")],
  bundle: true, platform: "node", format: "esm", target: "node22",
  outfile: join(root, "lib/cli.js"),
  external: ["katex", "esbuild", "jsdom"],
  logLevel: "warning",
});
console.log(`wrote lib/cli.js (${(readFileSync(join(root, "lib/cli.js")).length / 1024).toFixed(0)} kB)`);
