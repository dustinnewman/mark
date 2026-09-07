// Emitter (A-5): one ES module per document with islands (the pruned AST as data,
// interpreted by the runtime — no eval / new Function) plus one module per page.
import type { Expr, Node, Stmt } from "./ast.ts";
import type { AnalyzedDoc } from "./analysis.ts";
import type { Compiled } from "./core/render.ts";

export interface IslandRef { doc: string; nodes: number[]; id: number }

export const docFileName = (id: string): string => id.replace(/:/g, "_").replace(/\//g, "__") + ".js";
export const pageFileName = (path: string): string => (path === "/" ? "index" : path.replace(/^\//, "")) + ".js";

/** Names referenced anywhere inside nodes/expressions (identifiers), for declaration pruning. */
export function collectNames(v: unknown, out: Set<string>): void {
  if (!v || typeof v !== "object") return;
  if (Array.isArray(v)) { for (const x of v) collectNames(x, out); return; }
  const o = v as Record<string, unknown>;
  if (o.type === "Identifier" && typeof o.name === "string") out.add(o.name);
  if (o.k === "bind" && Array.isArray(o.path) && typeof o.path[0] === "string") out.add(o.path[0]);
  for (const key of Object.keys(o)) if (key !== "tree" && key !== "md") collectNames(o[key], out);
}

/** Root docs keep only islands and the declarations they (transitively) depend on. */
export function pruneDoc(doc: AnalyzedDoc, full: boolean): Node[] {
  if (full || doc.kind === "component") return doc.nodes;
  const islands = doc.nodes.filter((n) => (n as Node & Compiled).island);
  const needed = new Set<string>();
  for (const n of islands) collectNames(n, needed);
  const decls = doc.nodes.filter((n) => n.t === "var" || n.t === "let" || n.t === "fn" || n.t === "prop") as (Node & { name: string })[];
  let changed = true;
  while (changed) {
    changed = false;
    for (const d of decls) {
      if (!needed.has(d.name)) continue;
      const before = needed.size;
      collectNames(d.t === "fn" ? (d as { body: Expr | Stmt[] }).body : (d as { init?: Expr }).init, needed);
      if (needed.size !== before) changed = true;
    }
  }
  return doc.nodes.filter((n) => (n as Node & Compiled).island || ((n.t === "var" || n.t === "let" || n.t === "fn" || n.t === "prop") && needed.has(n.name)));
}

/** Component docs used (transitively) by the given nodes. */
export function componentClosure(nodes: Node[], byName: Map<string, AnalyzedDoc>, out = new Map<string, AnalyzedDoc>()): Map<string, AnalyzedDoc> {
  const visit = (n: Node): void => {
    switch (n.t) {
      case "tag":
        if (n.kind === "comp" && n.name !== "Fragment" && n.name !== "Math") {
          const d = byName.get(n.name);
          if (d && !out.has(d.id)) { out.set(d.id, d); d.nodes.forEach(visit); }
        }
        n.children.forEach(visit);
        break;
      case "prose": for (const p of n.parts) if (p.p === "tag") visit(p.node); break;
      case "if": n.then.forEach(visit); if (n.else) Array.isArray(n.else) ? n.else.forEach(visit) : visit(n.else); break;
      case "for": n.body.forEach(visit); break;
      case "head": n.children.forEach(visit); break;
    }
  };
  nodes.forEach(visit);
  return out;
}

const stripForClient = (_k: string, v: unknown): unknown => (_k === "md" ? undefined : v);

export function emitDocModule(doc: AnalyzedDoc, nodes: Node[]): string {
  const data = { id: doc.id, name: doc.name, kind: doc.kind, props: doc.props, stamp: doc.stamp, nodes };
  return `export default ${JSON.stringify(data, stripForClient)};\n`;
}

export interface PageManifest {
  path: string;
  params: Record<string, string>;
  info: unknown;
  title: string;
  layouts: string[];         // doc ids, outermost first
  page: string;              // page doc id
}

export function emitPageModule(opts: {
  depth: number; manifest: PageManifest; docIds: string[]; islands: IslandRef[]; needSite: boolean; needMath: boolean;
  base: string; spa: boolean; dev: boolean; mathMode: string; katexMacros: Record<string, string>;
}): string {
  const up = "../".repeat(opts.depth + 1);
  const lines: string[] = [`import { hydrate } from "${up}runtime.js";`];
  opts.docIds.forEach((id, i) => lines.push(`import d${i} from "${up}docs/${docFileName(id)}";`));
  if (opts.needSite) lines.push(`import site from "${up}site.js";`);
  if (opts.needMath) lines.push(`import katex from "${up}katex.js";`);
  const docs = opts.docIds.map((id, i) => `${JSON.stringify(id)}: d${i}`).join(", ");
  lines.push(`const m = {`);
  lines.push(`  page: ${JSON.stringify(opts.manifest)},`);
  lines.push(`  docs: { ${docs} },`);
  lines.push(`  islands: ${JSON.stringify(opts.islands)},`);
  lines.push(`  site: ${opts.needSite ? "site" : "null"},`);
  lines.push(`  math: ${opts.needMath ? "katex" : "null"},`);
  lines.push(`  base: ${JSON.stringify(opts.base)}, spa: ${opts.spa}, dev: ${opts.dev}, mathMode: ${JSON.stringify(opts.mathMode)}, macros: ${JSON.stringify(opts.katexMacros)},`);
  lines.push(`};`);
  if (opts.spa) { lines.push(`export default m;`); lines.push(`if (!globalThis.__mark) hydrate(m);`); }
  else lines.push(`hydrate(m);`);
  return lines.join("\n") + "\n";
}

export function emitSiteModule(site: unknown, routes: unknown): string {
  return `export default ${JSON.stringify({ site, routes })};\n`;
}
