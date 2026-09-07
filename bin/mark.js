#!/usr/bin/env node
// Runs the TypeScript sources directly (Node ≥ 22.6 strips types). Node refuses to do that under
// node_modules, so an installed copy runs the bundle in lib/ instead (`npm run lib` refreshes it).
// The single-file binary is produced by `npm run binary` (see scripts/).
process.removeAllListeners("warning");
process.on("warning", (w) => { if (w.name !== "ExperimentalWarning") console.warn(w); });
const { main } = await import("../src/cli.ts").catch((e) => {
  if (e.code !== "ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING") throw e;
  return import("../lib/cli.js");
});
main().then((code) => { process.exitCode = code; }, (e) => { console.error(e); process.exitCode = 1; });
