// Project compilation: parse every document, attach prose trees and node ids,
// run the checker, the site indexer and the island analysis.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { Document, Node } from "./ast.ts";
import { analyzeProject, type AnalyzedDoc } from "./analysis.ts";
import { BUILTINS } from "./builtins.ts";
import { checkProject, type DocInfo } from "./checker.ts";
import type { Config } from "./config.ts";
import type { Compiled } from "./core/render.ts";
import { scopeCss } from "./css.ts";
import { type Diagnostic, MarkError } from "./diagnostics.ts";
import { parseMarkdown } from "./markdown.ts";
import { parseDocument } from "./parser.ts";
import { buildIndex, classify, loadData, type IndexResult } from "./site.ts";

export interface Project {
  config: Config;
  files: Map<string, string>;
  docs: Map<string, AnalyzedDoc>;       // by id
  byName: Map<string, AnalyzedDoc>;     // components by name (built-ins included)
  byFile: Map<string, AnalyzedDoc>;     // root-relative file -> doc
  index: IndexResult;
  diagnostics: Diagnostic[];
  hasErrors: boolean;
  css: string;
  cssByDoc: Map<string, string>;
}

export interface CompileOpts { drafts?: boolean; dev?: boolean }

/** Read a project directory into a file map (site/**, _data/**, static/** contents are read lazily by the build). */
export function loadFiles(dir: string, config: Config): Map<string, string> {
  const files = new Map<string, string>();
  const walk = (d: string, textOnly: boolean): void => {
    if (!exists(d)) return;
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p, textOnly);
      else if (!textOnly || /\.(mark|json|ya?ml)$/.test(name)) files.set(relative(dir, p).split("\\").join("/"), readFileSync(p, "utf8"));
    }
  };
  walk(join(dir, config.root), true);
  walk(join(dir, "_data"), true);
  return files;
}

function exists(p: string): boolean { try { statSync(p); return true; } catch { return false; } }

export const docIdOf = (file: string): string => file.replace(/\.mark$/, "");
export const stampOf = (id: string): string => "data-mk-" + id.replace(/^components\//, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");

export function compileProject(files: Map<string, string>, config: Config, opts: CompileOpts = {}): Project {
  const diagnostics: Diagnostic[] = [];
  const errors: MarkError[] = [];
  const rootPrefix = config.root.replace(/\/$/, "") + "/";
  const parsed: { file: string; ast: Document }[] = [];

  for (const [path, src] of files) {
    if (!path.startsWith(rootPrefix) || !path.endsWith(".mark")) continue;
    const file = path.slice(rootPrefix.length);
    try { parsed.push({ file, ast: parseDocument(src) }); }
    catch (e) {
      if (e instanceof MarkError) diagnostics.push(e.toDiagnostic(path));
      else throw e;
    }
  }

  const classified = classify(parsed.map((p) => p.file), errors);
  const docs = new Map<string, AnalyzedDoc>();
  const byName = new Map<string, AnalyzedDoc>();
  const byFile = new Map<string, AnalyzedDoc>();
  const infos: DocInfo[] = [];

  const makeDoc = (id: string, name: string, kind: AnalyzedDoc["kind"], ast: Document, file: string): AnalyzedDoc => {
    compileNodes(ast);
    const style = ast.find((n) => n.t === "style");
    const doc: AnalyzedDoc = {
      id, name, kind, nodes: ast,
      props: ast.filter((n) => n.t === "prop").map((n) => (n as { name: string }).name),
      stamp: style && !(style as { global: boolean }).global ? stampOf(id) : null,
      intrinsic: false, islands: [], hasMath: false, usesSite: false,
    };
    infos.push({ file, ast, kind: kind === "page" ? "page" : kind, name: name || undefined, props: doc.props, hasExports: ast.some((n) => (n.t === "let" || n.t === "fn") && n.export) });
    return doc;
  };

  for (const [name, src] of Object.entries(BUILTINS)) {
    const doc = makeDoc("builtin:" + name, name, "component", parseDocument(src), "builtin:" + name);
    docs.set(doc.id, doc);
    byName.set(name, doc);
  }
  for (const c of classified) {
    const ast = parsed.find((p) => p.file === c.file)!.ast;
    const kind = c.kind === "notfound" ? "page" : c.kind;
    const doc = makeDoc(docIdOf(c.file), c.name ?? "", kind, ast, rootPrefix + c.file);
    docs.set(doc.id, doc);
    byFile.set(c.file, doc);
    if (c.name) byName.set(c.name, doc);
  }

  const byNameInfo = new Map<string, DocInfo>();
  for (const i of infos) if (i.name) byNameInfo.set(i.name, i);
  diagnostics.push(...checkProject(infos.filter((i) => !i.file.startsWith("builtin:")), byNameInfo));

  const layoutFiles = classified.filter((c) => c.kind === "layout").map((c) => c.file);
  const notFound = classified.find((c) => c.kind === "notfound")?.file ?? null;
  const pages = classified.filter((c) => c.kind === "page").map((c) => ({ file: c.file, ast: byFile.get(c.file)!.nodes }));
  const data = loadData(files);
  const index = buildIndex(pages, layoutFiles, notFound, data, config, { drafts: opts.drafts }, errors);
  for (const e of errors) diagnostics.push(e.toDiagnostic(e.file.startsWith(rootPrefix) ? e.file : rootPrefix + e.file));

  analyzeProject(docs, byName, config.spa);

  // Styles (T-25): _site, layouts, pages, then components.
  const cssByDoc = new Map<string, string>();
  const order = [...docs.values()].sort((a, b) => rank(a) - rank(b) || (a.id < b.id ? -1 : 1));
  const cssParts: string[] = [];
  for (const d of order) {
    const style = d.nodes.find((n) => n.t === "style") as { css: string; global: boolean } | undefined;
    if (!style) continue;
    const css = style.global ? style.css : scopeCss(style.css, d.stamp!);
    cssByDoc.set(d.id, css);
    cssParts.push(`/* ${d.id} */\n${css}`);
  }

  diagnostics.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line));
  return {
    config, files, docs, byName, byFile, index, diagnostics,
    hasErrors: diagnostics.some((d) => d.severity === "error"),
    css: cssParts.join("\n"), cssByDoc,
  };
}

const rank = (d: AnalyzedDoc): number => (d.id === "_site" ? 0 : d.kind === "layout" ? 1 : d.kind === "page" ? 2 : 3);

/** Attach prose trees and DFS node ids. */
export function compileNodes(nodes: Node[]): void {
  let next = 0;
  const visit = (n: Node): void => {
    (n as Node & Compiled).id = next++;
    switch (n.t) {
      case "prose":
        (n as Node & Compiled).tree = parseMarkdown(n.md, n.parts);
        for (const p of n.parts) if (p.p === "tag") visit(p.node);
        break;
      case "if":
        n.then.forEach(visit);
        if (n.else) Array.isArray(n.else) ? n.else.forEach(visit) : visit(n.else);
        break;
      case "for": n.body.forEach(visit); break;
      case "tag": n.children.forEach(visit); break;
      case "head": n.children.forEach(visit); break;
    }
  };
  nodes.forEach(visit);
}
