// Static checks (A-2): scope (C-1..C-3), assignment contexts (C-14/15), component
// props (T-8), bindings (T-15), await/return placement (C-18), whitelist (V-1/V-4).
import type { Attr, Document, Expr, Node, Stmt } from "./ast.ts";
import { type Diagnostic, MSG } from "./diagnostics.ts";
import {
  ARRAY_MUTATORS, ARRAY_STATIC, CONSOLE_MEMBERS, DATE_STATIC, ENV_MEMBERS, JSON_STATIC, MATH_MEMBERS, NUMBER_STATIC, OBJECT_STATIC, PROMISE_STATIC,
} from "./core/host.ts";

export interface DocInfo {
  file: string;
  ast: Document;
  kind: "page" | "layout" | "component" | "notfound";
  name?: string;
  props: string[];
  hasExports: boolean;
}

export const GLOBALS = new Set(["Site", "Page", "Math", "JSON", "Number", "String", "Array", "Object", "Date", "Promise", "console", "env", "next", "after", "measure"]);

const STATIC_MEMBERS: Record<string, Set<string>> = {
  Math: MATH_MEMBERS, Number: NUMBER_STATIC, Array: ARRAY_STATIC, Object: OBJECT_STATIC, JSON: JSON_STATIC, Date: DATE_STATIC,
  Promise: PROMISE_STATIC, console: CONSOLE_MEMBERS, env: ENV_MEMBERS, String: new Set<string>(),
};

export const HTML_ELEMENTS = new Set(("a abbr address area article aside audio b base bdi bdo blockquote body br button canvas caption cite code col colgroup " +
  "data datalist dd del details dfn dialog div dl dt em embed fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 head header hgroup hr html i iframe " +
  "img input ins kbd label legend li link main map mark menu meta meter nav noscript object ol optgroup option output p picture pre progress q rp rt ruby " +
  "s samp script search section select slot small source span strong style sub summary sup table tbody td template textarea tfoot th thead time title tr " +
  "track u ul var video wbr svg path circle rect line polyline polygon g text defs use symbol ellipse tspan").split(" "));

const HEAD_CHILDREN = new Set(["title", "meta", "link", "style", "script", "base"]);

type Kind = "var" | "let" | "prop" | "fn" | "item" | "index" | "local" | "const" | "param";
interface Binding { kind: Kind; line: number }

class Scope {
  vars = new Map<string, Binding>();
  parent: Scope | null;
  constructor(parent: Scope | null) { this.parent = parent; }
  lookup(name: string): Binding | undefined { return this.vars.get(name) ?? this.parent?.lookup(name); }
}

interface ExprCtx { handler: boolean; async: boolean; varInit: boolean; fnBody: boolean }
const PLAIN: ExprCtx = { handler: false, async: false, varInit: false, fnBody: false };

export function checkProject(docs: DocInfo[], byName: Map<string, DocInfo>): Diagnostic[] {
  const out: Diagnostic[] = [];
  const exportNames = new Set([...byName.values()].filter((d) => d.hasExports).map((d) => d.name!));
  for (const d of docs) new Checker(d, byName, exportNames, out).run();
  return out;
}

class Checker {
  doc: DocInfo;
  byName: Map<string, DocInfo>;
  exportNames: Set<string>;
  out: Diagnostic[];
  docScope = new Scope(null);
  later = new Map<string, number>(); // doc-level names declared later in the file
  laterFns = new Set<string>();
  hasSlot = false;

  constructor(doc: DocInfo, byName: Map<string, DocInfo>, exportNames: Set<string>, out: Diagnostic[]) {
    this.doc = doc; this.byName = byName; this.exportNames = exportNames; this.out = out;
    for (const n of doc.ast) {
      if (n.t === "var" || n.t === "let" || n.t === "prop" || n.t === "fn") this.later.set(n.name, n.line);
      if (n.t === "fn") this.laterFns.add(n.name);
    }
  }

  report(code: string, message: string, line: number, col = 0): void {
    this.out.push({ file: this.doc.file, line, col, code, message, severity: code.startsWith("W") ? "warning" : "error" });
  }

