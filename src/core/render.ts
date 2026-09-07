// Shared renderer: walks a document AST and drives a Host (virtual tree at build
// time, real DOM in the browser). Reactivity comes from effects created per
// attribute / interpolation / block (R-2).
import type { Attr, Expr, ForNode, IfNode, Node, ProseNode, TagNode } from "../ast.ts";
import { PH, PLACEHOLDER_RE } from "../ast.ts";
import { attrValue, fmt, escapeHtml } from "./host.ts";
import { type Cell, type Ctx, Scope, constCell, drive, evalExpr, evalGen, makeFunction } from "./interp.ts";
import { reactive, toRaw } from "./reactive.ts";
import { Owner, Rx, batch, computed, effect, getOwner, onCleanup, runWithOwner, signal, untrack } from "./signal.ts";
import { type HNode, isList } from "./tree.ts";

// ---------------------------------------------------------------- host

export interface Host<N> {
  el(tag: string): N;
  text(s: string): N;
  /** Comment node. `marker` comments are runtime anchors, dropped outside islands at build. */
  comment(s: string, marker: boolean): N;
  /** A single element parsed from raw HTML (math output). */
  html(html: string): N;
  setAttr(n: N, name: string, value: string | null): void;
  setProp(n: N, name: string, value: unknown): void;
  setText(n: N, s: string): void;
  insert(parent: N, n: N, before: N | null): void;
  remove(n: N): void;
  next(n: N): N | null;
  first(n: N): N | null;
  /** Begin/end rendering the children of `n` (adoption cursor in the browser). */
  enter(n: N): void;
  exit(n: N): void;
  tagOf(n: N): string;
  listen(n: N, event: string, fn: (e: unknown) => void): () => void;
  /** Called after a node is in the tree (ref / onMount). */
  isMounted?(n: N): boolean;
}

export interface Out<N> { parent: N; before: N | null }

// ---------------------------------------------------------------- compiled documents

export interface CompiledDoc {
  id: string;                                 // "components/Nav" | "_site" | "blog/index" | "builtin:Slider"
  name: string;                               // component name ("post.Card"), "" for pages/layouts
  kind: "page" | "layout" | "component";
  nodes: Node[];
  props: string[];
  stamp: string | null;                       // data-mk-X attribute when the doc has a scoped <style>
  exports?: Record<string, unknown>;
}

/** Internal fields attached to AST nodes by the compiler. */
export interface Compiled {
  id?: number;
  tree?: HNode[];
  island?: true;
}

export type PropInput =
  | { k: "static"; value: unknown }
  | { k: "dyn"; get: () => unknown }
  | { k: "bind"; get: () => unknown; set: (v: unknown) => void }
  | { k: "fn"; value: Function };

export interface Slots<N> { render(name: string, out: Out<N>): void; has(name: string): boolean }

export interface Instance<N> {
  doc: CompiledDoc;
  scope: Scope;
  owner: Owner;
  props: Map<string, Cell>;
  bound: Set<string>;
  slots: Slots<N> | null;
}

export interface MathRenderer { (tex: string, display: boolean): string }

export interface RenderCtx<N> {
  host: Host<N>;
  ctx: Ctx;
  docs: Map<string, CompiledDoc>;          // by component name
  dev: boolean;
  spa: boolean;
  base: string;
  math: MathRenderer | null;
  slugs: Map<string, number>;
  tbodies: WeakMap<object, N>;
  head: Out<N> | null;
  onError(err: unknown, where: { line: number; doc: string }): void;
  /** Build only: returns an island id when `node` starts an island. */
  islandId?(nodes: Node[], inst: Instance<N>): number | null;
}

// ---------------------------------------------------------------- documents

export function mountDocument<N>(
  rc: RenderCtx<N>, doc: CompiledDoc, inputs: Map<string, PropInput>, slots: Slots<N> | null, out: Out<N>, parentScope: Scope | null = null,
): Instance<N> {
  const owner = new Owner(getOwner());
  const inst: Instance<N> = { doc, scope: new Scope(parentScope), owner, props: new Map(), bound: new Set(), slots };
  runWithOwner(owner, () => renderItems(rc, doc.nodes, inst, out, inputs));
  return inst;
}

/** Create an instance and run its declarations only (hydration renders islands separately). */
export function setupDocument<N>(rc: RenderCtx<N>, doc: CompiledDoc, slots: Slots<N> | null): Instance<N> {
  const owner = new Owner(getOwner());
  const inst: Instance<N> = { doc, scope: new Scope(null), owner, props: new Map(), bound: new Set(), slots };
  const decls = doc.nodes.filter((n) => n.t === "var" || n.t === "let" || n.t === "fn" || n.t === "prop");
  runWithOwner(owner, () => renderItems(rc, decls, inst, { parent: null as unknown as N, before: null }, new Map()));
  return inst;
}

