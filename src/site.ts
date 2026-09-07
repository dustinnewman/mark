// Site indexer (section 8.1, 2.x): routes, layouts, page metadata, Site object.
import type { Document, Expr, Node } from "./ast.ts";
import type { Config } from "./config.ts";
import { MarkError, MSG } from "./diagnostics.ts";
import { deepFreeze } from "./core/reactive.ts";
import { parseMarkdown, plainText } from "./markdown.ts";

export interface PageInfo {
  path: string;
  dir: string;
  file: string;
  title: string;
  section?: string;
  order?: number;
  date?: string;
  tags: string[];
  props: Record<string, unknown>;
  excerpt: string;
  dynamic: boolean;
}
export interface Section { name: string; path: string; pages: PageInfo[] }

export interface SiteIndex {
  base: string;
  pages: PageInfo[];
  sections: Record<string, Section>;
  nav: PageInfo[];
  data: Record<string, unknown>;
  page(path: string): PageInfo | undefined;
  under(path: string): PageInfo[];
}

export interface PageEntry {
  info: PageInfo;
  file: string;               // "blog/[slug].mark"
  params: Record<string, string>;
  layouts: string[];          // layout files, outermost first, e.g. ["_site.mark", "blog/_layout.mark"]
  layoutComponent?: string;   // `layout` prop naming a component
  draft: boolean;
}

export interface RouteInfo {
  file: string;
  template: string;           // "/blog/[slug]"
  pattern: RegExp;
  paramNames: string[];
  layouts: string[];
  layoutComponent?: string;
  hasPaths: boolean;
}

export interface Classified {
  file: string;
  kind: "page" | "layout" | "component" | "notfound";
  name?: string;              // component name
}

/** Classify every `.mark` file under the root (S-2..S-4). */
export function classify(files: string[], errors: MarkError[]): Classified[] {
  const out: Classified[] = [];
  for (const file of files) {
    const parts = file.split("/");
    const base = parts[parts.length - 1].replace(/\.mark$/, "");
    if (parts.slice(0, -1).some((d) => d.startsWith("_"))) continue;
    const compIdx = parts.lastIndexOf("components");
    if (compIdx >= 0) {
      const segs = parts.slice(compIdx + 1);
      segs[segs.length - 1] = base;
      if (!segs.every((s) => /^[A-Z][A-Za-z0-9]*$/.test(s))) {
        errors.push(new MarkError("S004", `Component file \`${file}\` must be named [A-Z][A-Za-z0-9]* (each segment)`, 1, 0, file));
        continue;
      }
      out.push({ file, kind: "component", name: segs.join(".") });
      continue;
    }
    if (base.startsWith("_")) {
      if (base === "_site" && parts.length === 1) out.push({ file, kind: "layout" });
      else if (base === "_layout") out.push({ file, kind: "layout" });
      else if (base === "_404" && parts.length === 1) out.push({ file, kind: "notfound" });
      else errors.push(new MarkError("S002", `\`${file}\`: files starting with _ must be _site.mark, _layout.mark or _404.mark`, 1, 0, file));
      continue;
    }
    out.push({ file, kind: "page" });
  }
  return out;
}

/** Route path for a page file (S-5). */
export function routeOf(file: string): { template: string; dynamic: boolean } {
  const parts = file.replace(/\.mark$/, "").split("/");
  if (parts[parts.length - 1] === "index") parts.pop();
  const template = "/" + parts.join("/");
  return { template: template === "/" ? "/" : template.replace(/\/$/, ""), dynamic: /\[[^\]]+\]/.test(template) };
}

export function routePattern(template: string): { pattern: RegExp; paramNames: string[] } {
  const names: string[] = [];
  const re = template.split("/").map((seg) => {
    let m = /^\[\.\.\.([A-Za-z_][A-Za-z0-9_]*)\]$/.exec(seg);
    if (m) { names.push(m[1]); return "(.+)"; }
    m = /^\[([A-Za-z_][A-Za-z0-9_]*)\]$/.exec(seg);
    if (m) { names.push(m[1]); return "([^/]+)"; }
    return seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }).join("/");
  return { pattern: new RegExp("^" + (re === "" ? "/" : re) + "$"), paramNames: names };
}

/** Layout chain for a page file (S-7). */
export function layoutChain(file: string, layouts: Set<string>): string[] {
  const chain: string[] = [];
  if (layouts.has("_site.mark")) chain.push("_site.mark");
  const dirs = file.split("/").slice(0, -1);
  for (let i = 1; i <= dirs.length; i++) {
    const l = dirs.slice(0, i).join("/") + "/_layout.mark";
    if (layouts.has(l)) chain.push(l);
  }
  return chain;
}