  run(): void {
    this.nodes(this.doc.ast, this.docScope, true);
    if (this.doc.kind === "layout" && !this.hasSlot) this.report("W001", MSG.W001(), 1);
  }

  declare(scope: Scope, name: string, kind: Kind, line: number, warnShadow = false): void {
    const own = scope.vars.get(name);
    if (own) { this.report("E004", MSG.E004(name, own.line), line); return; }
    if (warnShadow && scope.parent?.lookup(name)) this.report("W002", MSG.W002(name), line);
    scope.vars.set(name, { kind, line });
  }

  nodes(nodes: Node[], scope: Scope, top: boolean): void {
    for (const n of nodes) this.node(n, scope, top);
  }

  node(n: Node, scope: Scope, top: boolean): void {
    switch (n.t) {
      case "var":
        this.declare(scope, n.name, "var", n.line);
        if (n.init) this.expr(n.init, scope, { ...PLAIN, varInit: true }, n.line);
        return;
      case "let":
        this.declare(scope, n.name, "let", n.line);
        this.expr(n.init, scope, PLAIN, n.line);
        return;
      case "prop":
        this.declare(scope, n.name, "prop", n.line);
        if (n.init && this.doc.kind !== "page") this.expr(n.init, scope, PLAIN, n.line);
        return;
      case "fn": {
        this.declare(scope, n.name, "fn", n.line);
        const inner = new Scope(scope);
        for (const p of n.params) this.declare(inner, p, "param", n.line);
        const ctx: ExprCtx = { handler: true, async: n.async, varInit: false, fnBody: true };
        if (Array.isArray(n.body)) this.stmts(n.body, inner, ctx);
        else this.expr(n.body, inner, ctx, n.line);
        return;
      }
      case "style": return;
      case "prose":
        for (const p of n.parts) {
          if (p.p === "interp") this.expr(p.expr, scope, PLAIN, n.line);
          else if (p.p === "tag") this.node(p.node, scope, false);
        }
        return;
      case "if": {
        this.expr(n.cond, scope, PLAIN, n.line);
        this.nodes(n.then, scope, false);
        if (n.else) Array.isArray(n.else) ? this.nodes(n.else, scope, false) : this.node(n.else, scope, false);
        return;
      }
      case "for": {
        this.expr(n.src, scope, PLAIN, n.line);
        const inner = new Scope(scope);
        this.declare(inner, n.item, "item", n.line, true);
        if (n.index) this.declare(inner, n.index, "index", n.line, true);
        if (n.key) this.expr(n.key, inner, PLAIN, n.line);
        this.nodes(n.body, inner, false);
        return;
      }
      case "head":
        for (const c of n.children) {
          if (c.t === "tag" && !HEAD_CHILDREN.has(c.name)) this.report("E012", `<${c.name}> is not allowed inside <head> (only title, meta, link, style, script)`, c.line);
          this.node(c, scope, false);
        }
        return;
      case "tag":
        return n.kind === "html" ? this.htmlTag(n, scope) : this.compTag(n, scope);
    }
    void top;
  }

  htmlTag(n: Extract<Node, { t: "tag" }>, scope: Scope): void {
    if (n.name === "slot") { this.hasSlot = true; return; }
    if (!HTML_ELEMENTS.has(n.name)) this.report("W003", MSG.W003(n.name), n.line);
    for (const a of n.attrs) this.attr(a, scope, n.line, null);
    this.nodes(n.children, scope, false);
  }

  compTag(n: Extract<Node, { t: "tag" }>, scope: Scope): void {
    if (n.name === "Fragment") {
      for (const a of n.attrs) if (a.name !== "slot") this.report("E008", MSG.E008("Fragment", a.name, ["slot"]), n.line);
      this.nodes(n.children, scope, false);
      return;
    }
    const comp = this.byName.get(n.name);
    if (!comp) { this.report("E007", MSG.E007(n.name), n.line); this.nodes(n.children, scope, false); return; }
    for (const a of n.attrs) this.attr(a, scope, n.line, comp);
    this.nodes(n.children, scope, false);
  }