/** Render nodes of an existing instance (used for islands). */
export function renderInto<N>(rc: RenderCtx<N>, nodes: Node[], inst: Instance<N>, out: Out<N>): void {
  runWithOwner(inst.owner, () => { for (const n of nodes) renderNodeInner(rc, n, inst, out); });
}

/** T-21: exports evaluate once at module load in a scope without props or vars. */
export function evalExports(doc: CompiledDoc, ctx: Ctx): Record<string, unknown> {
  const scope = new Scope(null);
  const out: Record<string, unknown> = {};
  for (const n of doc.nodes) {
    if (n.t === "fn") {
      const f = makeFunction(n.params, n.body, scope, ctx, n.async, n.name);
      scope.define(n.name, constCell(f));
      if (n.export) out[n.name] = f;
    } else if (n.t === "let") {
      const v = evalExpr(n.init, scope, ctx);
      scope.define(n.name, constCell(v));
      if (n.export) out[n.name] = v;
    }
  }
  return Object.freeze(out);
}

/** Browsers wrap bare <tr>s in an implicit <tbody>; render into one so build and DOM agree. */
function tableBody<N>(rc: RenderCtx<N>, inst: Instance<N>, out: Out<N>): Out<N> {
  const h = rc.host;
  if (!out.parent || h.tagOf(out.parent) !== "table") return out;
  let tb = rc.tbodies.get(out.parent as object);
  if (!tb) {
    tb = h.el("tbody");
    if (inst.doc.stamp) h.setAttr(tb, inst.doc.stamp, "");
    h.insert(out.parent, tb, out.before);
    h.enter(tb);
    rc.tbodies.set(out.parent as object, tb);
  }
  return { parent: tb, before: null };
}

/** Declarations execute in document order interleaved with rendering (C-9). */
function renderItems<N>(rc: RenderCtx<N>, nodes: Node[], inst: Instance<N>, out: Out<N>, inputs?: Map<string, PropInput>): void {
  const h = rc.host;
  let group: Node[] | null = null;      // consecutive island nodes (declarations in between do not split them)
  const flushGroup = (): void => {
    if (!group) return;
    const id = rc.islandId!(group, inst);
    const start = h.comment("mk:" + id, false);
    h.insert(out.parent, start, out.before);
    for (const n of group) renderNodeInner(rc, n, inst, out);
    const end = h.comment("/mk:" + id, false);
    h.insert(out.parent, end, out.before);
    group = null;
  };
  for (const node of nodes) {
    switch (node.t) {
      case "var": declareVar(rc, node, inst); break;
      case "let": declareLet(rc, node, inst); break;
      case "fn": declareFn(rc, node, inst); break;
      case "prop": declareProp(rc, node, inst, inputs?.get(node.name)); break;
      case "style": break;
      default:
        if (rc.islandId && (node as Compiled).island && inst.doc.kind !== "component") { (group ??= []).push(node); break; }
        flushGroup();
        renderNodeInner(rc, node, inst, out);
    }
  }
  flushGroup();
}

function guard<N, T>(rc: RenderCtx<N>, inst: Instance<N>, line: number, fn: () => T, fallback: T): T {
  try { return fn(); } catch (err) { rc.onError(err, { line, doc: inst.doc.id }); return fallback; }
}

function declareVar<N>(rc: RenderCtx<N>, node: Extract<Node, { t: "var" }>, inst: Instance<N>): void {
  const prev = rc.ctx.dynamic;
  rc.ctx.dynamic = true; // V-4: initializers may use Math.random / Date.now
  const init = node.init ? guard(rc, inst, node.line, () => untrack(() => evalExpr(node.init!, inst.scope, rc.ctx)), undefined) : undefined;
  rc.ctx.dynamic = prev;
  const sig = signal<unknown>(reactive(init), node.name);
  inst.scope.define(node.name, {
    kind: "var",
    get: () => sig.get(),
    set: (v) => {
      if (inst.owner.disposed) { if (rc.dev) rc.ctx.log("warn", [`write to \`${node.name}\` of an unmounted component ignored`]); return; }
      sig.set(reactive(v));
    },
  });
}

function declareLet<N>(rc: RenderCtx<N>, node: Extract<Node, { t: "let" }>, inst: Instance<N>): void {
  const c = computed<unknown>(() => guard(rc, inst, node.line, () => evalExpr(node.init, inst.scope, rc.ctx), undefined), node.name);
  inst.scope.define(node.name, { kind: "let", get: () => c.get(), set: () => { throw new TypeError(`Cannot assign to let \`${node.name}\``); } });
}