/** Literal value of a page-prop default (P-9) or undefined when not literal. */
export function literalValue(e: Expr): { ok: true; value: unknown } | { ok: false } {
  switch (e.type) {
    case "Literal": return { ok: true, value: e.value };
    case "UnaryExpression": {
      const a = literalValue(e.argument);
      if (!a.ok || typeof a.value !== "number") return { ok: false };
      return { ok: true, value: e.operator === "-" ? -a.value : e.operator === "+" ? +a.value : !a.value };
    }
    case "ArrayExpression": {
      const out: unknown[] = [];
      for (const x of e.elements) { const v = literalValue(x); if (!v.ok) return v; out.push(v.value); }
      return { ok: true, value: out };
    }
    case "ObjectExpression": {
      const out: Record<string, unknown> = {};
      for (const p of e.properties) {
        if (p.shorthand) return { ok: false };
        const v = literalValue(p.value);
        if (!v.ok) return v;
        out[p.key.type === "Identifier" ? p.key.name : String((p.key as { value: unknown }).value)] = v.value;
      }
      return { ok: true, value: out };
    }
  }
  return { ok: false };
}

/** Page props (front matter) of a document. Non-literal defaults are reported as E010. */
export function pageProps(ast: Document, file: string, errors: MarkError[]): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  let sawContent = false;
  for (const n of ast) {
    if (n.t === "prop") {
      if (sawContent) errors.push(new MarkError("E010", `Page prop \`${n.name}\` must appear before any prose or tag`, n.line, 0, file));
      if (!n.init) { errors.push(new MarkError("E010", MSG.E010(n.name), n.line, 0, file)); continue; }
      const v = literalValue(n.init);
      if (!v.ok) { errors.push(new MarkError("E010", MSG.E010(n.name), n.line, 0, file)); continue; }
      props[n.name] = v.value;
    } else if (n.t === "prose" || n.t === "tag" || n.t === "if" || n.t === "for" || n.t === "head") sawContent = true;
  }
  return props;
}

export function excerptOf(ast: Document): string {
  for (const n of ast) {
    if (n.t !== "prose") continue;
    const tree = parseMarkdown(n.md, n.parts);
    for (const h of tree) if (h.k === "el" && h.tag === "p") return plainText(h.children).replace(/\s+/g, " ").trim();
  }
  return "";
}

const titleCase = (s: string): string => s.replace(/[-_]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());

export function derivedTitle(file: string): string {
  const parts = file.replace(/\.mark$/, "").split("/");
  const stem = parts[parts.length - 1];
  if (stem === "index") return parts.length > 1 ? titleCase(parts[parts.length - 2]) : "Home";
  return titleCase(stem);
}

export interface IndexInput {
  file: string;
  ast: Document;
}

export interface IndexResult {
  entries: PageEntry[];         // emitted pages (drafts excluded unless allowed)
  routes: RouteInfo[];          // dynamic route table (SPA fallback)
  notFound: string | null;
  site: SiteIndex;
}

export function buildIndex(pages: IndexInput[], layoutFiles: string[], notFound: string | null, data: Record<string, unknown>, config: Config, opts: { drafts?: boolean }, errors: MarkError[]): IndexResult {
  const layouts = new Set(layoutFiles);
  const entries: PageEntry[] = [];
  const routes: RouteInfo[] = [];
  const byPath = new Map<string, string>();
  const infos: PageInfo[] = [];

  for (const { file, ast } of pages) {
    const props = pageProps(ast, file, errors);
    const { template, dynamic } = routeOf(file);
    const draft = props.draft === true;
    const chain = props.layout === false ? [] : typeof props.layout === "string" ? [] : layoutChain(file, layouts);
    const layoutComponent = typeof props.layout === "string" ? props.layout : undefined;
    const excerpt = excerptOf(ast);
    const base = (path: string, extra: Record<string, unknown> = {}): PageInfo => {
      const merged = { ...props, ...extra };
      const info: PageInfo = {
        path,
        dir: path.slice(0, path.lastIndexOf("/")) || "/",
        file,
        title: typeof merged.title === "string" ? merged.title : derivedTitle(file),
        tags: Array.isArray(merged.tags) ? (merged.tags as string[]) : [],
        props: merged,
        excerpt,
        dynamic,
      };
      if (typeof merged.section === "string") info.section = merged.section;
      if (typeof merged.order === "number") info.order = merged.order;
      if (typeof merged.date === "string") info.date = merged.date;
      return info;
    };
    const register = (info: PageInfo, params: Record<string, string>): void => {
      const prev = byPath.get(info.path);
      if (prev) { errors.push(new MarkError("E011", MSG.E011(info.path, prev, file), 1, 0, file)); return; }
      byPath.set(info.path, file);
      if (draft && !opts.drafts) return;
      infos.push(info);
      entries.push({ info, file, params, layouts: chain, layoutComponent, draft });
    };
    if (!dynamic) { register(base(template), {}); continue; }
    const { pattern, paramNames } = routePattern(template);
    const paths = props.paths;
    routes.push({ file, template, pattern, paramNames, layouts: chain, layoutComponent, hasPaths: Array.isArray(paths) });
    if (Array.isArray(paths)) {
      for (const p of paths) {
        if (typeof p !== "object" || p === null) continue;
        const params: Record<string, string> = {};
        for (const k of Object.keys(p)) params[k] = String((p as Record<string, unknown>)[k]);
        let path = template;
        for (const name of paramNames) path = path.replace(`[...${name}]`, params[name] ?? "").replace(`[${name}]`, params[name] ?? "");
        register(base(path, p as Record<string, unknown>), params);
      }
    } else if (config.spa) {
      const info = base(template);
      if (!(draft && !opts.drafts)) infos.push(info);
    } else {
      errors.push(new MarkError("E024", MSG.E024(file), 1, 0, file));
    }
  }

  infos.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const sections: Record<string, Section> = {};
  for (const p of infos) {
    if (!p.section) continue;
    (sections[p.section] ??= { name: p.section, path: "", pages: [] }).pages.push(p);
  }
  for (const s of Object.values(sections)) {
    const dirs = new Set(s.pages.map((p) => p.dir));
    s.path = dirs.size === 1 ? [...dirs][0] : s.pages.map((p) => p.path).reduce((a, b) => (b.length < a.length ? b : a));
  }
  const nav = infos.filter((p) => p.order !== undefined).sort((a, b) => (a.order! - b.order!) || (a.title < b.title ? -1 : a.title > b.title ? 1 : 0));
  const site: SiteIndex = {
    base: config.base,
    pages: infos,
    sections,
    nav,
    data,
    page: (path: string) => infos.find((p) => p.path === path),
    under: (path: string) => infos.filter((p) => p.path.startsWith(path.replace(/\/$/, "") + "/")),
  };
  deepFreeze(site);
  return { entries, routes, notFound, site };
}