  attr(a: Attr, scope: Scope, line: number, comp: DocInfo | null): void {
    const propOk = (name: string): void => {
      if (comp && !comp.props.includes(name)) this.report("E008", MSG.E008(comp.name ?? comp.file, name, comp.props), line);
    };
    switch (a.k) {
      case "static":
        propOk(a.name);
        if (a.if) this.expr(a.if, scope, PLAIN, line);
        return;
      case "dyn":
        if (a.name === "ref" && !comp) {
          const b = a.value.type === "Identifier" ? scope.lookup(a.value.name) : undefined;
          if (!b || b.kind !== "var") this.report("E005", "`ref` must name a `var`", line);
          return;
        }
        propOk(a.name);
        this.expr(a.value, scope, PLAIN, line);
        if (a.if) this.expr(a.if, scope, PLAIN, line);
        return;
      case "event":
        if (comp) propOk(a.name);
        this.expr(a.handler, scope, { handler: true, async: true, varInit: false, fnBody: false }, line);
        return;
      case "bind": {
        if (comp) { propOk(a.name); propOk("on" + a.name[0].toUpperCase() + a.name.slice(1) + "Change"); }
        const root = a.path[0] as string;
        const b = scope.lookup(root);
        if (!b) { this.unresolved(root, line); return; }
        if (b.kind !== "var" && b.kind !== "prop" && b.kind !== "item") this.report("E009", MSG.E009(a.path.map((s) => (typeof s === "string" ? s : "[…]")).join("."), root), line);
        for (const seg of a.path) if (typeof seg !== "string") this.expr(seg, scope, PLAIN, line);
        return;
      }
    }
  }

  unresolved(name: string, line: number): void {
    const l = this.later.get(name);
    if (l !== undefined) this.report("E003", MSG.E003(name, l), line);
    else this.report("E003", `\`${name}\` is not declared`, line);
  }

  stmts(stmts: Stmt[], scope: Scope, ctx: ExprCtx): void {
    for (const s of stmts) {
      switch (s.s) {
        case "let": case "var":
          this.declare(scope, s.name, s.s === "let" ? "const" : "local", s.line);
          if (s.init) this.expr(s.init, scope, ctx, s.line);
          break;
        case "if":
          this.expr(s.cond, scope, ctx, s.line);
          this.stmts(s.then, new Scope(scope), ctx);
          if (s.else) Array.isArray(s.else) ? this.stmts(s.else, new Scope(scope), ctx) : this.stmts([s.else], scope, ctx);
          break;
        case "for": {
          this.expr(s.src, scope, ctx, s.line);
          const inner = new Scope(scope);
          this.declare(inner, s.item, "local", s.line, true);
          if (s.index) this.declare(inner, s.index, "local", s.line, true);
          this.stmts(s.body, inner, ctx);
          break;
        }
        case "return":
          if (s.value) this.expr(s.value, scope, ctx, s.line);
          break;
        case "expr":
          if (s.expr.type === "ObjectExpression" || s.expr.type === "ArrayExpression" || s.expr.type === "Literal") this.report("W004", MSG.W004(), s.line);
          this.expr(s.expr, scope, ctx, s.line);
          break;
      }
    }
  }