function declareFn<N>(rc: RenderCtx<N>, node: Extract<Node, { t: "fn" }>, inst: Instance<N>): void {
  inst.scope.define(node.name, constCell(makeFunction(node.params, node.body, inst.scope, rc.ctx, node.async, node.name)));
}

function declareProp<N>(rc: RenderCtx<N>, node: Extract<Node, { t: "prop" }>, inst: Instance<N>, input: PropInput | undefined): void {
  let initial: unknown;
  if (!input) {
    if (node.init) initial = guard(rc, inst, node.line, () => untrack(() => evalExpr(node.init!, inst.scope, rc.ctx)), undefined);
    else if (rc.dev && inst.doc.kind === "component") rc.onError(Object.assign(new Error(`Required prop \`${node.name}\` of <${inst.doc.name}> not provided`), { code: "RT04" }), { line: node.line, doc: inst.doc.id });
  } else if (input.k === "static") initial = input.value;
  else if (input.k === "fn") initial = input.value;
  else initial = untrack(input.get);
  const sig = signal<unknown>(reactive(initial), node.name);
  if (input && (input.k === "dyn" || input.k === "bind")) {
    effect(() => sig.set(reactive(input.get())), "prop:" + node.name);
  }
  if (input?.k === "bind") inst.bound.add(node.name);
  const cell: Cell = {
    kind: "prop",
    get: () => sig.get(),
    set: (v) => {
      if (inst.owner.disposed) return;
      sig.set(reactive(v));
      if (inst.bound.has(node.name)) {
        const cb = inst.props.get("on" + node.name[0].toUpperCase() + node.name.slice(1) + "Change")?.get();
        if (typeof cb === "function") cb(v);
      }
    },
  };
  inst.props.set(node.name, cell);
  inst.scope.define(node.name, cell);
}

// ---------------------------------------------------------------- nodes

export function renderNode<N>(rc: RenderCtx<N>, node: Node, inst: Instance<N>, out: Out<N>): void {
  renderNodeInner(rc, node, inst, out);
}

function renderNodeInner<N>(rc: RenderCtx<N>, node: Node, inst: Instance<N>, out: Out<N>): void {
  switch (node.t) {
    case "tag": return node.kind === "html" ? renderHtml(rc, node, inst, out) : renderComponent(rc, node, inst, out);
    case "prose": return renderProse(rc, node, inst, out);
    case "if": return renderIf(rc, node, inst, out);
    case "for": return renderFor(rc, node, inst, out);
    case "head": return renderHead(rc, node, inst);
    default: return renderItems(rc, [node], inst, out);
  }
}

function renderNodes<N>(rc: RenderCtx<N>, nodes: Node[], inst: Instance<N>, out: Out<N>): void {
  renderItems(rc, nodes, inst, out);
}

// ---------------------------------------------------------------- html elements

const eventName = (attr: string): string => (attr === "onTap" ? "click" : attr.slice(2).toLowerCase());
const URL_ATTRS = new Set(["href", "src", "action", "poster"]);

function withBase(rc: RenderCtx<unknown>, name: string, v: string | null): string | null {
  if (v !== null && URL_ATTRS.has(name) && v.startsWith("/") && !v.startsWith("//") && rc.base !== "/") return rc.base.replace(/\/$/, "") + v;
  return v;
}

