// Runtime test harness (15.3): builds a project in memory, mounts a page in jsdom
// and hydrates it with the real runtime and the real emitted document modules.
import { JSDOM } from "jsdom";
import katex from "katex";
import { buildProject, type BuildOutput } from "../src/build.ts";
import { compileProject } from "../src/compile.ts";
import { toRaw } from "../src/core/reactive.ts";
import { hydrate, type App, type Manifest } from "../src/runtime/index.ts";
import { configOf, filesOf, normalizeHtml } from "./tiers.ts";

const tick = async (): Promise<void> => { await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0)); };

/** `export default {...};` module text -> value (the emitted modules are pure data). */
const loadModule = (src: string): unknown => JSON.parse(src.replace(/^export default /, "").replace(/;\s*$/, ""));

export interface Mounted { app: App; dom: JSDOM; window: Window & typeof globalThis; document: Document; pageDoc: string }

function manifestFromModule(output: BuildOutput, moduleFile: string): { page: Manifest["page"]; docs: Record<string, Manifest["docs"][string]>; needMath: boolean } | null {
  const src = output.files.get(moduleFile);
  if (!src) return null;
  const m = /page: (\{.*?\}),\n/.exec(src);
  const docs: Record<string, Manifest["docs"][string]> = {};
  for (const [, id] of src.matchAll(/import d\d+ from "(?:\.\.\/)+docs\/(.+?)\.js";/g)) {
    const d = loadModule(output.files.get("_mk/docs/" + id + ".js")!) as Manifest["docs"][string];
    docs[d.id] = d;
  }
  return { page: JSON.parse(m![1]), docs, needMath: src.includes("katex.js") };
}

export async function mount(output: BuildOutput, path: string, spa: boolean, base = "/"): Promise<Mounted> {
  let page = output.pages.find((p) => p.path === path);
  if (!page && spa) page = output.pages.find((p) => p.file === "404.html");
  if (!page) throw new Error(`no page at ${path} (have ${output.pages.map((p) => p.path).join(", ")})`);
  const dom = new JSDOM(page.html, { url: "http://localhost" + path, pretendToBeVisual: true });
  const window = dom.window as unknown as Window & typeof globalThis;
  // Expose DOM classes used by the runtime's host-object checks.
  for (const k of ["Node", "Element", "HTMLElement", "Text", "Comment", "Event", "KeyboardEvent", "MouseEvent", "MutationObserver"]) {
    (globalThis as Record<string, unknown>)[k] = (window as unknown as Record<string, unknown>)[k];
  }
  window.scrollTo = () => {};
  // jsdom has no layout: derive rects from inline width/height so `measure` is testable.
  window.Element.prototype.getBoundingClientRect = function (this: Element) {
    const w = parseFloat((this as HTMLElement).style?.width || "0") || 0;
    const h = parseFloat((this as HTMLElement).style?.height || "0") || 0;
    return { x: 0, y: 0, left: 0, top: 0, right: w, bottom: h, width: w, height: h, toJSON: () => ({}) } as DOMRect;
  };
  const moduleFile = "_mk/pages/" + (page.path === "/" ? "index" : page.path.slice(1)) + ".js";
  const parsed = manifestFromModule(output, moduleFile);
  const siteMod = output.files.get("_mk/site.js");
  const site = siteMod ? (loadModule(siteMod) as Manifest["site"]) : null;
  const common = { site, math: katex, base, spa, dev: true, mathMode: "mathml", macros: {} };
  const manifest: Manifest = {
    ...common,
    page: parsed?.page ?? { path, params: {}, info: null, title: "", layouts: [], page: "" },
    docs: parsed?.docs ?? {},
    islands: page.islands,
    math: parsed?.needMath ? katex : null,
    document: window.document,
    loadPage: async (module) => {
      const p = manifestFromModule(output, "_mk/" + module);
      if (!p) throw new Error("no module " + module);
      return { ...common, page: p.page, docs: p.docs, islands: [], math: p.needMath ? katex : null, document: window.document };
    },
  };
  const app = hydrate(manifest);
  await app.ready;
  return { app, dom, window, document: window.document, pageDoc: manifest.page.page };
}