  expr(e: Expr, scope: Scope, ctx: ExprCtx, line: number): void {
    switch (e.type) {
      case "Literal": return;
      case "Identifier": this.ident(e.name, scope, line, ctx); return;
      case "MemberExpression": {
        if (e.object.type === "Identifier" && !scope.lookup(e.object.name) && !e.computed) {
          const table = STATIC_MEMBERS[e.object.name];
          const prop = (e.property as { name: string }).name;
          if (table && !table.has(prop)) { this.report("E021", MSG.E021(`${e.object.name}.${prop}`), line); return; }
          if (((e.object.name === "Math" && prop === "random") || (e.object.name === "Date" && prop === "now")) && !ctx.varInit && !ctx.handler) {
            this.report("E022", MSG.E022(), line);
          }
        }
        this.expr(e.object, scope, ctx, line);
        if (e.computed) this.expr(e.property, scope, ctx, line);
        return;
      }
      case "ChainExpression": return this.expr(e.expression, scope, ctx, line);
      case "CallExpression": {
        const c = e.callee;
        const method = c.type === "MemberExpression" && !c.computed ? (c.property as { name: string }).name : "";
        if (ARRAY_MUTATORS.has(method) && method !== "sort" && method !== "reverse" && !ctx.handler) {
          this.report("E006", MSG.E006(), line);
        }
        this.expr(c, scope, ctx, line);
        for (const a of e.arguments) this.expr(a, scope, ctx, line);
        return;
      }
      case "NewExpression": {
        const name = (e.callee as { name: string }).name;
        if (name !== "Date") this.report("E021", MSG.E021("new " + name), line);
        else if (e.arguments.length === 0 && !ctx.varInit && !ctx.handler) this.report("E022", MSG.E022(), line);
        for (const a of e.arguments) this.expr(a, scope, ctx, line);
        return;
      }
      case "ArrayExpression": for (const x of e.elements) this.expr(x, scope, ctx, line); return;
      case "ObjectExpression": for (const p of e.properties) this.expr(p.value, scope, ctx, line); return;
      case "ArrowFunctionExpression": {
        const inner = new Scope(scope);
        for (const p of e.params) this.declare(inner, (p as { name: string }).name, "param", line);
        this.expr(e.body, inner, { handler: true, async: e.async, varInit: false, fnBody: true }, line);
        return;
      }
      case "UnaryExpression": return this.expr(e.argument, scope, ctx, line);
      case "BinaryExpression": case "LogicalExpression": this.expr(e.left, scope, ctx, line); this.expr(e.right, scope, ctx, line); return;
      case "ConditionalExpression": this.expr(e.test, scope, ctx, line); this.expr(e.consequent, scope, ctx, line); this.expr(e.alternate, scope, ctx, line); return;
      case "AssignmentExpression": {
        if (!ctx.handler) this.report("E006", MSG.E006(), line);
        this.target(e.left, scope, line);
        this.expr(e.right, scope, ctx, line);
        return;
      }
      case "SequenceExpression":
        if (!ctx.handler) this.report("E006", MSG.E006(), line);
        for (const x of e.expressions) this.expr(x, scope, ctx, line);
        return;
      case "AwaitExpression":
        if (!ctx.async) this.report("E016", MSG.E016(), line);
        return this.expr(e.argument, scope, ctx, line);
      case "TryExpression": this.expr(e.expr, scope, ctx, line); this.expr(e.fallback, scope, ctx, line); return;
    }
  }

  ident(name: string, scope: Scope, line: number, ctx: ExprCtx = PLAIN): void {
    if (scope.lookup(name)) return;
    if (GLOBALS.has(name) || this.exportNames.has(name)) return;
    if (ctx.fnBody && this.laterFns.has(name)) return; // functions may call functions declared later
    this.unresolved(name, line);
  }

  /** C-15: the root of an assignment target must be a var, prop, or loop item. */
  target(t: Expr, scope: Scope, line: number): void {
    if (t.type === "Identifier") {
      const b = scope.lookup(t.name);
      if (!b) {
        if (GLOBALS.has(t.name) || this.exportNames.has(t.name)) this.report("E005", MSG.E005("global", t.name), line);
        else this.unresolved(t.name, line);
        return;
      }
      if (b.kind === "let" || b.kind === "fn" || b.kind === "const" || b.kind === "index") this.report("E005", MSG.E005(b.kind === "const" ? "let" : b.kind, t.name), line);
      return;
    }
    if (t.type === "MemberExpression") {
      let root: Expr = t;
      while (root.type === "MemberExpression") { if (root.computed) this.expr(root.property, scope, PLAIN, line); root = root.object; }
      if (root.type === "Identifier") {
        const b = scope.lookup(root.name);
        if (!b) {
          if (root.name === "Page" && t.object === root && !t.computed && ((t.property as { name: string }).name === "path" || (t.property as { name: string }).name === "title")) return;
          if (GLOBALS.has(root.name) || this.exportNames.has(root.name)) this.report("E005", MSG.E005("global", root.name), line);
          else this.unresolved(root.name, line);
          return;
        }
        if (b.kind === "let" || b.kind === "fn") this.report("E005", MSG.E005(b.kind, root.name), line);
        return;
      }
      this.expr(root, scope, { ...PLAIN, handler: true }, line);
    }
  }
}