function renderHtml<N>(rc: RenderCtx<N>, node: TagNode, inst: Instance<N>, out: Out<N>): void {
  if (node.name === "slot") return renderSlot(rc, node, inst, out);
  if (node.name === "tr") out = tableBody(rc, inst, out);
  const h = rc.host;
  const el = h.el(node.name);
  if (inst.doc.stamp) h.setAttr(el, inst.doc.stamp, "");
  const scope = inst.scope;
  const classAttrs = node.attrs.filter((a) => (a.k === "static" || a.k === "dyn") && a.name === "class");
  const ev = (e: Expr): unknown => evalExpr(e, scope, rc.ctx);
  const isInput = node.name === "input" || node.name === "textarea" || node.name === "select";

  const renderClass = (): void => {
    const compute = (): string | null => {
      const parts: string[] = [];
      for (const a of classAttrs) {
        if (a.k === "bind" || a.k === "event") continue;
        if (a.if && !ev(a.if)) continue;
        const v = a.k === "static" ? a.value : ev(a.value);
        if (v === true) continue;
        if (v) parts.push(fmt(v));
      }
      return parts.length ? parts.join(" ") : null;
    };
    const isStatic = classAttrs.every((a) => a.k === "static" && !a.if);
    if (isStatic) h.setAttr(el, "class", compute());
    else effect(() => h.setAttr(el, "class", guard(rc, inst, node.line, compute, null)), "class");
  };

  let classDone = false;
  for (const a of node.attrs) {
    if ((a.k === "static" || a.k === "dyn") && a.name === "class") { if (!classDone) { classDone = true; renderClass(); } continue; }
    switch (a.k) {
      case "static":
        if (a.if) effect(() => h.setAttr(el, a.name, guard(rc, inst, node.line, () => (ev(a.if!) ? withBase(rc, a.name, a.value === true ? "" : a.value) : null), null)), a.name);
        else h.setAttr(el, a.name, withBase(rc, a.name, a.value === true ? "" : a.value));
        break;
      case "dyn": {
        if (a.name === "ref") {
          const cell = a.value.type === "Identifier" ? scope.lookup(a.value.name) : undefined;
          if (cell && rc.ctx.client) { queueMicrotaskSafe(() => cell.set(el)); onCleanup(() => cell.set(null)); }
          break;
        }
        effect(() => {
          const v = guard(rc, inst, node.line, () => (a.if && !ev(a.if) ? null : attrValue(a.name, ev(a.value))), null);
          h.setAttr(el, a.name, withBase(rc, a.name, v));
          if (isInput && (a.name === "value" || a.name === "checked")) h.setProp(el, a.name, a.name === "checked" ? v !== null : (v ?? ""));
        }, a.name);
        break;
      }
      case "bind": {
        const path = bindPath(rc, a.path, inst);
        effect(() => {
          const v = guard(rc, inst, node.line, path.get, undefined);
          const s = attrValue(a.name, v);
          h.setAttr(el, a.name, s);
          h.setProp(el, a.name, a.name === "checked" ? !!v : (v ?? ""));
        }, "bind:" + a.name);
        const typeAttr = node.attrs.find((x) => x.k === "static" && x.name === "type") as { value: string | true } | undefined;
        const numeric = typeAttr && (typeAttr.value === "number" || typeAttr.value === "range");
        const evName = a.name === "checked" ? "change" : "input";
        onCleanup(h.listen(el, evName, (e) => {
          const target = (e as { target: Record<string, unknown> }).target;
          const raw = a.name === "checked" ? target.checked : target.value;
          rc.ctx.ops = 0;
          batch(() => guard(rc, inst, node.line, () => path.set(numeric ? Number(raw) : raw), undefined));
        }));
        break;
      }
      case "event": {
        if (a.name === "onMount" || a.name === "onUnmount") {
          const call = (): void => { const f = guard(rc, inst, node.line, () => ev(a.handler), null); if (typeof f === "function") batch(() => f(el)); };
          if (a.name === "onMount") queueMicrotaskSafe(call); else onCleanup(call);
          break;
        }
        onCleanup(h.listen(el, eventName(a.name), (e) => runHandler(rc, inst, a, node.line, e)));
        break;
      }
    }
  }
  h.insert(out.parent, el, out.before);
  h.enter(el);
  renderNodes(rc, node.children, inst, { parent: el, before: null });
  h.exit(el);
}

const queueMicrotaskSafe = (fn: () => void): void => { queueMicrotask(fn); };

/** Run an `on*` handler: wrapped expressions are evaluated lazily; functions receive the event (C-16). */
export function runHandler<N>(rc: RenderCtx<N>, inst: Instance<N>, a: Extract<Attr, { k: "event" }>, line: number, e: unknown): void {
  const prev = rc.ctx.dynamic;
  rc.ctx.dynamic = true;
  rc.ctx.ops = 0; // the operation limit (V-5) is per event turn in the browser
  try {
    if (a.wrap) {
      drive(evalGen(a.handler, inst.scope, rc.ctx), batch).catch((err) => rc.onError(err, { line, doc: inst.doc.id }));
    } else {
      const f = batch(() => guard(rc, inst, line, () => evalExpr(a.handler, inst.scope, rc.ctx), null));
      if (typeof f === "function") {
        const r = batch(() => guard(rc, inst, line, () => f(e), undefined));
        if (r instanceof Promise) r.catch((err) => rc.onError(err, { line, doc: inst.doc.id }));
      }
    }
  } finally { rc.ctx.dynamic = prev; }
}

