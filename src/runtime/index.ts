// Browser runtime (A-6): hydrates islands by adopting the static DOM, using the
// same interpreter, reactive core and renderer as the build-time evaluator.
import type { Node as MarkNode } from "../ast.ts";
import { makeCtx, type Ctx } from "../core/interp.ts";
import { deepFreeze } from "../core/reactive.ts";
import { type CompiledDoc, type Compiled, type Instance, type MathRenderer, type RenderCtx, type Slots, evalExports, renderInto, setupDocument } from "../core/render.ts";
import { Owner, type Rx, batch, flush, runWithOwner, signal } from "../core/signal.ts";
import { DomHost, Mismatch } from "./dom.ts";

export { signal, computed, effect, flush, batch } from "../core/signal.ts";

export interface DocData extends CompiledDoc {}

export interface Manifest {
  page: { path: string; params: Record<string, string>; info: unknown; title: string; layouts: string[]; page: string };
  docs: Record<string, DocData>;
  islands: { doc: string; nodes: number[]; id: number }[];
  site: { site: Record<string, unknown>; routes: unknown } | null;
  math: { renderToString(tex: string, opts: Record<string, unknown>): string } | null;
  base: string;
  spa: boolean;
  dev: boolean;
  mathMode: string;
  macros: Record<string, string>;
  document?: Document;
  /** Test hook: load a page module (default: dynamic import of `<base>_mk/<module>`). */
  loadPage?: (module: string) => Promise<Manifest>;
}

export interface RuntimeError { code: string; message: string; line: number; doc: string }

export interface App {
  instances: Map<string, Instance<Node>>;
  errors: RuntimeError[];
  mismatches: number;
  rc: RenderCtx<Node>;
  ctx: Ctx;
  Page: Record<string, unknown>;
  flush(): void;
  /** SPA only: navigate and resolve when the new page is rendered. */
  navigate(path: string): Promise<void>;
  /** SPA only: pending navigation started by hydrate (client-rendered fallback route). */
  ready: Promise<void>;
}

export interface PageSignals {
  path: Rx<string>; params: Rx<Record<string, string>>; info: Rx<unknown>; title: Rx<string>; layouts: Rx<string[]>;
}

export function makeSite(json: Record<string, unknown> | null, base: string): Record<string, unknown> {
  const pages = (json?.pages as { path: string }[]) ?? [];
  const site = {
    base, pages, sections: json?.sections ?? {}, nav: json?.nav ?? [], data: json?.data ?? {},
    page: (path: string) => pages.find((p) => p.path === path),
    under: (path: string) => pages.filter((p) => p.path.startsWith(path.replace(/\/$/, "") + "/")),
  };
  return deepFreeze(site);
}

export function makeMath(m: Manifest["math"], mode: string, macros: Record<string, string>): MathRenderer | null {
  if (!m) return null;
  return (tex, display) => {
    try {
      return m.renderToString(tex, { displayMode: display, output: mode === "mathml" ? "mathml" : "htmlAndMathml", throwOnError: true, macros: { ...macros }, strict: "ignore", trust: false });
    } catch {
      const s = document.createElement("span");
      s.className = "mk-math-error";
      s.textContent = tex;
      return s.outerHTML;
    }
  };
}

