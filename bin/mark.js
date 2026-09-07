#!/usr/bin/env node
// Development entry: runs the TypeScript sources directly (Node ≥ 22.6 strips types).
// The single-file binary is produced by `npm run binary` (see scripts/).
process.removeAllListeners("warning");
process.on("warning", (w) => { if (w.name !== "ExperimentalWarning") console.warn(w); });
const { main } = await import("../src/cli.ts");
main().then((code) => { process.exitCode = code; }, (e) => { console.error(e); process.exitCode = 1; });