/** A `$path` binding: reads/writes re-evaluate index expressions every time (T-13a). */
function bindPath<N>(rc: RenderCtx<N>, path: (string | Expr)[], inst: Instance<N>): { get: () => unknown; set: (v: unknown) => void } {
  const scope = inst.scope;
  const root = path[0] as string;
  const walk = (): { obj: unknown; key: unknown } | null => {
    const cell = scope.lookup(root);
    if (!cell) throw new ReferenceError(`${root} is not defined`);
    if (path.length === 1) return null;
    let obj: unknown = cell.get();
    for (let i = 1; i < path.length - 1; i++) {
      const seg = path[i];
      const key = typeof seg === "string" ? seg : evalExpr(seg, scope, rc.ctx);
      obj = (obj as Record<string, unknown>)[key as string];
    }
    const last = path[path.length - 1];
    return { obj, key: typeof last === "string" ? last : evalExpr(last, scope, rc.ctx) };
  };
  return {
    get: () => {
      const w = walk();
      if (!w) return scope.lookup(root)!.get();
      if (w.obj === null || w.obj === undefined) return undefined;
      return (w.obj as Record<string, unknown>)[w.key as string];
    },
    set: (v) => {
      const w = walk();
      if (!w) { scope.lookup(root)!.set(v); return; }
      (w.obj as Record<string, unknown>)[w.key as string] = toRaw(v);
    },
  };
}

// ---------------------------------------------------------------- components

function renderComponent<N>(rc: RenderCtx<N>, node: TagNode, inst: Instance<N>, out: Out<N>): void {
  if (node.name === "Fragment") return renderNodes(rc, node.children, inst, out);
  if (node.name === "Math") return renderMathComponent(rc, node, inst, out);
  const doc = rc.docs.get(node.name);
  if (!doc) { rc.onError(Object.assign(new Error(`Unknown component <${node.name}>`), { code: "E007" }), { line: node.line, doc: inst.doc.id }); return; }
  const scope = inst.scope;
  const inputs = new Map<string, PropInput>();
  for (const a of node.attrs) {
    switch (a.k) {
      case "static":
        if (a.if) inputs.set(a.name, { k: "dyn", get: () => (evalExpr(a.if!, scope, rc.ctx) ? a.value : undefined) });
        else inputs.set(a.name, { k: "static", value: a.value });
        break;
      case "dyn":
        inputs.set(a.name, { k: "dyn", get: () => (a.if && !evalExpr(a.if, scope, rc.ctx) ? undefined : evalExpr(a.value, scope, rc.ctx)) });
        break;
      case "bind": {
        const p = bindPath(rc, a.path, inst);
        inputs.set(a.name, { k: "bind", get: p.get, set: p.set });
        const cb = "on" + a.name[0].toUpperCase() + a.name.slice(1) + "Change";
        if (doc.props.includes(cb)) inputs.set(cb, { k: "fn", value: (v: unknown) => batch(() => p.set(v)) });
        break;
      }
      case "event": {
        if (a.wrap) inputs.set(a.name, { k: "fn", value: (e: unknown) => runHandler(rc, inst, a, node.line, e) });
        else inputs.set(a.name, { k: "dyn", get: () => evalExpr(a.handler, scope, rc.ctx) });
        break;
      }
    }
  }
  const named = new Map<string, Node[]>();
  const defaults: Node[] = [];
  for (const c of node.children) {
    const slotAttr = c.t === "tag" && c.name === "Fragment" ? c.attrs.find((x) => x.k === "static" && x.name === "slot") : undefined;
    if (slotAttr && slotAttr.k === "static") named.set(String(slotAttr.value), c.t === "tag" ? c.children : []);
    else defaults.push(c);
  }
  const slots: Slots<N> = {
    has: (name) => (name === "" ? defaults.length > 0 : named.has(name)),
    render: (name, o) => renderNodes(rc, name === "" ? defaults : named.get(name) ?? [], inst, o),
  };
  mountDocument(rc, doc, inputs, slots, out);
}

function renderSlot<N>(rc: RenderCtx<N>, node: TagNode, inst: Instance<N>, out: Out<N>): void {
  const nameAttr = node.attrs.find((a) => a.k === "static" && a.name === "name") as { value: string | true } | undefined;
  const name = nameAttr && nameAttr.value !== true ? nameAttr.value : "";
  const h = rc.host;
  const markers = rc.spa && inst.doc.kind === "layout" && name === "";
  if (markers) h.insert(out.parent, h.comment("mk:slot", false), out.before);
  if (inst.slots && inst.slots.has(name)) inst.slots.render(name, out);
  if (markers) h.insert(out.parent, h.comment("/mk:slot", false), out.before);
}

// ---------------------------------------------------------------- blocks (if / for)

interface Range<N> { start: N; end: N }

/**
 * Anchor pair around block content. The end anchor is created after `body` renders
 * the initial content so that hydration claims nodes in document order.
 */
