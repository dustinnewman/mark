// AST interpreter for the Mark expression language (12.2). Used at build time by
// the evaluator and in the browser by the runtime, so both agree by construction.
import type { Expr, Stmt } from "../ast.ts";
import { eq, toRaw } from "./reactive.ts";
import { batch } from "./signal.ts";
import {
  ARRAY_METHODS, ARRAY_STATIC, CONSOLE_MEMBERS, DATE_METHODS, DATE_STATIC, ENV_MEMBERS, HostError, JSON_STATIC,
  MATH_MEMBERS, NUMBER_METHODS, NUMBER_STATIC, OBJECT_STATIC, PROMISE_STATIC, STRING_METHODS, compareStrings, e021,
} from "./host.ts";

export interface Cell {
  kind: "var" | "let" | "prop" | "fn" | "item" | "local" | "const";
  get(): unknown;
  set(v: unknown): void;
}

export class Scope {
  vars = new Map<string, Cell>();
  parent: Scope | null;
  constructor(parent: Scope | null = null) { this.parent = parent; }
  lookup(name: string): Cell | undefined {
    let s: Scope | null = this;
    while (s) { const c = s.vars.get(name); if (c) return c; s = s.parent; }
    return undefined;
  }
  define(name: string, cell: Cell): void { this.vars.set(name, cell); }
}

export const localCell = (value: unknown, kind: Cell["kind"] = "local"): Cell => {
  const c = { kind, value, get: () => c.value, set: (v: unknown) => { c.value = v; } };
  return c as Cell & { value: unknown };
};
export const constCell = (value: unknown): Cell => ({ kind: "const", get: () => value, set: () => { throw new TypeError("Cannot assign to a constant"); } });

export interface Intrinsics {
  next(): Promise<void>;
  after(ms: number): Promise<void>;
  measure(node: unknown, rel?: unknown): { x: number; y: number; w: number; h: number };
}

export interface Ctx {
  globals: Record<string, unknown>;
  env: Record<string, unknown>;
  intrinsics: Intrinsics;
  /** Non-deterministic calls are allowed only while this is true (V-4). */
  dynamic: boolean;
  client: boolean;
  buildTime: number;
  locale: string;
  log(level: "log" | "warn" | "error", args: unknown[]): void;
  ops: number;
  opLimit: number;
  deadline: number;
}

export function makeCtx(over: Partial<Ctx> = {}): Ctx {
  return {
    globals: {},
    env: { reducedMotion: false, client: false, dev: false, touch: false },
    intrinsics: {
      next: () => Promise.resolve(),
      after: () => new Promise<void>(() => {}),
      measure: () => ({ x: 0, y: 0, w: 0, h: 0 }),
    },
    dynamic: false,
    client: false,
    buildTime: 0,
    locale: "en-US",
    log: () => {},
    ops: 0,
    opLimit: 10_000_000,
    deadline: Infinity,
    ...over,
  };
}

const SHORT = Symbol("short-circuit");
class Return { value: unknown; constructor(v: unknown) { this.value = v; } }

const limitError = (): HostError => new HostError("E023", "Page evaluation exceeded the operation limit");

function tick(ctx: Ctx): void {
  if (++ctx.ops > ctx.opLimit) throw limitError();
  if ((ctx.ops & 0xffff) === 0 && Date.now() > ctx.deadline) throw limitError();
}

// ---------------------------------------------------------------- members

const isDomNode = (v: unknown): boolean => typeof Node !== "undefined" && v instanceof Node;

function bound(obj: unknown, fn: unknown): unknown {
  return typeof fn === "function" ? (...a: unknown[]) => (fn as Function).apply(obj, a) : fn;
}

