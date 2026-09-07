// SPA mode (8.6): client-side navigation with layout-chain diffing (P-6, P-7, P-14).
import type { Instance, Slots } from "../core/render.ts";
import { mountDocument, renderHeadOf } from "../core/render.ts";
import { Owner, batch, flush, runWithOwner } from "../core/signal.ts";
import type { App, Manifest, PageSignals } from "./index.ts";

export interface Spa {
  navigate(path: string, opts: { replace?: boolean; push?: boolean }): Promise<void>;
  ready: Promise<void>;
}

interface Routes {
  pages: { path: string; module: string }[];
  dynamic: { template: string; pattern: string; params: string[]; module: string }[];
  notFound: string | null;
}

interface Entry { id: string; inst: Instance<Node> | null; heads: Owner | null }

export function startSpa(app: App, m: Manifest, sigs: PageSignals, root: Owner): Spa {
  const doc = m.document ?? document;
  const win = doc.defaultView as (Window & typeof globalThis);
  const routes = (m.site?.routes ?? { pages: [], dynamic: [], notFound: null }) as Routes;
  const base = m.base.replace(/\/$/, "");
  const stripBase = (p: string): string => (base && p.startsWith(base) ? p.slice(base.length) || "/" : p);
  let chain: Entry[] = [...m.page.layouts, m.page.page].map((id) => ({ id, inst: app.instances.get(id) ?? null, heads: null }));
  let current = m.page;
  let pending: Promise<void> = Promise.resolve();

  const loadPage = (module: string): Promise<Manifest> =>
    m.loadPage ? m.loadPage(module) : import(/* @vite-ignore */ `${base}/_mk/${module}`).then((x) => x.default as Manifest);

  function resolve(path: string): { module: string; params: Record<string, string> } | null {
    const p = routes.pages.find((x) => x.path === path);
    if (p) return { module: p.module, params: {} };
    for (const d of routes.dynamic) {
      const mt = new RegExp(d.pattern).exec(path);
      if (!mt) continue;
      const params: Record<string, string> = {};
      d.params.forEach((n, i) => { params[n] = decodeURIComponent(mt[i + 1]); });
      return { module: d.module, params };
    }
    return null;
  }

  /** Anchor pair of the `depth`-th layout slot in document order. */
  function slotRange(depth: number): [Comment, Comment] | null {
    const walker = doc.createTreeWalker(doc.body, 128);
    let seen = 0;
    let start: Comment | null = null;
    let level = 0;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const c = n as Comment;
      if (c.data === "mk:slot") {
        if (!start) { if (seen === depth) { start = c; level = 0; } seen++; }
        else level++;
      } else if (c.data === "/mk:slot" && start) {
        if (level === 0) return [start, c];
        level--;
      }
    }
    return null;
  }

  function removeHead(id: string): void {
    for (const el of Array.from(doc.head.querySelectorAll(`[data-mk-head="${id}"]`))) el.remove();
  }

  function fixTitle(fallback: string): void {
    const titles = Array.from(doc.head.querySelectorAll("title"));
    const stamped = titles.filter((t) => t.hasAttribute("data-mk-head"));
    const keep = stamped.length ? stamped[stamped.length - 1] : titles[titles.length - 1];
    for (const t of titles) if (t !== keep) t.remove();
    if (!keep) doc.title = fallback;
  }

  async function navigate(path: string, opts: { replace?: boolean; push?: boolean } = {}): Promise<void> {
    const target = resolve(path) ?? (routes.notFound ? { module: routes.notFound, params: {} } : null);
    if (!target) { win.location.assign(base + path); return; }
    let man: Manifest;
    try { man = await loadPage(target.module); }
    catch (e) { console.error("[mark] failed to load page module", target.module, e); win.location.assign(base + path); return; }
    for (const [id, d] of Object.entries(man.docs)) {
      if (m.docs[id]) continue;
      m.docs[id] = d;
      if (d.kind === "component") app.rc.docs.set(d.name, d);
    }
    const layouts = man.page.layouts;
    let k = 0;
    while (k < chain.length - 1 && k < layouts.length && chain[k].id === layouts[k]) k++;
    const dropped = chain.slice(k);
    const kept = chain.slice(0, k);
    for (const e of dropped.reverse()) { e.inst?.owner.dispose(); e.heads?.dispose(); removeHead(e.id); }
    let parent: Node, before: Node | null;
    if (k === 0) { doc.body.replaceChildren(); parent = doc.body; before = null; }
    else {
      const r = slotRange(k - 1);
      if (!r) { win.location.assign(base + path); return; }
      for (let n = r[0].nextSibling; n && n !== r[1];) { const nx = n.nextSibling; n.parentNode!.removeChild(n); n = nx; }
      parent = r[0].parentNode!;
      before = r[1];
    }
    current = { ...man.page, path, params: target.params && Object.keys(target.params).length ? target.params : man.page.params };
    batch(() => {
      sigs.path.set(current.path);
      sigs.params.set(current.params);
      sigs.info.set(current.info);
      sigs.layouts.set(current.layouts);
      sigs.title.set(current.title);
    });
    chain = kept;
    runWithOwner(root, () => renderChain(k, { parent, before }));
    for (const e of kept) {
      e.heads?.dispose();
      removeHead(e.id);
      if (e.inst) { e.heads = new Owner(root); runWithOwner(e.heads, () => renderHeadOf(app.rc, e.inst!)); }
    }
    fixTitle(current.title);
    flush();
    if (opts.replace) win.history.replaceState({}, "", base + path);
    else if (opts.push !== false) win.history.pushState({}, "", base + path);
    win.scrollTo?.(0, 0);
    app.instances.clear();
    for (const e of chain) if (e.inst) app.instances.set(e.id, e.inst);
  }

  function renderChain(i: number, out: { parent: Node; before: Node | null }): void {
    const ids = current.layouts;
    if (i >= ids.length) {
      const entry: Entry = { id: current.page, inst: null, heads: null };
      chain.push(entry);
      entry.inst = mountDocument(app.rc, m.docs[current.page], new Map(), null, out);
      return;
    }
    const entry: Entry = { id: ids[i], inst: null, heads: null };
    chain.push(entry);
    const slots: Slots<Node> = { has: (n) => n === "", render: (n, o) => { if (n === "") renderChain(i + 1, o); } };
    entry.inst = mountDocument(app.rc, m.docs[ids[i]], new Map(), slots, out);
  }

  const queue = (path: string, opts: { replace?: boolean; push?: boolean }): Promise<void> => {
    pending = pending.then(() => navigate(path, opts)).catch((e) => { console.error("[mark] navigation failed", e); });
    return pending;
  };

  // P-6: intercept same-origin left clicks on <a href>.
  doc.addEventListener("click", (e: MouseEvent) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
    if (!a || a.target === "_blank" || a.hasAttribute("download") || a.hasAttribute("native")) return;
    const url = new URL(a.getAttribute("href")!, win.location.href);
    if (url.origin !== win.location.origin) return;
    if (base && !(url.pathname === base || url.pathname.startsWith(base + "/"))) return;
    e.preventDefault();
    void queue(stripBase(url.pathname), {});
  });
  win.addEventListener("popstate", () => { void queue(stripBase(win.location.pathname), { push: false }); });

  const here = stripBase(win.location.pathname);
  const ready = here !== m.page.path ? queue(here, { replace: true }) : Promise.resolve();
  return { navigate: queue, ready };
}