function withRange<N>(h: Host<N>, out: Out<N>, body: (before: N | null) => void): Range<N> {
  const start = h.comment("", true);
  h.insert(out.parent, start, out.before);
  body(out.before);
  const end = h.comment("", true);
  h.insert(out.parent, end, out.before);
  return { start, end };
}
function clearRange<N>(h: Host<N>, r: Range<N>): void {
  let n = h.next(r.start);
  while (n && n !== r.end) { const nx = h.next(n); h.remove(n); n = nx; }
}
function moveRange<N>(h: Host<N>, parent: N, r: Range<N>, before: N | null): void {
  let n: N | null = r.start;
  const stop = h.next(r.end);
  while (n && n !== stop) { const nx = h.next(n); h.insert(parent, n, before); n = nx; }
}
function removeRange<N>(h: Host<N>, r: Range<N>): void {
  clearRange(h, r);
  h.remove(r.start);
  h.remove(r.end);
}

/** M-6: a body that renders as exactly one list merges its items across iterations/branches. */
function listTag(nodes: Node[]): string | null {
  const real = nodes.filter((n) => n.t !== "var" && n.t !== "let" && n.t !== "fn" && n.t !== "prop" && n.t !== "style");
  if (real.length !== 1) return null;
  const n = real[0];
  if (n.t === "prose") {
    const tree = (n as ProseNode & Compiled).tree;
    return tree && tree.length === 1 && isList(tree[0]) ? tree[0].tag : null;
  }
  if (n.t === "for") return listTag(n.body);
  if (n.t === "if") {
    const t = listTag(n.then);
    if (!t) return null;
    let e: IfNode["else"] = n.else;
    while (e) {
      if (Array.isArray(e)) { if (e.length && listTag(e) !== t) return null; break; }
      if (listTag(e.then) !== t) return null;
      e = e.else;
    }
    return t;
  }
  return null;
}

function renderIf<N>(rc: RenderCtx<N>, node: IfNode, inst: Instance<N>, out: Out<N>): void {
  const h = rc.host;
  out = tableBody(rc, inst, out);
  const branches: { cond: Expr | null; nodes: Node[] }[] = [];
  let cur: IfNode | Node[] | undefined = node;
  while (cur) {
    if (Array.isArray(cur)) { branches.push({ cond: null, nodes: cur }); break; }
    branches.push({ cond: cur.cond, nodes: cur.then });
    cur = cur.else;
  }
  const merged = !!(out as Out<N> & { listMerge?: boolean }).listMerge;
  const parentOwner = getOwner();
  let current = -1;
  let owner: Owner | null = null;
  let range: Range<N> | null = null;
  range = withRange(h, out, (before) => effect(() => {
    let idx = -1;
    for (let i = 0; i < branches.length; i++) {
      const b = branches[i];
      if (!b.cond || guard(rc, inst, node.line, () => evalExpr(b.cond!, inst.scope, rc.ctx), false)) { idx = i; break; }
    }
    if (idx === current) return;
    current = idx;
    if (owner) { owner.dispose(); owner = null; }
    if (range) clearRange(h, range);
    if (idx < 0) return;
    runWithOwner(parentOwner, () => {
      owner = new Owner(parentOwner);
      runWithOwner(owner, () => renderBody(rc, branches[idx].nodes, inst, { parent: out.parent, before: range ? range.end : before }, merged));
    });
  }, "if"));
}

/** Render a block body; when the parent merges lists, unwrap the body's single list. */
function renderBody<N>(rc: RenderCtx<N>, nodes: Node[], inst: Instance<N>, out: Out<N>, merge: boolean): void {
  if (!merge) return renderNodes(rc, nodes, inst, out);
  for (const n of nodes) {
    if (n.t === "prose") {
      const tree = (n as ProseNode & Compiled).tree;
      if (tree && tree.length === 1 && isList(tree[0])) { renderTree(rc, tree[0].children, n.parts, inst, out); continue; }
    }
    if (n.t === "if" || n.t === "for") { renderNodeInner(rc, n, inst, Object.assign({}, out, { listMerge: true })); continue; }
    renderItems(rc, [n], inst, out);
  }
}

interface Row<N> { range: Range<N>; owner: Owner; item: Rx<unknown>; index: Rx<number>; key: unknown }