export function getMember(obj: unknown, key: unknown, ctx: Ctx): unknown {
  if (obj === null || obj === undefined) throw new TypeError(`Cannot read properties of ${obj} (reading '${String(key)}')`);
  const k = typeof key === "number" ? key : String(key);
  switch (typeof obj) {
    case "string":
      if (typeof k === "number" || /^\d+$/.test(k)) return obj[Number(k)];
      if (k === "length") return obj.length;
      if (!STRING_METHODS.has(k)) throw e021("String." + k);
      if (k === "localeCompare") return (b: unknown) => compareStrings(obj, String(b));
      return bound(obj, (String.prototype as unknown as Record<string, unknown>)[k]);
    case "number":
      if (!NUMBER_METHODS.has(k as string)) throw e021("Number." + k);
      return bound(obj, (Number.prototype as unknown as Record<string, unknown>)[k as string]);
    case "boolean":
      if (k === "toString") return () => String(obj);
      throw e021("Boolean." + k);
    case "function": {
      const g = hostGlobalMember(obj, k as string, ctx);
      if (g !== NOT_HOST) return g;
      throw e021("function." + k);
    }
    case "object": break;
    default: throw e021(String(k));
  }
  const o = obj as Record<string, unknown>;
  if (Array.isArray(o)) {
    if (typeof k === "number" || /^\d+$/.test(k)) return o[Number(k)];
    if (!ARRAY_METHODS.has(k)) throw e021("Array." + k);
    if (k === "length") return o.length;
    if (k === "sort" || k === "toSorted") {
      const native = (Array.prototype as unknown as Record<string, Function>)[k];
      return (cmp?: unknown) => native.call(o, typeof cmp === "function" ? cmp : (a: unknown, b: unknown) => compareStrings(String(a), String(b)));
    }
    return bound(o, (Array.prototype as unknown as Record<string, unknown>)[k]);
  }
  if (o instanceof Date) {
    if (!DATE_METHODS.has(k as string)) throw e021("Date." + k);
    const name = DATE_MAP[k as string] ?? (k as string);
    if (name.startsWith("toLocale")) return (loc?: unknown, opts?: unknown) =>
      (o as unknown as Record<string, Function>)[name](typeof loc === "string" ? loc : ctx.locale, { timeZone: "UTC", ...(typeof opts === "object" && opts ? opts : {}) });
    return bound(o, (Date.prototype as unknown as Record<string, unknown>)[name]);
  }
  if (isDomNode(o)) return bound(o, o[k as string]);
  const hg = hostGlobalMember(o, k as string, ctx);
  if (hg !== NOT_HOST) return hg;
  if (o instanceof Promise) {
    if (k === "then" || k === "catch" || k === "finally") return bound(o, o[k as string]);
    throw e021("Promise." + k);
  }
  // Host objects (events, DOM-adjacent values) expose their members as-is (5.6).
  const proto = Object.getPrototypeOf(toRaw(o));
  if (proto !== Object.prototype && proto !== null) return bound(o, o[k as string]);
  // plain object (possibly reactive proxy): own properties only
  if (Object.prototype.hasOwnProperty.call(toRaw(o), k)) return o[k as string];
  if (k in Object.prototype) throw e021("Object." + k);
  return undefined;
}

const DATE_MAP: Record<string, string> = {
  getFullYear: "getUTCFullYear", getMonth: "getUTCMonth", getDate: "getUTCDate", getDay: "getUTCDay",
  getHours: "getUTCHours", getMinutes: "getUTCMinutes", getSeconds: "getUTCSeconds",
};

const NOT_HOST = Symbol("not-host");
const hostTables = new Map<unknown, [string, Set<string>]>([
  [Math, ["Math", MATH_MEMBERS]], [Number, ["Number", NUMBER_STATIC]], [String, ["String", new Set<string>()]],
  [Array, ["Array", ARRAY_STATIC]], [Object, ["Object", OBJECT_STATIC]], [JSON, ["JSON", JSON_STATIC]],
  [Date, ["Date", DATE_STATIC]], [Promise, ["Promise", PROMISE_STATIC]],
]);

function hostGlobalMember(obj: unknown, k: string, ctx: Ctx): unknown {
  const t = hostTables.get(obj);
  if (t) {
    const [name, allowed] = t;
    if (!allowed.has(k)) throw e021(`${name}.${k}`);
    if (obj === Math && k === "random") return () => { if (!ctx.dynamic) throw e022(); return ctx.client ? Math.random() : 0; };
    if (obj === Date && k === "now") return () => { if (!ctx.dynamic) throw e022(); return ctx.client ? Date.now() : ctx.buildTime; };
    if (obj === Array && k === "from") return (a: unknown, f?: unknown) => Array.from(a as Iterable<unknown>, f as (v: unknown, i: number) => unknown);
    return bound(obj, (obj as Record<string, unknown>)[k]);
  }
  if (obj === ctx.globals.console) {
    if (!CONSOLE_MEMBERS.has(k)) throw e021("console." + k);
    return (...args: unknown[]) => ctx.log(k as "log", args);
  }
  if (obj === ctx.env) {
    if (!ENV_MEMBERS.has(k)) throw e021("env." + k);
    return ctx.env[k];
  }
  return NOT_HOST;
}