// ---------------------------------------------------------------- data files

export function parseDataFile(name: string, src: string): unknown {
  if (name.endsWith(".json")) return JSON.parse(src);
  if (name.endsWith(".yaml") || name.endsWith(".yml")) return parseYaml(src);
  return undefined;
}

/** A small YAML subset: block mappings/sequences, scalars, flow collections via JSON, comments. */
export function parseYaml(src: string): unknown {
  const lines = src.replace(/\r\n?/g, "\n").split("\n")
    .map((l) => l.replace(/\s+#.*$/, "").replace(/^#.*$/, ""))
    .filter((l) => l.trim() !== "");
  let i = 0;
  const indent = (l: string): number => l.length - l.trimStart().length;
  function scalar(s: string): unknown {
    s = s.trim();
    if (s === "" || s === "~" || s === "null") return null;
    if (s === "true") return true;
    if (s === "false") return false;
    if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(s)) return Number(s);
    if ((s.startsWith('"') && s.endsWith('"'))) return JSON.parse(s);
    if (s.startsWith("'") && s.endsWith("'")) return s.slice(1, -1).replace(/''/g, "'");
    if (s.startsWith("[") || s.startsWith("{")) { try { return JSON.parse(s); } catch { return s; } }
    return s;
  }
  function block(level: number): unknown {
    if (i >= lines.length) return null;
    const first = lines[i];
    if (indent(first) < level) return null;
    if (first.trimStart().startsWith("- ")) {
      const out: unknown[] = [];
      const lvl = indent(first);
      while (i < lines.length && indent(lines[i]) === lvl && lines[i].trimStart().startsWith("- ")) {
        const rest = lines[i].trimStart().slice(2);
        if (/^[^:\s"'[{]+:\s*(.*)$/.test(rest) || /^[^:]+:$/.test(rest)) {
          // inline mapping start inside a sequence item
          lines[i] = " ".repeat(lvl + 2) + rest;
          out.push(block(lvl + 2));
        } else if (rest.trim() === "") { i++; out.push(block(lvl + 1)); }
        else { i++; out.push(scalar(rest)); }
      }
      return out;
    }
    const obj: Record<string, unknown> = {};
    const lvl = indent(first);
    while (i < lines.length && indent(lines[i]) === lvl && !lines[i].trimStart().startsWith("- ")) {
      const m = /^([^:]+?):\s*(.*)$/.exec(lines[i].trim());
      if (!m) throw new Error(`YAML: cannot parse line: ${lines[i]}`);
      const key = m[1].replace(/^["']|["']$/g, "");
      i++;
      if (m[2] === "") obj[key] = i < lines.length && indent(lines[i]) > lvl ? block(indent(lines[i])) : null;
      else if (m[2] === "|" || m[2] === ">") {
        const buf: string[] = [];
        while (i < lines.length && indent(lines[i]) > lvl) buf.push(lines[i].trim()), i++;
        obj[key] = buf.join(m[2] === "|" ? "\n" : " ");
      } else obj[key] = scalar(m[2]);
    }
    return obj;
  }
  return block(0);
}

/** Collect data files from the project file map (`_data/*.json|yaml`). */
export function loadData(files: Map<string, string>): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const [path, src] of files) {
    const m = /^_data\/([^/]+)\.(json|ya?ml)$/.exec(path);
    if (m) data[m[1]] = parseDataFile(path, src);
  }
  return data;
}

export const isContentNode = (n: Node): boolean => n.t === "prose" || n.t === "tag" || n.t === "if" || n.t === "for" || n.t === "head";