function renderFor<N>(rc: RenderCtx<N>, node: ForNode, inst: Instance<N>, out: Out<N>): void {
  const h = rc.host;
  out = tableBody(rc, inst, out);
  const merged = !!(out as Out<N> & { listMerge?: boolean }).listMerge;
  const tag = merged ? null : listTag(node.body);
  let container: Out<N> = out;
  if (tag) {
    const ul = h.el(tag);
    if (inst.doc.stamp) h.setAttr(ul, inst.doc.stamp, "");
    h.insert(out.parent, ul, out.before);
    h.enter(ul);
    container = { parent: ul, before: null };
  }
  const merge = merged || !!tag;
  const parentOwner = getOwner();
  const rows = new Map<unknown, Row<N>>();
  const scope = inst.scope;
  let range: Range<N> | null = null;
  range = withRange(h, container, (outerBefore) => effect(() => {
    const endAnchor = (): N | null => (range ? range.end : outerBefore);
    const src = guard(rc, inst, node.line, () => evalExpr(node.src, scope, rc.ctx), []);
    let list: unknown[] = [];
    if (src === null || src === undefined) list = [];
    else if (Array.isArray(src)) { list = []; for (let i = 0; i < src.length; i++) list.push(src[i]); }
    else { rc.onError(Object.assign(new Error(`\`for\` source is not an array (got ${typeof src})`), { code: "RT01" }), { line: node.line, doc: inst.doc.id }); }
    // keys
    const keys: unknown[] = [];
    const seen = new Map<unknown, number>();
    for (let i = 0; i < list.length; i++) {
      let k: unknown;
      if (node.key) {
        const s = new Scope(scope);
        s.define(node.item, constCell(list[i]));
        if (node.index) s.define(node.index, constCell(i));
        k = guard(rc, inst, node.line, () => toRaw(evalExpr(node.key!, s, rc.ctx)), i);
      } else k = typeof list[i] === "object" && list[i] !== null ? toRaw(list[i]) : list[i];
      const n = seen.get(k) ?? 0;
      seen.set(k, n + 1);
      if (n > 0) {
        if (node.key && rc.dev) rc.onError(Object.assign(new Error(`Duplicate key ${JSON.stringify(k)} in \`for\` at line ${node.line}`), { code: "RT02" }), { line: node.line, doc: inst.doc.id });
        k = { dup: k, n };
        keys.push(k);
        continue;
      }
      keys.push(k);
    }
    untrack(() => runWithOwner(parentOwner, () => {
      // remove vanished rows
      const keep = new Set(keys.map((k) => (typeof k === "object" && k !== null && "dup" in (k as object) ? JSON.stringify(k) : k)));
      for (const [k, row] of rows) if (!keep.has(k)) { row.owner.dispose(); removeRange(h, row.range); rows.delete(k); }
      // create / update rows in order
      let cursor: N | null = range ? h.next(range.start) : null;
      const atEnd = (): boolean => cursor === endAnchor();
      for (let i = 0; i < list.length; i++) {
        const rawKey = keys[i];
        const k = typeof rawKey === "object" && rawKey !== null && "dup" in (rawKey as object) ? JSON.stringify(rawKey) : rawKey;
        let row = rows.get(k);
        if (!row) {
          const owner = new Owner(parentOwner);
          const item = signal<unknown>(list[i], node.item);
          const index = signal<number>(i, node.index ?? "index");
          const s = new Scope(scope);
          const srcArr = src as unknown[];
          s.define(node.item, { kind: "item", get: () => item.get(), set: (v) => { srcArr[index.peek()] = toRaw(v); item.set(v); } });
          if (node.index) s.define(node.index, { kind: "item", get: () => index.get(), set: () => { throw new TypeError("Cannot assign to a loop index"); } });
          const rowInst: Instance<N> = { ...inst, scope: s };
          const before = atEnd() ? endAnchor() : cursor;
          const r = withRange(h, { parent: container.parent, before }, (b) =>
            runWithOwner(owner, () => renderBody(rc, node.body, rowInst, { parent: container.parent, before: b }, merge)));
          row = { range: r, owner, item, index, key: k };
          rows.set(k, row);
          cursor = h.next(r.end);
          continue;
        }
        batch(() => { row!.item.set(list[i]); row!.index.set(i); });
        if (row.range.start !== cursor) moveRange(h, container.parent, row.range, cursor);
        cursor = h.next(row.range.end);
      }
    }));
  }, "for"));
  if (tag) h.exit(container.parent);
}

// ---------------------------------------------------------------- prose

function renderProse<N>(rc: RenderCtx<N>, node: ProseNode, inst: Instance<N>, out: Out<N>): void {
  const tree = (node as ProseNode & Compiled).tree;
  if (!tree) throw new Error("prose node was not compiled");
  renderTree(rc, tree, node.parts, inst, out);
}

function renderTree<N>(rc: RenderCtx<N>, tree: HNode[], parts: ProseNode["parts"], inst: Instance<N>, out: Out<N>): void {
  for (const n of tree) renderHNode(rc, n, parts, inst, out);
}