const e022 = (): HostError => new HostError("E022", "`Math.random`/`Date.now` cannot be used in static content; use it in a `var` or handler");

function setMember(obj: unknown, key: unknown, value: unknown): void {
  if (obj === null || obj === undefined || typeof obj !== "object") throw new TypeError(`Cannot set properties of ${String(obj)}`);
  const ok = Reflect.set(obj as object, key as PropertyKey, value);
  if (!ok) throw new TypeError(`Cannot assign to read only property '${String(key)}'`);
}

// ---------------------------------------------------------------- expressions (sync)

export function evalExpr(e: Expr, sc: Scope, ctx: Ctx): unknown {
  tick(ctx);
  switch (e.type) {
    case "Literal": return e.value;
    case "Identifier": return lookup(e.name, sc, ctx);
    case "MemberExpression": {
      const obj = evalExpr(e.object, sc, ctx);
      if (e.optional && (obj === null || obj === undefined)) throw SHORT;
      const key = e.computed ? evalExpr(e.property, sc, ctx) : (e.property as { name: string }).name;
      return getMember(obj, key, ctx);
    }
    case "ChainExpression":
      try { return evalExpr(e.expression, sc, ctx); } catch (x) { if (x === SHORT) return undefined; throw x; }
    case "CallExpression": {
      const fn = calleeOf(e.callee, sc, ctx);
      if (e.optional && (fn === null || fn === undefined)) throw SHORT;
      const args = e.arguments.map((a) => evalExpr(a, sc, ctx));
      return callValue(fn, args, e.callee);
    }
    case "NewExpression": return construct(e, e.arguments.map((a) => evalExpr(a, sc, ctx)), ctx);
    case "ArrayExpression": return e.elements.map((x) => evalExpr(x, sc, ctx));
    case "ObjectExpression": {
      const o: Record<string, unknown> = {};
      for (const p of e.properties) {
        const k = p.key.type === "Identifier" ? p.key.name : String((p.key as { value: unknown }).value);
        o[k] = evalExpr(p.value, sc, ctx);
      }
      return o;
    }
    case "ArrowFunctionExpression": return makeFunction(e.params.map((p) => (p as { name: string }).name), e.body, sc, ctx, e.async, "arrow");
    case "UnaryExpression": {
      const v = evalExpr(e.argument, sc, ctx);
      return e.operator === "!" ? !v : e.operator === "-" ? -(v as number) : +(v as number);
    }
    case "BinaryExpression": return binary(e.operator, evalExpr(e.left, sc, ctx), evalExpr(e.right, sc, ctx));
    case "LogicalExpression": {
      const l = evalExpr(e.left, sc, ctx);
      return e.operator === "&&" ? (l ? evalExpr(e.right, sc, ctx) : l) : (l ? l : evalExpr(e.right, sc, ctx));
    }
    case "ConditionalExpression": return evalExpr(e.test, sc, ctx) ? evalExpr(e.consequent, sc, ctx) : evalExpr(e.alternate, sc, ctx);
    case "AssignmentExpression": return assign(e.left, e.operator, evalExpr(e.right, sc, ctx), sc, ctx);
    case "SequenceExpression": { let v: unknown; for (const x of e.expressions) v = evalExpr(x, sc, ctx); return v; }
    case "AwaitExpression": throw new HostError("E016", "`await` is only allowed in `async fn`, handlers, and async arrows");
    case "TryExpression":
      try { return evalExpr(e.expr, sc, ctx); }
      catch (err) {
        if (err === SHORT || isFatal(err)) throw err;
        const fb = evalExpr(e.fallback, sc, ctx);
        return typeof fb === "function" ? fb(err) : fb;
      }
  }
  throw new Error(`Unknown expression ${(e as { type: string }).type}`);
}

const isFatal = (err: unknown): boolean => err instanceof HostError && err.code === "E023";

