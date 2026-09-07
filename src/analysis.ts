// Island analysis (8.7): which nodes can change after load.
import type { Expr, Node, Stmt } from "./ast.ts";
import type { CompiledDoc, Compiled } from "./core/render.ts";

export interface IslandInfo { nodeId: number; line: number; causes: string[] }

export interface AnalyzedDoc extends CompiledDoc {
  intrinsic: boolean;             // every instance is dynamic (has vars, handlers, refs, ...)
  islands: IslandInfo[];          // root docs only
  hasMath: boolean;
  usesSite: boolean;
}

/** Marks `island` on top-level dynamic nodes of root docs; computes intrinsic dynamic-ness of components. */
export function analyzeProject(docs: Map<string, AnalyzedDoc>, byName: Map<string, AnalyzedDoc>, spa: boolean): void {
  const memo = new Map<string, boolean>();
  const visiting = new Set<string>();

  const compDynamic = (name: string): boolean => {
    if (name === "Fragment") return false;
    if (name === "Math") return false;
    const d = byName.get(name);
    if (!d) return false;
    if (memo.has(d.id)) return memo.get(d.id)!;
    if (visiting.has(d.id)) return false;
    visiting.add(d.id);
    const r = new Analyzer(d, compDynamic, spa).run();
    visiting.delete(d.id);
    memo.set(d.id, r);
    d.intrinsic = r;
    return r;
  };

  for (const d of byName.values()) compDynamic(d.name);
  for (const d of docs.values()) {
    if (d.kind === "component") continue;
    const a = new Analyzer(d, compDynamic, spa);
    a.run();
    d.intrinsic = a.anyDynamic;
    d.islands = a.islands;
  }
  for (const d of docs.values()) {
    d.hasMath = hasMath(d.nodes);
    d.usesSite = mentions(d.nodes, "Site");
  }
}

class Analyzer {
  doc: AnalyzedDoc;
  compDynamic: (name: string) => boolean;
  spa: boolean;
  names = new Map<string, Set<string>>();   // name -> causes (empty set = static)
  islands: IslandInfo[] = [];
  anyDynamic = false;

  constructor(doc: AnalyzedDoc, compDynamic: (n: string) => boolean, spa: boolean) {
    this.doc = doc; this.compDynamic = compDynamic; this.spa = spa;
  }

  /** Returns whether any instance of this doc is dynamic regardless of props. */
  run(): boolean {
    let intrinsic = false;
    for (const n of this.doc.nodes) {
      const causes = new Set<string>();
      switch (n.t) {
        case "var": this.names.set(n.name, new Set([n.name])); break;
        case "let": this.expr(n.init, causes); this.names.set(n.name, causes); break;
        case "fn": this.body(n.body, causes, new Set(n.params)); this.names.set(n.name, causes); break;
        case "prop": this.names.set(n.name, new Set()); break;
        case "style": break;
        default: {
          this.node(n, causes);
          if (causes.size) {
            intrinsic = true;
            if (this.doc.kind !== "component") {
              (n as Node & Compiled).island = true;
              this.islands.push({ nodeId: (n as Node & Compiled).id ?? -1, line: n.line, causes: [...causes] });
            }
          }
        }
      }
    }
    this.anyDynamic = intrinsic;
    return intrinsic;
  }

  node(n: Node, causes: Set<string>, locals: Map<string, Set<string>> = new Map()): void {
    switch (n.t) {
      case "var": case "let": case "fn": case "prop": case "style": return;
      case "prose":
        for (const p of n.parts) {
          if (p.p === "interp") this.expr(p.expr, causes, locals);
          else if (p.p === "tag") this.node(p.node, causes, locals);
        }
        return;
      case "if": {
        this.expr(n.cond, causes, locals);
        for (const c of n.then) this.node(c, causes, locals);
        if (n.else) Array.isArray(n.else) ? n.else.forEach((c) => this.node(c, causes, locals)) : this.node(n.else, causes, locals);
        return;
      }
      case "for": {
        const src = new Set<string>();
        this.expr(n.src, src, locals);
        for (const c of src) causes.add(c);
        const inner = new Map(locals);
        inner.set(n.item, src);
        if (n.index) inner.set(n.index, src);
        if (n.key) this.expr(n.key, causes, inner);
        for (const c of n.body) this.node(c, causes, inner);
        return;
      }
      case "head": return; // hoisted; in SPA mode heads are re-rendered on navigation instead
      case "tag": {
        if (n.kind === "html" && n.name === "slot") return;
        if (n.kind === "comp" && this.compDynamic(n.name)) causes.add("<" + n.name + ">");
        for (const a of n.attrs) {
          switch (a.k) {
            case "static": if (a.if) this.expr(a.if, causes, locals); break;
            case "dyn":
              if (a.name === "ref") { causes.add("ref"); break; }
              this.expr(a.value, causes, locals);
              if (a.if) this.expr(a.if, causes, locals);
              break;
            case "bind": causes.add("$" + a.path[0]); break;
            case "event": causes.add(a.name); break;
          }
        }
        for (const c of n.children) this.node(c, causes, locals);
        return;
      }
    }
  }

