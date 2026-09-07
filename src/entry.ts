// Entry point for the bundled CLI / single-executable binary.
import { main } from "./cli.ts";
const sea = process.getBuiltinModule?.("node:sea") as { isSea(): boolean } | undefined;
const isSea = !!sea?.isSea();
main(isSea ? process.argv.slice(1) : process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => { console.error(e); process.exitCode = 1; });