function lookup(name: string, sc: Scope, ctx: Ctx): unknown {
  const c = sc.lookup(name);
  if (c) return c.get();
  if (name in ctx.globals) return ctx.globals[name];
  if (name === "env") return ctx.env;
  if (name === "next") return ctx.intrinsics.next;
  if (name === "after") return ctx.intrinsics.after;
  if (name === "measure") return ctx.intrinsics.measure;
  throw new ReferenceError(`${name} is not defined`);
}

function calleeOf(callee: Expr, sc: Scope, ctx: Ctx): unknown {
  if (callee.type === "MemberExpression") {
    const obj = evalExpr(callee.object, sc, ctx);
    if (callee.optional && (obj === null || obj === undefined)) throw SHORT;
    const key = callee.computed ? evalExpr(callee.property, sc, ctx) : (callee.property as { name: string }).name;
    return getMember(obj, key, ctx);
  }
  return evalExpr(callee, sc, ctx);
}

function callValue(fn: unknown, args: unknown[], callee: Expr): unknown {
  if (typeof fn !== "function") throw new TypeError(`${describeCallee(callee)} is not a function`);
  return fn(...args);
}

function describeCallee(c: Expr): string {
  if (c.type === "Identifier") return c.name;
  if (c.type === "MemberExpression" && !c.computed) return describeCallee(c.object) + "." + (c.property as { name: string }).name;
  return "expression";
}

function construct(e: Extract<Expr, { type: "NewExpression" }>, args: unknown[], ctx: Ctx): unknown {
  const name = (e.callee as { name: string }).name;
  if (name !== "Date") throw e021("new " + name);
  if (args.length === 0) {
    if (!ctx.dynamic) throw e022();
    return ctx.client ? new Date() : new Date(ctx.buildTime);
  }
  return new Date(...(args as [number]));
}

function binary(op: string, l: unknown, r: unknown): unknown {
  switch (op) {
    case "==": return eq(l, r);
    case "!=": return !eq(l, r);
    case "+": return (l as number) + (r as number);
    case "-": return (l as number) - (r as number);
    case "*": return (l as number) * (r as number);
    case "/": return (l as number) / (r as number);
    case "%": return (l as number) % (r as number);
    case "**": return (l as number) ** (r as number);
    case "<": return (l as number) < (r as number);
    case ">": return (l as number) > (r as number);
    case "<=": return (l as number) <= (r as number);
    case ">=": return (l as number) >= (r as number);
  }
  throw new Error("Unknown operator " + op);
}

function assign(left: Expr, op: string, value: unknown, sc: Scope, ctx: Ctx): unknown {
  const compute = (old: () => unknown): unknown => op === "=" ? value : binary(op.slice(0, -1), old(), value);
  if (left.type === "Identifier") {
    const c = sc.lookup(left.name);
    if (!c) {
      if (left.name in ctx.globals) throw new TypeError(`Cannot assign to global ${left.name}`);
      throw new ReferenceError(`${left.name} is not defined`);
    }
    const v = compute(() => c.get());
    c.set(v);
    return v;
  }
  if (left.type === "MemberExpression") {
    const obj = evalExpr(left.object, sc, ctx);
    const key = left.computed ? evalExpr(left.property, sc, ctx) : (left.property as { name: string }).name;
    const v = compute(() => getMember(obj, key, ctx));
    setMember(obj, key, v);
    return v;
  }
  throw new SyntaxError("Invalid assignment target");
}

// ---------------------------------------------------------------- functions & statements

export function makeFunction(params: string[], body: Expr | Stmt[], sc: Scope, ctx: Ctx, isAsync: boolean, name: string): Function {
  const f = (...args: unknown[]): unknown => {
    const inner = new Scope(sc);
    params.forEach((p, i) => inner.define(p, localCell(args[i])));
    if (isAsync) return drive(Array.isArray(body) ? execStmtsGen(body, inner, ctx) : evalGen(body, inner, ctx), batch);
    if (!Array.isArray(body)) return evalExpr(body, inner, ctx);
    const r = execStmts(body, inner, ctx);
    return r instanceof Return ? r.value : undefined;
  };
  Object.defineProperty(f, "name", { value: name });
  return f;
}