export function hydrate(m: Manifest): App {
  const doc = m.document ?? document;
  const win = doc.defaultView as (Window & typeof globalThis) | null;
  const errors: RuntimeError[] = [];
  const Site = makeSite(m.site?.site ?? null, m.base);
  if (win) Object.defineProperty(win, "__mark", { value: true, configurable: true, writable: true });
  const sigs: PageSignals = {
    path: signal(m.page.path), params: signal(m.page.params), info: signal(m.page.info), title: signal(m.page.title), layouts: signal(m.page.layouts),
  };
  const Page: Record<string, unknown> = {
    get path() { return m.spa ? sigs.path.get() : m.page.path; },
    set path(p: string) { navigate(p); },
    get params() { return m.spa ? sigs.params.get() : m.page.params; },
    get query() { return Object.fromEntries(new URLSearchParams(win?.location.search ?? "")); },
    get hash() { return win?.location.hash ?? ""; },
    get info() { return m.spa ? sigs.info.get() : m.page.info; },
    get title() { return m.spa ? sigs.title.get() : doc.title; },
    set title(t: string) { doc.title = t; sigs.title.set(t); },
    get layouts() { return m.spa ? sigs.layouts.get() : m.page.layouts; },
    replace: (p: string) => (m.spa ? spa?.navigate(p, { replace: true }) : win?.location.replace(m.base.replace(/\/$/, "") + p)),
    back: () => win?.history.back(),
  };
  const navigate = (p: string): Promise<void> => {
    if (!m.spa || !spa) { win?.location.assign(m.base.replace(/\/$/, "") + p); return Promise.resolve(); }
    return spa.navigate(p, {});
  };
  const ctx = makeCtx({
    client: true, dynamic: true, buildTime: Date.now(), locale: "en-US",
    env: {
      reducedMotion: !!win?.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
      client: true, dev: m.dev, touch: !!win && "ontouchstart" in win,
    },
    intrinsics: {
      next: () => new Promise<void>((r) => queueMicrotask(() => { flush(); r(); })),
      after: (ms) => new Promise<void>((r) => setTimeout(r, ms)),
      measure: (node, rel) => {
        const el = node as Element | null;
        if (!el || !el.isConnected) throw new Error("measure: node is not mounted");
        const r = el.getBoundingClientRect();
        const b = rel ? (rel as Element).getBoundingClientRect() : { left: 0, top: 0 };
        return { x: r.left - b.left, y: r.top - b.top, w: r.width, h: r.height };
      },
    },
    log: (level, args) => console[level](...args),
  });
  const globals: Record<string, unknown> = { Site, Page, Math, JSON, Number, String, Array, Object, Date, Promise, console: {} };
  const docsByName = new Map<string, CompiledDoc>();
  for (const d of Object.values(m.docs)) {
    if (d.kind === "component") docsByName.set(d.name, d);
    if (d.nodes.some((n) => (n.t === "let" || n.t === "fn") && n.export)) {
      let cache: Record<string, unknown> | null = null;
      Object.defineProperty(globals, d.name, { enumerable: true, get: () => (cache ??= evalExports(d, ctx)) });
    }
  }
  ctx.globals = globals;
  const host = new DomHost(doc);
  const rc: RenderCtx<Node> = {
    host, ctx, docs: docsByName, dev: m.dev, spa: m.spa, base: m.base,
    math: makeMath(m.math, m.mathMode, m.macros),
    slugs: new Map(), tbodies: new WeakMap(), head: m.spa ? { parent: doc.head, before: null } : null,
    onError: (err, where) => {
      const e = err as { code?: string; message?: string };
      let code = e.code ?? "RT00";
      if (err instanceof RangeError && /call stack/.test(err.message)) code = "RT03";
      errors.push({ code, message: String(e.message ?? err), line: where.line, doc: where.doc });
      if (m.dev || code === "RT00") console.error(`[mark] ${where.doc}.mark:${where.line} ${code}: ${e.message ?? err}`);
    },
  };

  const instances = new Map<string, Instance<Node>>();
  let mismatches = 0;
  const root = new Owner(null);
  const emptySlots: Slots<Node> = { has: () => false, render: () => {} };
  runWithOwner(root, () => {
    for (const id of [...m.page.layouts, m.page.page]) {
      const d = m.docs[id];
      if (d) instances.set(id, setupDocument(rc, d, id === m.page.page ? null : emptySlots));
    }
  });

  // Locate island anchors.
  const anchors = new Map<string, Comment>();
  const walker = doc.createTreeWalker(doc.documentElement, 128 /* SHOW_COMMENT */);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const c = n as Comment;
    if (/^\/?mk:\d+$/.test(c.data)) anchors.set(c.data, c);
  }
  const nodeIndex = new Map<string, Map<number, MarkNode>>();
  const indexOf = (id: string): Map<number, MarkNode> => {
    let idx = nodeIndex.get(id);
    if (!idx) {
      idx = new Map();
      const visit = (n: MarkNode): void => {
        idx!.set((n as MarkNode & Compiled).id!, n);
        if (n.t === "prose") { for (const p of n.parts) if (p.p === "tag") visit(p.node); }
        else if (n.t === "if") { n.then.forEach(visit); if (n.else) Array.isArray(n.else) ? n.else.forEach(visit) : visit(n.else); }
        else if (n.t === "for") n.body.forEach(visit);
        else if (n.t === "tag" || n.t === "head") n.children.forEach(visit);
      };
      m.docs[id].nodes.forEach(visit);
      nodeIndex.set(id, idx);
    }
    return idx;
  };

  for (const isl of m.islands) {
    const start = anchors.get("mk:" + isl.id), end = anchors.get("/mk:" + isl.id);
    const inst = instances.get(isl.doc);
    if (!start || !end || !inst) { rc.onError(new Error(`island ${isl.id} anchors not found`), { line: 0, doc: isl.doc }); continue; }
    const nodes = isl.nodes.map((n) => indexOf(isl.doc).get(n)!).filter(Boolean);
    const parent = start.parentNode!;
    const attempt = new Owner(inst.owner);
    host.beginAdopt(parent, start.nextSibling);
    try {
      runWithOwner(attempt, () => renderInto(rc, nodes, inst, { parent, before: end }));
      const left = host.endAdopt();
      if (left !== end) throw new Mismatch(`unexpected trailing content before island end (${left ? left.nodeName : "none"})`);
    } catch (err) {
      host.endAdopt();
      if (!(err instanceof Mismatch)) throw err;
      mismatches++;
      if (m.dev) console.warn(`[mark] hydration mismatch in ${isl.doc} island ${isl.id}: ${err.message}; re-rendering`);
      attempt.dispose();
      for (let n = start.nextSibling; n && n !== end;) { const nx = n.nextSibling; n.parentNode!.removeChild(n); n = nx; }
      const retry = new Owner(inst.owner);
      runWithOwner(retry, () => renderInto(rc, nodes, inst, { parent, before: end }));
    }
  }
  flush();
  const app: App = {
    instances, errors, get mismatches() { return mismatches; }, rc, ctx, Page, flush,
    navigate: (p) => navigate(p), ready: Promise.resolve(),
  };
  let spa: Spa | null = null;
  if (m.spa) { spa = startSpa(app, m, sigs, root); app.ready = spa.ready; }
  if (win) Object.defineProperty(win, "__mark", { value: app, configurable: true, writable: true });
  return app;
}

// SPA support (8.6) is attached by ./spa.ts when the page is built with `spa: true`.
import { type Spa, startSpa } from "./spa.ts";