export async function runRun(t: any): Promise<string | null> {
  const config = configOf(t);
  const project = compileProject(filesOf(t), config, { drafts: !!t.drafts });
  const output = project.hasErrors ? null : buildProject(project, {});
  const diags = (output ? output.diagnostics : project.diagnostics).filter((d) => d.severity === "error");
  if (t.error) return diags.some((d) => d.code === t.error) ? null : `expected ${t.error}, got [${diags.map((d) => d.code + "@" + d.file + ":" + d.line).join(", ")}]`;
  if (diags.length || !output) return `compile errors: ${diags.map((d) => `${d.code}@${d.file}:${d.line} ${d.message}`).join("; ")}`;

  let m = await mount(output, t.path ?? "/", !!config.spa, config.base);
  const history0 = m.window.history.length;
  const marks = new Map<string, Node>();
  let mutations = 0;
  let observer: MutationObserver | null = null;
  const q = (sel: string, nth = 0): Element | null => m.document.querySelectorAll(sel)[nth] ?? null;
  const need = (sel: string, nth = 0): Element => { const el = q(sel, nth); if (!el) throw new Error(`no element ${sel}`); return el; };
  const html = (el: Element): string => normalizeHtml(el.innerHTML.replace(/<!--[\s\S]*?-->/g, ""));
  const settle = async (): Promise<void> => { m.app.flush(); await tick(); };

  for (const [i, step] of (t.steps as any[]).entries()) {
    const fail = (msg: string): string => `step ${i} ${JSON.stringify(step)}: ${msg}`;
    try {
      if ("click" in step) { need(step.click, step.nth).dispatchEvent(new m.window.MouseEvent("click", { bubbles: true, cancelable: true })); await settle(); }
      else if ("input" in step) { const el = need(step.input, step.nth) as HTMLInputElement; el.value = step.value; el.dispatchEvent(new m.window.Event("input", { bubbles: true })); await settle(); }
      else if ("change" in step) { need(step.change, step.nth).dispatchEvent(new m.window.Event("change", { bubbles: true })); await settle(); }
      else if ("keydown" in step) { need(step.keydown, step.nth).dispatchEvent(new m.window.KeyboardEvent("keydown", { key: step.key, bubbles: true })); await settle(); }
      else if ("mouseenter" in step) { need(step.mouseenter, step.nth).dispatchEvent(new m.window.MouseEvent("mouseenter")); await settle(); }
      else if ("mouseleave" in step) { need(step.mouseleave, step.nth).dispatchEvent(new m.window.MouseEvent("mouseleave")); await settle(); }
      else if ("wait" in step) { await new Promise((r) => setTimeout(r, step.wait)); await settle(); }
      else if ("navigate" in step) {
        if (config.spa) { await m.app.navigate(step.navigate); await settle(); }
        else { observer?.disconnect(); m = await mount(output, step.navigate, false, config.base); }
      }
      else if ("expectPath" in step) { if (m.window.location.pathname !== step.expectPath) return fail(`path: expected ${step.expectPath} got ${m.window.location.pathname}`); }
      else if ("expectHistoryGrew" in step) { if (m.window.history.length - history0 !== step.expectHistoryGrew) return fail(`history grew by ${m.window.history.length - history0}, expected ${step.expectHistoryGrew}`); }
      else if ("expectHead" in step) {
        for (const [sel, want] of Object.entries(step.expectHead as Record<string, boolean>)) {
          const has = !!m.document.head.querySelector(sel);
          if (has !== want) return fail(`head ${sel}: expected ${want ? "present" : "absent"}`);
        }
      }
      else if ("expectSpaPage" in step) { const p = m.app.Page as { path: string }; if (p.path !== step.expectSpaPage) return fail(`Page.path: expected ${step.expectSpaPage} got ${p.path}`); }
      else if ("observe" in step) { mutations = 0; observer?.disconnect(); observer = new m.window.MutationObserver((recs) => { mutations += recs.length; }); observer.observe(need(step.observe), { characterData: true, childList: true, subtree: true }); }
      else if ("expectMutations" in step) { await tick(); if (mutations !== step.expectMutations) return fail(`expected ${step.expectMutations} mutations, got ${mutations}`); }
      else if ("mark" in step) marks.set(step.as, need(step.mark, step.nth));
      else if ("click" in step) {}
      else if ("same" in step) { if (marks.get(step.as) !== need(step.same, step.nth)) return fail(`node identity changed for ${step.same}`); }
      else if ("expect" in step) {
        for (const [sel, want] of Object.entries(step.expect as Record<string, string | null>)) {
          const el = q(sel);
          if (want === null) { if (el) return fail(`${sel} should be absent, got ${html(el)}`); continue; }
          if (!el) return fail(`${sel} not found`);
          if (html(el) !== normalizeHtml(want)) return fail(`${sel}\n      expected: ${normalizeHtml(want)}\n      got:      ${html(el)}`);
        }
      }
      else if ("expectText" in step) {
        for (const [sel, want] of Object.entries(step.expectText as Record<string, string[]>)) {
          const got = Array.from(m.document.querySelectorAll(sel)).map((e) => e.textContent!.trim());
          if (JSON.stringify(got) !== JSON.stringify(want)) return fail(`${sel} texts: expected ${JSON.stringify(want)} got ${JSON.stringify(got)}`);
        }
      }
      else if ("expectAttr" in step) {
        for (const [sel, attrs] of Object.entries(step.expectAttr as Record<string, Record<string, string | null>>)) {
          const el = need(sel);
          for (const [a, v] of Object.entries(attrs)) if (el.getAttribute(a) !== v) return fail(`${sel}[${a}]: expected ${JSON.stringify(v)} got ${JSON.stringify(el.getAttribute(a))}`);
        }
      }
      else if ("expectCount" in step) {
        for (const [sel, n] of Object.entries(step.expectCount as Record<string, number>)) {
          const got = m.document.querySelectorAll(sel).length;
          if (got !== n) return fail(`${sel}: expected ${n} elements, got ${got}`);
        }
      }
      else if ("expectStyle" in step) {
        for (const [sel, props] of Object.entries(step.expectStyle as Record<string, Record<string, string>>)) {
          const cs = m.window.getComputedStyle(need(sel));
          for (const [p, v] of Object.entries(props)) if (cs.getPropertyValue(p) !== v) return fail(`${sel} computed ${p}: expected ${v} got ${cs.getPropertyValue(p)}`);
        }
      }
      else if ("expectTitle" in step) { if (m.document.title !== step.expectTitle) return fail(`title: expected ${step.expectTitle} got ${m.document.title}`); }
      else if ("expectMismatches" in step) { if (m.app.mismatches !== step.expectMismatches) return fail(`expected ${step.expectMismatches} hydration mismatches, got ${m.app.mismatches}`); }
      else if ("expectBody" in step) { if (!html(m.document.body).includes(normalizeHtml(step.expectBody))) return fail(`body does not contain ${step.expectBody}\n      got: ${html(m.document.body)}`); }
      else if ("get" in step) {
        const inst = m.app.instances.get(m.pageDoc);
        for (const [name, want] of Object.entries(step.get as Record<string, unknown>)) {
          const cell = inst?.scope.lookup(name);
          if (!cell) return fail(`no top-level ${name}`);
          const got = JSON.parse(JSON.stringify(toRaw(cell.get()) ?? null));
          if (JSON.stringify(got) !== JSON.stringify(want)) return fail(`${name}: expected ${JSON.stringify(want)} got ${JSON.stringify(got)}`);
        }
      }
      else if ("expectErrors" in step) {
        const got = m.app.errors.map((e) => e.code);
        if (JSON.stringify(got) !== JSON.stringify(step.expectErrors)) return fail(`errors: expected ${JSON.stringify(step.expectErrors)} got ${JSON.stringify(got)} ${m.app.errors.map((e) => e.message).join("; ")}`);
      }
      else if ("expectSite" in step) {
        const site = m.app.ctx.globals.Site as Record<string, unknown>;
        for (const [expr, want] of Object.entries(step.expectSite as Record<string, unknown>)) {
          const got = JSON.parse(JSON.stringify(new Function("Site", "return " + expr)(site) ?? null));
          if (JSON.stringify(got) !== JSON.stringify(want)) return fail(`Site ${expr}: expected ${JSON.stringify(want)} got ${JSON.stringify(got)}`);
        }
      }
      else return fail("unknown step");
    } catch (e) {
      return fail(`threw ${(e as Error).stack}`);
    }
  }
  observer?.disconnect();
  return null;
}