export function execStmts(stmts: Stmt[], sc: Scope, ctx: Ctx): Return | undefined {
  for (const s of stmts) {
    tick(ctx);
    switch (s.s) {
      case "let": case "var":
        sc.define(s.name, localCell(s.init ? evalExpr(s.init, sc, ctx) : undefined, s.s === "let" ? "const" : "local"));
        break;
      case "if": {
        const branch = evalExpr(s.cond, sc, ctx) ? s.then : s.else;
        if (!branch) break;
        const r = Array.isArray(branch) ? execStmts(branch, new Scope(sc), ctx) : execStmts([branch], sc, ctx);
        if (r) return r;
        break;
      }
      case "for": {
        const src = evalExpr(s.src, sc, ctx);
        const arr = src === null || src === undefined ? [] : src;
        if (!Array.isArray(arr)) throw new HostError("RT01", `\`for\` source is not an array (got ${typeof arr})`);
        for (let i = 0; i < arr.length; i++) {
          const inner = new Scope(sc);
          inner.define(s.item, localCell(arr[i]));
          if (s.index) inner.define(s.index, localCell(i));
          const r = execStmts(s.body, inner, ctx);
          if (r) return r;
        }
        break;
      }
      case "return": return new Return(s.value ? evalExpr(s.value, sc, ctx) : undefined);
      case "expr": evalExpr(s.expr, sc, ctx); break;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------- async path (generators yield awaited promises)

type Gen = Generator<unknown, unknown, unknown>;

const awaitCache = new WeakMap<object, boolean>();
export function hasAwait(e: Expr | Stmt | Stmt[]): boolean {
  if (Array.isArray(e)) return e.some(hasAwait);
  const cached = awaitCache.get(e);
  if (cached !== undefined) return cached;
  let r = false;
  if ("type" in e) {
    if (e.type === "AwaitExpression") r = true;
    else if (e.type === "ArrowFunctionExpression") r = false;
    else for (const v of Object.values(e)) {
      if (v && typeof v === "object") {
        if (Array.isArray(v)) { if (v.some((x) => x && typeof x === "object" && "type" in x && hasAwait(x))) { r = true; break; } }
        else if ("type" in v && hasAwait(v as Expr)) { r = true; break; }
      }
    }
  } else {
    switch (e.s) {
      case "let": case "var": r = !!e.init && hasAwait(e.init); break;
      case "if": r = hasAwait(e.cond) || hasAwait(e.then) || (!!e.else && (Array.isArray(e.else) ? hasAwait(e.else) : hasAwait(e.else))); break;
      case "for": r = hasAwait(e.src) || hasAwait(e.body); break;
      case "return": r = !!e.value && hasAwait(e.value); break;
      case "expr": r = hasAwait(e.expr); break;
    }
  }
  awaitCache.set(e, r);
  return r;
}

export function* evalGen(e: Expr, sc: Scope, ctx: Ctx): Gen {
  if (!hasAwait(e)) return evalExpr(e, sc, ctx);
  tick(ctx);
  switch (e.type) {
    case "AwaitExpression": return yield yield* evalGen(e.argument, sc, ctx);
    case "MemberExpression": {
      const obj = yield* evalGen(e.object, sc, ctx);
      if (e.optional && (obj === null || obj === undefined)) throw SHORT;
      const key = e.computed ? yield* evalGen(e.property, sc, ctx) : (e.property as { name: string }).name;
      return getMember(obj, key, ctx);
    }
    case "ChainExpression":
      try { return yield* evalGen(e.expression, sc, ctx); } catch (x) { if (x === SHORT) return undefined; throw x; }
    case "CallExpression": {
      let fn: unknown;
      if (e.callee.type === "MemberExpression") {
        const obj = yield* evalGen(e.callee.object, sc, ctx);
        if (e.callee.optional && (obj === null || obj === undefined)) throw SHORT;
        const key = e.callee.computed ? yield* evalGen(e.callee.property, sc, ctx) : (e.callee.property as { name: string }).name;
        fn = getMember(obj, key, ctx);
      } else fn = yield* evalGen(e.callee, sc, ctx);
      if (e.optional && (fn === null || fn === undefined)) throw SHORT;
      const args: unknown[] = [];
      for (const a of e.arguments) args.push(yield* evalGen(a, sc, ctx));
      return callValue(fn, args, e.callee);
    }
    case "NewExpression": { const args: unknown[] = []; for (const a of e.arguments) args.push(yield* evalGen(a, sc, ctx)); return construct(e, args, ctx); }
    case "ArrayExpression": { const out: unknown[] = []; for (const x of e.elements) out.push(yield* evalGen(x, sc, ctx)); return out; }
    case "ObjectExpression": {
      const o: Record<string, unknown> = {};
      for (const p of e.properties) {
        const k = p.key.type === "Identifier" ? p.key.name : String((p.key as { value: unknown }).value);
        o[k] = yield* evalGen(p.value, sc, ctx);
      }
      return o;
    }
    case "UnaryExpression": { const v = yield* evalGen(e.argument, sc, ctx); return e.operator === "!" ? !v : e.operator === "-" ? -(v as number) : +(v as number); }
    case "BinaryExpression": { const l = yield* evalGen(e.left, sc, ctx); const r = yield* evalGen(e.right, sc, ctx); return binary(e.operator, l, r); }
    case "LogicalExpression": {
      const l = yield* evalGen(e.left, sc, ctx);
      if (e.operator === "&&") return l ? yield* evalGen(e.right, sc, ctx) : l;
      return l ? l : yield* evalGen(e.right, sc, ctx);
    }
    case "ConditionalExpression": return (yield* evalGen(e.test, sc, ctx)) ? yield* evalGen(e.consequent, sc, ctx) : yield* evalGen(e.alternate, sc, ctx);
    case "AssignmentExpression": { const v = yield* evalGen(e.right, sc, ctx); return assign(e.left, e.operator, v, sc, ctx); }
    case "SequenceExpression": { let v: unknown; for (const x of e.expressions) v = yield* evalGen(x, sc, ctx); return v; }
    case "TryExpression": {
      try { return yield* evalGen(e.expr, sc, ctx); }
      catch (err) {
        if (err === SHORT || isFatal(err)) throw err;
        const fb = yield* evalGen(e.fallback, sc, ctx);
        return typeof fb === "function" ? fb(err) : fb;
      }
    }
  }
  return evalExpr(e, sc, ctx);
}

export function* execStmtsGen(stmts: Stmt[], sc: Scope, ctx: Ctx): Gen {
  for (const s of stmts) {
    if (!hasAwait(s)) {
      const r = execStmts([s], sc, ctx);
      if (r) return r.value;
      continue;
    }
    tick(ctx);
    switch (s.s) {
      case "let": case "var":
        sc.define(s.name, localCell(s.init ? yield* evalGen(s.init, sc, ctx) : undefined, s.s === "let" ? "const" : "local"));
        break;
      case "if": {
        const branch = (yield* evalGen(s.cond, sc, ctx)) ? s.then : s.else;
        if (!branch) break;
        const r = Array.isArray(branch) ? yield* execStmtsGen(branch, new Scope(sc), ctx) : yield* execStmtsGen([branch], sc, ctx);
        if (r !== NO_RETURN) return r;
        break;
      }
      case "for": {
        const src = yield* evalGen(s.src, sc, ctx);
        const arr = src === null || src === undefined ? [] : src;
        if (!Array.isArray(arr)) throw new HostError("RT01", `\`for\` source is not an array (got ${typeof arr})`);
        for (let i = 0; i < arr.length; i++) {
          const inner = new Scope(sc);
          inner.define(s.item, localCell(arr[i]));
          if (s.index) inner.define(s.index, localCell(i));
          const r = yield* execStmtsGen(s.body, inner, ctx);
          if (r !== NO_RETURN) return r;
        }
        break;
      }
      case "return": return s.value ? yield* evalGen(s.value, sc, ctx) : undefined;
      case "expr": yield* evalGen(s.expr, sc, ctx); break;
    }
  }
  return NO_RETURN;
}
const NO_RETURN = Symbol("no-return");

/** Drive a generator: each synchronous segment runs inside a batch (C-17). */
export function drive(gen: Gen, wrap: <T>(f: () => T) => T = (f) => f()): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const step = (method: "next" | "throw", value: unknown): void => {
      let r: IteratorResult<unknown>;
      try { r = wrap(() => gen[method](value)); } catch (err) { reject(err); return; }
      if (r.done) { resolve(r.value === NO_RETURN ? undefined : r.value); return; }
      Promise.resolve(r.value).then((v) => step("next", v), (err) => step("throw", err));
    };
    step("next", undefined);
  });
}
