// Build orchestration (12.1, 12.3): evaluate every page, write HTML/CSS and, for
// pages with islands, the runtime, document modules and page modules.
import { cpSync, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { KATEX_DIST, binaryAsset, katexFontNames, pkgDir, textAsset } from "./assets.ts";
import type { AnalyzedDoc } from "./analysis.ts";
import { BuildHost, type VNode, findAll, serialize, textOf } from "./buildhost.ts";
import { type Config, loadConfig } from "./config.ts";
import { compileProject, loadFiles, type Project } from "./compile.ts";
import { type Ctx, makeCtx } from "./core/interp.ts";
import { deepFreeze } from "./core/reactive.ts";
import { type Compiled, type Instance, type RenderCtx, type Slots, evalExports, mountDocument } from "./core/render.ts";
import { Owner, flush, runWithOwner } from "./core/signal.ts";
import { type Diagnostic, formatDiagnostic } from "./diagnostics.ts";
import { type IslandRef, collectNames, componentClosure, docFileName, emitDocModule, emitPageModule, emitSiteModule, pageFileName, pruneDoc } from "./emit.ts";
import { escapeHtml } from "./core/host.ts";
import { makeMathRenderer } from "./math.ts";
import type { PageEntry, PageInfo } from "./site.ts";

export interface BuildOpts { dev?: boolean; drafts?: boolean; islands?: boolean; runtimeJs?: string }

export interface PageOutput {
  path: string;
  file: string;               // dist-relative html file
  html: string;
  islands: IslandRef[];
  errors: Diagnostic[];
  title: string;
}

export interface BuildOutput {
  files: Map<string, string>;   // dist-relative text files
  pages: PageOutput[];
  diagnostics: Diagnostic[];
  report: string[];             // --islands report lines
  needsKatex: boolean;
  needsRuntime: boolean;
}


/** Globals available to expressions on one page (C-4, T-21). */
export function makeGlobals(project: Project, page: Record<string, unknown>, ctx: () => Ctx): Record<string, unknown> {
  const g: Record<string, unknown> = { Site: project.index.site, Page: page, Math, JSON, Number, String, Array, Object, Date, Promise, console: {} };
  for (const d of project.byName.values()) {
    if (!d.nodes.some((n) => (n.t === "let" || n.t === "fn") && n.export)) continue;
    let cache: Record<string, unknown> | null = null;
    Object.defineProperty(g, d.name, { enumerable: true, get: () => (cache ??= evalExports(d, ctx())) });
  }
  return g;
}

export interface RenderedPage { body: VNode; head: VNode; islands: IslandRef[]; errors: Diagnostic[]; ctx: Ctx; title: string }

/** Evaluate one page (with its layout chain) to a virtual tree. */
export function renderPage(project: Project, entry: PageEntry, opts: BuildOpts, pageObj?: Record<string, unknown>): RenderedPage {
  const config = project.config;
  const errors: Diagnostic[] = [];
  const page = pageObj ?? {
    path: entry.info.path, params: entry.params, query: {}, hash: "", info: entry.info, title: entry.info.title,
    layouts: entry.layouts,
  };
  const ctx: Ctx = makeCtx({
    client: false, dynamic: false, buildTime: Date.now(), locale: config.locale,
    env: { reducedMotion: false, client: false, dev: !!opts.dev, touch: false },
    log: (level, args) => console[level === "log" ? "log" : level](`[mark ${entry.file}]`, ...args),
    deadline: Date.now() + 10_000,
  });
  ctx.globals = makeGlobals(project, page, () => ctx);
  const host = new BuildHost();
  const body = host.root("body");
  const head = host.root("head");
  const islands: IslandRef[] = [];
  const rc: RenderCtx<VNode> = {
    host, ctx, docs: project.byName, dev: !!opts.dev, spa: config.spa, base: config.base,
    math: makeMathRenderer(config.math, config.katex.macros ?? {}),
    slugs: new Map(), tbodies: new WeakMap(), head: { parent: head, before: null },
    onError: (err, where) => {
      const e = err as { code?: string; message?: string };
      if (err instanceof RangeError && /call stack/.test(err.message)) { e.code = "E023"; e.message = "Page evaluation exceeded the operation limit (stack overflow)"; }
      const file = where.doc.startsWith("builtin:") ? where.doc : project.config.root + "/" + where.doc + ".mark";
      errors.push({ file, line: where.line, col: 0, code: e.code ?? "RT00", message: String(e.message ?? err), severity: "error" });
    },
    islandId: (nodes, inst) => {
      const id = islands.length;
      islands.push({ doc: inst.doc.id, nodes: nodes.map((n) => (n as Compiled).id!), id });
      return id;
    },
  };
  const chain: AnalyzedDoc[] = entry.layoutComponent
    ? [project.byName.get(entry.layoutComponent)!].filter(Boolean)
    : entry.layouts.map((f) => project.byFile.get(f)!).filter(Boolean);
  const pageDoc = project.byFile.get(entry.file)!;
  const owner = new Owner(null);
  runWithOwner(owner, () => {
    const renderChain = (i: number, out: { parent: VNode; before: VNode | null }): void => {
      if (i >= chain.length) { mountDocument(rc, pageDoc, new Map(), null, out); return; }
      const slots: Slots<VNode> = { has: (n) => n === "", render: (n, o) => { if (n === "") renderChain(i + 1, o); } };
      mountDocument(rc, chain[i], new Map(), slots, out);
    };
    renderChain(0, { parent: body, before: null });
  });
  flush();
  owner.dispose();
  const titles = findAll(head, "title");
  const title = titles.length ? textOf(titles[titles.length - 1]) : entry.info.title;
  return { body, head, islands, errors, ctx, title };
}

export function pageHtml(project: Project, entry: PageEntry, r: RenderedPage, opts: BuildOpts): string {
  const config = project.config;
  const host = new BuildHost();
  const titles = findAll(r.head, "title");
  for (const t of titles.slice(0, -1)) host.remove(t);
  const hasCharset = findAll(r.head, "meta").some((m) => m.type === "el" && m.attrs.has("charset"));
  let head = serialize(r.head);
  if (!titles.length) head += `<title${config.spa ? ' data-mk-head="' + escapeHtml(project.byFile.get(entry.file)!.id) + '"' : ""}>${escapeHtml(r.title)}</title>`;
  if (project.css) head += `<link rel="stylesheet" href="${config.base}_mk/mark.css">`;
  if (config.math === "katex" && project.byFile.get(entry.file)?.hasMath) head += `<link rel="stylesheet" href="${config.base}_mk/katex/katex.min.css">`;
  const body = serialize(r.body);
  const script = r.islands.length || config.spa
    ? `<script type="module" src="${config.base}_mk/pages/${pageFileName(entry.info.path)}"></script>`
    : "";
  return `<!doctype html>\n<html lang="${escapeHtml(config.lang)}">\n<head>\n${hasCharset ? "" : '<meta charset="utf-8">\n'}${head}\n</head>\n<body>\n${body}\n${script}${script ? "\n" : ""}</body>\n</html>\n`;
}

/** Build all pages in memory. */
export function buildProject(project: Project, opts: BuildOpts = {}): BuildOutput {
  const config = project.config;
  const files = new Map<string, string>();
  const pages: PageOutput[] = [];
  const diagnostics: Diagnostic[] = [...project.diagnostics];
  const report: string[] = [];
  const emittedDocs = new Set<string>();
  let needsKatex = false;
  let needsRuntime = false;

  const entries: PageEntry[] = [...project.index.entries];
  if (project.index.notFound) {
    const nf = project.byFile.get(project.index.notFound)!;
    const info: PageInfo = { path: "/404", dir: "/", file: project.index.notFound, title: "Not found", tags: [], props: {}, excerpt: "", dynamic: false };
    entries.push({ info, file: project.index.notFound, params: {}, layouts: project.byFile.has("_site.mark") ? ["_site.mark"] : [], draft: false });
    void nf;
  }

  for (const entry of entries) {
    const is404 = entry.info.path === "/404" && entry.file === project.index.notFound;
    const pageObj = is404
      ? { path: "/404", params: {}, query: {}, hash: "", info: undefined, title: "Not found", layouts: entry.layouts }
      : undefined;
    const r = renderPage(project, entry, opts, pageObj);
    diagnostics.push(...r.errors);
    const html = pageHtml(project, entry, r, opts);
    const file = is404 ? "404.html" : entry.info.path === "/" ? "index.html" : entry.info.path.replace(/^\//, "") + "/index.html";
    files.set(file, html);
    pages.push({ path: entry.info.path, file, html, islands: r.islands, errors: r.errors, title: r.title });

    const pageDoc = project.byFile.get(entry.file)!;
    const chainDocs = entry.layoutComponent ? [project.byName.get(entry.layoutComponent)!] : entry.layouts.map((f) => project.byFile.get(f)!);
    const rootDocs = [...chainDocs, pageDoc];
    if (r.islands.length || config.spa) {
      needsRuntime = true;
      const docIds: string[] = [];
      const islandNodes = rootDocs.flatMap((d) => pruneDoc(d, config.spa));
      const fullSpa = config.spa;
      const comps = componentClosure(islandNodes, project.byName);
      const names = new Set<string>();
      for (const d of [...rootDocs, ...comps.values()]) collectNames(pruneDoc(d, config.spa), names);
      for (const d of project.byName.values()) if (names.has(d.name) && d.nodes.some((n) => (n.t === "let" || n.t === "fn") && n.export)) comps.set(d.id, d);
      let needMath = false;
      let needSite = false;
      for (const d of [...rootDocs, ...comps.values()]) {
        const nodes = pruneDoc(d, config.spa);
        if (!nodes.length && !fullSpa) continue;        // nothing dynamic in this document
        docIds.push(d.id);
        if (!emittedDocs.has(d.id)) {
          emittedDocs.add(d.id);
          files.set("_mk/docs/" + docFileName(d.id), emitDocModule(d, nodes));
        }
        if (d.hasMath) needMath = true;
        if (d.usesSite) needSite = true;
      }
      if (needMath) needsKatex = true;
      const depth = entry.info.path === "/" ? 0 : entry.info.path.split("/").length - 2;
      files.set("_mk/pages/" + pageFileName(entry.info.path), emitPageModule({
        depth,
        manifest: { path: entry.info.path, params: entry.params, info: is404 ? null : entry.info, title: entry.info.title, layouts: chainDocs.map((d) => d.id), page: pageDoc.id },
        docIds, islands: r.islands, needSite: needSite || config.spa, needMath,
        base: config.base, spa: config.spa, dev: !!opts.dev, mathMode: config.math, katexMacros: config.katex.macros ?? {},
      }));
    }
    if (opts.islands) {
      report.push(`${entry.info.path}: ${r.islands.length} island${r.islands.length === 1 ? "" : "s"}`);
      for (const isl of r.islands) {
        const d = project.docs.get(isl.doc)!;
        const infos = isl.nodes.map((n) => d.islands.find((x) => x.nodeId === n)).filter(Boolean);
        const causes = [...new Set(infos.flatMap((x) => x!.causes))];
        report.push(`  #${isl.id} ${isl.doc}.mark:${infos[0]?.line ?? "?"} ← ${causes.join(", ")}`);
      }
    }
  }
  if (config.spa) {
    // Client-rendered fallback modules for dynamic routes (S-11, P-14).
    for (const r of project.index.routes) {
      const pageDoc = project.byFile.get(r.file)!;
      const chainDocs = r.layoutComponent ? [project.byName.get(r.layoutComponent)!] : r.layouts.map((f) => project.byFile.get(f)!);
      const rootDocs = [...chainDocs, pageDoc];
      const comps = componentClosure(rootDocs.flatMap((d) => d.nodes), project.byName);
      const docIds: string[] = [];
      let needMath = false;
      for (const d of [...rootDocs, ...comps.values()]) {
        docIds.push(d.id);
        if (!emittedDocs.has(d.id)) { emittedDocs.add(d.id); files.set("_mk/docs/" + docFileName(d.id), emitDocModule(d, d.nodes)); }
        if (d.hasMath) needMath = true;
      }
      if (needMath) needsKatex = true;
      const depth = r.template.split("/").length - 2;
      files.set("_mk/pages/" + pageFileName(r.template), emitPageModule({
        depth,
        manifest: { path: r.template, params: {}, info: null, title: pageDoc.name || r.template, layouts: chainDocs.map((d) => d.id), page: pageDoc.id },
        docIds, islands: [], needSite: true, needMath,
        base: config.base, spa: true, dev: !!opts.dev, mathMode: config.math, katexMacros: config.katex.macros ?? {},
      }));
    }
  }
  if (project.css) files.set("_mk/mark.css", project.css);
  if (needsRuntime || config.spa) {
    const site = JSON.parse(JSON.stringify(project.index.site));
    const specificity = (t: string): number => (t.split("[...").length - 1) * 100 + (t.split("[").length - 1) * 10 - t.split("/").length;
    const routes = {
      pages: project.index.entries.map((e) => ({ path: e.info.path, module: "pages/" + pageFileName(e.info.path) })),
      dynamic: [...project.index.routes].sort((a, b) => specificity(a.template) - specificity(b.template))
        .map((r) => ({ template: r.template, pattern: r.pattern.source, params: r.paramNames, module: "pages/" + pageFileName(r.template) })),
      notFound: project.index.notFound ? "pages/404.js" : null,
    };
    files.set("_mk/site.js", emitSiteModule(site, routes));
  }
  return { files, pages, diagnostics, report, needsKatex, needsRuntime: needsRuntime || config.spa };
}

/** The browser runtime bundle (embedded asset, prebuilt `runtime/runtime.js`, or bundled on the fly during development). */
export async function runtimeSource(): Promise<string> {
  const prebuilt = textAsset("runtime.js", "runtime/runtime.js");
  if (prebuilt) return prebuilt;
  const esbuild = await import("esbuild");
  const r = await esbuild.build({
    entryPoints: [join(pkgDir(), "src", "runtime", "index.ts")], bundle: true, format: "esm", write: false, minify: true, target: "es2022",
  });
  return r.outputFiles[0].text;
}

/** Build a project directory to `config.out`. */
export async function buildDir(projectDir: string, opts: BuildOpts & { config?: Partial<Config> } = {}): Promise<{ project: Project; output: BuildOutput; outDir: string }> {
  const config = loadConfig(projectDir, opts.config);
  const files = loadFiles(projectDir, config);
  const project = compileProject(files, config, { drafts: opts.drafts, dev: opts.dev });
  const output = buildProject(project, opts);
  const outDir = join(projectDir, config.out);
  const ok = !output.diagnostics.some((d) => d.severity === "error");
  if (ok) {
    if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
    mkdirSync(outDir, { recursive: true });
    for (const [rel, content] of output.files) {
      const p = join(outDir, rel);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, content);
    }
    if (output.needsRuntime) writeFileSync(join(outDir, "_mk", "runtime.js"), opts.runtimeJs ?? (await runtimeSource()));
    if (output.needsKatex || (config.math === "katex")) copyKatex(outDir, output.needsKatex, config.math === "katex");
    const staticDir = join(projectDir, "static");
    if (existsSync(staticDir)) cpSync(staticDir, outDir, { recursive: true });
    copyAssets(join(projectDir, config.root), outDir);
  }
  return { project, output, outDir };
}

/** Copy files that sit next to pages (images, video, …) to the same path under `out`, so `site/posts/a/fig.png` serves at `/posts/a/fig.png`. Sources and `components/` are skipped. */
function copyAssets(root: string, outDir: string): void {
  if (!existsSync(root)) return;
  cpSync(root, outDir, {
    recursive: true,
    filter: (src) => {
      const rel = relative(root, src);
      if (rel.split(sep).includes("components")) return false;
      return statSync(src).isDirectory() || !/\.(mark|json|ya?ml)$/.test(src);
    },
  });
}

function copyKatex(outDir: string, js: boolean, css: boolean): void {
  mkdirSync(join(outDir, "_mk"), { recursive: true });
  if (js) writeFileSync(join(outDir, "_mk", "katex.js"), textAsset("katex.mjs", KATEX_DIST + "/katex.mjs") ?? "");
  if (css) {
    mkdirSync(join(outDir, "_mk", "katex", "fonts"), { recursive: true });
    writeFileSync(join(outDir, "_mk", "katex", "katex.min.css"), textAsset("katex.min.css", KATEX_DIST + "/katex.min.css") ?? "");
    for (const f of katexFontNames()) {
      const b = binaryAsset("fonts/" + f, KATEX_DIST + "/fonts/" + f);
      if (b) writeFileSync(join(outDir, "_mk", "katex", "fonts", f), b);
    }
  }
}

export function printDiagnostics(ds: Diagnostic[]): void {
  for (const d of ds) console.error(formatDiagnostic(d));
}

export type { Instance };
