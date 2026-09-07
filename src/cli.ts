#!/usr/bin/env node
// mark CLI: parse | check | build | dev
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildDir, printDiagnostics } from "./build.ts";
import { loadConfig } from "./config.ts";
import { compileProject, loadFiles } from "./compile.ts";
import { MarkError, formatDiagnostic } from "./diagnostics.ts";
import { parseDocument } from "./parser.ts";

const USAGE = `mark — Markdown-flavored language for interactive websites

Usage:
  mark parse <file.mark>            Print the JSON AST of one document
  mark check [dir]                  Type-check a project (default: current directory)
  mark build [dir] [options]        Build the site into <out> (default dist/)
  mark dev [dir] [--port N]         Build, serve with live reload, rebuild on change

Options:
  --drafts        Include pages with \`prop draft = true\`
  --islands       Report islands per page and the vars that caused them
  --spa           Enable client-side navigation (overrides mark.config.json)
  --out <dir>     Output directory
  --port <n>      Dev server port (default 4321)
`;

interface Args { cmd: string; positional: string[]; flags: Record<string, string | boolean> }

function parseArgs(argv: string[]): Args {
  const [cmd = "help", ...rest] = argv;
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a.startsWith("--")) {
      const name = a.slice(2);
      if (name === "out" || name === "port") flags[name] = rest[++i];
      else flags[name] = true;
    } else positional.push(a);
  }
  return { cmd, positional, flags };
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const { cmd, positional, flags } = parseArgs(argv);
  switch (cmd) {
    case "parse": {
      const file = positional[0];
      if (!file) { console.error(USAGE); return 2; }
      try {
        console.log(JSON.stringify(parseDocument(readFileSync(file, "utf8")), null, 2));
        return 0;
      } catch (e) {
        if (e instanceof MarkError) { console.error(formatDiagnostic(e.toDiagnostic(file))); return 1; }
        throw e;
      }
    }
    case "check": {
      const dir = resolve(positional[0] ?? ".");
      const config = loadConfig(dir, flags.spa ? { spa: true } : {});
      const project = compileProject(loadFiles(dir, config), config, { drafts: !!flags.drafts });
      printDiagnostics(project.diagnostics);
      console.error(project.hasErrors ? "✗ errors found" : `✓ ${project.index.entries.length} pages, ${project.byName.size} components`);
      return project.hasErrors ? 1 : 0;
    }
    case "build": {
      const dir = resolve(positional[0] ?? ".");
      const over: Record<string, unknown> = {};
      if (flags.spa) over.spa = true;
      if (typeof flags.out === "string") over.out = flags.out;
      const t0 = Date.now();
      const { output, outDir } = await buildDir(dir, { drafts: !!flags.drafts, islands: !!flags.islands, config: over });
      printDiagnostics(output.diagnostics);
      if (flags.islands) console.log(output.report.join("\n"));
      const failed = output.diagnostics.some((d) => d.severity === "error");
      if (!failed) console.error(`✓ built ${output.pages.length} pages → ${outDir} in ${Date.now() - t0} ms`);
      return failed ? 1 : 0;
    }
    case "dev": {
      const dir = resolve(positional[0] ?? ".");
      const { devServer } = await import("./dev.ts");
      await devServer(dir, { port: Number(flags.port ?? 4321), drafts: true, spa: !!flags.spa });
      return 0;
    }
    default:
      console.log(USAGE);
      return cmd === "help" || cmd === "--help" ? 0 : 2;
  }
}

if (process.argv[1] && /cli\.(ts|js|cjs)$/.test(process.argv[1])) {
  main().then((code) => { process.exitCode = code; }, (e) => { console.error(e); process.exitCode = 1; });
}