function substitute(rc: RenderCtx<unknown>, template: string, parts: ProseNode["parts"], inst: Instance<unknown>): string {
  return template.replace(PLACEHOLDER_RE, (_, i) => {
    const p = parts[Number(i)];
    return p && p.p === "interp" ? fmt(evalExpr(p.expr, inst.scope, rc.ctx)) : "";
  });
}

function renderHNode<N>(rc: RenderCtx<N>, n: HNode, parts: ProseNode["parts"], inst: Instance<N>, out: Out<N>): void {
  const h = rc.host;
  switch (n.k) {
    case "text": {
      const t = h.text(n.s);
      h.insert(out.parent, t, out.before);
      return;
    }
    case "comment": {
      const c = h.comment(n.s, false);
      h.insert(out.parent, c, out.before);
      return;
    }
    case "el": {
      const el = h.el(n.tag);
      if (inst.doc.stamp) h.setAttr(el, inst.doc.stamp, "");
      for (const [name, value] of Object.entries(n.attrs)) {
        if (value.includes(PH)) effect(() => h.setAttr(el, name, withBase(rc, name, guard(rc, inst, 0, () => substitute(rc, value, parts, inst), ""))), name);
        else h.setAttr(el, name, withBase(rc, name, value));
      }
      if (n.slug) {
        const count = (rc.slugs.get(n.slug) ?? 0) + 1;
        rc.slugs.set(n.slug, count);
        h.setAttr(el, "id", count === 1 ? n.slug : `${n.slug}-${count}`);
      }
      h.insert(out.parent, el, out.before);
      h.enter(el);
      renderTree(rc, n.children, parts, inst, { parent: el, before: null });
      h.exit(el);
      return;
    }
    case "hole": {
      const part = parts[n.i];
      if (!part) return;
      if (part.p === "tag") return renderNode(rc, part.node, inst, out);
      if (part.p === "text") { const t = h.text(part.s); h.insert(out.parent, t, out.before); return; }
      let textNode: N | null = null;
      let range: Range<N> | null = null;
      range = withRange(h, out, (before) => effect(() => {
        const v = guard(rc, inst, 0, () => fmt(evalExpr(part.expr, inst.scope, rc.ctx)), "");
        if (v === "") { if (textNode) { h.remove(textNode); textNode = null; } return; }
        if (textNode) h.setText(textNode, v);
        else { textNode = h.text(v); h.insert(out.parent, textNode, range ? range.end : before); }
      }, "interp"));
      return;
    }
    case "math": return renderMath(rc, () => substitute(rc, n.tex, parts, inst), n.display, inst, out);
  }
}

function renderMath<N>(rc: RenderCtx<N>, tex: () => string, display: boolean, inst: Instance<N>, out: Out<N>): void {
  const h = rc.host;
  let node: N | null = null;
  let range: Range<N> | null = null;
  range = withRange(h, out, (before) => effect(() => {
    const src = guard(rc, inst, 0, tex, "");
    const html = rc.math ? rc.math(src, display) : `<span class="mk-math-error">${escapeHtml(src)}</span>`;
    if (node) h.remove(node);
    node = h.html(html);
    h.insert(out.parent, node, range ? range.end : before);
  }, "math"));
}

function renderMathComponent<N>(rc: RenderCtx<N>, node: TagNode, inst: Instance<N>, out: Out<N>): void {
  const get = (name: string): (() => unknown) => {
    const a = node.attrs.find((x) => x.name === name && (x.k === "static" || x.k === "dyn"));
    if (!a) return () => undefined;
    return a.k === "static" ? () => a.value : () => evalExpr((a as { value: Expr }).value, inst.scope, rc.ctx);
  };
  const tex = get("tex"), display = get("display");
  renderMath(rc, () => fmt(tex()), !!untrack(display), inst, out);
}

// ---------------------------------------------------------------- head

function renderHead<N>(rc: RenderCtx<N>, node: Extract<Node, { t: "head" }>, inst: Instance<N>): void {
  if (!rc.head) return;
  if (!rc.spa) { renderNodes(rc, node.children, inst, rc.head); return; }
  // SPA: stamp hoisted elements with their document so navigation can replace them (P-12).
  const h = rc.host;
  const tmp = h.el("div");
  renderNodes(rc, node.children, inst, { parent: tmp, before: null });
  for (let c = h.first(tmp); c; c = h.first(tmp)) {
    if (h.tagOf(c)) h.setAttr(c, "data-mk-head", inst.doc.id);
    h.insert(rc.head.parent, c, rc.head.before);
  }
}

/** Re-render the top-level <head> nodes of an instance (SPA navigation). */
export function renderHeadOf<N>(rc: RenderCtx<N>, inst: Instance<N>): void {
  for (const n of inst.doc.nodes) if (n.t === "head") renderHead(rc, n, inst);
}