  body(b: Expr | Stmt[], causes: Set<string>, params: Set<string>): void {
    const locals = new Map<string, Set<string>>();
    for (const p of params) locals.set(p, new Set());
    if (!Array.isArray(b)) return this.expr(b, causes, locals);
    const walk = (stmts: Stmt[]): void => {
      for (const s of stmts) {
        switch (s.s) {
          case "let": case "var": if (s.init) this.expr(s.init, causes, locals); locals.set(s.name, new Set()); break;
          case "if": this.expr(s.cond, causes, locals); walk(s.then); if (s.else) Array.isArray(s.else) ? walk(s.else) : walk([s.else]); break;
          case "for": this.expr(s.src, causes, locals); locals.set(s.item, new Set()); if (s.index) locals.set(s.index, new Set()); walk(s.body); break;
          case "return": if (s.value) this.expr(s.value, causes, locals); break;
          case "expr": this.expr(s.expr, causes, locals); break;
        }
      }
    };
    walk(b);
  }

  expr(e: Expr, causes: Set<string>, locals: Map<string, Set<string>> = new Map()): void {
    switch (e.type) {
      case "Literal": return;
      case "Identifier": {
        const l = locals.get(e.name);
        if (l) { for (const c of l) causes.add(c); return; }
        const d = this.names.get(e.name);
        if (d) for (const c of d) causes.add(c);
        return;
      }
      case "MemberExpression": {
        if (e.object.type === "Identifier" && !e.computed && !locals.has(e.object.name) && !this.names.has(e.object.name)) {
          const prop = (e.property as { name: string }).name;
          if (e.object.name === "env" && prop === "client") causes.add("env.client");
          if (e.object.name === "Page" && (prop === "query" || prop === "hash" || this.spa)) causes.add("Page." + prop);
        }
        this.expr(e.object, causes, locals);
        if (e.computed) this.expr(e.property, causes, locals);
        return;
      }
      case "ChainExpression": return this.expr(e.expression, causes, locals);
      case "CallExpression": this.expr(e.callee, causes, locals); e.arguments.forEach((a) => this.expr(a, causes, locals)); return;
      case "NewExpression": e.arguments.forEach((a) => this.expr(a, causes, locals)); return;
      case "ArrayExpression": e.elements.forEach((a) => this.expr(a, causes, locals)); return;
      case "ObjectExpression": e.properties.forEach((p) => this.expr(p.value, causes, locals)); return;
      case "ArrowFunctionExpression": {
        const inner = new Map(locals);
        for (const p of e.params) inner.set((p as { name: string }).name, new Set());
        return this.expr(e.body, causes, inner);
      }
      case "UnaryExpression": return this.expr(e.argument, causes, locals);
      case "BinaryExpression": case "LogicalExpression": this.expr(e.left, causes, locals); this.expr(e.right, causes, locals); return;
      case "ConditionalExpression": this.expr(e.test, causes, locals); this.expr(e.consequent, causes, locals); this.expr(e.alternate, causes, locals); return;
      case "AssignmentExpression": this.expr(e.left, causes, locals); this.expr(e.right, causes, locals); return;
      case "SequenceExpression": e.expressions.forEach((x) => this.expr(x, causes, locals)); return;
      case "AwaitExpression": return this.expr(e.argument, causes, locals);
      case "TryExpression": this.expr(e.expr, causes, locals); this.expr(e.fallback, causes, locals); return;
    }
  }
}

function hasMath(nodes: Node[]): boolean {
  return nodes.some((n) => {
    if (n.t === "prose") return (n as Node & Compiled).tree?.some(function has(h): boolean { return h.k === "math" || (h.k === "el" && h.children.some(has)); }) || n.parts.some((p) => p.p === "tag" && hasMath([p.node]));
    if (n.t === "if") return hasMath(n.then) || (!!n.else && (Array.isArray(n.else) ? hasMath(n.else) : hasMath([n.else])));
    if (n.t === "for") return hasMath(n.body);
    if (n.t === "tag") return n.name === "Math" || hasMath(n.children);
    if (n.t === "head") return hasMath(n.children);
    return false;
  });
}

function mentions(nodes: Node[], name: string): boolean {
  const s = JSON.stringify(nodes, (k, v) => (k === "tree" ? undefined : v));
  return s.includes(`"name":"${name}"`);
}
