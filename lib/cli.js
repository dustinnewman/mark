#!/usr/bin/env node
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/assets.ts
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
function textAsset(key, fallbackPath) {
  if (sea) {
    try {
      return sea.getAsset(key, "utf8");
    } catch {
      return null;
    }
  }
  if (embedded) return key in embedded ? Buffer.from(embedded[key], "base64").toString("utf8") : null;
  const p = isAbsolute(fallbackPath) ? fallbackPath : join(pkgDir(), fallbackPath);
  return existsSync(p) ? readFileSync(p, "utf8") : null;
}
function binaryAsset(key, fallbackPath) {
  if (sea) {
    try {
      return Buffer.from(sea.getAsset(key));
    } catch {
      return null;
    }
  }
  if (embedded) return key in embedded ? Buffer.from(embedded[key], "base64") : null;
  const p = isAbsolute(fallbackPath) ? fallbackPath : join(pkgDir(), fallbackPath);
  return existsSync(p) ? readFileSync(p) : null;
}
function katexFontNames() {
  const list = textAsset("katex-fonts.json", "__none__");
  if (list) return JSON.parse(list);
  const dir = join(KATEX_DIST, "fonts");
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".woff2")) : [];
}
var sea, pkgDir, embedded, KATEX_DIST;
var init_assets = __esm({
  "src/assets.ts"() {
    "use strict";
    sea = null;
    try {
      const api = process.getBuiltinModule?.("node:sea");
      sea = api && api.isSea() ? api : null;
    } catch {
      sea = null;
    }
    pkgDir = () => {
      try {
        if (import.meta.url) return join(dirname(fileURLToPath(import.meta.url)), "..");
      } catch {
      }
      return typeof __dirname === "string" ? join(__dirname, "..") : process.cwd();
    };
    embedded = typeof __MARK_ASSETS__ !== "undefined" ? __MARK_ASSETS__ : null;
    KATEX_DIST = (() => {
      try {
        return join(dirname(createRequire(import.meta.url).resolve("katex/package.json")), "dist");
      } catch {
        return "node_modules/katex/dist";
      }
    })();
  }
});

// src/core/signal.ts
function untrack(fn) {
  const prev = tracking;
  tracking = false;
  try {
    return fn();
  } finally {
    tracking = prev;
  }
}
function getOwner() {
  return currentOwner;
}
function runWithOwner(owner, fn) {
  const prevOwner = currentOwner, prevRx = currentRx, prevTracking = tracking;
  currentOwner = owner;
  currentRx = null;
  tracking = false;
  try {
    return fn();
  } finally {
    currentOwner = prevOwner;
    currentRx = prevRx;
    tracking = prevTracking;
  }
}
function onCleanup(fn) {
  if (currentOwner) currentOwner.cleanups.push(fn);
}
function batch(fn) {
  batchDepth++;
  try {
    return fn();
  } finally {
    batchDepth--;
    if (batchDepth === 0) flush();
  }
}
function flush() {
  flushScheduled = false;
  let guard2 = 0;
  while (queue.length) {
    const q = queue;
    queue = [];
    for (const e of q) if (!e.disposed && e.state !== CLEAN) e.updateIfNecessary();
    if (++guard2 > 1e3) throw new Error("Effect loop: effects keep scheduling each other");
  }
}
function scheduleFlush() {
  if (flushScheduled) return;
  flushScheduled = true;
  queueMicrotask(() => {
    if (flushScheduled) flush();
  });
}
var CLEAN, CHECK, DIRTY, CycleError, Owner, Rx, currentRx, currentOwner, tracking, batchDepth, queue, flushScheduled, signal, computed, effect;
var init_signal = __esm({
  "src/core/signal.ts"() {
    "use strict";
    CLEAN = 0;
    CHECK = 1;
    DIRTY = 2;
    CycleError = class extends Error {
      code = "RT03";
      constructor(names) {
        super("Cycle: " + names.join(" \u2192 "));
      }
    };
    Owner = class {
      children = [];
      cleanups = [];
      disposed = false;
      parent;
      constructor(parent = currentOwner) {
        this.parent = parent;
        if (parent) parent.children.push(this);
      }
      dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.disposeChildren();
        if (this.parent) {
          const i = this.parent.children.indexOf(this);
          if (i >= 0) this.parent.children.splice(i, 1);
        }
      }
      disposeChildren() {
        const kids = this.children;
        this.children = [];
        for (let i = kids.length - 1; i >= 0; i--) {
          const k = kids[i];
          k.parent = null;
          k.dispose();
        }
        const cl = this.cleanups;
        this.cleanups = [];
        for (let i = cl.length - 1; i >= 0; i--) cl[i]();
      }
    };
    Rx = class extends Owner {
      value;
      fn;
      sources = [];
      observers = [];
      state;
      effect;
      running = false;
      name;
      constructor(value, fn, effect2 = false, name = "") {
        super(fn ? currentOwner : null);
        this.value = value;
        this.fn = fn;
        this.effect = effect2;
        this.state = fn ? DIRTY : CLEAN;
        this.name = name;
        if (effect2) this.update();
      }
      get() {
        if (currentRx && tracking) {
          const obs = this.observers;
          if (obs[obs.length - 1] !== currentRx) {
            obs.push(currentRx);
            currentRx.sources.push(this);
          }
        }
        if (this.fn) {
          if (this.running) throw new CycleError([this.name, this.name]);
          this.updateIfNecessary();
        }
        return this.value;
      }
      peek() {
        if (this.fn) this.updateIfNecessary();
        return this.value;
      }
      set(v) {
        if (this.fn) throw new Error("Cannot assign to a computed value");
        if (v === this.value) return;
        this.value = v;
        this.mark(DIRTY);
        if (batchDepth === 0) scheduleFlush();
      }
      /** Mark observers stale. Direct observers become DIRTY, transitive ones CHECK. */
      mark(state) {
        for (const o of this.observers) {
          if (o.state < state) {
            o.state = state;
            if (o.effect) queue.push(o);
            if (state === DIRTY || o.state === CHECK) o.markCheck();
          }
        }
      }
      markCheck() {
        for (const o of this.observers) {
          if (o.state === CLEAN) {
            o.state = CHECK;
            if (o.effect) queue.push(o);
            o.markCheck();
          }
        }
      }
      updateIfNecessary() {
        if (this.state === CHECK) {
          for (const s of this.sources) {
            s.updateIfNecessary();
            if (this.state === DIRTY) break;
          }
        }
        if (this.state === DIRTY) this.update();
        this.state = CLEAN;
      }
      unlink() {
        for (const s of this.sources) {
          const i = s.observers.indexOf(this);
          if (i >= 0) s.observers.splice(i, 1);
        }
        this.sources = [];
      }
      update() {
        if (this.disposed || !this.fn) return;
        if (this.running) throw new CycleError([this.name, this.name]);
        this.disposeChildren();
        this.unlink();
        const prevRx = currentRx, prevOwner = currentOwner, prevTracking = tracking;
        currentRx = this;
        currentOwner = this;
        tracking = true;
        this.running = true;
        let next;
        try {
          next = this.fn();
        } finally {
          this.running = false;
          currentRx = prevRx;
          currentOwner = prevOwner;
          tracking = prevTracking;
        }
        this.state = CLEAN;
        if (this.effect) return;
        if (next !== this.value) {
          this.value = next;
          for (const o of this.observers) o.state = DIRTY;
        }
      }
      dispose() {
        if (this.disposed) return;
        super.dispose();
        this.unlink();
        this.fn = null;
      }
    };
    currentRx = null;
    currentOwner = null;
    tracking = true;
    batchDepth = 0;
    queue = [];
    flushScheduled = false;
    signal = (value, name = "") => new Rx(value, null, false, name);
    computed = (fn, name = "") => new Rx(void 0, fn, false, name);
    effect = (fn, name = "") => new Rx(void 0, fn, true, name);
  }
});

// src/core/reactive.ts
function toRaw(v) {
  return typeof v === "object" && v !== null && v[RAW] || v;
}
function reactive(v) {
  if (!isPlain(v) || Object.isFrozen(v)) return v;
  const raw = toRaw(v);
  if (raw !== v) return v;
  let p = proxies.get(raw);
  if (!p) {
    p = new Proxy(raw, handlers);
    proxies.set(raw, p);
  }
  return p;
}
function track(target, key) {
  let m = deps.get(target);
  if (!m) deps.set(target, m = /* @__PURE__ */ new Map());
  let s = m.get(key);
  if (!s) m.set(key, s = signal(0));
  s.get();
}
function trigger(target, key) {
  const s = deps.get(target)?.get(key);
  if (s) s.set(s.value + 1);
}
function deepFreeze(v) {
  if (isPlain(v) && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const k of Object.keys(v)) deepFreeze(v[k]);
  }
  return v;
}
var RAW, ITERATE, proxies, deps, isPlain, eq, handlers;
var init_reactive = __esm({
  "src/core/reactive.ts"() {
    "use strict";
    init_signal();
    RAW = Symbol("mk.raw");
    ITERATE = Symbol("mk.iterate");
    proxies = /* @__PURE__ */ new WeakMap();
    deps = /* @__PURE__ */ new WeakMap();
    isPlain = (v) => {
      if (typeof v !== "object" || v === null) return false;
      if (Array.isArray(v)) return true;
      const p = Object.getPrototypeOf(v);
      return p === Object.prototype || p === null;
    };
    eq = (a, b) => toRaw(a) === toRaw(b);
    handlers = {
      get(target, key, receiver) {
        if (key === RAW) return target;
        const res = Reflect.get(target, key, receiver);
        if (typeof key === "symbol") return res;
        track(target, key);
        if (typeof res === "function") return res;
        return reactive(res);
      },
      set(target, key, value) {
        const raw = toRaw(value);
        const had = Object.prototype.hasOwnProperty.call(target, key);
        const old = target[key];
        const ok = Reflect.set(target, key, raw);
        if (!had) {
          trigger(target, key);
          trigger(target, ITERATE);
          if (Array.isArray(target)) trigger(target, "length");
        } else if (old !== raw || key === "length" && Array.isArray(target)) {
          trigger(target, key);
          if (key === "length") trigger(target, ITERATE);
        }
        return ok;
      },
      deleteProperty(target, key) {
        const had = Object.prototype.hasOwnProperty.call(target, key);
        const ok = Reflect.deleteProperty(target, key);
        if (had) {
          trigger(target, key);
          trigger(target, ITERATE);
        }
        return ok;
      },
      has(target, key) {
        if (typeof key !== "symbol") track(target, key);
        return Reflect.has(target, key);
      },
      ownKeys(target) {
        track(target, ITERATE);
        return Reflect.ownKeys(target);
      }
    };
  }
});

// src/core/host.ts
function fmt(v) {
  if (v === null || v === void 0 || v === false) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") return String(v);
  if (Array.isArray(v)) return v.map(fmt).join("");
  if (typeof v === "function") return "";
  if (v instanceof Date) return v.toISOString();
  return JSON.stringify(v);
}
function styleToString(v) {
  if (v === null || v === void 0 || v === false) return "";
  if (typeof v === "string") return v;
  if (typeof v !== "object") return String(v);
  const raw = toRaw(v);
  const out = [];
  for (const k of Object.keys(raw)) {
    const val = raw[k];
    if (val === null || val === void 0 || val === false || val === "") continue;
    const name = k.startsWith("--") ? k : k.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());
    out.push(`${name}: ${String(val)}`);
  }
  return out.join("; ");
}
function attrValue(name, v) {
  if (name === "style") {
    const s = styleToString(v);
    return s === "" ? null : s;
  }
  if (BOOLEAN_ATTRS.has(name)) return v ? "" : null;
  if (v === null || v === void 0 || v === false) return null;
  if (v === true) return "";
  return fmt(v);
}
var words, MATH_MEMBERS, NUMBER_STATIC, NUMBER_METHODS, STRING_METHODS, ARRAY_STATIC, ARRAY_METHODS, ARRAY_MUTATORS, OBJECT_STATIC, JSON_STATIC, DATE_STATIC, DATE_METHODS, CONSOLE_MEMBERS, PROMISE_STATIC, ENV_MEMBERS, HostError, e021, compareStrings, BOOLEAN_ATTRS, escapeHtml, escapeAttr;
var init_host = __esm({
  "src/core/host.ts"() {
    "use strict";
    init_reactive();
    words = (s) => new Set(s.split(" "));
    MATH_MEMBERS = words("abs ceil floor round trunc sign sqrt cbrt pow exp log log2 log10 min max hypot sin cos tan asin acos atan atan2 PI E random");
    NUMBER_STATIC = words("isFinite isInteger isNaN parseFloat parseInt MAX_SAFE_INTEGER EPSILON");
    NUMBER_METHODS = words("toFixed toPrecision toString");
    STRING_METHODS = words("length slice substring indexOf lastIndexOf includes startsWith endsWith split trim trimStart trimEnd toUpperCase toLowerCase replace replaceAll repeat padStart padEnd charAt charCodeAt at localeCompare concat");
    ARRAY_STATIC = words("isArray from of");
    ARRAY_METHODS = words("length map filter reduce reduceRight find findIndex findLast findLastIndex some every includes indexOf lastIndexOf join slice concat flat flatMap at keys entries values sort toSorted reverse toReversed push pop shift unshift splice fill forEach");
    ARRAY_MUTATORS = words("sort reverse push pop shift unshift splice fill");
    OBJECT_STATIC = words("keys values entries fromEntries assign freeze");
    JSON_STATIC = words("parse stringify");
    DATE_STATIC = words("now");
    DATE_METHODS = words("getFullYear getMonth getDate getDay getHours getMinutes getSeconds getTime valueOf toISOString toLocaleDateString toLocaleTimeString toLocaleString");
    CONSOLE_MEMBERS = words("log warn error");
    PROMISE_STATIC = words("all allSettled race resolve reject");
    ENV_MEMBERS = words("reducedMotion client dev touch");
    HostError = class extends Error {
      code;
      constructor(code, message) {
        super(message);
        this.code = code;
      }
    };
    e021 = (m) => new HostError("E021", `\`${m}\` is not available in Mark expressions`);
    compareStrings = (a, b) => a < b ? -1 : a > b ? 1 : 0;
    BOOLEAN_ATTRS = words("disabled checked hidden readonly required selected multiple autofocus autoplay controls loop muted open default defer async novalidate formnovalidate inert itemscope nomodule playsinline reversed");
    escapeHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    escapeAttr = (s) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  }
});

// src/ast.ts
var PH, placeholder, PLACEHOLDER_RE;
var init_ast = __esm({
  "src/ast.ts"() {
    "use strict";
    PH = String.fromCharCode(0);
    placeholder = (n) => PH + n + PH;
    PLACEHOLDER_RE = new RegExp(PH + "(\\d+)" + PH, "g");
  }
});

// src/diagnostics.ts
var MarkError, syntax, formatDiagnostic, MSG;
var init_diagnostics = __esm({
  "src/diagnostics.ts"() {
    "use strict";
    MarkError = class extends Error {
      code;
      line;
      col;
      file;
      constructor(code, message, line = 0, col = 0, file = "") {
        super(message);
        this.code = code;
        this.line = line;
        this.col = col;
        this.file = file;
      }
      toDiagnostic(file = this.file) {
        return {
          file,
          line: this.line,
          col: this.col,
          code: this.code,
          message: this.message,
          severity: this.code.startsWith("W") ? "warning" : "error"
        };
      }
    };
    syntax = (message, line, col = 0) => new MarkError("SYNTAX", message, line, col);
    formatDiagnostic = (d) => `${d.file}:${d.line}${d.col ? ":" + d.col : ""} ${d.severity} ${d.code}: ${d.message}`;
    MSG = {
      E001: () => "`else` must follow `}` on the same line",
      E002: (x, y, n) => `Mismatched closing tag </${x}> for <${y}> opened at line ${n}`,
      E003: (n, l) => `\`${n}\` is used before its declaration (line ${l})`,
      E004: (n, l) => `\`${n}\` is already declared at line ${l}`,
      E005: (kind, n) => `Cannot assign to ${kind} \`${n}\``,
      E006: () => "Assignment is only allowed inside handlers and functions",
      E007: (x) => `Unknown component <${x}>`,
      E008: (x, y, avail) => `Component ${x} has no prop \`${y}\` (available: ${avail.join(", ") || "none"})`,
      E009: (p, root) => `Cannot bind \`$${p}\`: root \`${root}\` is not a \`var\`, loop item, or bound prop`,
      E010: (n) => `Page prop \`${n}\` must have a literal default`,
      E011: (p, a, b) => `Path \`${p}\` is produced by both \`${a}\` and \`${b}\``,
      E013: () => "`export var` is not allowed",
      E014: (x) => `Void element <${x}> cannot have children`,
      E016: () => "`await` is only allowed in `async fn`, handlers, and async arrows",
      E017: () => "`return` outside a function body",
      E018: () => "`try` takes exactly two operands: `try(expr, fallback)`",
      E019: () => "`$` shorthand cannot end in `[\u2026]`; give the prop a name",
      E020: () => "`<style>` must be at document top level; at most one per document",
      E021: (m) => `\`${m}\` is not available in Mark expressions`,
      E022: () => "`Math.random`/`Date.now` cannot be used in static content; use it in a `var` or handler",
      E023: () => "Page evaluation exceeded the operation limit",
      E024: (f) => `Dynamic page \`${f}\` has no \`prop paths\` and SPA mode is off`,
      W001: () => "Layout has no <slot />",
      W002: (n) => `\`${n}\` shadows outer declaration`,
      W003: (x) => `Unknown HTML element <${x}>`,
      W004: () => "Expression statement has no effect"
    };
  }
});

// src/lexer.ts
var PUNCT, CONTINUATION, isIdentStart, isIdentChar, Scanner;
var init_lexer = __esm({
  "src/lexer.ts"() {
    "use strict";
    init_diagnostics();
    PUNCT = [
      "?.",
      "=>",
      "**",
      "==",
      "!=",
      "<=",
      ">=",
      "&&",
      "||",
      "+=",
      "-=",
      "*=",
      "/=",
      "/>",
      "(",
      ")",
      "[",
      "]",
      "{",
      "}",
      ",",
      ";",
      ":",
      ".",
      "?",
      "=",
      "<",
      ">",
      "+",
      "-",
      "*",
      "/",
      "%",
      "!",
      "$"
    ];
    CONTINUATION = /^(?:\n[ \t]*)+(\?|:|&&|\|\||\.(?=[A-Za-z_]))/;
    isIdentStart = (c) => /[A-Za-z_]/.test(c);
    isIdentChar = (c) => /[A-Za-z0-9_]/.test(c);
    Scanner = class {
      pos = 0;
      src;
      lineStarts = [0];
      constructor(src) {
        this.src = src;
        for (let i = 0; i < src.length; i++) if (src[i] === "\n") this.lineStarts.push(i + 1);
      }
      lineAt(pos) {
        let lo = 0, hi = this.lineStarts.length - 1;
        while (lo < hi) {
          const mid = lo + hi + 1 >> 1;
          if (this.lineStarts[mid] <= pos) lo = mid;
          else hi = mid - 1;
        }
        return lo + 1;
      }
      colAt(pos) {
        return pos - this.lineStarts[this.lineAt(pos) - 1] + 1;
      }
      get line() {
        return this.lineAt(this.pos);
      }
      get eof() {
        return this.pos >= this.src.length;
      }
      peekChar(off = 0) {
        return this.src[this.pos + off] ?? "";
      }
      startsWith(s) {
        return this.src.startsWith(s, this.pos);
      }
      /** Skip spaces/tabs (not newlines). */
      skipInlineWs() {
        while (this.pos < this.src.length && (this.src[this.pos] === " " || this.src[this.pos] === "	")) this.pos++;
      }
      /** Skip all whitespace including newlines. */
      skipWs() {
        while (this.pos < this.src.length && /\s/.test(this.src[this.pos])) this.pos++;
      }
      /** Rest of the current line (not consumed). */
      restOfLine() {
        const nl = this.src.indexOf("\n", this.pos);
        return nl < 0 ? this.src.slice(this.pos) : this.src.slice(this.pos, nl);
      }
      /** Consume through end of current line (including the newline). */
      consumeLine() {
        const nl = this.src.indexOf("\n", this.pos);
        const s = nl < 0 ? this.src.slice(this.pos) : this.src.slice(this.pos, nl);
        this.pos = nl < 0 ? this.src.length : nl + 1;
        return s;
      }
      atLineEnd() {
        this.skipInlineWs();
        return this.eof || this.src[this.pos] === "\n";
      }
      /** Require nothing but whitespace/comment until end of line, then consume the newline. */
      expectEol() {
        this.skipInlineWs();
        if (this.startsWith("//")) this.consumeLine();
        else if (this.eof) return;
        else if (this.src[this.pos] === "\n") this.pos++;
        else throw syntax(`Unexpected \`${this.restOfLine().trim()}\` at end of line`, this.line, this.colAt(this.pos));
      }
      /**
       * Tokenize at the current position. `multiline` lets whitespace span lines; otherwise a
       * line break ends the expression unless the next line starts with `?`, `:`, `&&`, `||` or `.name`
       * (an operator-led continuation line, as in the spec's multi-line ternaries).
       */
      token(multiline) {
        if (multiline) this.skipWs();
        else {
          this.skipInlineWs();
          const m = CONTINUATION.exec(this.src.slice(this.pos, this.pos + 200));
          if (m) this.pos += m[0].length - m[1].length;
        }
        const start = this.pos;
        const line = this.lineAt(start), col = this.colAt(start);
        const mk = (type, value, num) => ({ type, value, num, pos: start, end: this.pos, line, col });
        if (this.eof) return mk("eof", "");
        if (this.src.startsWith("//", this.pos)) {
          const nl = this.src.indexOf("\n", this.pos);
          this.pos = nl < 0 ? this.src.length : nl;
          return nl < 0 ? mk("eof", "") : mk("nl", "\n");
        }
        const c = this.src[this.pos];
        if (c === "\n") return mk("nl", "\n");
        if (isIdentStart(c)) {
          while (this.pos < this.src.length && isIdentChar(this.src[this.pos])) this.pos++;
          return mk("ident", this.src.slice(start, this.pos));
        }
        if (/[0-9]/.test(c) || c === "." && /[0-9]/.test(this.src[this.pos + 1] ?? "")) {
          const m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(this.src.slice(this.pos));
          this.pos += m[0].length;
          if (isIdentStart(this.src[this.pos] ?? "")) throw syntax(`Invalid number \`${m[0]}${this.src[this.pos]}\``, line, col);
          return mk("num", m[0], Number(m[0]));
        }
        if (c === '"' || c === "'") {
          const q = c;
          let s = "";
          this.pos++;
          for (; ; ) {
            if (this.eof || this.src[this.pos] === "\n") throw syntax("Unterminated string", line, col);
            const ch = this.src[this.pos++];
            if (ch === q) break;
            if (ch === "\\") {
              const e = this.src[this.pos++];
              switch (e) {
                case "n":
                  s += "\n";
                  break;
                case "t":
                  s += "	";
                  break;
                case "r":
                  s += "\r";
                  break;
                case "b":
                  s += "\b";
                  break;
                case "f":
                  s += "\f";
                  break;
                case "v":
                  s += "\v";
                  break;
                case "0":
                  s += "\0";
                  break;
                case "x":
                  s += String.fromCharCode(parseInt(this.src.substr(this.pos, 2), 16));
                  this.pos += 2;
                  break;
                case "u": {
                  if (this.src[this.pos] === "{") {
                    const close = this.src.indexOf("}", this.pos);
                    s += String.fromCodePoint(parseInt(this.src.slice(this.pos + 1, close), 16));
                    this.pos = close + 1;
                  } else {
                    s += String.fromCharCode(parseInt(this.src.substr(this.pos, 4), 16));
                    this.pos += 4;
                  }
                  break;
                }
                case "\n":
                  break;
                default:
                  s += e;
              }
            } else s += ch;
          }
          return mk("str", s);
        }
        for (const p of PUNCT) {
          if (this.src.startsWith(p, this.pos)) {
            this.pos += p.length;
            return mk("punct", p);
          }
        }
        throw syntax(`Unexpected character \`${c}\``, line, col);
      }
    };
  }
});

// src/expr.ts
function describe(t) {
  if (t.type === "eof") return "end of input";
  if (t.type === "nl") return "end of line";
  return `\`${t.value}\``;
}
var RESERVED, BIN_PREC, ASSIGN_OPS, ExprParser;
var init_expr = __esm({
  "src/expr.ts"() {
    "use strict";
    init_diagnostics();
    init_lexer();
    RESERVED = /* @__PURE__ */ new Set([
      "var",
      "let",
      "prop",
      "fn",
      "if",
      "else",
      "for",
      "in",
      "key",
      "try",
      "return",
      "await",
      "async",
      "true",
      "false",
      "null",
      "undefined",
      "slot"
    ]);
    BIN_PREC = {
      "||": 1,
      "&&": 2,
      "==": 3,
      "!=": 3,
      "<": 4,
      ">": 4,
      "<=": 4,
      ">=": 4,
      "+": 5,
      "-": 5,
      "*": 6,
      "/": 6,
      "%": 6
    };
    ASSIGN_OPS = /* @__PURE__ */ new Set(["=", "+=", "-=", "*=", "/="]);
    ExprParser = class {
      peeked = null;
      peekedMulti = false;
      multiline = false;
      tag = false;
      sc;
      constructor(sc) {
        this.sc = sc;
      }
      /** Parse one full expression (with `;` sequences) starting at the scanner position. */
      parse(opts = {}) {
        const saveM = this.multiline, saveT = this.tag;
        this.multiline = !!opts.multiline;
        this.tag = !!opts.tag;
        this.drop();
        try {
          return this.seq();
        } finally {
          this.drop();
          this.multiline = saveM;
          this.tag = saveT;
        }
      }
      // ---- token helpers ----
      drop() {
        if (this.peeked) {
          this.sc.pos = this.peeked.pos;
          this.peeked = null;
        }
      }
      peek() {
        if (this.peeked && this.peekedMulti === this.multiline) return this.peeked;
        this.drop();
        const save = this.sc.pos;
        const t = this.sc.token(this.multiline);
        this.sc.pos = save;
        this.peeked = t;
        this.peekedMulti = this.multiline;
        return t;
      }
      next() {
        const t = this.peek();
        this.peeked = null;
        this.sc.pos = t.end;
        return t;
      }
      is(value, type = "punct") {
        const t = this.peek();
        return t.type === type && t.value === value;
      }
      eat(value, type = "punct") {
        if (this.is(value, type)) {
          this.next();
          return true;
        }
        return false;
      }
      expect(value) {
        const t = this.peek();
        if (t.type !== "punct" || t.value !== value) throw this.err(`Expected \`${value}\` but found ${describe(t)}`, t);
        return this.next();
      }
      err(msg, t = this.peek()) {
        return syntax(msg, t.line, t.col);
      }
      /** Run `f` with multiline enabled (inside brackets). */
      nested(f) {
        const m = this.multiline, tg = this.tag;
        this.multiline = true;
        this.tag = false;
        try {
          return f();
        } finally {
          this.multiline = m;
          this.tag = tg;
        }
      }
      ident() {
        const t = this.peek();
        if (t.type !== "ident") throw this.err(`Expected identifier but found ${describe(t)}`, t);
        if (RESERVED.has(t.value)) throw this.err(`\`${t.value}\` is a reserved word`, t);
        this.next();
        return t.value;
      }
      // ---- grammar ----
      seq() {
        const first = this.assign();
        if (!this.is(";")) return first;
        const expressions = [first];
        while (this.eat(";")) expressions.push(this.assign());
        return { type: "SequenceExpression", expressions };
      }
      assign() {
        const left = this.ternary();
        const t = this.peek();
        if (t.type === "punct" && ASSIGN_OPS.has(t.value)) {
          if (left.type !== "Identifier" && left.type !== "MemberExpression") throw this.err("Invalid assignment target", t);
          this.next();
          const right = this.assign();
          return { type: "AssignmentExpression", operator: t.value, left, right };
        }
        return left;
      }
      ternary() {
        const test = this.binary(1);
        if (!this.eat("?")) return test;
        const consequent = this.nested(() => this.assignNoSeq());
        this.expect(":");
        const alternate = this.ternary();
        return { type: "ConditionalExpression", test, consequent, alternate };
      }
      /** `expr` inside a ternary branch: everything but `;`. */
      assignNoSeq() {
        return this.assign();
      }
      binary(minPrec) {
        let left = this.pow();
        for (; ; ) {
          const t = this.peek();
          if (t.type !== "punct") break;
          if (this.tag && (t.value === "/>" || t.value === ">" && !/^[ \t]+[\w("'\[{!\-.]/.test(this.sc.src.slice(t.end)))) break;
          const prec = BIN_PREC[t.value];
          if (prec === void 0 || prec < minPrec) break;
          this.next();
          const right = this.binary(prec + 1);
          left = t.value === "&&" || t.value === "||" ? { type: "LogicalExpression", operator: t.value, left, right } : { type: "BinaryExpression", operator: t.value, left, right };
        }
        return left;
      }
      pow() {
        const base = this.unary();
        if (this.eat("**")) {
          const exp = this.pow();
          return { type: "BinaryExpression", operator: "**", left: base, right: exp };
        }
        return base;
      }
      unary() {
        const t = this.peek();
        if (t.type === "punct" && (t.value === "!" || t.value === "-" || t.value === "+")) {
          this.next();
          return { type: "UnaryExpression", operator: t.value, prefix: true, argument: this.unary() };
        }
        if (t.type === "ident" && t.value === "await") {
          this.next();
          return { type: "AwaitExpression", argument: this.unary() };
        }
        return this.postfix();
      }
      postfix() {
        let e = this.primary();
        let chained = false;
        for (; ; ) {
          const t = this.peek();
          if (t.type !== "punct") break;
          if (t.value === ".") {
            this.next();
            const name = this.propName();
            e = { type: "MemberExpression", object: e, property: { type: "Identifier", name }, computed: false };
          } else if (t.value === "?.") {
            this.next();
            chained = true;
            if (this.is("(")) {
              e = { type: "CallExpression", callee: e, arguments: this.args(), optional: true };
            } else if (this.is("[")) {
              this.next();
              const property = this.nested(() => this.seq());
              this.expect("]");
              e = { type: "MemberExpression", object: e, property, computed: true, optional: true };
            } else {
              const name = this.propName();
              e = { type: "MemberExpression", object: e, property: { type: "Identifier", name }, computed: false, optional: true };
            }
          } else if (t.value === "[") {
            this.next();
            const property = this.nested(() => this.seq());
            this.expect("]");
            e = { type: "MemberExpression", object: e, property, computed: true };
          } else if (t.value === "(") {
            e = { type: "CallExpression", callee: e, arguments: this.args() };
          } else break;
        }
        return chained ? { type: "ChainExpression", expression: e } : e;
      }
      /** Property names after `.` may be any identifier, including reserved words. */
      propName() {
        const t = this.peek();
        if (t.type !== "ident") throw this.err(`Expected property name but found ${describe(t)}`, t);
        this.next();
        return t.value;
      }
      args() {
        this.expect("(");
        return this.nested(() => {
          const out = [];
          if (this.eat(")")) return out;
          for (; ; ) {
            out.push(this.assign());
            if (this.eat(")")) return out;
            this.expect(",");
          }
        });
      }
      primary() {
        const t = this.peek();
        switch (t.type) {
          case "num":
            this.next();
            return { type: "Literal", value: t.num };
          case "str":
            this.next();
            return { type: "Literal", value: t.value };
          case "ident":
            break;
          case "punct":
            if (t.value === "(") return this.parenOrArrow();
            if (t.value === "[") return this.array();
            if (t.value === "{") return this.object();
            throw this.err(`Unexpected \`${t.value}\``, t);
          default:
            throw this.err(`Unexpected ${describe(t)}`, t);
        }
        switch (t.value) {
          case "true":
            this.next();
            return { type: "Literal", value: true };
          case "false":
            this.next();
            return { type: "Literal", value: false };
          case "null":
            this.next();
            return { type: "Literal", value: null };
          case "undefined":
            this.next();
            return { type: "Literal", value: void 0 };
          case "try":
            return this.tryExpr();
          case "new":
            return this.newExpr();
          case "async": {
            this.next();
            const n = this.peek();
            if (n.type === "ident" || n.type === "punct" && n.value === "(") {
              const fn = this.arrowOrIdent();
              if (fn.type === "ArrowFunctionExpression") return { ...fn, async: true };
            }
            throw this.err("`async` must be followed by an arrow function", t);
          }
        }
        return this.arrowOrIdent();
      }
      /** `ident` or `ident => expr`. */
      arrowOrIdent() {
        const t = this.peek();
        if (t.type === "punct" && t.value === "(") return this.parenOrArrow();
        const name = this.ident();
        if (this.is("=>")) {
          this.next();
          const body = this.assign();
          return { type: "ArrowFunctionExpression", async: false, params: [{ type: "Identifier", name }], body, expression: true };
        }
        return { type: "Identifier", name };
      }
      /** `( expr )` or `( a, b ) => expr`. */
      parenOrArrow() {
        const open = this.next();
        const save = this.sc.pos;
        let depth = 1;
        let isArrow = false;
        try {
          for (; ; ) {
            const tk = this.sc.token(true);
            if (tk.type === "eof") break;
            if (tk.type === "punct") {
              if (tk.value === "(" || tk.value === "[" || tk.value === "{") depth++;
              else if (tk.value === ")" || tk.value === "]" || tk.value === "}") {
                depth--;
                if (depth === 0) break;
              }
            }
          }
          if (depth === 0) {
            const n = this.sc.token(true);
            isArrow = n.type === "punct" && n.value === "=>";
          }
        } catch {
          isArrow = false;
        }
        this.sc.pos = save;
        this.peeked = null;
        if (isArrow) {
          const params = this.nested(() => {
            const ps = [];
            if (this.eat(")")) return ps;
            for (; ; ) {
              ps.push({ type: "Identifier", name: this.ident() });
              if (this.eat(")")) return ps;
              this.expect(",");
            }
          });
          this.expect("=>");
          const body = this.assign();
          return { type: "ArrowFunctionExpression", async: false, params, body, expression: true };
        }
        const e = this.nested(() => this.seq());
        if (!this.is(")")) throw this.err(`Expected \`)\` to close \`(\` at line ${open.line}`);
        this.next();
        return e;
      }
      array() {
        this.expect("[");
        return this.nested(() => {
          const elements = [];
          if (this.eat("]")) return { type: "ArrayExpression", elements };
          for (; ; ) {
            elements.push(this.assign());
            if (this.eat("]")) return { type: "ArrayExpression", elements };
            this.expect(",");
            if (this.eat("]")) return { type: "ArrayExpression", elements };
          }
        });
      }
      object() {
        this.expect("{");
        return this.nested(() => {
          const properties = [];
          if (this.eat("}")) return { type: "ObjectExpression", properties };
          for (; ; ) {
            const t = this.peek();
            let key;
            let shorthandName = null;
            if (t.type === "str") {
              this.next();
              key = { type: "Literal", value: t.value };
            } else if (t.type === "num") {
              this.next();
              key = { type: "Literal", value: t.num };
            } else if (t.type === "ident") {
              this.next();
              key = { type: "Identifier", name: t.value };
              shorthandName = t.value;
            } else throw this.err(`Expected property key but found ${describe(t)}`, t);
            if (this.eat(":")) {
              properties.push({ type: "Property", key, value: this.assign(), computed: false, shorthand: false, kind: "init" });
            } else {
              if (shorthandName === null || RESERVED.has(shorthandName)) throw this.err("Expected `:` after property key");
              properties.push({ type: "Property", key, value: { type: "Identifier", name: shorthandName }, computed: false, shorthand: true, kind: "init" });
            }
            if (this.eat("}")) return { type: "ObjectExpression", properties };
            this.expect(",");
            if (this.eat("}")) return { type: "ObjectExpression", properties };
          }
        });
      }
      tryExpr() {
        const t = this.next();
        if (!this.is("(")) throw this.err("`try` is a reserved word; write `try(expr, fallback)`", t);
        const args = this.args();
        if (args.length !== 2) throw new MarkError("E018", MSG.E018(), t.line, t.col);
        return { type: "TryExpression", expr: args[0], fallback: args[1] };
      }
      newExpr() {
        this.next();
        const callee = { type: "Identifier", name: this.ident() };
        const args = this.is("(") ? this.args() : [];
        return { type: "NewExpression", callee, arguments: args };
      }
    };
  }
});

// src/parser.ts
function parseDocument(src) {
  return new DocParser(src).parse();
}
function mkTag(name, attrs, selfClose, line) {
  return { t: "tag", name, kind: /^[A-Z]/.test(name) ? "comp" : "html", attrs, children: [], selfClose, line };
}
function needsWrap(e) {
  if (e.type === "ChainExpression") return true;
  return !(e.type === "Identifier" || e.type === "MemberExpression" || e.type === "ArrowFunctionExpression");
}
function isReserved(s) {
  return RESERVED_DECL.has(s);
}
var VOID_ELEMENTS, CODE_LINE, TAG_NAME, ATTR_NAME, DocParser, RESERVED_DECL;
var init_parser = __esm({
  "src/parser.ts"() {
    "use strict";
    init_ast();
    init_diagnostics();
    init_expr();
    init_lexer();
    VOID_ELEMENTS = /* @__PURE__ */ new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
    CODE_LINE = /^(?:(?:export\s+)?(?:async\s+)?(?:var|let|prop|fn)\s|(?:if|for)\s|\}|else\b|<[A-Za-z]|<\/[A-Za-z])/;
    TAG_NAME = /^(?:[a-z][a-z0-9-]*|[A-Z][A-Za-z0-9]*(?:\.[A-Z][A-Za-z0-9]*)*)/;
    ATTR_NAME = /^[A-Za-z_:][A-Za-z0-9_:.-]*/;
    DocParser = class {
      sc;
      ep;
      stack = [];
      styleSeen = false;
      constructor(src) {
        this.sc = new Scanner(src.replace(/\r\n?/g, "\n"));
        this.ep = new ExprParser(this.sc);
      }
      get top() {
        return this.stack[this.stack.length - 1];
      }
      parse() {
        this.stack.push({ kind: "doc", items: [], line: 1, prose: null });
        while (!this.sc.eof) this.line();
        while (this.stack.length > 1) {
          const f = this.stack.pop();
          if (f.kind === "tag" || f.kind === "head") throw syntax(`Unclosed <${f.kind === "head" ? "head" : f.tag.name}> opened at line ${f.line}`, f.line);
          throw syntax(`Unclosed \`${f.kind}\` block opened at line ${f.line}`, f.line);
        }
        const doc = this.stack.pop();
        this.flush(doc);
        return doc.items;
      }
      // ---- prose accumulation ----
      pending(frame, line) {
        if (!frame.prose) frame.prose = { md: "", parts: [], line, touched: true };
        frame.prose.touched = true;
        return frame.prose;
      }
      flush(frame) {
        const p = frame.prose;
        if (!p) return;
        frame.prose = null;
        const md = p.md.replace(/\n+$/, "\n");
        if (md.trim() === "" && p.parts.length === 0) return;
        const node = { t: "prose", md, parts: p.parts, line: p.line };
        frame.items.push(node);
      }
      addNode(node) {
        this.flush(this.top);
        this.top.items.push(node);
      }
      // ---- lines ----
      line() {
        const sc = this.sc;
        const lineNo = sc.line;
        const raw = sc.restOfLine();
        const stripped = raw.trimStart();
        if (stripped === "") {
          sc.consumeLine();
          const p = this.top.prose;
          if (p && p.md !== "") p.md += "\n";
          return;
        }
        if (stripped.startsWith("//")) {
          sc.consumeLine();
          return;
        }
        if (stripped.startsWith("\\") && CODE_LINE.test(stripped.slice(1))) {
          const indent = raw.length - stripped.length;
          sc.pos += indent + 1;
          this.proseLine(lineNo);
          return;
        }
        if (CODE_LINE.test(stripped)) {
          sc.pos += raw.length - stripped.length;
          this.codeLine(lineNo, stripped);
          return;
        }
        const fence = /^(`{3,}|~{3,})/.exec(stripped);
        if (fence && raw.length - stripped.length <= 3) {
          const p = this.pending(this.top, lineNo);
          p.md += sc.consumeLine() + "\n";
          const close = new RegExp("^\\s{0,3}" + fence[1][0] + "{" + fence[1].length + ",}\\s*$");
          while (!sc.eof) {
            const l = sc.consumeLine();
            p.md += l + "\n";
            if (close.test(l)) break;
          }
          return;
        }
        if (stripped === "$$") {
          const p = this.pending(this.top, lineNo);
          p.md += sc.consumeLine() + "\n";
          while (!sc.eof) {
            const l = sc.restOfLine();
            if (l.trim() === "$$") {
              p.md += sc.consumeLine() + "\n";
              return;
            }
            this.mathBody(p, sc.pos, sc.pos + l.length);
            sc.pos += l.length;
            if (!sc.eof) sc.pos++;
            p.md += "\n";
          }
          return;
        }
        this.proseLine(lineNo);
      }
      /** A prose line: inline scan until EOL, then newline. */
      proseLine(lineNo) {
        const p = this.pending(this.top, lineNo);
        this.inline(p, "prose", null);
        p.md += "\n";
        p.touched = false;
        if (!this.sc.eof) this.sc.pos++;
      }
      codeLine(lineNo, stripped) {
        const sc = this.sc;
        if (stripped.startsWith("</")) {
          sc.pos += 2;
          const name = this.readTagName();
          sc.skipInlineWs();
          if (sc.peekChar() !== ">") throw syntax(`Expected \`>\` after </${name}`, lineNo);
          sc.pos++;
          this.closeTag(name, lineNo);
          this.blockRemainder(lineNo);
          return;
        }
        if (stripped.startsWith("<")) {
          this.tagStart(lineNo);
          this.blockRemainder(lineNo);
          return;
        }
        if (stripped.startsWith("}")) {
          this.closer(lineNo);
          return;
        }
        if (/^else\b/.test(stripped)) throw new MarkError("E001", MSG.E001(), lineNo, sc.colAt(sc.pos));
        const kw = /^(?:(export)\s+)?(?:(async)\s+)?(var|let|prop|fn|if|for)\b/.exec(stripped);
        sc.pos += kw[0].length;
        const exported = !!kw[1], isAsync = !!kw[2], word = kw[3];
        if ((exported || isAsync) && word !== "fn" && !(exported && word === "let") && !(exported && word === "var")) {
          throw syntax(`\`${kw[0].trim()}\` is not a valid declaration`, lineNo);
        }
        switch (word) {
          case "var": {
            if (exported) throw new MarkError("E013", MSG.E013(), lineNo);
            const name = this.declName();
            sc.skipInlineWs();
            const init = sc.peekChar() === "=" ? (sc.pos++, this.expr()) : void 0;
            sc.expectEol();
            this.addNode(init ? { t: "var", name, init, line: lineNo } : { t: "var", name, line: lineNo });
            return;
          }
          case "let": {
            const name = this.declName();
            sc.skipInlineWs();
            if (sc.peekChar() !== "=") throw syntax("`let` requires an initializer", lineNo);
            sc.pos++;
            const init = this.expr();
            sc.expectEol();
            const node = { t: "let", name, init, line: lineNo };
            if (exported) node.export = true;
            this.addNode(node);
            return;
          }
          case "prop": {
            const name = this.declName();
            sc.skipInlineWs();
            const init = sc.peekChar() === "=" ? (sc.pos++, this.expr()) : void 0;
            sc.expectEol();
            this.addNode(init ? { t: "prop", name, init, line: lineNo } : { t: "prop", name, line: lineNo });
            return;
          }
          case "fn": {
            const name = this.declName();
            const params = this.params();
            sc.skipInlineWs();
            let body;
            if (sc.peekChar() === "=") {
              sc.pos++;
              body = this.expr();
              sc.expectEol();
            } else if (sc.peekChar() === "{") {
              sc.pos++;
              if (sc.atLineEnd()) {
                sc.expectEol();
                body = this.stmtBlock();
              } else {
                sc.skipInlineWs();
                const isReturn = /^return\b/.test(sc.restOfLine());
                if (isReturn) sc.pos += 6;
                const e = this.expr();
                sc.skipInlineWs();
                if (sc.peekChar() !== "}") throw syntax("Expected `}` to close function body", lineNo, sc.colAt(sc.pos));
                sc.pos++;
                sc.expectEol();
                body = [isReturn ? { s: "return", value: e, line: lineNo } : { s: "expr", expr: e, line: lineNo }];
              }
            } else throw syntax("Expected `=` or `{` after function parameters", lineNo);
            const node = { t: "fn", name, params, async: isAsync, body, line: lineNo };
            if (exported) node.export = true;
            this.addNode(node);
            return;
          }
          case "if": {
            const cond = this.expr();
            this.openBrace(lineNo);
            this.flush(this.top);
            const node = { t: "if", cond, then: [], line: lineNo };
            this.stack.push({ kind: "if", items: [], line: lineNo, prose: null, ifRoot: node, ifCur: node });
            return;
          }
          case "for": {
            const node = this.forHeader(lineNo);
            this.flush(this.top);
            this.stack.push({ kind: "for", items: [], line: lineNo, prose: null, forNode: node });
            return;
          }
        }
      }
      /** `item[, index] in src [key e] {` */
      forHeader(lineNo, stmt = false) {
        const sc = this.sc;
        const item = this.declName();
        sc.skipInlineWs();
        let index;
        if (sc.peekChar() === ",") {
          sc.pos++;
          index = this.declName();
        }
        sc.skipInlineWs();
        if (!/^in\b/.test(sc.restOfLine())) throw syntax("Expected `in` in `for` header", lineNo);
        sc.pos += 2;
        const src = this.expr();
        let key;
        sc.skipInlineWs();
        if (!stmt && /^key\b/.test(sc.restOfLine())) {
          sc.pos += 3;
          key = this.expr();
        }
        this.openBrace(lineNo);
        if (stmt) {
          const n2 = { s: "for", item, src, body: [], line: lineNo };
          if (index) n2.index = index;
          return n2;
        }
        const n = { t: "for", item, src, body: [], line: lineNo };
        if (index) n.index = index;
        if (key) n.key = key;
        return n;
      }
      openBrace(lineNo) {
        this.sc.skipInlineWs();
        if (this.sc.peekChar() !== "{") throw syntax("Expected `{` at end of line", lineNo, this.sc.colAt(this.sc.pos));
        this.sc.pos++;
        this.sc.expectEol();
      }
      /** `}` / `} else {` / `} else if cond {` at document level. */
      closer(lineNo) {
        const sc = this.sc;
        sc.pos++;
        const f = this.top;
        if (f.kind === "tag" || f.kind === "head") throw syntax(`Expected </${f.kind === "head" ? "head" : f.tag.name}> (opened at line ${f.line}) before \`}\``, lineNo);
        if (f.kind === "doc") throw syntax("Unexpected `}`", lineNo);
        this.flush(f);
        sc.skipInlineWs();
        const rest = sc.restOfLine();
        if (f.kind === "if" && /^else\b/.test(rest)) {
          if (f.inElse) throw syntax("Unexpected `else` after `else`", lineNo);
          sc.pos += 4;
          sc.skipInlineWs();
          f.ifCur.then = f.items;
          f.items = [];
          if (/^if\b/.test(sc.restOfLine())) {
            sc.pos += 2;
            const cond = this.expr();
            this.openBrace(lineNo);
            const node = { t: "if", cond, then: [], line: lineNo };
            f.ifCur.else = node;
            f.ifCur = node;
          } else {
            this.openBrace(lineNo);
            f.inElse = true;
          }
          return;
        }
        sc.expectEol();
        this.stack.pop();
        if (f.kind === "if") {
          if (f.inElse) f.ifCur.else = f.items;
          else f.ifCur.then = f.items;
          this.top.items.push(f.ifRoot);
        } else {
          f.forNode.body = f.items;
          this.top.items.push(f.forNode);
        }
      }
      // ---- tags ----
      readTagName() {
        const m = TAG_NAME.exec(this.sc.restOfLine());
        if (!m) throw syntax("Invalid tag name", this.sc.line, this.sc.colAt(this.sc.pos));
        this.sc.pos += m[0].length;
        return m[0];
      }
      /** At `<name` on a block-level line: open (push frame) or self-close. */
      tagStart(lineNo) {
        const sc = this.sc;
        sc.pos++;
        const name = this.readTagName();
        if (name === "style") {
          this.styleBlock(lineNo);
          return;
        }
        const { attrs, selfClose } = this.attrs(lineNo);
        if (name === "head") {
          if (attrs.length) throw syntax("<head> takes no attributes", lineNo);
          if (selfClose) {
            this.addNode({ t: "head", children: [], line: lineNo });
            return;
          }
          this.flush(this.top);
          this.stack.push({ kind: "head", items: [], line: lineNo, prose: null });
          return;
        }
        const node = mkTag(name, attrs, selfClose || VOID_ELEMENTS.has(name), lineNo);
        if (node.selfClose) {
          this.addNode(node);
          return;
        }
        this.flush(this.top);
        this.stack.push({ kind: "tag", items: [], line: lineNo, prose: null, tag: node });
      }
      closeTag(name, lineNo) {
        const f = this.top;
        if (f.kind === "head") {
          if (name !== "head") throw new MarkError("E002", MSG.E002(name, "head", f.line), lineNo);
          this.flush(f);
          this.stack.pop();
          this.top.items.push({ t: "head", children: f.items, line: f.line });
          return;
        }
        if (f.kind !== "tag") {
          if (f.kind === "doc") throw new MarkError("E002", `Unexpected closing tag </${name}>`, lineNo);
          throw syntax(`Expected \`}\` to close \`${f.kind}\` (line ${f.line}) before </${name}>`, lineNo);
        }
        if (f.tag.name !== name) throw new MarkError("E002", MSG.E002(name, f.tag.name, f.line), lineNo);
        this.flush(f);
        this.stack.pop();
        f.tag.children = f.items;
        this.top.items.push(f.tag);
      }
      /** Rest of a block-level tag line: inline content; tags may stay open (become frames). */
      blockRemainder(lineNo) {
        this.inline(null, "block", null, lineNo);
        const f = this.top;
        if (f.prose && f.prose.touched) {
          f.prose.md += "\n";
          f.prose.touched = false;
        }
        if (!this.sc.eof) this.sc.pos++;
      }
      styleBlock(lineNo) {
        const sc = this.sc;
        sc.skipInlineWs();
        let global = false;
        if (/^global\b/.test(sc.restOfLine())) {
          sc.pos += 6;
          global = true;
          sc.skipInlineWs();
        }
        if (sc.peekChar() !== ">") throw syntax("Expected `>` after <style", lineNo);
        sc.pos++;
        sc.expectEol();
        if (this.top.kind !== "doc" || this.styleSeen) throw new MarkError("E020", MSG.E020(), lineNo);
        this.styleSeen = true;
        let css = "";
        for (; ; ) {
          if (sc.eof) throw syntax("Unclosed <style> block", lineNo);
          const l = sc.consumeLine();
          if (l.trim() === "</style>") break;
          css += l + "\n";
        }
        this.addNode({ t: "style", css, global, line: lineNo });
      }
      /** Attribute list up to `>` or `/>`; may span lines (L-7). */
      attrs(lineNo) {
        const sc = this.sc;
        const attrs = [];
        for (; ; ) {
          sc.skipWs();
          if (sc.eof) throw syntax(`Unterminated tag started at line ${lineNo}`, lineNo);
          if (sc.startsWith("/>")) {
            sc.pos += 2;
            return { attrs, selfClose: true };
          }
          if (sc.peekChar() === ">") {
            sc.pos++;
            return { attrs, selfClose: false };
          }
          const attrLine = sc.line;
          if (sc.peekChar() === "$") {
            sc.pos++;
            const path = this.bindPath();
            const last = path[path.length - 1];
            if (typeof last !== "string") throw new MarkError("E019", MSG.E019(), attrLine);
            attrs.push({ k: "bind", name: last, path });
            continue;
          }
          const m = ATTR_NAME.exec(sc.restOfLine());
          if (!m) throw syntax(`Unexpected \`${sc.peekChar()}\` in tag`, attrLine, sc.colAt(sc.pos));
          const name = m[0];
          sc.pos += name.length;
          sc.skipInlineWs();
          const isEvent = /^on[A-Z]/.test(name);
          let attr;
          if (sc.peekChar() === "=") {
            sc.pos++;
            sc.skipInlineWs();
            const c = sc.peekChar();
            if (c === "{") {
              sc.pos++;
              const value = this.ep.parse({ multiline: true });
              sc.skipWs();
              if (sc.peekChar() !== "}") throw syntax("Expected `}` to close attribute expression", attrLine, sc.colAt(sc.pos));
              sc.pos++;
              attr = isEvent ? { k: "event", name, handler: value, wrap: needsWrap(value) } : { k: "dyn", name, value };
            } else if (c === "$") {
              sc.pos++;
              attr = { k: "bind", name, path: this.bindPath() };
            } else if (c === '"' || c === "'") {
              const t = sc.token(false);
              attr = { k: "static", name, value: t.value };
            } else {
              const um = /^[^\s>]+/.exec(sc.restOfLine());
              if (!um) throw syntax("Expected attribute value", attrLine);
              sc.pos += um[0].length;
              attr = { k: "static", name, value: um[0].endsWith("/") ? (sc.pos--, um[0].slice(0, -1)) : um[0] };
            }
            if (isEvent && attr.k !== "event") throw syntax(`Event attribute \`${name}\` needs a \`{...}\` handler`, attrLine);
          } else {
            if (isEvent) throw syntax(`Event attribute \`${name}\` needs a \`{...}\` handler`, attrLine);
            attr = { k: "static", name, value: true };
          }
          sc.skipInlineWs();
          if (/^if\b/.test(sc.restOfLine())) {
            if (attr.k === "bind" || attr.k === "event") throw syntax("`if` is not allowed on bindings or handlers", attrLine);
            sc.pos += 2;
            attr.if = this.ep.parse({ multiline: true, tag: true });
          }
          attrs.push(attr);
        }
      }
      /** ident { .ident | [expr] } */
      bindPath() {
        const sc = this.sc;
        const start = sc.pos;
        if (!isIdentStart(sc.peekChar())) throw syntax("Expected identifier after `$`", sc.line, sc.colAt(sc.pos));
        while (isIdentChar(sc.peekChar())) sc.pos++;
        const path = [sc.src.slice(start, sc.pos)];
        for (; ; ) {
          if (sc.peekChar() === "." && isIdentStart(sc.peekChar(1))) {
            sc.pos++;
            const s = sc.pos;
            while (isIdentChar(sc.peekChar())) sc.pos++;
            path.push(sc.src.slice(s, sc.pos));
          } else if (sc.peekChar() === "[") {
            sc.pos++;
            path.push(this.ep.parse({ multiline: true }));
            sc.skipWs();
            if (sc.peekChar() !== "]") throw syntax("Expected `]` in binding path", sc.line);
            sc.pos++;
          } else return path;
        }
      }
      // ---- inline content ----
      /**
       * Scan inline content until end of line. In "prose" mode inline tags must close on
       * the line and content goes to `p`. In "block" mode content goes to the current
       * frame's pending prose and tags push/pop frames. `closeName` is the inline tag
       * we are inside (prose mode); returns when its close tag is found.
       */
      inline(p, mode, closeName, lineNo = this.sc.line) {
        const sc = this.sc;
        const target = () => mode === "block" ? this.pending(this.top, lineNo) : p;
        while (!sc.eof && sc.peekChar() !== "\n") {
          const c = sc.peekChar();
          if (c === "\\") {
            const n = sc.peekChar(1);
            if (n === "{" || n === "}") {
              target().md += n;
              sc.pos += 2;
              continue;
            }
            if (n === "$") {
              target().md += "\\$";
              sc.pos += 2;
              continue;
            }
            target().md += c + (n === "\n" ? "" : n);
            sc.pos += n === "\n" || n === "" ? 1 : 2;
            continue;
          }
          if (c === "`") {
            target().md += this.codeSpan();
            continue;
          }
          if (c === "{") {
            sc.pos++;
            const expr = this.ep.parse({ multiline: false });
            sc.skipInlineWs();
            if (sc.peekChar() !== "}") throw syntax("Expected `}` to close interpolation", sc.line, sc.colAt(sc.pos));
            sc.pos++;
            const t = target();
            t.md += placeholder(t.parts.length);
            t.parts.push({ p: "interp", expr, inMath: false });
            continue;
          }
          if (c === "$") {
            if (this.mathSpan(target())) continue;
            target().md += "$";
            sc.pos++;
            continue;
          }
          if (c === "<") {
            if (sc.startsWith("<!--")) {
              const end = sc.restOfLine().indexOf("-->");
              const len = end < 0 ? sc.restOfLine().length : end + 3;
              target().md += sc.src.substr(sc.pos, len);
              sc.pos += len;
              continue;
            }
            const rest = sc.restOfLine();
            if (/^<\/[A-Za-z]/.test(rest)) {
              const save = sc.pos;
              sc.pos += 2;
              const name = this.readTagName();
              sc.skipInlineWs();
              if (sc.peekChar() !== ">") throw syntax(`Expected \`>\` after </${name}`, sc.line);
              sc.pos++;
              if (mode === "block") {
                this.closeTag(name, sc.lineAt(save));
                continue;
              }
              if (closeName === null) throw syntax(`Unexpected closing tag </${name}>`, sc.lineAt(save));
              if (name !== closeName) throw new MarkError("E002", MSG.E002(name, closeName, lineNo), sc.lineAt(save));
              return true;
            }
            const tm = /^<([A-Za-z][A-Za-z0-9.-]*)([\s/>]|$)/.exec(rest);
            if (tm && rest[tm[1].length + 1] !== ":") {
              const tagLine = sc.line;
              sc.pos++;
              const name = this.readTagName();
              if (name === "style") throw new MarkError("E020", MSG.E020(), tagLine);
              const { attrs, selfClose } = this.attrs(tagLine);
              if (name === "head") throw syntax("<head> must start its own line", tagLine);
              const node = mkTag(name, attrs, selfClose || VOID_ELEMENTS.has(name), tagLine);
              if (!node.selfClose) {
                const child = { md: "", parts: [], line: tagLine, touched: true };
                const save = sc.pos;
                const closed = this.inline(child, "prose", name, tagLine);
                if (!closed) {
                  if (mode === "prose") throw syntax(`Inline tag <${name}> must be closed on the same line`, tagLine);
                  sc.pos = save;
                  this.flush(this.top);
                  this.stack.push({ kind: "tag", items: [], line: tagLine, prose: null, tag: node });
                  continue;
                }
                if (child.md !== "" || child.parts.length) node.children.push({ t: "prose", md: child.md, parts: child.parts, line: tagLine });
              }
              if (mode === "block" && !(this.top.prose && this.top.prose.touched)) {
                this.addNode(node);
                continue;
              }
              const t = target();
              t.md += placeholder(t.parts.length);
              t.parts.push({ p: "tag", node });
              continue;
            }
            target().md += "<";
            sc.pos++;
            continue;
          }
          target().md += c;
          sc.pos++;
        }
        return false;
      }
      /** Copy a code span literally (braces inside are literal, L-10). */
      codeSpan() {
        const sc = this.sc;
        const rest = sc.restOfLine();
        const open = /^`+/.exec(rest)[0];
        const closeIdx = rest.indexOf(open, open.length);
        if (closeIdx < 0) {
          sc.pos += open.length;
          return open;
        }
        const s = rest.slice(0, closeIdx + open.length);
        sc.pos += s.length;
        return s;
      }
      /** Try to scan `$…$` or `$$…$$` at the cursor (M-8). Returns false if literal. */
      mathSpan(t) {
        const sc = this.sc;
        const rest = sc.restOfLine();
        const delim = rest.startsWith("$$") ? "$$" : "$";
        const after = rest[delim.length] ?? "";
        if (after === "" || /\s/.test(after)) return false;
        const before = sc.src[sc.pos - 1] ?? "";
        if (delim === "$" && /\d/.test(before) && /\d/.test(after)) return false;
        let i = delim.length;
        let close = -1;
        while (i < rest.length) {
          if (rest[i] === "\\") {
            i += 2;
            continue;
          }
          if (rest.startsWith(delim, i)) {
            if (/\d/.test(rest[i + delim.length] ?? "")) {
              i++;
              continue;
            }
            close = i;
            break;
          }
          i++;
        }
        if (close < 0) return false;
        const start = sc.pos;
        t.md += delim;
        sc.pos += delim.length;
        this.mathBody(t, sc.pos, start + close);
        sc.pos = start + close + delim.length;
        t.md += delim;
        return true;
      }
      /** Scan TeX between [from, to) for ` {expr} ` interpolations (M-4). */
      mathBody(t, from, to) {
        const sc = this.sc;
        let i = from;
        while (i < to) {
          const c = sc.src[i];
          if (c === "{" && (i === from || /\s/.test(sc.src[i - 1]))) {
            const save = sc.pos;
            sc.pos = i + 1;
            let expr = null;
            try {
              expr = this.ep.parse({ multiline: false });
              sc.skipInlineWs();
              const closeOk = sc.peekChar() === "}" && sc.pos < to && (sc.pos + 1 === to || /\s/.test(sc.src[sc.pos + 1]));
              if (!closeOk) expr = null;
            } catch {
              expr = null;
            }
            if (expr) {
              t.md += placeholder(t.parts.length);
              t.parts.push({ p: "interp", expr, inMath: true });
              i = sc.pos + 1;
              sc.pos = save;
              continue;
            }
            sc.pos = save;
          }
          t.md += c;
          i++;
        }
      }
      // ---- declarations ----
      declName() {
        const sc = this.sc;
        sc.skipInlineWs();
        const t = sc.token(false);
        if (t.type !== "ident") throw syntax("Expected a name", t.line, t.col);
        if (isReserved(t.value)) throw syntax(`\`${t.value}\` is a reserved word`, t.line, t.col);
        return t.value;
      }
      params() {
        const sc = this.sc;
        sc.skipInlineWs();
        if (sc.peekChar() !== "(") throw syntax("Expected `(` after function name", sc.line, sc.colAt(sc.pos));
        sc.pos++;
        const out = [];
        sc.skipWs();
        if (sc.peekChar() === ")") {
          sc.pos++;
          return out;
        }
        for (; ; ) {
          sc.skipWs();
          out.push(this.declName());
          sc.skipWs();
          if (sc.peekChar() === ")") {
            sc.pos++;
            return out;
          }
          if (sc.peekChar() !== ",") throw syntax("Expected `,` or `)` in parameter list", sc.line, sc.colAt(sc.pos));
          sc.pos++;
        }
      }
      expr() {
        return this.ep.parse({ multiline: false });
      }
      // ---- fn bodies (L-12) ----
      stmtBlock() {
        const sc = this.sc;
        const out = [];
        for (; ; ) {
          if (sc.eof) throw syntax("Unclosed function body", sc.line);
          const lineNo = sc.line;
          const raw = sc.restOfLine();
          const s = raw.trim();
          if (s === "" || s.startsWith("//")) {
            sc.consumeLine();
            continue;
          }
          sc.pos += raw.length - raw.trimStart().length;
          if (s.startsWith("}")) {
            sc.pos++;
            return out;
          }
          const kw = /^(let|var|if|for|return)\b/.exec(s);
          if (!kw) {
            const expr = this.expr();
            sc.expectEol();
            if (expr.type === "Identifier" || expr.type === "Literal") throw syntax("Prose is not allowed inside a function body", lineNo);
            out.push({ s: "expr", expr, line: lineNo });
            continue;
          }
          sc.pos += kw[0].length;
          switch (kw[1]) {
            case "let":
            case "var": {
              const name = this.declName();
              sc.skipInlineWs();
              let init;
              if (sc.peekChar() === "=") {
                sc.pos++;
                init = this.expr();
              } else if (kw[1] === "let") throw syntax("`let` requires an initializer", lineNo);
              sc.expectEol();
              out.push(init ? { s: kw[1], name, init, line: lineNo } : { s: kw[1], name, line: lineNo });
              break;
            }
            case "return": {
              sc.skipInlineWs();
              if (sc.atLineEnd() || sc.startsWith("//")) {
                sc.expectEol();
                out.push({ s: "return", line: lineNo });
              } else {
                const value = this.expr();
                sc.expectEol();
                out.push({ s: "return", value, line: lineNo });
              }
              break;
            }
            case "for": {
              const n = this.forHeader(lineNo, true);
              n.body = this.stmtBlock();
              sc.expectEol();
              out.push(n);
              break;
            }
            case "if": {
              out.push(this.ifStmt(lineNo));
              break;
            }
          }
        }
      }
      /** `if cond {` … with `} else if` / `} else {` continuations on the closer line. */
      ifStmt(lineNo) {
        const sc = this.sc;
        const cond = this.expr();
        this.openBrace(lineNo);
        const node = { s: "if", cond, then: this.stmtBlock(), line: lineNo };
        sc.skipInlineWs();
        if (/^else\b/.test(sc.restOfLine())) {
          sc.pos += 4;
          sc.skipInlineWs();
          if (/^if\b/.test(sc.restOfLine())) {
            sc.pos += 2;
            node.else = this.ifStmt(sc.line);
          } else {
            this.openBrace(sc.line);
            node.else = this.stmtBlock();
            sc.expectEol();
          }
        } else sc.expectEol();
        return node;
      }
    };
    RESERVED_DECL = /* @__PURE__ */ new Set(["var", "let", "prop", "fn", "if", "else", "for", "in", "key", "try", "return", "await", "async", "true", "false", "null", "undefined", "slot"]);
  }
});

// src/buildhost.ts
function serialize(root, inIsland = false) {
  if (root.type !== "el") return "";
  const st = { inIsland };
  return root.children.map((c) => ser(c, st, root.tag)).join("");
}
function ser(n, st, parentTag) {
  switch (n.type) {
    case "text":
      return RAW_TEXT.has(parentTag) ? n.s : escapeHtml(n.s);
    case "html":
      return n.html;
    case "comment":
      if (n.s.startsWith("mk:")) {
        st.inIsland = true;
        return `<!--${n.s}-->`;
      }
      if (n.s.startsWith("/mk:")) {
        st.inIsland = false;
        return `<!--${n.s}-->`;
      }
      if (n.marker) return st.inIsland ? "<!---->" : "";
      return `<!--${n.s}-->`;
    case "el": {
      let s = "<" + n.tag;
      for (const [k, v] of n.attrs) s += v === "" ? ` ${k}` : ` ${k}="${escapeAttr(v)}"`;
      s += ">";
      if (VOID_ELEMENTS.has(n.tag)) return s;
      for (const c of n.children) s += ser(c, st, n.tag);
      return s + `</${n.tag}>`;
    }
  }
}
function findAll(root, tag, out = []) {
  if (root.type !== "el") return out;
  for (const c of root.children) {
    if (c.type === "el") {
      if (c.tag === tag) out.push(c);
      findAll(c, tag, out);
    }
  }
  return out;
}
function textOf(n) {
  if (n.type === "text") return n.s;
  if (n.type === "el") return n.children.map(textOf).join("");
  return "";
}
var RAW_TEXT, BuildHost;
var init_buildhost = __esm({
  "src/buildhost.ts"() {
    "use strict";
    init_host();
    init_parser();
    RAW_TEXT = /* @__PURE__ */ new Set(["script", "style"]);
    BuildHost = class {
      root(tag = "#root") {
        return { type: "el", tag, attrs: /* @__PURE__ */ new Map(), children: [], parent: null };
      }
      el(tag) {
        return { type: "el", tag, attrs: /* @__PURE__ */ new Map(), children: [], parent: null };
      }
      text(s) {
        return { type: "text", s, parent: null };
      }
      comment(s, marker) {
        return { type: "comment", s, marker, parent: null };
      }
      html(html) {
        return { type: "html", html, parent: null };
      }
      setAttr(n, name, value) {
        if (n.type !== "el") return;
        if (value === null) n.attrs.delete(name);
        else n.attrs.set(name, value);
      }
      setProp() {
      }
      setText(n, s) {
        if (n.type === "text") n.s = s;
      }
      insert(parent, n, before) {
        if (parent.type !== "el") throw new Error("insert into non-element");
        if (n.parent) this.remove(n);
        const idx = before ? parent.children.indexOf(before) : -1;
        if (idx < 0) parent.children.push(n);
        else parent.children.splice(idx, 0, n);
        n.parent = parent;
      }
      remove(n) {
        const p = n.parent;
        if (!p || p.type !== "el") return;
        const i = p.children.indexOf(n);
        if (i >= 0) p.children.splice(i, 1);
        n.parent = null;
      }
      next(n) {
        const p = n.parent;
        if (!p || p.type !== "el") return null;
        const i = p.children.indexOf(n);
        return p.children[i + 1] ?? null;
      }
      first(n) {
        return n.type === "el" ? n.children[0] ?? null : null;
      }
      enter() {
      }
      exit() {
      }
      tagOf(n) {
        return n.type === "el" ? n.tag : "";
      }
      listen() {
        return () => {
        };
      }
    };
  }
});

// src/config.ts
import { existsSync as existsSync2, readFileSync as readFileSync2 } from "node:fs";
import { join as join2 } from "node:path";
function loadConfig(projectDir, overrides = {}) {
  const cfg = defaultConfig();
  const file = join2(projectDir, "mark.config.json");
  if (existsSync2(file)) Object.assign(cfg, JSON.parse(readFileSync2(file, "utf8")));
  Object.assign(cfg, overrides);
  if (!cfg.base.startsWith("/")) cfg.base = "/" + cfg.base;
  if (!cfg.base.endsWith("/")) cfg.base += "/";
  return cfg;
}
var defaultConfig;
var init_config = __esm({
  "src/config.ts"() {
    "use strict";
    defaultConfig = () => ({
      root: "site",
      out: "dist",
      base: "/",
      spa: false,
      math: "mathml",
      katex: {},
      lang: "en",
      locale: "en-US"
    });
  }
});

// src/analysis.ts
function analyzeProject(docs, byName, spa) {
  const memo = /* @__PURE__ */ new Map();
  const visiting = /* @__PURE__ */ new Set();
  const compDynamic = (name) => {
    if (name === "Fragment") return false;
    if (name === "Math") return false;
    const d = byName.get(name);
    if (!d) return false;
    if (memo.has(d.id)) return memo.get(d.id);
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
function hasMath(nodes) {
  return nodes.some((n) => {
    if (n.t === "prose") return n.tree?.some(function has(h) {
      return h.k === "math" || h.k === "el" && h.children.some(has);
    }) || n.parts.some((p) => p.p === "tag" && hasMath([p.node]));
    if (n.t === "if") return hasMath(n.then) || !!n.else && (Array.isArray(n.else) ? hasMath(n.else) : hasMath([n.else]));
    if (n.t === "for") return hasMath(n.body);
    if (n.t === "tag") return n.name === "Math" || hasMath(n.children);
    if (n.t === "head") return hasMath(n.children);
    return false;
  });
}
function mentions(nodes, name) {
  const s = JSON.stringify(nodes, (k, v) => k === "tree" ? void 0 : v);
  return s.includes(`"name":"${name}"`);
}
var Analyzer;
var init_analysis = __esm({
  "src/analysis.ts"() {
    "use strict";
    Analyzer = class {
      doc;
      compDynamic;
      spa;
      names = /* @__PURE__ */ new Map();
      // name -> causes (empty set = static)
      islands = [];
      anyDynamic = false;
      constructor(doc, compDynamic, spa) {
        this.doc = doc;
        this.compDynamic = compDynamic;
        this.spa = spa;
      }
      /** Returns whether any instance of this doc is dynamic regardless of props. */
      run() {
        let intrinsic = false;
        for (const n of this.doc.nodes) {
          const causes = /* @__PURE__ */ new Set();
          switch (n.t) {
            case "var":
              this.names.set(n.name, /* @__PURE__ */ new Set([n.name]));
              break;
            case "let":
              this.expr(n.init, causes);
              this.names.set(n.name, causes);
              break;
            case "fn":
              this.body(n.body, causes, new Set(n.params));
              this.names.set(n.name, causes);
              break;
            case "prop":
              this.names.set(n.name, /* @__PURE__ */ new Set());
              break;
            case "style":
              break;
            default: {
              this.node(n, causes);
              if (causes.size) {
                intrinsic = true;
                if (this.doc.kind !== "component") {
                  n.island = true;
                  this.islands.push({ nodeId: n.id ?? -1, line: n.line, causes: [...causes] });
                }
              }
            }
          }
        }
        this.anyDynamic = intrinsic;
        return intrinsic;
      }
      node(n, causes, locals = /* @__PURE__ */ new Map()) {
        switch (n.t) {
          case "var":
          case "let":
          case "fn":
          case "prop":
          case "style":
            return;
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
            const src = /* @__PURE__ */ new Set();
            this.expr(n.src, src, locals);
            for (const c of src) causes.add(c);
            const inner = new Map(locals);
            inner.set(n.item, src);
            if (n.index) inner.set(n.index, src);
            if (n.key) this.expr(n.key, causes, inner);
            for (const c of n.body) this.node(c, causes, inner);
            return;
          }
          case "head":
            return;
          // hoisted; in SPA mode heads are re-rendered on navigation instead
          case "tag": {
            if (n.kind === "html" && n.name === "slot") return;
            if (n.kind === "comp" && this.compDynamic(n.name)) causes.add("<" + n.name + ">");
            for (const a of n.attrs) {
              switch (a.k) {
                case "static":
                  if (a.if) this.expr(a.if, causes, locals);
                  break;
                case "dyn":
                  if (a.name === "ref") {
                    causes.add("ref");
                    break;
                  }
                  this.expr(a.value, causes, locals);
                  if (a.if) this.expr(a.if, causes, locals);
                  break;
                case "bind":
                  causes.add("$" + a.path[0]);
                  break;
                case "event":
                  causes.add(a.name);
                  break;
              }
            }
            for (const c of n.children) this.node(c, causes, locals);
            return;
          }
        }
      }
      body(b, causes, params) {
        const locals = /* @__PURE__ */ new Map();
        for (const p of params) locals.set(p, /* @__PURE__ */ new Set());
        if (!Array.isArray(b)) return this.expr(b, causes, locals);
        const walk = (stmts) => {
          for (const s of stmts) {
            switch (s.s) {
              case "let":
              case "var":
                if (s.init) this.expr(s.init, causes, locals);
                locals.set(s.name, /* @__PURE__ */ new Set());
                break;
              case "if":
                this.expr(s.cond, causes, locals);
                walk(s.then);
                if (s.else) Array.isArray(s.else) ? walk(s.else) : walk([s.else]);
                break;
              case "for":
                this.expr(s.src, causes, locals);
                locals.set(s.item, /* @__PURE__ */ new Set());
                if (s.index) locals.set(s.index, /* @__PURE__ */ new Set());
                walk(s.body);
                break;
              case "return":
                if (s.value) this.expr(s.value, causes, locals);
                break;
              case "expr":
                this.expr(s.expr, causes, locals);
                break;
            }
          }
        };
        walk(b);
      }
      expr(e, causes, locals = /* @__PURE__ */ new Map()) {
        switch (e.type) {
          case "Literal":
            return;
          case "Identifier": {
            const l = locals.get(e.name);
            if (l) {
              for (const c of l) causes.add(c);
              return;
            }
            const d = this.names.get(e.name);
            if (d) for (const c of d) causes.add(c);
            return;
          }
          case "MemberExpression": {
            if (e.object.type === "Identifier" && !e.computed && !locals.has(e.object.name) && !this.names.has(e.object.name)) {
              const prop = e.property.name;
              if (e.object.name === "env" && prop === "client") causes.add("env.client");
              if (e.object.name === "Page" && (prop === "query" || prop === "hash" || this.spa)) causes.add("Page." + prop);
            }
            this.expr(e.object, causes, locals);
            if (e.computed) this.expr(e.property, causes, locals);
            return;
          }
          case "ChainExpression":
            return this.expr(e.expression, causes, locals);
          case "CallExpression":
            this.expr(e.callee, causes, locals);
            e.arguments.forEach((a) => this.expr(a, causes, locals));
            return;
          case "NewExpression":
            e.arguments.forEach((a) => this.expr(a, causes, locals));
            return;
          case "ArrayExpression":
            e.elements.forEach((a) => this.expr(a, causes, locals));
            return;
          case "ObjectExpression":
            e.properties.forEach((p) => this.expr(p.value, causes, locals));
            return;
          case "ArrowFunctionExpression": {
            const inner = new Map(locals);
            for (const p of e.params) inner.set(p.name, /* @__PURE__ */ new Set());
            return this.expr(e.body, causes, inner);
          }
          case "UnaryExpression":
            return this.expr(e.argument, causes, locals);
          case "BinaryExpression":
          case "LogicalExpression":
            this.expr(e.left, causes, locals);
            this.expr(e.right, causes, locals);
            return;
          case "ConditionalExpression":
            this.expr(e.test, causes, locals);
            this.expr(e.consequent, causes, locals);
            this.expr(e.alternate, causes, locals);
            return;
          case "AssignmentExpression":
            this.expr(e.left, causes, locals);
            this.expr(e.right, causes, locals);
            return;
          case "SequenceExpression":
            e.expressions.forEach((x) => this.expr(x, causes, locals));
            return;
          case "AwaitExpression":
            return this.expr(e.argument, causes, locals);
          case "TryExpression":
            this.expr(e.expr, causes, locals);
            this.expr(e.fallback, causes, locals);
            return;
        }
      }
    };
  }
});

// src/builtins.ts
var BUILTINS;
var init_builtins = __esm({
  "src/builtins.ts"() {
    "use strict";
    BUILTINS = {
      Slider: `prop value = 0
prop onValueChange = {}
prop min = 0
prop max = 1
prop step = 0.01
prop label = ""
<label class="mk-slider">
if label != "" {
<span class="mk-slider-label">{label}</span>
}
<input type="range" min={min} max={max} step={step} value=$value />
<output class="mk-slider-value">{value}</output>
</label>
`,
      Stepper: `prop onTap = {}
prop label = "+"
<button type="button" class="mk-stepper" onTap={onTap}>{label}</button>
`,
      Button: `prop onTap = {}
prop disabled = false
<button type="button" class="mk-button" disabled={disabled} onTap={onTap}><slot /></button>
`,
      Toggle: `prop value = false
prop onValueChange = {}
prop label = ""
<label class="mk-toggle"><input type="checkbox" checked=$value /> {label}</label>
`,
      Input: `prop value = ""
prop onValueChange = {}
prop type = "text"
prop placeholder = ""
<input class="mk-input" type={type} placeholder={placeholder} value=$value />
`,
      Select: `prop value = ""
prop onValueChange = {}
prop options = []
<select class="mk-select" value=$value>
for o in options {
<option value={o.value == undefined ? o : o.value} selected={(o.value == undefined ? o : o.value) == value}>{o.label == undefined ? o : o.label}</option>
}
</select>
`,
      Fragment: `<slot />
`,
      Math: `prop tex = ""
prop display = false
`,
      Link: `prop href = "/"
prop active = "current"
let cur = Page.path == href || (href != "/" && Page.path.startsWith(href + "/"))
<a href={href} class={active} if cur><slot /></a>
`
    };
  }
});

// src/checker.ts
function checkProject(docs, byName) {
  const out = [];
  const exportNames = new Set([...byName.values()].filter((d) => d.hasExports).map((d) => d.name));
  for (const d of docs) new Checker(d, byName, exportNames, out).run();
  return out;
}
var GLOBALS, STATIC_MEMBERS, HTML_ELEMENTS, HEAD_CHILDREN, Scope, PLAIN, Checker;
var init_checker = __esm({
  "src/checker.ts"() {
    "use strict";
    init_diagnostics();
    init_host();
    GLOBALS = /* @__PURE__ */ new Set(["Site", "Page", "Math", "JSON", "Number", "String", "Array", "Object", "Date", "Promise", "console", "env", "next", "after", "measure"]);
    STATIC_MEMBERS = {
      Math: MATH_MEMBERS,
      Number: NUMBER_STATIC,
      Array: ARRAY_STATIC,
      Object: OBJECT_STATIC,
      JSON: JSON_STATIC,
      Date: DATE_STATIC,
      Promise: PROMISE_STATIC,
      console: CONSOLE_MEMBERS,
      env: ENV_MEMBERS,
      String: /* @__PURE__ */ new Set()
    };
    HTML_ELEMENTS = new Set("a abbr address area article aside audio b base bdi bdo blockquote body br button canvas caption cite code col colgroup data datalist dd del details dfn dialog div dl dt em embed fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 head header hgroup hr html i iframe img input ins kbd label legend li link main map mark menu meta meter nav noscript object ol optgroup option output p picture pre progress q rp rt ruby s samp script search section select slot small source span strong style sub summary sup table tbody td template textarea tfoot th thead time title tr track u ul var video wbr svg path circle rect line polyline polygon g text defs use symbol ellipse tspan".split(" "));
    HEAD_CHILDREN = /* @__PURE__ */ new Set(["title", "meta", "link", "style", "script", "base"]);
    Scope = class {
      vars = /* @__PURE__ */ new Map();
      parent;
      constructor(parent) {
        this.parent = parent;
      }
      lookup(name) {
        return this.vars.get(name) ?? this.parent?.lookup(name);
      }
    };
    PLAIN = { handler: false, async: false, varInit: false, fnBody: false };
    Checker = class {
      doc;
      byName;
      exportNames;
      out;
      docScope = new Scope(null);
      later = /* @__PURE__ */ new Map();
      // doc-level names declared later in the file
      laterFns = /* @__PURE__ */ new Set();
      hasSlot = false;
      constructor(doc, byName, exportNames, out) {
        this.doc = doc;
        this.byName = byName;
        this.exportNames = exportNames;
        this.out = out;
        for (const n of doc.ast) {
          if (n.t === "var" || n.t === "let" || n.t === "prop" || n.t === "fn") this.later.set(n.name, n.line);
          if (n.t === "fn") this.laterFns.add(n.name);
        }
      }
      report(code, message, line, col = 0) {
        this.out.push({ file: this.doc.file, line, col, code, message, severity: code.startsWith("W") ? "warning" : "error" });
      }
      run() {
        this.nodes(this.doc.ast, this.docScope, true);
        if (this.doc.kind === "layout" && !this.hasSlot) this.report("W001", MSG.W001(), 1);
      }
      declare(scope, name, kind, line, warnShadow = false) {
        const own = scope.vars.get(name);
        if (own) {
          this.report("E004", MSG.E004(name, own.line), line);
          return;
        }
        if (warnShadow && scope.parent?.lookup(name)) this.report("W002", MSG.W002(name), line);
        scope.vars.set(name, { kind, line });
      }
      nodes(nodes, scope, top) {
        for (const n of nodes) this.node(n, scope, top);
      }
      node(n, scope, top) {
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
            const ctx = { handler: true, async: n.async, varInit: false, fnBody: true };
            if (Array.isArray(n.body)) this.stmts(n.body, inner, ctx);
            else this.expr(n.body, inner, ctx, n.line);
            return;
          }
          case "style":
            return;
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
      }
      htmlTag(n, scope) {
        if (n.name === "slot") {
          this.hasSlot = true;
          return;
        }
        if (!HTML_ELEMENTS.has(n.name)) this.report("W003", MSG.W003(n.name), n.line);
        for (const a of n.attrs) this.attr(a, scope, n.line, null);
        this.nodes(n.children, scope, false);
      }
      compTag(n, scope) {
        if (n.name === "Fragment") {
          for (const a of n.attrs) if (a.name !== "slot") this.report("E008", MSG.E008("Fragment", a.name, ["slot"]), n.line);
          this.nodes(n.children, scope, false);
          return;
        }
        const comp = this.byName.get(n.name);
        if (!comp) {
          this.report("E007", MSG.E007(n.name), n.line);
          this.nodes(n.children, scope, false);
          return;
        }
        for (const a of n.attrs) this.attr(a, scope, n.line, comp);
        this.nodes(n.children, scope, false);
      }
      attr(a, scope, line, comp) {
        const propOk = (name) => {
          if (comp && !comp.props.includes(name)) this.report("E008", MSG.E008(comp.name ?? comp.file, name, comp.props), line);
        };
        switch (a.k) {
          case "static":
            propOk(a.name);
            if (a.if) this.expr(a.if, scope, PLAIN, line);
            return;
          case "dyn":
            if (a.name === "ref" && !comp) {
              const b = a.value.type === "Identifier" ? scope.lookup(a.value.name) : void 0;
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
            if (comp) {
              propOk(a.name);
              propOk("on" + a.name[0].toUpperCase() + a.name.slice(1) + "Change");
            }
            const root = a.path[0];
            const b = scope.lookup(root);
            if (!b) {
              this.unresolved(root, line);
              return;
            }
            if (b.kind !== "var" && b.kind !== "prop" && b.kind !== "item") this.report("E009", MSG.E009(a.path.map((s) => typeof s === "string" ? s : "[\u2026]").join("."), root), line);
            for (const seg of a.path) if (typeof seg !== "string") this.expr(seg, scope, PLAIN, line);
            return;
          }
        }
      }
      unresolved(name, line) {
        const l = this.later.get(name);
        if (l !== void 0) this.report("E003", MSG.E003(name, l), line);
        else this.report("E003", `\`${name}\` is not declared`, line);
      }
      stmts(stmts, scope, ctx) {
        for (const s of stmts) {
          switch (s.s) {
            case "let":
            case "var":
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
      expr(e, scope, ctx, line) {
        switch (e.type) {
          case "Literal":
            return;
          case "Identifier":
            this.ident(e.name, scope, line, ctx);
            return;
          case "MemberExpression": {
            if (e.object.type === "Identifier" && !scope.lookup(e.object.name) && !e.computed) {
              const table = STATIC_MEMBERS[e.object.name];
              const prop = e.property.name;
              if (table && !table.has(prop)) {
                this.report("E021", MSG.E021(`${e.object.name}.${prop}`), line);
                return;
              }
              if ((e.object.name === "Math" && prop === "random" || e.object.name === "Date" && prop === "now") && !ctx.varInit && !ctx.handler) {
                this.report("E022", MSG.E022(), line);
              }
            }
            this.expr(e.object, scope, ctx, line);
            if (e.computed) this.expr(e.property, scope, ctx, line);
            return;
          }
          case "ChainExpression":
            return this.expr(e.expression, scope, ctx, line);
          case "CallExpression": {
            const c = e.callee;
            const method = c.type === "MemberExpression" && !c.computed ? c.property.name : "";
            if (ARRAY_MUTATORS.has(method) && method !== "sort" && method !== "reverse" && !ctx.handler) {
              this.report("E006", MSG.E006(), line);
            }
            this.expr(c, scope, ctx, line);
            for (const a of e.arguments) this.expr(a, scope, ctx, line);
            return;
          }
          case "NewExpression": {
            const name = e.callee.name;
            if (name !== "Date") this.report("E021", MSG.E021("new " + name), line);
            else if (e.arguments.length === 0 && !ctx.varInit && !ctx.handler) this.report("E022", MSG.E022(), line);
            for (const a of e.arguments) this.expr(a, scope, ctx, line);
            return;
          }
          case "ArrayExpression":
            for (const x of e.elements) this.expr(x, scope, ctx, line);
            return;
          case "ObjectExpression":
            for (const p of e.properties) this.expr(p.value, scope, ctx, line);
            return;
          case "ArrowFunctionExpression": {
            const inner = new Scope(scope);
            for (const p of e.params) this.declare(inner, p.name, "param", line);
            this.expr(e.body, inner, { handler: true, async: e.async, varInit: false, fnBody: true }, line);
            return;
          }
          case "UnaryExpression":
            return this.expr(e.argument, scope, ctx, line);
          case "BinaryExpression":
          case "LogicalExpression":
            this.expr(e.left, scope, ctx, line);
            this.expr(e.right, scope, ctx, line);
            return;
          case "ConditionalExpression":
            this.expr(e.test, scope, ctx, line);
            this.expr(e.consequent, scope, ctx, line);
            this.expr(e.alternate, scope, ctx, line);
            return;
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
          case "TryExpression":
            this.expr(e.expr, scope, ctx, line);
            this.expr(e.fallback, scope, ctx, line);
            return;
        }
      }
      ident(name, scope, line, ctx = PLAIN) {
        if (scope.lookup(name)) return;
        if (GLOBALS.has(name) || this.exportNames.has(name)) return;
        if (ctx.fnBody && this.laterFns.has(name)) return;
        this.unresolved(name, line);
      }
      /** C-15: the root of an assignment target must be a var, prop, or loop item. */
      target(t, scope, line) {
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
          let root = t;
          while (root.type === "MemberExpression") {
            if (root.computed) this.expr(root.property, scope, PLAIN, line);
            root = root.object;
          }
          if (root.type === "Identifier") {
            const b = scope.lookup(root.name);
            if (!b) {
              if (root.name === "Page" && t.object === root && !t.computed && (t.property.name === "path" || t.property.name === "title")) return;
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
    };
  }
});

// src/css.ts
function scopeCss(css, attr) {
  return rewriteBlock(css, attr, false);
}
function rewriteBlock(css, attr, keyframes) {
  let out = "";
  let i = 0;
  while (i < css.length) {
    const c = css[i];
    if (c === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      const stop = end < 0 ? css.length : end + 2;
      out += css.slice(i, stop);
      i = stop;
      continue;
    }
    if (/\s/.test(c)) {
      out += c;
      i++;
      continue;
    }
    let j = i;
    let depthParen = 0;
    let quote = null;
    while (j < css.length) {
      const ch = css[j];
      if (quote) {
        if (ch === quote && css[j - 1] !== "\\") quote = null;
      } else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === "(") depthParen++;
      else if (ch === ")") depthParen--;
      else if (depthParen === 0 && (ch === "{" || ch === ";")) break;
      j++;
    }
    const prelude = css.slice(i, j).trim();
    if (j >= css.length || css[j] === ";") {
      out += css.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    const bodyStart = j + 1;
    const bodyEnd = matchBrace(css, j);
    const body = css.slice(bodyStart, bodyEnd);
    if (prelude.startsWith("@")) {
      const name = prelude.slice(1).split(/[\s(]/)[0].toLowerCase();
      const nested = name === "media" || name === "supports" || name === "layer" || name === "container";
      const kf = name.endsWith("keyframes");
      out += prelude + " {" + (nested ? rewriteBlock(body, attr, false) : kf ? body : keyframes ? body : body) + "}";
    } else if (keyframes) {
      out += prelude + " {" + body + "}";
    } else {
      out += scopeSelectorList(prelude, attr) + " {" + body + "}";
    }
    i = bodyEnd + 1;
  }
  return out;
}
function matchBrace(css, open) {
  let depth = 0;
  let quote = null;
  for (let k = open; k < css.length; k++) {
    const ch = css[k];
    if (quote) {
      if (ch === quote && css[k - 1] !== "\\") quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return k;
    }
  }
  return css.length;
}
function scopeSelectorList(list, attr) {
  return splitTop(list, ",").map((s) => scopeSelector(s.trim(), attr)).join(", ");
}
function scopeSelector(sel, attr) {
  if (!sel) return sel;
  const wholeGlobal = /^:global\((.*)\)$/s.exec(sel);
  if (wholeGlobal) return wholeGlobal[1];
  const parts = [];
  let cur = "";
  let depth = 0;
  for (let i = 0; i < sel.length; i++) {
    const ch = sel[i];
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (depth === 0 && /[\s>+~]/.test(ch)) {
      if (cur) parts.push(cur);
      parts.push(ch);
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur) parts.push(cur);
  let last = parts.length - 1;
  while (last >= 0 && /^[\s>+~]$/.test(parts[last])) last--;
  if (last < 0) return sel;
  parts[last] = scopeCompound(parts[last], attr);
  return parts.map((p) => p.replace(/^:global\((.*)\)$/s, "$1")).join("").replace(/\s+/g, " ");
}
function scopeCompound(comp, attr) {
  const g = /^:global\((.*)\)$/s.exec(comp);
  if (g) return g[1];
  const m = /^(.*?)((?:::?[a-zA-Z-]+(?:\([^)]*\))?)*)$/s.exec(comp);
  const base = m ? m[1] : comp;
  const pseudo = m ? m[2] : "";
  const pcs = [];
  const pes = [];
  for (const p of pseudo.match(/::?[a-zA-Z-]+(?:\([^)]*\))?/g) ?? []) (p.startsWith("::") ? pes : pcs).push(p);
  return `${base || ""}[${attr}]${pcs.join("")}${pes.join("")}`;
}
function splitTop(s, sep2) {
  const out = [];
  let cur = "";
  let depth = 0;
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === sep2 && depth === 0) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}
var init_css = __esm({
  "src/css.ts"() {
    "use strict";
  }
});

// src/core/tree.ts
var BLOCK_TAGS, isList;
var init_tree = __esm({
  "src/core/tree.ts"() {
    "use strict";
    BLOCK_TAGS = /* @__PURE__ */ new Set([
      "address",
      "article",
      "aside",
      "blockquote",
      "details",
      "dialog",
      "div",
      "dl",
      "fieldset",
      "figcaption",
      "figure",
      "footer",
      "form",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "header",
      "hr",
      "main",
      "nav",
      "ol",
      "p",
      "pre",
      "section",
      "table",
      "ul",
      "li",
      "tr",
      "td",
      "th",
      "thead",
      "tbody",
      "menu",
      "summary",
      "video",
      "canvas",
      "svg",
      "slot"
    ]);
    isList = (n) => n.k === "el" && (n.tag === "ul" || n.tag === "ol");
  }
});

// src/markdown.ts
function parseMarkdown(md, parts) {
  if (!md.endsWith("\n")) return parseInline(md);
  return new BlockParser(parts).parse(md.split("\n").slice(0, -1));
}
function plainText(nodes) {
  let s = "";
  for (const n of nodes) {
    if (n.k === "text") s += n.s;
    else if (n.k === "el") s += n.tag === "br" ? " " : plainText(n.children);
    else if (n.k === "math") s += n.tex;
  }
  return s;
}
function slugify(s) {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "") || "section";
}
function isBlockStart(l) {
  return RE_FENCE.test(l) || RE_HEADING.test(l) || RE_HR.test(l) || RE_QUOTE.test(l) || RE_LIST.test(l) || l.trim() === "$$";
}
function stripIndent(l, n) {
  let k = 0;
  while (k < n && l[k] === " ") k++;
  return l.slice(k);
}
function parseInline(s) {
  const toks = [];
  let buf = "";
  const flushText = () => {
    if (buf) {
      toks.push({ n: text(buf) });
      buf = "";
    }
  };
  const n = s.length;
  let i = 0;
  while (i < n) {
    const c = s[i];
    if (c === PH) {
      const end = s.indexOf(PH, i + 1);
      flushText();
      toks.push({ n: { k: "hole", i: parseInt(s.slice(i + 1, end), 10) } });
      i = end + 1;
      continue;
    }
    if (c === "\\") {
      const nx = s[i + 1] ?? "";
      if (nx === "\n") {
        flushText();
        toks.push({ n: el("br") });
        i += 2;
        continue;
      }
      if (ESCAPABLE.includes(nx)) {
        buf += nx;
        i += 2;
        continue;
      }
      buf += "\\";
      i++;
      continue;
    }
    if (c === "`") {
      const run = /^`+/.exec(s.slice(i))[0];
      const close = s.indexOf(run, i + run.length);
      const validClose = close >= 0 && s[close + run.length] !== "`";
      if (validClose) {
        let code = s.slice(i + run.length, close).replace(/\n/g, " ");
        if (code.length > 2 && code.startsWith(" ") && code.endsWith(" ") && code.trim() !== "") code = code.slice(1, -1);
        flushText();
        toks.push({ n: el("code", [text(code)]) });
        i = close + run.length;
        continue;
      }
      buf += run;
      i += run.length;
      continue;
    }
    if (c === "$") {
      const m = mathAt(s, i);
      if (m) {
        flushText();
        toks.push({ n: m.node });
        i = m.end;
        continue;
      }
      buf += "$";
      i++;
      continue;
    }
    if (c === "*" || c === "_") {
      let j = i;
      while (s[j] === c) j++;
      const count = j - i;
      const prev = i === 0 ? " " : s[i - 1];
      const next = j >= n ? " " : s[j];
      const prevWs = /\s/.test(prev), nextWs = /\s/.test(next);
      const prevP = PUNCT_RE.test(prev), nextP = PUNCT_RE.test(next);
      const left = !nextWs && (!nextP || prevWs || prevP);
      const right = !prevWs && (!prevP || nextWs || nextP);
      const canOpen = c === "*" ? left : left && (!right || prevP);
      const canClose = c === "*" ? right : right && (!left || nextP);
      flushText();
      toks.push({ d: { idx: toks.length, ch: c, count, canOpen, canClose } });
      i = j;
      continue;
    }
    if (c === "~" && s[i + 1] === "~") {
      const close = s.indexOf("~~", i + 2);
      if (close > i + 2) {
        flushText();
        toks.push({ n: el("del", parseInline(s.slice(i + 2, close))) });
        i = close + 2;
        continue;
      }
    }
    if (c === "!" && s[i + 1] === "[") {
      flushText();
      toks.push({ bracket: "![", idx: toks.length, active: true });
      i += 2;
      continue;
    }
    if (c === "[") {
      flushText();
      toks.push({ bracket: "[", idx: toks.length, active: true });
      i++;
      continue;
    }
    if (c === "]") {
      let oi = -1;
      for (let k = toks.length - 1; k >= 0; k--) {
        const t = toks[k];
        if ("bracket" in t) {
          oi = k;
          break;
        }
      }
      if (oi < 0 || !toks[oi].active) {
        buf += "]";
        i++;
        continue;
      }
      const opener = toks[oi];
      const link = linkTail(s, i + 1);
      if (!link) {
        opener.active = false;
        buf += "]";
        i++;
        continue;
      }
      flushText();
      const inner = toks.splice(oi + 1);
      toks.pop();
      const children = processEmphasis(inner);
      if (opener.bracket === "![") {
        const attrs = { src: link.dest, alt: plainText(children) };
        if (link.title) attrs.title = link.title;
        toks.push({ n: el("img", [], attrs) });
      } else {
        const attrs = { href: link.dest };
        if (link.title) attrs.title = link.title;
        toks.push({ n: el("a", children, attrs) });
        for (const t of toks) if ("bracket" in t && t.bracket === "[") t.active = false;
      }
      i = link.end;
      continue;
    }
    if (c === "<") {
      const am = /^<((?:[a-zA-Z][a-zA-Z0-9+.-]*:|www\.)[^\s<>]*)>/.exec(s.slice(i));
      if (am) {
        flushText();
        toks.push({ n: el("a", [text(am[1])], { href: am[1] }) });
        i += am[0].length;
        continue;
      }
      const cm = /^<!--[\s\S]*?-->/.exec(s.slice(i));
      if (cm) {
        flushText();
        toks.push({ n: { k: "comment", s: cm[0].slice(4, -3) } });
        i += cm[0].length;
        continue;
      }
      buf += "<";
      i++;
      continue;
    }
    if (c === "&") {
      const em = /^&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]*);/.exec(s.slice(i));
      if (em) {
        const name = em[1];
        let decoded = null;
        if (name.startsWith("#x")) decoded = String.fromCodePoint(parseInt(name.slice(2), 16));
        else if (name.startsWith("#")) decoded = String.fromCodePoint(parseInt(name.slice(1), 10));
        else if (name in ENTITIES) decoded = ENTITIES[name];
        if (decoded !== null) {
          flushText();
          toks.push({ n: text(decoded) });
          i += em[0].length;
          continue;
        }
      }
    }
    if (c === "\n") {
      const hard = buf.endsWith("  ");
      buf = buf.replace(/ +$/, "");
      flushText();
      toks.push({ n: hard ? el("br") : text("\n") });
      i++;
      while (s[i] === " ") i++;
      continue;
    }
    buf += c;
    i++;
  }
  flushText();
  return processEmphasis(toks);
}
function linkTail(s, i) {
  if (s[i] !== "(") return null;
  let j = i + 1;
  while (s[j] === " ") j++;
  let dest = "";
  if (s[j] === "<") {
    const close = s.indexOf(">", j);
    if (close < 0) return null;
    dest = s.slice(j + 1, close);
    j = close + 1;
  } else {
    let depth = 0;
    while (j < s.length) {
      const c = s[j];
      if (c === "\\" && j + 1 < s.length) {
        dest += s[j + 1];
        j += 2;
        continue;
      }
      if (/\s/.test(c)) break;
      if (c === "(") depth++;
      if (c === ")") {
        if (depth === 0) break;
        depth--;
      }
      dest += c;
      j++;
    }
  }
  while (s[j] === " ") j++;
  let title;
  if (s[j] === '"' || s[j] === "'") {
    const q = s[j];
    const close = s.indexOf(q, j + 1);
    if (close < 0) return null;
    title = s.slice(j + 1, close);
    j = close + 1;
    while (s[j] === " ") j++;
  }
  if (s[j] !== ")") return null;
  return { dest, title, end: j + 1 };
}
function processEmphasis(toks) {
  const items = toks.map((t) => "n" in t ? { node: t.n } : "d" in t ? { delim: { ...t.d, alive: true } } : { node: text(t.bracket) });
  for (let ci = 0; ci < items.length; ci++) {
    const closer = items[ci].delim;
    if (!closer || !closer.canClose || !closer.alive) continue;
    let oi = ci - 1;
    for (; oi >= 0; oi--) {
      const o = items[oi].delim;
      if (o && o.alive && o.ch === closer.ch && o.canOpen && o.count > 0) {
        if ((o.canClose || closer.canOpen) && (o.count + closer.count) % 3 === 0 && !(o.count % 3 === 0 && closer.count % 3 === 0)) continue;
        break;
      }
    }
    if (oi < 0) {
      if (!closer.canOpen) closer.alive = false;
      continue;
    }
    const opener = items[oi].delim;
    const use = opener.count >= 2 && closer.count >= 2 ? 2 : 1;
    const inner = items.slice(oi + 1, ci).flatMap((it) => it.node ? [it.node] : it.delim ? [text(it.delim.ch.repeat(it.delim.count))] : []);
    const wrapped = el(use === 2 ? "strong" : "em", inner);
    opener.count -= use;
    closer.count -= use;
    const replacement = [];
    if (opener.count > 0) replacement.push({ delim: opener });
    replacement.push({ node: wrapped });
    if (closer.count > 0) replacement.push({ delim: closer });
    items.splice(oi, ci - oi + 1, ...replacement);
    ci = oi + replacement.length - 1 - (closer.count > 0 ? 1 : 0);
    if (closer.count > 0) ci = oi + replacement.length - 2;
  }
  const out = [];
  for (const it of items) {
    if (it.node) out.push(it.node);
    else if (it.delim && it.delim.count > 0) out.push(text(it.delim.ch.repeat(it.delim.count)));
  }
  const merged = [];
  for (const n of out) {
    const last = merged[merged.length - 1];
    if (n.k === "text" && last && last.k === "text") last.s += n.s;
    else merged.push(n.k === "text" ? { k: "text", s: n.s } : n);
  }
  return merged;
}
function mathAt(s, i) {
  const delim = s.startsWith("$$", i) ? "$$" : "$";
  const after = s[i + delim.length] ?? "";
  if (after === "" || /\s/.test(after)) return null;
  const before = s[i - 1] ?? "";
  if (delim === "$" && /\d/.test(before) && /\d/.test(after)) return null;
  let j = i + delim.length;
  while (j < s.length) {
    if (s[j] === "\\") {
      j += 2;
      continue;
    }
    if (s.startsWith(delim, j)) {
      if (/\d/.test(s[j + delim.length] ?? "")) {
        j++;
        continue;
      }
      return { node: { k: "math", tex: s.slice(i + delim.length, j), display: delim === "$$" }, end: j + delim.length };
    }
    j++;
  }
  return null;
}
var el, text, RE_FENCE, RE_HEADING, RE_HR, RE_QUOTE, RE_LIST, RE_TABLE_DELIM, isBlank, indentOf, BlockParser, PUNCT_RE, ESCAPABLE, ENTITIES;
var init_markdown = __esm({
  "src/markdown.ts"() {
    "use strict";
    init_ast();
    init_tree();
    el = (tag, children = [], attrs = {}) => ({ k: "el", tag, attrs, children });
    text = (s) => ({ k: "text", s });
    RE_FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
    RE_HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
    RE_HR = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
    RE_QUOTE = /^ {0,3}>/;
    RE_LIST = /^( {0,3})([-*+]|\d{1,9}[.)])( {1,4}|\t|$)/;
    RE_TABLE_DELIM = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
    isBlank = (l) => l.trim() === "";
    indentOf = (l) => l.length - l.trimStart().length;
    BlockParser = class {
      parts;
      constructor(parts) {
        this.parts = parts;
      }
      parse(lines) {
        const out = [];
        let i = 0;
        while (i < lines.length) {
          const line = lines[i];
          if (isBlank(line)) {
            i++;
            continue;
          }
          let m;
          if (m = RE_FENCE.exec(line)) {
            const fence = m[1], info = m[2].trim();
            const close = new RegExp("^ {0,3}" + fence[0] + "{" + fence.length + ",}[ \\t]*$");
            const indent = indentOf(line);
            const body = [];
            i++;
            while (i < lines.length && !close.test(lines[i])) body.push(stripIndent(lines[i], indent)), i++;
            i++;
            const code = el("code", [text(body.join("\n") + (body.length ? "\n" : ""))]);
            if (info) code.attrs.class = "language-" + info.split(/\s+/)[0];
            out.push(el("pre", [code]));
            continue;
          }
          if (line.trim() === "$$") {
            const body = [];
            i++;
            while (i < lines.length && lines[i].trim() !== "$$") body.push(lines[i]), i++;
            i++;
            out.push({ k: "math", tex: body.join("\n"), display: true });
            continue;
          }
          if (m = RE_HEADING.exec(line)) {
            const children2 = parseInline(m[2] ?? "");
            const h = el("h" + m[1].length, children2);
            h.slug = slugify(plainText(children2));
            out.push(h);
            i++;
            continue;
          }
          if (RE_HR.test(line)) {
            out.push(el("hr"));
            i++;
            continue;
          }
          if (RE_QUOTE.test(line)) {
            const inner = [];
            while (i < lines.length) {
              const l = lines[i];
              if (RE_QUOTE.test(l)) inner.push(l.replace(/^ {0,3}> ?/, ""));
              else if (!isBlank(l) && inner.length && !isBlank(inner[inner.length - 1]) && !isBlockStart(l)) inner.push(l);
              else break;
              i++;
            }
            out.push(el("blockquote", this.parse(inner)));
            continue;
          }
          if (m = RE_LIST.exec(line)) {
            i = this.list(lines, i, out);
            continue;
          }
          if (line.includes("|") && i + 1 < lines.length && RE_TABLE_DELIM.test(lines[i + 1]) && lines[i + 1].includes("-")) {
            i = this.table(lines, i, out);
            continue;
          }
          if (line.trimStart().startsWith("<!--")) {
            const body = [];
            while (i < lines.length) {
              body.push(lines[i]);
              if (lines[i].includes("-->")) {
                i++;
                break;
              }
              i++;
            }
            const joined = body.join("\n");
            out.push({ k: "comment", s: joined.slice(4, joined.indexOf("-->") < 0 ? void 0 : joined.indexOf("-->")) });
            continue;
          }
          const para = [line];
          i++;
          while (i < lines.length && !isBlank(lines[i]) && !isBlockStart(lines[i])) para.push(lines[i]), i++;
          const children = parseInline(para.map((l) => l.trimStart()).join("\n").replace(/[ \t]+$/, ""));
          out.push(...this.paragraph(children));
        }
        return out;
      }
      /** A paragraph made only of block-level tag holes is emitted unwrapped. */
      paragraph(children) {
        const onlyBlocks = children.length > 0 && children.every((c) => {
          if (c.k === "text") return c.s.trim() === "";
          if (c.k !== "hole") return false;
          const p = this.parts[c.i];
          return p?.p === "tag" && (p.node.kind === "comp" || BLOCK_TAGS.has(p.node.name));
        });
        if (onlyBlocks) return children.filter((c) => c.k !== "text");
        return [el("p", children)];
      }
      list(lines, i, out) {
        const first = RE_LIST.exec(lines[i]);
        const ordered = /\d/.test(first[2]);
        const kind = ordered ? first[2].slice(-1) : first[2];
        const start = ordered ? parseInt(first[2], 10) : 1;
        const items = [];
        let loose = false;
        let sawBlankBetween = false;
        while (i < lines.length) {
          const m = RE_LIST.exec(lines[i]);
          if (!m) break;
          const mk = ordered ? m[2].slice(-1) : m[2];
          if (mk !== kind || /\d/.test(m[2]) !== ordered) break;
          let contentIndent = m[1].length + m[2].length + (m[3] === "	" ? 1 : m[3].length);
          if (m[3].length > 4) contentIndent = m[1].length + m[2].length + 1;
          const firstContent = m[3].length > 4 ? lines[i].slice(m[1].length + m[2].length + 1) : lines[i].slice(m[0].length);
          const item = [firstContent];
          i++;
          if (sawBlankBetween) loose = true;
          sawBlankBetween = false;
          let blanks = 0;
          while (i < lines.length) {
            const l = lines[i];
            if (isBlank(l)) {
              blanks++;
              i++;
              continue;
            }
            if (indentOf(l) >= contentIndent) {
              for (let b = 0; b < blanks; b++) item.push("");
              if (blanks) loose = true;
              blanks = 0;
              item.push(l.slice(contentIndent));
              i++;
              continue;
            }
            if (blanks === 0 && !isBlockStart(l) && !isBlank(item[item.length - 1])) {
              item.push(l);
              i++;
              continue;
            }
            break;
          }
          if (blanks && i < lines.length && RE_LIST.test(lines[i])) sawBlankBetween = true;
          items.push(item);
        }
        const list = el(ordered ? "ol" : "ul");
        if (ordered && start !== 1) list.attrs.start = String(start);
        for (const item of items) {
          let children = this.parse(item);
          if (!loose) children = children.flatMap((c) => c.k === "el" && c.tag === "p" ? c.children : [c]);
          const f = children[0];
          if (f && f.k === "text" && /^\[[ xX]\] /.test(f.s)) {
            const checked = f.s[1] !== " ";
            const box = el("input", [], checked ? { type: "checkbox", disabled: "", checked: "" } : { type: "checkbox", disabled: "" });
            children = [box, text(" "), { k: "text", s: f.s.slice(4) }, ...children.slice(1)];
          }
          list.children.push(el("li", children));
        }
        out.push(list);
        return i;
      }
      table(lines, i, out) {
        const split = (l) => {
          const cells = [];
          let cur = "";
          let t = l.trim();
          if (t.startsWith("|")) t = t.slice(1);
          if (t.endsWith("|") && !t.endsWith("\\|")) t = t.slice(0, -1);
          for (let k = 0; k < t.length; k++) {
            if (t[k] === "\\" && t[k + 1] === "|") {
              cur += "|";
              k++;
            } else if (t[k] === "|") {
              cells.push(cur.trim());
              cur = "";
            } else cur += t[k];
          }
          cells.push(cur.trim());
          return cells;
        };
        const header = split(lines[i]);
        const aligns = split(lines[i + 1]).map((d) => d.startsWith(":") && d.endsWith(":") ? "center" : d.endsWith(":") ? "right" : d.startsWith(":") ? "left" : "");
        const cell = (tag, s, j) => {
          const c = el(tag, parseInline(s));
          if (aligns[j]) c.attrs.style = "text-align:" + aligns[j];
          return c;
        };
        const thead = el("thead", [el("tr", header.map((h, j) => cell("th", h, j)))]);
        const tbody = el("tbody");
        i += 2;
        while (i < lines.length && !isBlank(lines[i]) && lines[i].includes("|")) {
          const row = split(lines[i]);
          tbody.children.push(el("tr", header.map((_, j) => cell("td", row[j] ?? "", j))));
          i++;
        }
        out.push(el("table", tbody.children.length ? [thead, tbody] : [thead]));
        return i;
      }
    };
    PUNCT_RE = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~\p{P}\p{S}]/u;
    ESCAPABLE = "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~";
    ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\xA0", copy: "\xA9", mdash: "\u2014", ndash: "\u2013", hellip: "\u2026", laquo: "\xAB", raquo: "\xBB" };
  }
});

// src/site.ts
function classify(files, errors) {
  const out = [];
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
function routeOf(file) {
  const parts = file.replace(/\.mark$/, "").split("/");
  if (parts[parts.length - 1] === "index") parts.pop();
  const template = "/" + parts.join("/");
  return { template: template === "/" ? "/" : template.replace(/\/$/, ""), dynamic: /\[[^\]]+\]/.test(template) };
}
function routePattern(template) {
  const names = [];
  const re = template.split("/").map((seg) => {
    let m = /^\[\.\.\.([A-Za-z_][A-Za-z0-9_]*)\]$/.exec(seg);
    if (m) {
      names.push(m[1]);
      return "(.+)";
    }
    m = /^\[([A-Za-z_][A-Za-z0-9_]*)\]$/.exec(seg);
    if (m) {
      names.push(m[1]);
      return "([^/]+)";
    }
    return seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }).join("/");
  return { pattern: new RegExp("^" + (re === "" ? "/" : re) + "$"), paramNames: names };
}
function layoutChain(file, layouts) {
  const chain = [];
  if (layouts.has("_site.mark")) chain.push("_site.mark");
  const dirs = file.split("/").slice(0, -1);
  for (let i = 1; i <= dirs.length; i++) {
    const l = dirs.slice(0, i).join("/") + "/_layout.mark";
    if (layouts.has(l)) chain.push(l);
  }
  return chain;
}
function literalValue(e) {
  switch (e.type) {
    case "Literal":
      return { ok: true, value: e.value };
    case "UnaryExpression": {
      const a = literalValue(e.argument);
      if (!a.ok || typeof a.value !== "number") return { ok: false };
      return { ok: true, value: e.operator === "-" ? -a.value : e.operator === "+" ? +a.value : !a.value };
    }
    case "ArrayExpression": {
      const out = [];
      for (const x of e.elements) {
        const v = literalValue(x);
        if (!v.ok) return v;
        out.push(v.value);
      }
      return { ok: true, value: out };
    }
    case "ObjectExpression": {
      const out = {};
      for (const p of e.properties) {
        if (p.shorthand) return { ok: false };
        const v = literalValue(p.value);
        if (!v.ok) return v;
        out[p.key.type === "Identifier" ? p.key.name : String(p.key.value)] = v.value;
      }
      return { ok: true, value: out };
    }
  }
  return { ok: false };
}
function pageProps(ast, file, errors) {
  const props = {};
  let sawContent = false;
  for (const n of ast) {
    if (n.t === "prop") {
      if (sawContent) errors.push(new MarkError("E010", `Page prop \`${n.name}\` must appear before any prose or tag`, n.line, 0, file));
      if (!n.init) {
        errors.push(new MarkError("E010", MSG.E010(n.name), n.line, 0, file));
        continue;
      }
      const v = literalValue(n.init);
      if (!v.ok) {
        errors.push(new MarkError("E010", MSG.E010(n.name), n.line, 0, file));
        continue;
      }
      props[n.name] = v.value;
    } else if (n.t === "prose" || n.t === "tag" || n.t === "if" || n.t === "for" || n.t === "head") sawContent = true;
  }
  return props;
}
function excerptOf(ast) {
  for (const n of ast) {
    if (n.t !== "prose") continue;
    const tree = parseMarkdown(n.md, n.parts);
    for (const h of tree) if (h.k === "el" && h.tag === "p") return plainText(h.children).replace(/\s+/g, " ").trim();
  }
  return "";
}
function derivedTitle(file) {
  const parts = file.replace(/\.mark$/, "").split("/");
  const stem = parts[parts.length - 1];
  if (stem === "index") return parts.length > 1 ? titleCase(parts[parts.length - 2]) : "Home";
  return titleCase(stem);
}
function buildIndex(pages, layoutFiles, notFound, data, config, opts, errors) {
  const layouts = new Set(layoutFiles);
  const entries = [];
  const routes = [];
  const byPath = /* @__PURE__ */ new Map();
  const infos = [];
  for (const { file, ast } of pages) {
    const props = pageProps(ast, file, errors);
    const { template, dynamic } = routeOf(file);
    const draft = props.draft === true;
    const chain = props.layout === false ? [] : typeof props.layout === "string" ? [] : layoutChain(file, layouts);
    const layoutComponent = typeof props.layout === "string" ? props.layout : void 0;
    const excerpt = excerptOf(ast);
    const base = (path, extra = {}) => {
      const merged = { ...props, ...extra };
      const info = {
        path,
        dir: path.slice(0, path.lastIndexOf("/")) || "/",
        file,
        title: typeof merged.title === "string" ? merged.title : derivedTitle(file),
        tags: Array.isArray(merged.tags) ? merged.tags : [],
        props: merged,
        excerpt,
        dynamic
      };
      if (typeof merged.section === "string") info.section = merged.section;
      if (typeof merged.order === "number") info.order = merged.order;
      if (typeof merged.date === "string") info.date = merged.date;
      return info;
    };
    const register = (info, params) => {
      const prev = byPath.get(info.path);
      if (prev) {
        errors.push(new MarkError("E011", MSG.E011(info.path, prev, file), 1, 0, file));
        return;
      }
      byPath.set(info.path, file);
      if (draft && !opts.drafts) return;
      infos.push(info);
      entries.push({ info, file, params, layouts: chain, layoutComponent, draft });
    };
    if (!dynamic) {
      register(base(template), {});
      continue;
    }
    const { pattern, paramNames } = routePattern(template);
    const paths = props.paths;
    routes.push({ file, template, pattern, paramNames, layouts: chain, layoutComponent, hasPaths: Array.isArray(paths) });
    if (Array.isArray(paths)) {
      for (const p of paths) {
        if (typeof p !== "object" || p === null) continue;
        const params = {};
        for (const k of Object.keys(p)) params[k] = String(p[k]);
        let path = template;
        for (const name of paramNames) path = path.replace(`[...${name}]`, params[name] ?? "").replace(`[${name}]`, params[name] ?? "");
        register(base(path, p), params);
      }
    } else if (config.spa) {
      const info = base(template);
      if (!(draft && !opts.drafts)) infos.push(info);
    } else {
      errors.push(new MarkError("E024", MSG.E024(file), 1, 0, file));
    }
  }
  infos.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const sections = {};
  for (const p of infos) {
    if (!p.section) continue;
    (sections[p.section] ??= { name: p.section, path: "", pages: [] }).pages.push(p);
  }
  for (const s of Object.values(sections)) {
    const dirs = new Set(s.pages.map((p) => p.dir));
    s.path = dirs.size === 1 ? [...dirs][0] : s.pages.map((p) => p.path).reduce((a, b) => b.length < a.length ? b : a);
  }
  const nav = infos.filter((p) => p.order !== void 0).sort((a, b) => a.order - b.order || (a.title < b.title ? -1 : a.title > b.title ? 1 : 0));
  const site = {
    base: config.base,
    pages: infos,
    sections,
    nav,
    data,
    page: (path) => infos.find((p) => p.path === path),
    under: (path) => infos.filter((p) => p.path.startsWith(path.replace(/\/$/, "") + "/"))
  };
  deepFreeze(site);
  return { entries, routes, notFound, site };
}
function parseDataFile(name, src) {
  if (name.endsWith(".json")) return JSON.parse(src);
  if (name.endsWith(".yaml") || name.endsWith(".yml")) return parseYaml(src);
  return void 0;
}
function parseYaml(src) {
  const lines = src.replace(/\r\n?/g, "\n").split("\n").map((l) => l.replace(/\s+#.*$/, "").replace(/^#.*$/, "")).filter((l) => l.trim() !== "");
  let i = 0;
  const indent = (l) => l.length - l.trimStart().length;
  function scalar(s) {
    s = s.trim();
    if (s === "" || s === "~" || s === "null") return null;
    if (s === "true") return true;
    if (s === "false") return false;
    if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(s)) return Number(s);
    if (s.startsWith('"') && s.endsWith('"')) return JSON.parse(s);
    if (s.startsWith("'") && s.endsWith("'")) return s.slice(1, -1).replace(/''/g, "'");
    if (s.startsWith("[") || s.startsWith("{")) {
      try {
        return JSON.parse(s);
      } catch {
        return s;
      }
    }
    return s;
  }
  function block(level) {
    if (i >= lines.length) return null;
    const first = lines[i];
    if (indent(first) < level) return null;
    if (first.trimStart().startsWith("- ")) {
      const out = [];
      const lvl2 = indent(first);
      while (i < lines.length && indent(lines[i]) === lvl2 && lines[i].trimStart().startsWith("- ")) {
        const rest = lines[i].trimStart().slice(2);
        if (/^[^:\s"'[{]+:\s*(.*)$/.test(rest) || /^[^:]+:$/.test(rest)) {
          lines[i] = " ".repeat(lvl2 + 2) + rest;
          out.push(block(lvl2 + 2));
        } else if (rest.trim() === "") {
          i++;
          out.push(block(lvl2 + 1));
        } else {
          i++;
          out.push(scalar(rest));
        }
      }
      return out;
    }
    const obj = {};
    const lvl = indent(first);
    while (i < lines.length && indent(lines[i]) === lvl && !lines[i].trimStart().startsWith("- ")) {
      const m = /^([^:]+?):\s*(.*)$/.exec(lines[i].trim());
      if (!m) throw new Error(`YAML: cannot parse line: ${lines[i]}`);
      const key = m[1].replace(/^["']|["']$/g, "");
      i++;
      if (m[2] === "") obj[key] = i < lines.length && indent(lines[i]) > lvl ? block(indent(lines[i])) : null;
      else if (m[2] === "|" || m[2] === ">") {
        const buf = [];
        while (i < lines.length && indent(lines[i]) > lvl) buf.push(lines[i].trim()), i++;
        obj[key] = buf.join(m[2] === "|" ? "\n" : " ");
      } else obj[key] = scalar(m[2]);
    }
    return obj;
  }
  return block(0);
}
function loadData(files) {
  const data = {};
  for (const [path, src] of files) {
    const m = /^_data\/([^/]+)\.(json|ya?ml)$/.exec(path);
    if (m) data[m[1]] = parseDataFile(path, src);
  }
  return data;
}
var titleCase;
var init_site = __esm({
  "src/site.ts"() {
    "use strict";
    init_diagnostics();
    init_reactive();
    init_markdown();
    titleCase = (s) => s.replace(/[-_]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());
  }
});

// src/compile.ts
import { readdirSync as readdirSync2, readFileSync as readFileSync3, statSync } from "node:fs";
import { join as join3, relative } from "node:path";
function loadFiles(dir, config) {
  const files = /* @__PURE__ */ new Map();
  const walk = (d, textOnly) => {
    if (!exists(d)) return;
    for (const name of readdirSync2(d)) {
      const p = join3(d, name);
      if (statSync(p).isDirectory()) walk(p, textOnly);
      else if (!textOnly || /\.(mark|json|ya?ml)$/.test(name)) files.set(relative(dir, p).split("\\").join("/"), readFileSync3(p, "utf8"));
    }
  };
  walk(join3(dir, config.root), true);
  walk(join3(dir, "_data"), true);
  return files;
}
function exists(p) {
  try {
    statSync(p);
    return true;
  } catch {
    return false;
  }
}
function compileProject(files, config, opts = {}) {
  const diagnostics = [];
  const errors = [];
  const rootPrefix = config.root.replace(/\/$/, "") + "/";
  const parsed = [];
  for (const [path, src] of files) {
    if (!path.startsWith(rootPrefix) || !path.endsWith(".mark")) continue;
    const file = path.slice(rootPrefix.length);
    try {
      parsed.push({ file, ast: parseDocument(src) });
    } catch (e) {
      if (e instanceof MarkError) diagnostics.push(e.toDiagnostic(path));
      else throw e;
    }
  }
  const classified = classify(parsed.map((p) => p.file), errors);
  const docs = /* @__PURE__ */ new Map();
  const byName = /* @__PURE__ */ new Map();
  const byFile = /* @__PURE__ */ new Map();
  const infos = [];
  const makeDoc = (id, name, kind, ast, file) => {
    compileNodes(ast);
    const style = ast.find((n) => n.t === "style");
    const doc = {
      id,
      name,
      kind,
      nodes: ast,
      props: ast.filter((n) => n.t === "prop").map((n) => n.name),
      stamp: style && !style.global ? stampOf(id) : null,
      intrinsic: false,
      islands: [],
      hasMath: false,
      usesSite: false
    };
    infos.push({ file, ast, kind: kind === "page" ? "page" : kind, name: name || void 0, props: doc.props, hasExports: ast.some((n) => (n.t === "let" || n.t === "fn") && n.export) });
    return doc;
  };
  for (const [name, src] of Object.entries(BUILTINS)) {
    const doc = makeDoc("builtin:" + name, name, "component", parseDocument(src), "builtin:" + name);
    docs.set(doc.id, doc);
    byName.set(name, doc);
  }
  for (const c of classified) {
    const ast = parsed.find((p) => p.file === c.file).ast;
    const kind = c.kind === "notfound" ? "page" : c.kind;
    const doc = makeDoc(docIdOf(c.file), c.name ?? "", kind, ast, rootPrefix + c.file);
    docs.set(doc.id, doc);
    byFile.set(c.file, doc);
    if (c.name) byName.set(c.name, doc);
  }
  const byNameInfo = /* @__PURE__ */ new Map();
  for (const i of infos) if (i.name) byNameInfo.set(i.name, i);
  diagnostics.push(...checkProject(infos.filter((i) => !i.file.startsWith("builtin:")), byNameInfo));
  const layoutFiles = classified.filter((c) => c.kind === "layout").map((c) => c.file);
  const notFound = classified.find((c) => c.kind === "notfound")?.file ?? null;
  const pages = classified.filter((c) => c.kind === "page").map((c) => ({ file: c.file, ast: byFile.get(c.file).nodes }));
  const data = loadData(files);
  const index = buildIndex(pages, layoutFiles, notFound, data, config, { drafts: opts.drafts }, errors);
  for (const e of errors) diagnostics.push(e.toDiagnostic(e.file.startsWith(rootPrefix) ? e.file : rootPrefix + e.file));
  analyzeProject(docs, byName, config.spa);
  const cssByDoc = /* @__PURE__ */ new Map();
  const order = [...docs.values()].sort((a, b) => rank(a) - rank(b) || (a.id < b.id ? -1 : 1));
  const cssParts = [];
  for (const d of order) {
    const style = d.nodes.find((n) => n.t === "style");
    if (!style) continue;
    const css = style.global ? style.css : scopeCss(style.css, d.stamp);
    cssByDoc.set(d.id, css);
    cssParts.push(`/* ${d.id} */
${css}`);
  }
  diagnostics.sort((a, b) => a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line);
  return {
    config,
    files,
    docs,
    byName,
    byFile,
    index,
    diagnostics,
    hasErrors: diagnostics.some((d) => d.severity === "error"),
    css: cssParts.join("\n"),
    cssByDoc
  };
}
function compileNodes(nodes) {
  let next = 0;
  const visit = (n) => {
    n.id = next++;
    switch (n.t) {
      case "prose":
        n.tree = parseMarkdown(n.md, n.parts);
        for (const p of n.parts) if (p.p === "tag") visit(p.node);
        break;
      case "if":
        n.then.forEach(visit);
        if (n.else) Array.isArray(n.else) ? n.else.forEach(visit) : visit(n.else);
        break;
      case "for":
        n.body.forEach(visit);
        break;
      case "tag":
        n.children.forEach(visit);
        break;
      case "head":
        n.children.forEach(visit);
        break;
    }
  };
  nodes.forEach(visit);
}
var docIdOf, stampOf, rank;
var init_compile = __esm({
  "src/compile.ts"() {
    "use strict";
    init_analysis();
    init_builtins();
    init_checker();
    init_css();
    init_diagnostics();
    init_markdown();
    init_parser();
    init_site();
    docIdOf = (file) => file.replace(/\.mark$/, "");
    stampOf = (id) => "data-mk-" + id.replace(/^components\//, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
    rank = (d) => d.id === "_site" ? 0 : d.kind === "layout" ? 1 : d.kind === "page" ? 2 : 3;
  }
});

// src/core/interp.ts
function makeCtx(over = {}) {
  return {
    globals: {},
    env: { reducedMotion: false, client: false, dev: false, touch: false },
    intrinsics: {
      next: () => Promise.resolve(),
      after: () => new Promise(() => {
      }),
      measure: () => ({ x: 0, y: 0, w: 0, h: 0 })
    },
    dynamic: false,
    client: false,
    buildTime: 0,
    locale: "en-US",
    log: () => {
    },
    ops: 0,
    opLimit: 1e7,
    deadline: Infinity,
    ...over
  };
}
function tick(ctx) {
  if (++ctx.ops > ctx.opLimit) throw limitError();
  if ((ctx.ops & 65535) === 0 && Date.now() > ctx.deadline) throw limitError();
}
function bound(obj, fn) {
  return typeof fn === "function" ? (...a) => fn.apply(obj, a) : fn;
}
function getMember(obj, key, ctx) {
  if (obj === null || obj === void 0) throw new TypeError(`Cannot read properties of ${obj} (reading '${String(key)}')`);
  const k = typeof key === "number" ? key : String(key);
  switch (typeof obj) {
    case "string":
      if (typeof k === "number" || /^\d+$/.test(k)) return obj[Number(k)];
      if (k === "length") return obj.length;
      if (!STRING_METHODS.has(k)) throw e021("String." + k);
      if (k === "localeCompare") return (b) => compareStrings(obj, String(b));
      return bound(obj, String.prototype[k]);
    case "number":
      if (!NUMBER_METHODS.has(k)) throw e021("Number." + k);
      return bound(obj, Number.prototype[k]);
    case "boolean":
      if (k === "toString") return () => String(obj);
      throw e021("Boolean." + k);
    case "function": {
      const g = hostGlobalMember(obj, k, ctx);
      if (g !== NOT_HOST) return g;
      throw e021("function." + k);
    }
    case "object":
      break;
    default:
      throw e021(String(k));
  }
  const o = obj;
  if (Array.isArray(o)) {
    if (typeof k === "number" || /^\d+$/.test(k)) return o[Number(k)];
    if (!ARRAY_METHODS.has(k)) throw e021("Array." + k);
    if (k === "length") return o.length;
    if (k === "sort" || k === "toSorted") {
      const native = Array.prototype[k];
      return (cmp) => native.call(o, typeof cmp === "function" ? cmp : (a, b) => compareStrings(String(a), String(b)));
    }
    return bound(o, Array.prototype[k]);
  }
  if (o instanceof Date) {
    if (!DATE_METHODS.has(k)) throw e021("Date." + k);
    const name = DATE_MAP[k] ?? k;
    if (name.startsWith("toLocale")) return (loc, opts) => o[name](typeof loc === "string" ? loc : ctx.locale, { timeZone: "UTC", ...typeof opts === "object" && opts ? opts : {} });
    return bound(o, Date.prototype[name]);
  }
  if (isDomNode(o)) return bound(o, o[k]);
  const hg = hostGlobalMember(o, k, ctx);
  if (hg !== NOT_HOST) return hg;
  if (o instanceof Promise) {
    if (k === "then" || k === "catch" || k === "finally") return bound(o, o[k]);
    throw e021("Promise." + k);
  }
  const proto = Object.getPrototypeOf(toRaw(o));
  if (proto !== Object.prototype && proto !== null) return bound(o, o[k]);
  if (Object.prototype.hasOwnProperty.call(toRaw(o), k)) return o[k];
  if (k in Object.prototype) throw e021("Object." + k);
  return void 0;
}
function hostGlobalMember(obj, k, ctx) {
  const t = hostTables.get(obj);
  if (t) {
    const [name, allowed] = t;
    if (!allowed.has(k)) throw e021(`${name}.${k}`);
    if (obj === Math && k === "random") return () => {
      if (!ctx.dynamic) throw e022();
      return ctx.client ? Math.random() : 0;
    };
    if (obj === Date && k === "now") return () => {
      if (!ctx.dynamic) throw e022();
      return ctx.client ? Date.now() : ctx.buildTime;
    };
    if (obj === Array && k === "from") return (a, f) => Array.from(a, f);
    return bound(obj, obj[k]);
  }
  if (obj === ctx.globals.console) {
    if (!CONSOLE_MEMBERS.has(k)) throw e021("console." + k);
    return (...args) => ctx.log(k, args);
  }
  if (obj === ctx.env) {
    if (!ENV_MEMBERS.has(k)) throw e021("env." + k);
    return ctx.env[k];
  }
  return NOT_HOST;
}
function setMember(obj, key, value) {
  if (obj === null || obj === void 0 || typeof obj !== "object") throw new TypeError(`Cannot set properties of ${String(obj)}`);
  const ok = Reflect.set(obj, key, value);
  if (!ok) throw new TypeError(`Cannot assign to read only property '${String(key)}'`);
}
function evalExpr(e, sc, ctx) {
  tick(ctx);
  switch (e.type) {
    case "Literal":
      return e.value;
    case "Identifier":
      return lookup(e.name, sc, ctx);
    case "MemberExpression": {
      const obj = evalExpr(e.object, sc, ctx);
      if (e.optional && (obj === null || obj === void 0)) throw SHORT;
      const key = e.computed ? evalExpr(e.property, sc, ctx) : e.property.name;
      return getMember(obj, key, ctx);
    }
    case "ChainExpression":
      try {
        return evalExpr(e.expression, sc, ctx);
      } catch (x) {
        if (x === SHORT) return void 0;
        throw x;
      }
    case "CallExpression": {
      const fn = calleeOf(e.callee, sc, ctx);
      if (e.optional && (fn === null || fn === void 0)) throw SHORT;
      const args = e.arguments.map((a) => evalExpr(a, sc, ctx));
      return callValue(fn, args, e.callee);
    }
    case "NewExpression":
      return construct(e, e.arguments.map((a) => evalExpr(a, sc, ctx)), ctx);
    case "ArrayExpression":
      return e.elements.map((x) => evalExpr(x, sc, ctx));
    case "ObjectExpression": {
      const o = {};
      for (const p of e.properties) {
        const k = p.key.type === "Identifier" ? p.key.name : String(p.key.value);
        o[k] = evalExpr(p.value, sc, ctx);
      }
      return o;
    }
    case "ArrowFunctionExpression":
      return makeFunction(e.params.map((p) => p.name), e.body, sc, ctx, e.async, "arrow");
    case "UnaryExpression": {
      const v = evalExpr(e.argument, sc, ctx);
      return e.operator === "!" ? !v : e.operator === "-" ? -v : +v;
    }
    case "BinaryExpression":
      return binary(e.operator, evalExpr(e.left, sc, ctx), evalExpr(e.right, sc, ctx));
    case "LogicalExpression": {
      const l = evalExpr(e.left, sc, ctx);
      return e.operator === "&&" ? l ? evalExpr(e.right, sc, ctx) : l : l ? l : evalExpr(e.right, sc, ctx);
    }
    case "ConditionalExpression":
      return evalExpr(e.test, sc, ctx) ? evalExpr(e.consequent, sc, ctx) : evalExpr(e.alternate, sc, ctx);
    case "AssignmentExpression":
      return assign(e.left, e.operator, evalExpr(e.right, sc, ctx), sc, ctx);
    case "SequenceExpression": {
      let v;
      for (const x of e.expressions) v = evalExpr(x, sc, ctx);
      return v;
    }
    case "AwaitExpression":
      throw new HostError("E016", "`await` is only allowed in `async fn`, handlers, and async arrows");
    case "TryExpression":
      try {
        return evalExpr(e.expr, sc, ctx);
      } catch (err) {
        if (err === SHORT || isFatal(err)) throw err;
        const fb = evalExpr(e.fallback, sc, ctx);
        return typeof fb === "function" ? fb(err) : fb;
      }
  }
  throw new Error(`Unknown expression ${e.type}`);
}
function lookup(name, sc, ctx) {
  const c = sc.lookup(name);
  if (c) return c.get();
  if (name in ctx.globals) return ctx.globals[name];
  if (name === "env") return ctx.env;
  if (name === "next") return ctx.intrinsics.next;
  if (name === "after") return ctx.intrinsics.after;
  if (name === "measure") return ctx.intrinsics.measure;
  throw new ReferenceError(`${name} is not defined`);
}
function calleeOf(callee, sc, ctx) {
  if (callee.type === "MemberExpression") {
    const obj = evalExpr(callee.object, sc, ctx);
    if (callee.optional && (obj === null || obj === void 0)) throw SHORT;
    const key = callee.computed ? evalExpr(callee.property, sc, ctx) : callee.property.name;
    return getMember(obj, key, ctx);
  }
  return evalExpr(callee, sc, ctx);
}
function callValue(fn, args, callee) {
  if (typeof fn !== "function") throw new TypeError(`${describeCallee(callee)} is not a function`);
  return fn(...args);
}
function describeCallee(c) {
  if (c.type === "Identifier") return c.name;
  if (c.type === "MemberExpression" && !c.computed) return describeCallee(c.object) + "." + c.property.name;
  return "expression";
}
function construct(e, args, ctx) {
  const name = e.callee.name;
  if (name !== "Date") throw e021("new " + name);
  if (args.length === 0) {
    if (!ctx.dynamic) throw e022();
    return ctx.client ? /* @__PURE__ */ new Date() : new Date(ctx.buildTime);
  }
  return new Date(...args);
}
function binary(op, l, r) {
  switch (op) {
    case "==":
      return eq(l, r);
    case "!=":
      return !eq(l, r);
    case "+":
      return l + r;
    case "-":
      return l - r;
    case "*":
      return l * r;
    case "/":
      return l / r;
    case "%":
      return l % r;
    case "**":
      return l ** r;
    case "<":
      return l < r;
    case ">":
      return l > r;
    case "<=":
      return l <= r;
    case ">=":
      return l >= r;
  }
  throw new Error("Unknown operator " + op);
}
function assign(left, op, value, sc, ctx) {
  const compute = (old) => op === "=" ? value : binary(op.slice(0, -1), old(), value);
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
    const key = left.computed ? evalExpr(left.property, sc, ctx) : left.property.name;
    const v = compute(() => getMember(obj, key, ctx));
    setMember(obj, key, v);
    return v;
  }
  throw new SyntaxError("Invalid assignment target");
}
function makeFunction(params, body, sc, ctx, isAsync, name) {
  const f = (...args) => {
    const inner = new Scope2(sc);
    params.forEach((p, i) => inner.define(p, localCell(args[i])));
    if (isAsync) return drive(Array.isArray(body) ? execStmtsGen(body, inner, ctx) : evalGen(body, inner, ctx), batch);
    if (!Array.isArray(body)) return evalExpr(body, inner, ctx);
    const r = execStmts(body, inner, ctx);
    return r instanceof Return ? r.value : void 0;
  };
  Object.defineProperty(f, "name", { value: name });
  return f;
}
function execStmts(stmts, sc, ctx) {
  for (const s of stmts) {
    tick(ctx);
    switch (s.s) {
      case "let":
      case "var":
        sc.define(s.name, localCell(s.init ? evalExpr(s.init, sc, ctx) : void 0, s.s === "let" ? "const" : "local"));
        break;
      case "if": {
        const branch = evalExpr(s.cond, sc, ctx) ? s.then : s.else;
        if (!branch) break;
        const r = Array.isArray(branch) ? execStmts(branch, new Scope2(sc), ctx) : execStmts([branch], sc, ctx);
        if (r) return r;
        break;
      }
      case "for": {
        const src = evalExpr(s.src, sc, ctx);
        const arr = src === null || src === void 0 ? [] : src;
        if (!Array.isArray(arr)) throw new HostError("RT01", `\`for\` source is not an array (got ${typeof arr})`);
        for (let i = 0; i < arr.length; i++) {
          const inner = new Scope2(sc);
          inner.define(s.item, localCell(arr[i]));
          if (s.index) inner.define(s.index, localCell(i));
          const r = execStmts(s.body, inner, ctx);
          if (r) return r;
        }
        break;
      }
      case "return":
        return new Return(s.value ? evalExpr(s.value, sc, ctx) : void 0);
      case "expr":
        evalExpr(s.expr, sc, ctx);
        break;
    }
  }
  return void 0;
}
function hasAwait(e) {
  if (Array.isArray(e)) return e.some(hasAwait);
  const cached = awaitCache.get(e);
  if (cached !== void 0) return cached;
  let r = false;
  if ("type" in e) {
    if (e.type === "AwaitExpression") r = true;
    else if (e.type === "ArrowFunctionExpression") r = false;
    else for (const v of Object.values(e)) {
      if (v && typeof v === "object") {
        if (Array.isArray(v)) {
          if (v.some((x) => x && typeof x === "object" && "type" in x && hasAwait(x))) {
            r = true;
            break;
          }
        } else if ("type" in v && hasAwait(v)) {
          r = true;
          break;
        }
      }
    }
  } else {
    switch (e.s) {
      case "let":
      case "var":
        r = !!e.init && hasAwait(e.init);
        break;
      case "if":
        r = hasAwait(e.cond) || hasAwait(e.then) || !!e.else && (Array.isArray(e.else) ? hasAwait(e.else) : hasAwait(e.else));
        break;
      case "for":
        r = hasAwait(e.src) || hasAwait(e.body);
        break;
      case "return":
        r = !!e.value && hasAwait(e.value);
        break;
      case "expr":
        r = hasAwait(e.expr);
        break;
    }
  }
  awaitCache.set(e, r);
  return r;
}
function* evalGen(e, sc, ctx) {
  if (!hasAwait(e)) return evalExpr(e, sc, ctx);
  tick(ctx);
  switch (e.type) {
    case "AwaitExpression":
      return yield yield* evalGen(e.argument, sc, ctx);
    case "MemberExpression": {
      const obj = yield* evalGen(e.object, sc, ctx);
      if (e.optional && (obj === null || obj === void 0)) throw SHORT;
      const key = e.computed ? yield* evalGen(e.property, sc, ctx) : e.property.name;
      return getMember(obj, key, ctx);
    }
    case "ChainExpression":
      try {
        return yield* evalGen(e.expression, sc, ctx);
      } catch (x) {
        if (x === SHORT) return void 0;
        throw x;
      }
    case "CallExpression": {
      let fn;
      if (e.callee.type === "MemberExpression") {
        const obj = yield* evalGen(e.callee.object, sc, ctx);
        if (e.callee.optional && (obj === null || obj === void 0)) throw SHORT;
        const key = e.callee.computed ? yield* evalGen(e.callee.property, sc, ctx) : e.callee.property.name;
        fn = getMember(obj, key, ctx);
      } else fn = yield* evalGen(e.callee, sc, ctx);
      if (e.optional && (fn === null || fn === void 0)) throw SHORT;
      const args = [];
      for (const a of e.arguments) args.push(yield* evalGen(a, sc, ctx));
      return callValue(fn, args, e.callee);
    }
    case "NewExpression": {
      const args = [];
      for (const a of e.arguments) args.push(yield* evalGen(a, sc, ctx));
      return construct(e, args, ctx);
    }
    case "ArrayExpression": {
      const out = [];
      for (const x of e.elements) out.push(yield* evalGen(x, sc, ctx));
      return out;
    }
    case "ObjectExpression": {
      const o = {};
      for (const p of e.properties) {
        const k = p.key.type === "Identifier" ? p.key.name : String(p.key.value);
        o[k] = yield* evalGen(p.value, sc, ctx);
      }
      return o;
    }
    case "UnaryExpression": {
      const v = yield* evalGen(e.argument, sc, ctx);
      return e.operator === "!" ? !v : e.operator === "-" ? -v : +v;
    }
    case "BinaryExpression": {
      const l = yield* evalGen(e.left, sc, ctx);
      const r = yield* evalGen(e.right, sc, ctx);
      return binary(e.operator, l, r);
    }
    case "LogicalExpression": {
      const l = yield* evalGen(e.left, sc, ctx);
      if (e.operator === "&&") return l ? yield* evalGen(e.right, sc, ctx) : l;
      return l ? l : yield* evalGen(e.right, sc, ctx);
    }
    case "ConditionalExpression":
      return (yield* evalGen(e.test, sc, ctx)) ? yield* evalGen(e.consequent, sc, ctx) : yield* evalGen(e.alternate, sc, ctx);
    case "AssignmentExpression": {
      const v = yield* evalGen(e.right, sc, ctx);
      return assign(e.left, e.operator, v, sc, ctx);
    }
    case "SequenceExpression": {
      let v;
      for (const x of e.expressions) v = yield* evalGen(x, sc, ctx);
      return v;
    }
    case "TryExpression": {
      try {
        return yield* evalGen(e.expr, sc, ctx);
      } catch (err) {
        if (err === SHORT || isFatal(err)) throw err;
        const fb = yield* evalGen(e.fallback, sc, ctx);
        return typeof fb === "function" ? fb(err) : fb;
      }
    }
  }
  return evalExpr(e, sc, ctx);
}
function* execStmtsGen(stmts, sc, ctx) {
  for (const s of stmts) {
    if (!hasAwait(s)) {
      const r = execStmts([s], sc, ctx);
      if (r) return r.value;
      continue;
    }
    tick(ctx);
    switch (s.s) {
      case "let":
      case "var":
        sc.define(s.name, localCell(s.init ? yield* evalGen(s.init, sc, ctx) : void 0, s.s === "let" ? "const" : "local"));
        break;
      case "if": {
        const branch = (yield* evalGen(s.cond, sc, ctx)) ? s.then : s.else;
        if (!branch) break;
        const r = Array.isArray(branch) ? yield* execStmtsGen(branch, new Scope2(sc), ctx) : yield* execStmtsGen([branch], sc, ctx);
        if (r !== NO_RETURN) return r;
        break;
      }
      case "for": {
        const src = yield* evalGen(s.src, sc, ctx);
        const arr = src === null || src === void 0 ? [] : src;
        if (!Array.isArray(arr)) throw new HostError("RT01", `\`for\` source is not an array (got ${typeof arr})`);
        for (let i = 0; i < arr.length; i++) {
          const inner = new Scope2(sc);
          inner.define(s.item, localCell(arr[i]));
          if (s.index) inner.define(s.index, localCell(i));
          const r = yield* execStmtsGen(s.body, inner, ctx);
          if (r !== NO_RETURN) return r;
        }
        break;
      }
      case "return":
        return s.value ? yield* evalGen(s.value, sc, ctx) : void 0;
      case "expr":
        yield* evalGen(s.expr, sc, ctx);
        break;
    }
  }
  return NO_RETURN;
}
function drive(gen, wrap = (f) => f()) {
  return new Promise((resolve2, reject) => {
    const step = (method, value) => {
      let r;
      try {
        r = wrap(() => gen[method](value));
      } catch (err) {
        reject(err);
        return;
      }
      if (r.done) {
        resolve2(r.value === NO_RETURN ? void 0 : r.value);
        return;
      }
      Promise.resolve(r.value).then((v) => step("next", v), (err) => step("throw", err));
    };
    step("next", void 0);
  });
}
var Scope2, localCell, constCell, SHORT, Return, limitError, isDomNode, DATE_MAP, NOT_HOST, hostTables, e022, isFatal, awaitCache, NO_RETURN;
var init_interp = __esm({
  "src/core/interp.ts"() {
    "use strict";
    init_reactive();
    init_signal();
    init_host();
    Scope2 = class {
      vars = /* @__PURE__ */ new Map();
      parent;
      constructor(parent = null) {
        this.parent = parent;
      }
      lookup(name) {
        let s = this;
        while (s) {
          const c = s.vars.get(name);
          if (c) return c;
          s = s.parent;
        }
        return void 0;
      }
      define(name, cell) {
        this.vars.set(name, cell);
      }
    };
    localCell = (value, kind = "local") => {
      const c = { kind, value, get: () => c.value, set: (v) => {
        c.value = v;
      } };
      return c;
    };
    constCell = (value) => ({ kind: "const", get: () => value, set: () => {
      throw new TypeError("Cannot assign to a constant");
    } });
    SHORT = Symbol("short-circuit");
    Return = class {
      value;
      constructor(v) {
        this.value = v;
      }
    };
    limitError = () => new HostError("E023", "Page evaluation exceeded the operation limit");
    isDomNode = (v) => typeof Node !== "undefined" && v instanceof Node;
    DATE_MAP = {
      getFullYear: "getUTCFullYear",
      getMonth: "getUTCMonth",
      getDate: "getUTCDate",
      getDay: "getUTCDay",
      getHours: "getUTCHours",
      getMinutes: "getUTCMinutes",
      getSeconds: "getUTCSeconds"
    };
    NOT_HOST = Symbol("not-host");
    hostTables = /* @__PURE__ */ new Map([
      [Math, ["Math", MATH_MEMBERS]],
      [Number, ["Number", NUMBER_STATIC]],
      [String, ["String", /* @__PURE__ */ new Set()]],
      [Array, ["Array", ARRAY_STATIC]],
      [Object, ["Object", OBJECT_STATIC]],
      [JSON, ["JSON", JSON_STATIC]],
      [Date, ["Date", DATE_STATIC]],
      [Promise, ["Promise", PROMISE_STATIC]]
    ]);
    e022 = () => new HostError("E022", "`Math.random`/`Date.now` cannot be used in static content; use it in a `var` or handler");
    isFatal = (err) => err instanceof HostError && err.code === "E023";
    awaitCache = /* @__PURE__ */ new WeakMap();
    NO_RETURN = Symbol("no-return");
  }
});

// src/core/render.ts
function mountDocument(rc, doc, inputs, slots, out, parentScope = null) {
  const owner = new Owner(getOwner());
  const inst = { doc, scope: new Scope2(parentScope), owner, props: /* @__PURE__ */ new Map(), bound: /* @__PURE__ */ new Set(), slots };
  runWithOwner(owner, () => renderItems(rc, doc.nodes, inst, out, inputs));
  return inst;
}
function evalExports(doc, ctx) {
  const scope = new Scope2(null);
  const out = {};
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
function tableBody(rc, inst, out) {
  const h = rc.host;
  if (!out.parent || h.tagOf(out.parent) !== "table") return out;
  let tb = rc.tbodies.get(out.parent);
  if (!tb) {
    tb = h.el("tbody");
    if (inst.doc.stamp) h.setAttr(tb, inst.doc.stamp, "");
    h.insert(out.parent, tb, out.before);
    h.enter(tb);
    rc.tbodies.set(out.parent, tb);
  }
  return { parent: tb, before: null };
}
function renderItems(rc, nodes, inst, out, inputs) {
  const h = rc.host;
  let group = null;
  const flushGroup = () => {
    if (!group) return;
    const id = rc.islandId(group, inst);
    const start = h.comment("mk:" + id, false);
    h.insert(out.parent, start, out.before);
    for (const n of group) renderNodeInner(rc, n, inst, out);
    const end = h.comment("/mk:" + id, false);
    h.insert(out.parent, end, out.before);
    group = null;
  };
  for (const node of nodes) {
    switch (node.t) {
      case "var":
        declareVar(rc, node, inst);
        break;
      case "let":
        declareLet(rc, node, inst);
        break;
      case "fn":
        declareFn(rc, node, inst);
        break;
      case "prop":
        declareProp(rc, node, inst, inputs?.get(node.name));
        break;
      case "style":
        break;
      default:
        if (rc.islandId && node.island && inst.doc.kind !== "component") {
          (group ??= []).push(node);
          break;
        }
        flushGroup();
        renderNodeInner(rc, node, inst, out);
    }
  }
  flushGroup();
}
function guard(rc, inst, line, fn, fallback) {
  try {
    return fn();
  } catch (err) {
    rc.onError(err, { line, doc: inst.doc.id });
    return fallback;
  }
}
function declareVar(rc, node, inst) {
  const prev = rc.ctx.dynamic;
  rc.ctx.dynamic = true;
  const init = node.init ? guard(rc, inst, node.line, () => untrack(() => evalExpr(node.init, inst.scope, rc.ctx)), void 0) : void 0;
  rc.ctx.dynamic = prev;
  const sig = signal(reactive(init), node.name);
  inst.scope.define(node.name, {
    kind: "var",
    get: () => sig.get(),
    set: (v) => {
      if (inst.owner.disposed) {
        if (rc.dev) rc.ctx.log("warn", [`write to \`${node.name}\` of an unmounted component ignored`]);
        return;
      }
      sig.set(reactive(v));
    }
  });
}
function declareLet(rc, node, inst) {
  const c = computed(() => guard(rc, inst, node.line, () => evalExpr(node.init, inst.scope, rc.ctx), void 0), node.name);
  inst.scope.define(node.name, { kind: "let", get: () => c.get(), set: () => {
    throw new TypeError(`Cannot assign to let \`${node.name}\``);
  } });
}
function declareFn(rc, node, inst) {
  inst.scope.define(node.name, constCell(makeFunction(node.params, node.body, inst.scope, rc.ctx, node.async, node.name)));
}
function declareProp(rc, node, inst, input) {
  let initial;
  if (!input) {
    if (node.init) initial = guard(rc, inst, node.line, () => untrack(() => evalExpr(node.init, inst.scope, rc.ctx)), void 0);
    else if (rc.dev && inst.doc.kind === "component") rc.onError(Object.assign(new Error(`Required prop \`${node.name}\` of <${inst.doc.name}> not provided`), { code: "RT04" }), { line: node.line, doc: inst.doc.id });
  } else if (input.k === "static") initial = input.value;
  else if (input.k === "fn") initial = input.value;
  else initial = untrack(input.get);
  const sig = signal(reactive(initial), node.name);
  if (input && (input.k === "dyn" || input.k === "bind")) {
    effect(() => sig.set(reactive(input.get())), "prop:" + node.name);
  }
  if (input?.k === "bind") inst.bound.add(node.name);
  const cell = {
    kind: "prop",
    get: () => sig.get(),
    set: (v) => {
      if (inst.owner.disposed) return;
      sig.set(reactive(v));
      if (inst.bound.has(node.name)) {
        const cb = inst.props.get("on" + node.name[0].toUpperCase() + node.name.slice(1) + "Change")?.get();
        if (typeof cb === "function") cb(v);
      }
    }
  };
  inst.props.set(node.name, cell);
  inst.scope.define(node.name, cell);
}
function renderNode(rc, node, inst, out) {
  renderNodeInner(rc, node, inst, out);
}
function renderNodeInner(rc, node, inst, out) {
  switch (node.t) {
    case "tag":
      return node.kind === "html" ? renderHtml(rc, node, inst, out) : renderComponent(rc, node, inst, out);
    case "prose":
      return renderProse(rc, node, inst, out);
    case "if":
      return renderIf(rc, node, inst, out);
    case "for":
      return renderFor(rc, node, inst, out);
    case "head":
      return renderHead(rc, node, inst);
    default:
      return renderItems(rc, [node], inst, out);
  }
}
function renderNodes(rc, nodes, inst, out) {
  renderItems(rc, nodes, inst, out);
}
function withBase(rc, name, v) {
  if (v !== null && URL_ATTRS.has(name) && v.startsWith("/") && !v.startsWith("//") && rc.base !== "/") return rc.base.replace(/\/$/, "") + v;
  return v;
}
function renderHtml(rc, node, inst, out) {
  if (node.name === "slot") return renderSlot(rc, node, inst, out);
  if (node.name === "tr") out = tableBody(rc, inst, out);
  const h = rc.host;
  const el2 = h.el(node.name);
  if (inst.doc.stamp) h.setAttr(el2, inst.doc.stamp, "");
  const scope = inst.scope;
  const classAttrs = node.attrs.filter((a) => (a.k === "static" || a.k === "dyn") && a.name === "class");
  const ev = (e) => evalExpr(e, scope, rc.ctx);
  const isInput = node.name === "input" || node.name === "textarea" || node.name === "select";
  const renderClass = () => {
    const compute = () => {
      const parts = [];
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
    if (isStatic) h.setAttr(el2, "class", compute());
    else effect(() => h.setAttr(el2, "class", guard(rc, inst, node.line, compute, null)), "class");
  };
  let classDone = false;
  for (const a of node.attrs) {
    if ((a.k === "static" || a.k === "dyn") && a.name === "class") {
      if (!classDone) {
        classDone = true;
        renderClass();
      }
      continue;
    }
    switch (a.k) {
      case "static":
        if (a.if) effect(() => h.setAttr(el2, a.name, guard(rc, inst, node.line, () => ev(a.if) ? withBase(rc, a.name, a.value === true ? "" : a.value) : null, null)), a.name);
        else h.setAttr(el2, a.name, withBase(rc, a.name, a.value === true ? "" : a.value));
        break;
      case "dyn": {
        if (a.name === "ref") {
          const cell = a.value.type === "Identifier" ? scope.lookup(a.value.name) : void 0;
          if (cell && rc.ctx.client) {
            queueMicrotaskSafe(() => cell.set(el2));
            onCleanup(() => cell.set(null));
          }
          break;
        }
        effect(() => {
          const v = guard(rc, inst, node.line, () => a.if && !ev(a.if) ? null : attrValue(a.name, ev(a.value)), null);
          h.setAttr(el2, a.name, withBase(rc, a.name, v));
          if (isInput && (a.name === "value" || a.name === "checked")) h.setProp(el2, a.name, a.name === "checked" ? v !== null : v ?? "");
        }, a.name);
        break;
      }
      case "bind": {
        const path = bindPath(rc, a.path, inst);
        effect(() => {
          const v = guard(rc, inst, node.line, path.get, void 0);
          const s = attrValue(a.name, v);
          h.setAttr(el2, a.name, s);
          h.setProp(el2, a.name, a.name === "checked" ? !!v : v ?? "");
        }, "bind:" + a.name);
        const typeAttr = node.attrs.find((x) => x.k === "static" && x.name === "type");
        const numeric = typeAttr && (typeAttr.value === "number" || typeAttr.value === "range");
        const evName = a.name === "checked" ? "change" : "input";
        onCleanup(h.listen(el2, evName, (e) => {
          const target = e.target;
          const raw = a.name === "checked" ? target.checked : target.value;
          rc.ctx.ops = 0;
          batch(() => guard(rc, inst, node.line, () => path.set(numeric ? Number(raw) : raw), void 0));
        }));
        break;
      }
      case "event": {
        if (a.name === "onMount" || a.name === "onUnmount") {
          const call = () => {
            const f = guard(rc, inst, node.line, () => ev(a.handler), null);
            if (typeof f === "function") batch(() => f(el2));
          };
          if (a.name === "onMount") queueMicrotaskSafe(call);
          else onCleanup(call);
          break;
        }
        onCleanup(h.listen(el2, eventName(a.name), (e) => runHandler(rc, inst, a, node.line, e)));
        break;
      }
    }
  }
  h.insert(out.parent, el2, out.before);
  h.enter(el2);
  renderNodes(rc, node.children, inst, { parent: el2, before: null });
  h.exit(el2);
}
function runHandler(rc, inst, a, line, e) {
  const prev = rc.ctx.dynamic;
  rc.ctx.dynamic = true;
  rc.ctx.ops = 0;
  try {
    if (a.wrap) {
      drive(evalGen(a.handler, inst.scope, rc.ctx), batch).catch((err) => rc.onError(err, { line, doc: inst.doc.id }));
    } else {
      const f = batch(() => guard(rc, inst, line, () => evalExpr(a.handler, inst.scope, rc.ctx), null));
      if (typeof f === "function") {
        const r = batch(() => guard(rc, inst, line, () => f(e), void 0));
        if (r instanceof Promise) r.catch((err) => rc.onError(err, { line, doc: inst.doc.id }));
      }
    }
  } finally {
    rc.ctx.dynamic = prev;
  }
}
function bindPath(rc, path, inst) {
  const scope = inst.scope;
  const root = path[0];
  const walk = () => {
    const cell = scope.lookup(root);
    if (!cell) throw new ReferenceError(`${root} is not defined`);
    if (path.length === 1) return null;
    let obj = cell.get();
    for (let i = 1; i < path.length - 1; i++) {
      const seg = path[i];
      const key = typeof seg === "string" ? seg : evalExpr(seg, scope, rc.ctx);
      obj = obj[key];
    }
    const last = path[path.length - 1];
    return { obj, key: typeof last === "string" ? last : evalExpr(last, scope, rc.ctx) };
  };
  return {
    get: () => {
      const w = walk();
      if (!w) return scope.lookup(root).get();
      if (w.obj === null || w.obj === void 0) return void 0;
      return w.obj[w.key];
    },
    set: (v) => {
      const w = walk();
      if (!w) {
        scope.lookup(root).set(v);
        return;
      }
      w.obj[w.key] = toRaw(v);
    }
  };
}
function renderComponent(rc, node, inst, out) {
  if (node.name === "Fragment") return renderNodes(rc, node.children, inst, out);
  if (node.name === "Math") return renderMathComponent(rc, node, inst, out);
  const doc = rc.docs.get(node.name);
  if (!doc) {
    rc.onError(Object.assign(new Error(`Unknown component <${node.name}>`), { code: "E007" }), { line: node.line, doc: inst.doc.id });
    return;
  }
  const scope = inst.scope;
  const inputs = /* @__PURE__ */ new Map();
  for (const a of node.attrs) {
    switch (a.k) {
      case "static":
        if (a.if) inputs.set(a.name, { k: "dyn", get: () => evalExpr(a.if, scope, rc.ctx) ? a.value : void 0 });
        else inputs.set(a.name, { k: "static", value: a.value });
        break;
      case "dyn":
        inputs.set(a.name, { k: "dyn", get: () => a.if && !evalExpr(a.if, scope, rc.ctx) ? void 0 : evalExpr(a.value, scope, rc.ctx) });
        break;
      case "bind": {
        const p = bindPath(rc, a.path, inst);
        inputs.set(a.name, { k: "bind", get: p.get, set: p.set });
        const cb = "on" + a.name[0].toUpperCase() + a.name.slice(1) + "Change";
        if (doc.props.includes(cb)) inputs.set(cb, { k: "fn", value: (v) => batch(() => p.set(v)) });
        break;
      }
      case "event": {
        if (a.wrap) inputs.set(a.name, { k: "fn", value: (e) => runHandler(rc, inst, a, node.line, e) });
        else inputs.set(a.name, { k: "dyn", get: () => evalExpr(a.handler, scope, rc.ctx) });
        break;
      }
    }
  }
  const named = /* @__PURE__ */ new Map();
  const defaults = [];
  for (const c of node.children) {
    const slotAttr = c.t === "tag" && c.name === "Fragment" ? c.attrs.find((x) => x.k === "static" && x.name === "slot") : void 0;
    if (slotAttr && slotAttr.k === "static") named.set(String(slotAttr.value), c.t === "tag" ? c.children : []);
    else defaults.push(c);
  }
  const slots = {
    has: (name) => name === "" ? defaults.length > 0 : named.has(name),
    render: (name, o) => renderNodes(rc, name === "" ? defaults : named.get(name) ?? [], inst, o)
  };
  mountDocument(rc, doc, inputs, slots, out);
}
function renderSlot(rc, node, inst, out) {
  const nameAttr = node.attrs.find((a) => a.k === "static" && a.name === "name");
  const name = nameAttr && nameAttr.value !== true ? nameAttr.value : "";
  const h = rc.host;
  const markers = rc.spa && inst.doc.kind === "layout" && name === "";
  if (markers) h.insert(out.parent, h.comment("mk:slot", false), out.before);
  if (inst.slots && inst.slots.has(name)) inst.slots.render(name, out);
  if (markers) h.insert(out.parent, h.comment("/mk:slot", false), out.before);
}
function withRange(h, out, body) {
  const start = h.comment("", true);
  h.insert(out.parent, start, out.before);
  body(out.before);
  const end = h.comment("", true);
  h.insert(out.parent, end, out.before);
  return { start, end };
}
function clearRange(h, r) {
  let n = h.next(r.start);
  while (n && n !== r.end) {
    const nx = h.next(n);
    h.remove(n);
    n = nx;
  }
}
function moveRange(h, parent, r, before) {
  let n = r.start;
  const stop = h.next(r.end);
  while (n && n !== stop) {
    const nx = h.next(n);
    h.insert(parent, n, before);
    n = nx;
  }
}
function removeRange(h, r) {
  clearRange(h, r);
  h.remove(r.start);
  h.remove(r.end);
}
function listTag(nodes) {
  const real = nodes.filter((n2) => n2.t !== "var" && n2.t !== "let" && n2.t !== "fn" && n2.t !== "prop" && n2.t !== "style");
  if (real.length !== 1) return null;
  const n = real[0];
  if (n.t === "prose") {
    const tree = n.tree;
    return tree && tree.length === 1 && isList(tree[0]) ? tree[0].tag : null;
  }
  if (n.t === "for") return listTag(n.body);
  if (n.t === "if") {
    const t = listTag(n.then);
    if (!t) return null;
    let e = n.else;
    while (e) {
      if (Array.isArray(e)) {
        if (e.length && listTag(e) !== t) return null;
        break;
      }
      if (listTag(e.then) !== t) return null;
      e = e.else;
    }
    return t;
  }
  return null;
}
function renderIf(rc, node, inst, out) {
  const h = rc.host;
  out = tableBody(rc, inst, out);
  const branches = [];
  let cur = node;
  while (cur) {
    if (Array.isArray(cur)) {
      branches.push({ cond: null, nodes: cur });
      break;
    }
    branches.push({ cond: cur.cond, nodes: cur.then });
    cur = cur.else;
  }
  const merged = !!out.listMerge;
  const parentOwner = getOwner();
  let current = -1;
  let owner = null;
  let range = null;
  range = withRange(h, out, (before) => effect(() => {
    let idx = -1;
    for (let i = 0; i < branches.length; i++) {
      const b = branches[i];
      if (!b.cond || guard(rc, inst, node.line, () => evalExpr(b.cond, inst.scope, rc.ctx), false)) {
        idx = i;
        break;
      }
    }
    if (idx === current) return;
    current = idx;
    if (owner) {
      owner.dispose();
      owner = null;
    }
    if (range) clearRange(h, range);
    if (idx < 0) return;
    runWithOwner(parentOwner, () => {
      owner = new Owner(parentOwner);
      runWithOwner(owner, () => renderBody(rc, branches[idx].nodes, inst, { parent: out.parent, before: range ? range.end : before }, merged));
    });
  }, "if"));
}
function renderBody(rc, nodes, inst, out, merge) {
  if (!merge) return renderNodes(rc, nodes, inst, out);
  for (const n of nodes) {
    if (n.t === "prose") {
      const tree = n.tree;
      if (tree && tree.length === 1 && isList(tree[0])) {
        renderTree(rc, tree[0].children, n.parts, inst, out);
        continue;
      }
    }
    if (n.t === "if" || n.t === "for") {
      renderNodeInner(rc, n, inst, Object.assign({}, out, { listMerge: true }));
      continue;
    }
    renderItems(rc, [n], inst, out);
  }
}
function renderFor(rc, node, inst, out) {
  const h = rc.host;
  out = tableBody(rc, inst, out);
  const merged = !!out.listMerge;
  const tag = merged ? null : listTag(node.body);
  let container = out;
  if (tag) {
    const ul = h.el(tag);
    if (inst.doc.stamp) h.setAttr(ul, inst.doc.stamp, "");
    h.insert(out.parent, ul, out.before);
    h.enter(ul);
    container = { parent: ul, before: null };
  }
  const merge = merged || !!tag;
  const parentOwner = getOwner();
  const rows = /* @__PURE__ */ new Map();
  const scope = inst.scope;
  let range = null;
  range = withRange(h, container, (outerBefore) => effect(() => {
    const endAnchor = () => range ? range.end : outerBefore;
    const src = guard(rc, inst, node.line, () => evalExpr(node.src, scope, rc.ctx), []);
    let list = [];
    if (src === null || src === void 0) list = [];
    else if (Array.isArray(src)) {
      list = [];
      for (let i = 0; i < src.length; i++) list.push(src[i]);
    } else {
      rc.onError(Object.assign(new Error(`\`for\` source is not an array (got ${typeof src})`), { code: "RT01" }), { line: node.line, doc: inst.doc.id });
    }
    const keys = [];
    const seen = /* @__PURE__ */ new Map();
    for (let i = 0; i < list.length; i++) {
      let k;
      if (node.key) {
        const s = new Scope2(scope);
        s.define(node.item, constCell(list[i]));
        if (node.index) s.define(node.index, constCell(i));
        k = guard(rc, inst, node.line, () => toRaw(evalExpr(node.key, s, rc.ctx)), i);
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
      const keep = new Set(keys.map((k) => typeof k === "object" && k !== null && "dup" in k ? JSON.stringify(k) : k));
      for (const [k, row] of rows) if (!keep.has(k)) {
        row.owner.dispose();
        removeRange(h, row.range);
        rows.delete(k);
      }
      let cursor = range ? h.next(range.start) : null;
      const atEnd = () => cursor === endAnchor();
      for (let i = 0; i < list.length; i++) {
        const rawKey = keys[i];
        const k = typeof rawKey === "object" && rawKey !== null && "dup" in rawKey ? JSON.stringify(rawKey) : rawKey;
        let row = rows.get(k);
        if (!row) {
          const owner = new Owner(parentOwner);
          const item = signal(list[i], node.item);
          const index = signal(i, node.index ?? "index");
          const s = new Scope2(scope);
          const srcArr = src;
          s.define(node.item, { kind: "item", get: () => item.get(), set: (v) => {
            srcArr[index.peek()] = toRaw(v);
            item.set(v);
          } });
          if (node.index) s.define(node.index, { kind: "item", get: () => index.get(), set: () => {
            throw new TypeError("Cannot assign to a loop index");
          } });
          const rowInst = { ...inst, scope: s };
          const before = atEnd() ? endAnchor() : cursor;
          const r = withRange(h, { parent: container.parent, before }, (b) => runWithOwner(owner, () => renderBody(rc, node.body, rowInst, { parent: container.parent, before: b }, merge)));
          row = { range: r, owner, item, index, key: k };
          rows.set(k, row);
          cursor = h.next(r.end);
          continue;
        }
        batch(() => {
          row.item.set(list[i]);
          row.index.set(i);
        });
        if (row.range.start !== cursor) moveRange(h, container.parent, row.range, cursor);
        cursor = h.next(row.range.end);
      }
    }));
  }, "for"));
  if (tag) h.exit(container.parent);
}
function renderProse(rc, node, inst, out) {
  const tree = node.tree;
  if (!tree) throw new Error("prose node was not compiled");
  renderTree(rc, tree, node.parts, inst, out);
}
function renderTree(rc, tree, parts, inst, out) {
  for (const n of tree) renderHNode(rc, n, parts, inst, out);
}
function substitute(rc, template, parts, inst) {
  return template.replace(PLACEHOLDER_RE, (_, i) => {
    const p = parts[Number(i)];
    return p && p.p === "interp" ? fmt(evalExpr(p.expr, inst.scope, rc.ctx)) : "";
  });
}
function renderHNode(rc, n, parts, inst, out) {
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
      const el2 = h.el(n.tag);
      if (inst.doc.stamp) h.setAttr(el2, inst.doc.stamp, "");
      for (const [name, value] of Object.entries(n.attrs)) {
        if (value.includes(PH)) effect(() => h.setAttr(el2, name, withBase(rc, name, guard(rc, inst, 0, () => substitute(rc, value, parts, inst), ""))), name);
        else h.setAttr(el2, name, withBase(rc, name, value));
      }
      if (n.slug) {
        const count = (rc.slugs.get(n.slug) ?? 0) + 1;
        rc.slugs.set(n.slug, count);
        h.setAttr(el2, "id", count === 1 ? n.slug : `${n.slug}-${count}`);
      }
      h.insert(out.parent, el2, out.before);
      h.enter(el2);
      renderTree(rc, n.children, parts, inst, { parent: el2, before: null });
      h.exit(el2);
      return;
    }
    case "hole": {
      const part = parts[n.i];
      if (!part) return;
      if (part.p === "tag") return renderNode(rc, part.node, inst, out);
      if (part.p === "text") {
        const t = h.text(part.s);
        h.insert(out.parent, t, out.before);
        return;
      }
      let textNode = null;
      let range = null;
      range = withRange(h, out, (before) => effect(() => {
        const v = guard(rc, inst, 0, () => fmt(evalExpr(part.expr, inst.scope, rc.ctx)), "");
        if (v === "") {
          if (textNode) {
            h.remove(textNode);
            textNode = null;
          }
          return;
        }
        if (textNode) h.setText(textNode, v);
        else {
          textNode = h.text(v);
          h.insert(out.parent, textNode, range ? range.end : before);
        }
      }, "interp"));
      return;
    }
    case "math":
      return renderMath(rc, () => substitute(rc, n.tex, parts, inst), n.display, inst, out);
  }
}
function renderMath(rc, tex, display, inst, out) {
  const h = rc.host;
  let node = null;
  let range = null;
  range = withRange(h, out, (before) => effect(() => {
    const src = guard(rc, inst, 0, tex, "");
    const html = rc.math ? rc.math(src, display) : `<span class="mk-math-error">${escapeHtml(src)}</span>`;
    if (node) h.remove(node);
    node = h.html(html);
    h.insert(out.parent, node, range ? range.end : before);
  }, "math"));
}
function renderMathComponent(rc, node, inst, out) {
  const get = (name) => {
    const a = node.attrs.find((x) => x.name === name && (x.k === "static" || x.k === "dyn"));
    if (!a) return () => void 0;
    return a.k === "static" ? () => a.value : () => evalExpr(a.value, inst.scope, rc.ctx);
  };
  const tex = get("tex"), display = get("display");
  renderMath(rc, () => fmt(tex()), !!untrack(display), inst, out);
}
function renderHead(rc, node, inst) {
  if (!rc.head) return;
  if (!rc.spa) {
    renderNodes(rc, node.children, inst, rc.head);
    return;
  }
  const h = rc.host;
  const tmp = h.el("div");
  renderNodes(rc, node.children, inst, { parent: tmp, before: null });
  for (let c = h.first(tmp); c; c = h.first(tmp)) {
    if (h.tagOf(c)) h.setAttr(c, "data-mk-head", inst.doc.id);
    h.insert(rc.head.parent, c, rc.head.before);
  }
}
var eventName, URL_ATTRS, queueMicrotaskSafe;
var init_render = __esm({
  "src/core/render.ts"() {
    "use strict";
    init_ast();
    init_host();
    init_interp();
    init_reactive();
    init_signal();
    init_tree();
    eventName = (attr) => attr === "onTap" ? "click" : attr.slice(2).toLowerCase();
    URL_ATTRS = /* @__PURE__ */ new Set(["href", "src", "action", "poster"]);
    queueMicrotaskSafe = (fn) => {
      queueMicrotask(fn);
    };
  }
});

// src/emit.ts
function collectNames(v, out) {
  if (!v || typeof v !== "object") return;
  if (Array.isArray(v)) {
    for (const x of v) collectNames(x, out);
    return;
  }
  const o = v;
  if (o.type === "Identifier" && typeof o.name === "string") out.add(o.name);
  if (o.k === "bind" && Array.isArray(o.path) && typeof o.path[0] === "string") out.add(o.path[0]);
  for (const key of Object.keys(o)) if (key !== "tree" && key !== "md") collectNames(o[key], out);
}
function pruneDoc(doc, full) {
  if (full || doc.kind === "component") return doc.nodes;
  const islands = doc.nodes.filter((n) => n.island);
  const needed = /* @__PURE__ */ new Set();
  for (const n of islands) collectNames(n, needed);
  const decls = doc.nodes.filter((n) => n.t === "var" || n.t === "let" || n.t === "fn" || n.t === "prop");
  let changed = true;
  while (changed) {
    changed = false;
    for (const d of decls) {
      if (!needed.has(d.name)) continue;
      const before = needed.size;
      collectNames(d.t === "fn" ? d.body : d.init, needed);
      if (needed.size !== before) changed = true;
    }
  }
  return doc.nodes.filter((n) => n.island || (n.t === "var" || n.t === "let" || n.t === "fn" || n.t === "prop") && needed.has(n.name));
}
function componentClosure(nodes, byName, out = /* @__PURE__ */ new Map()) {
  const visit = (n) => {
    switch (n.t) {
      case "tag":
        if (n.kind === "comp" && n.name !== "Fragment" && n.name !== "Math") {
          const d = byName.get(n.name);
          if (d && !out.has(d.id)) {
            out.set(d.id, d);
            d.nodes.forEach(visit);
          }
        }
        n.children.forEach(visit);
        break;
      case "prose":
        for (const p of n.parts) if (p.p === "tag") visit(p.node);
        break;
      case "if":
        n.then.forEach(visit);
        if (n.else) Array.isArray(n.else) ? n.else.forEach(visit) : visit(n.else);
        break;
      case "for":
        n.body.forEach(visit);
        break;
      case "head":
        n.children.forEach(visit);
        break;
    }
  };
  nodes.forEach(visit);
  return out;
}
function emitDocModule(doc, nodes) {
  const data = { id: doc.id, name: doc.name, kind: doc.kind, props: doc.props, stamp: doc.stamp, nodes };
  return `export default ${JSON.stringify(data, stripForClient)};
`;
}
function emitPageModule(opts) {
  const up = "../".repeat(opts.depth + 1);
  const lines = [`import { hydrate } from "${up}runtime.js";`];
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
  if (opts.spa) {
    lines.push(`export default m;`);
    lines.push(`if (!globalThis.__mark) hydrate(m);`);
  } else lines.push(`hydrate(m);`);
  return lines.join("\n") + "\n";
}
function emitSiteModule(site, routes) {
  return `export default ${JSON.stringify({ site, routes })};
`;
}
var docFileName, pageFileName, stripForClient;
var init_emit = __esm({
  "src/emit.ts"() {
    "use strict";
    docFileName = (id) => id.replace(/:/g, "_").replace(/\//g, "__") + ".js";
    pageFileName = (path) => (path === "/" ? "index" : path.replace(/^\//, "")) + ".js";
    stripForClient = (_k, v) => _k === "md" ? void 0 : v;
  }
});

// src/math.ts
import katex from "katex";
function makeMathRenderer(mode, macros = {}) {
  return (tex, display) => {
    try {
      return katex.renderToString(tex, {
        displayMode: display,
        output: mode === "mathml" ? "mathml" : "htmlAndMathml",
        throwOnError: true,
        macros: { ...macros },
        strict: "ignore",
        trust: false
      });
    } catch {
      return `<span class="mk-math-error">${escapeHtml(tex)}</span>`;
    }
  };
}
var init_math = __esm({
  "src/math.ts"() {
    "use strict";
    init_host();
  }
});

// src/build.ts
import { cpSync, existsSync as existsSync3, mkdirSync, rmSync, statSync as statSync2, writeFileSync } from "node:fs";
import { dirname as dirname2, join as join4, relative as relative2, sep } from "node:path";
function makeGlobals(project, page, ctx) {
  const g = { Site: project.index.site, Page: page, Math, JSON, Number, String, Array, Object, Date, Promise, console: {} };
  for (const d of project.byName.values()) {
    if (!d.nodes.some((n) => (n.t === "let" || n.t === "fn") && n.export)) continue;
    let cache = null;
    Object.defineProperty(g, d.name, { enumerable: true, get: () => cache ??= evalExports(d, ctx()) });
  }
  return g;
}
function renderPage(project, entry, opts, pageObj) {
  const config = project.config;
  const errors = [];
  const page = pageObj ?? {
    path: entry.info.path,
    params: entry.params,
    query: {},
    hash: "",
    info: entry.info,
    title: entry.info.title,
    layouts: entry.layouts
  };
  const ctx = makeCtx({
    client: false,
    dynamic: false,
    buildTime: Date.now(),
    locale: config.locale,
    env: { reducedMotion: false, client: false, dev: !!opts.dev, touch: false },
    log: (level, args) => console[level === "log" ? "log" : level](`[mark ${entry.file}]`, ...args),
    deadline: Date.now() + 1e4
  });
  ctx.globals = makeGlobals(project, page, () => ctx);
  const host = new BuildHost();
  const body = host.root("body");
  const head = host.root("head");
  const islands = [];
  const rc = {
    host,
    ctx,
    docs: project.byName,
    dev: !!opts.dev,
    spa: config.spa,
    base: config.base,
    math: makeMathRenderer(config.math, config.katex.macros ?? {}),
    slugs: /* @__PURE__ */ new Map(),
    tbodies: /* @__PURE__ */ new WeakMap(),
    head: { parent: head, before: null },
    onError: (err, where) => {
      const e = err;
      if (err instanceof RangeError && /call stack/.test(err.message)) {
        e.code = "E023";
        e.message = "Page evaluation exceeded the operation limit (stack overflow)";
      }
      const file = where.doc.startsWith("builtin:") ? where.doc : project.config.root + "/" + where.doc + ".mark";
      errors.push({ file, line: where.line, col: 0, code: e.code ?? "RT00", message: String(e.message ?? err), severity: "error" });
    },
    islandId: (nodes, inst) => {
      const id = islands.length;
      islands.push({ doc: inst.doc.id, nodes: nodes.map((n) => n.id), id });
      return id;
    }
  };
  const chain = entry.layoutComponent ? [project.byName.get(entry.layoutComponent)].filter(Boolean) : entry.layouts.map((f) => project.byFile.get(f)).filter(Boolean);
  const pageDoc = project.byFile.get(entry.file);
  const owner = new Owner(null);
  runWithOwner(owner, () => {
    const renderChain = (i, out) => {
      if (i >= chain.length) {
        mountDocument(rc, pageDoc, /* @__PURE__ */ new Map(), null, out);
        return;
      }
      const slots = { has: (n) => n === "", render: (n, o) => {
        if (n === "") renderChain(i + 1, o);
      } };
      mountDocument(rc, chain[i], /* @__PURE__ */ new Map(), slots, out);
    };
    renderChain(0, { parent: body, before: null });
  });
  flush();
  owner.dispose();
  const titles = findAll(head, "title");
  const title = titles.length ? textOf(titles[titles.length - 1]) : entry.info.title;
  return { body, head, islands, errors, ctx, title };
}
function pageHtml(project, entry, r, opts) {
  const config = project.config;
  const host = new BuildHost();
  const titles = findAll(r.head, "title");
  for (const t of titles.slice(0, -1)) host.remove(t);
  const hasCharset = findAll(r.head, "meta").some((m) => m.type === "el" && m.attrs.has("charset"));
  let head = serialize(r.head);
  if (!titles.length) head += `<title${config.spa ? ' data-mk-head="' + escapeHtml(project.byFile.get(entry.file).id) + '"' : ""}>${escapeHtml(r.title)}</title>`;
  if (project.css) head += `<link rel="stylesheet" href="${config.base}_mk/mark.css">`;
  if (config.math === "katex" && project.byFile.get(entry.file)?.hasMath) head += `<link rel="stylesheet" href="${config.base}_mk/katex/katex.min.css">`;
  const body = serialize(r.body);
  const script = r.islands.length || config.spa ? `<script type="module" src="${config.base}_mk/pages/${pageFileName(entry.info.path)}"></script>` : "";
  return `<!doctype html>
<html lang="${escapeHtml(config.lang)}">
<head>
${hasCharset ? "" : '<meta charset="utf-8">\n'}${head}
</head>
<body>
${body}
${script}${script ? "\n" : ""}</body>
</html>
`;
}
function buildProject(project, opts = {}) {
  const config = project.config;
  const files = /* @__PURE__ */ new Map();
  const pages = [];
  const diagnostics = [...project.diagnostics];
  const report = [];
  const emittedDocs = /* @__PURE__ */ new Set();
  let needsKatex = false;
  let needsRuntime = false;
  const entries = [...project.index.entries];
  if (project.index.notFound) {
    const nf = project.byFile.get(project.index.notFound);
    const info = { path: "/404", dir: "/", file: project.index.notFound, title: "Not found", tags: [], props: {}, excerpt: "", dynamic: false };
    entries.push({ info, file: project.index.notFound, params: {}, layouts: project.byFile.has("_site.mark") ? ["_site.mark"] : [], draft: false });
  }
  for (const entry of entries) {
    const is404 = entry.info.path === "/404" && entry.file === project.index.notFound;
    const pageObj = is404 ? { path: "/404", params: {}, query: {}, hash: "", info: void 0, title: "Not found", layouts: entry.layouts } : void 0;
    const r = renderPage(project, entry, opts, pageObj);
    diagnostics.push(...r.errors);
    const html = pageHtml(project, entry, r, opts);
    const file = is404 ? "404.html" : entry.info.path === "/" ? "index.html" : entry.info.path.replace(/^\//, "") + "/index.html";
    files.set(file, html);
    pages.push({ path: entry.info.path, file, html, islands: r.islands, errors: r.errors, title: r.title });
    const pageDoc = project.byFile.get(entry.file);
    const chainDocs = entry.layoutComponent ? [project.byName.get(entry.layoutComponent)] : entry.layouts.map((f) => project.byFile.get(f));
    const rootDocs = [...chainDocs, pageDoc];
    if (r.islands.length || config.spa) {
      needsRuntime = true;
      const docIds = [];
      const islandNodes = rootDocs.flatMap((d) => pruneDoc(d, config.spa));
      const fullSpa = config.spa;
      const comps = componentClosure(islandNodes, project.byName);
      const names = /* @__PURE__ */ new Set();
      for (const d of [...rootDocs, ...comps.values()]) collectNames(pruneDoc(d, config.spa), names);
      for (const d of project.byName.values()) if (names.has(d.name) && d.nodes.some((n) => (n.t === "let" || n.t === "fn") && n.export)) comps.set(d.id, d);
      let needMath = false;
      let needSite = false;
      for (const d of [...rootDocs, ...comps.values()]) {
        const nodes = pruneDoc(d, config.spa);
        if (!nodes.length && !fullSpa) continue;
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
        docIds,
        islands: r.islands,
        needSite: needSite || config.spa,
        needMath,
        base: config.base,
        spa: config.spa,
        dev: !!opts.dev,
        mathMode: config.math,
        katexMacros: config.katex.macros ?? {}
      }));
    }
    if (opts.islands) {
      report.push(`${entry.info.path}: ${r.islands.length} island${r.islands.length === 1 ? "" : "s"}`);
      for (const isl of r.islands) {
        const d = project.docs.get(isl.doc);
        const infos = isl.nodes.map((n) => d.islands.find((x) => x.nodeId === n)).filter(Boolean);
        const causes = [...new Set(infos.flatMap((x) => x.causes))];
        report.push(`  #${isl.id} ${isl.doc}.mark:${infos[0]?.line ?? "?"} \u2190 ${causes.join(", ")}`);
      }
    }
  }
  if (config.spa) {
    for (const r of project.index.routes) {
      const pageDoc = project.byFile.get(r.file);
      const chainDocs = r.layoutComponent ? [project.byName.get(r.layoutComponent)] : r.layouts.map((f) => project.byFile.get(f));
      const rootDocs = [...chainDocs, pageDoc];
      const comps = componentClosure(rootDocs.flatMap((d) => d.nodes), project.byName);
      const docIds = [];
      let needMath = false;
      for (const d of [...rootDocs, ...comps.values()]) {
        docIds.push(d.id);
        if (!emittedDocs.has(d.id)) {
          emittedDocs.add(d.id);
          files.set("_mk/docs/" + docFileName(d.id), emitDocModule(d, d.nodes));
        }
        if (d.hasMath) needMath = true;
      }
      if (needMath) needsKatex = true;
      const depth = r.template.split("/").length - 2;
      files.set("_mk/pages/" + pageFileName(r.template), emitPageModule({
        depth,
        manifest: { path: r.template, params: {}, info: null, title: pageDoc.name || r.template, layouts: chainDocs.map((d) => d.id), page: pageDoc.id },
        docIds,
        islands: [],
        needSite: true,
        needMath,
        base: config.base,
        spa: true,
        dev: !!opts.dev,
        mathMode: config.math,
        katexMacros: config.katex.macros ?? {}
      }));
    }
  }
  if (project.css) files.set("_mk/mark.css", project.css);
  if (needsRuntime || config.spa) {
    const site = JSON.parse(JSON.stringify(project.index.site));
    const specificity = (t) => (t.split("[...").length - 1) * 100 + (t.split("[").length - 1) * 10 - t.split("/").length;
    const routes = {
      pages: project.index.entries.map((e) => ({ path: e.info.path, module: "pages/" + pageFileName(e.info.path) })),
      dynamic: [...project.index.routes].sort((a, b) => specificity(a.template) - specificity(b.template)).map((r) => ({ template: r.template, pattern: r.pattern.source, params: r.paramNames, module: "pages/" + pageFileName(r.template) })),
      notFound: project.index.notFound ? "pages/404.js" : null
    };
    files.set("_mk/site.js", emitSiteModule(site, routes));
  }
  return { files, pages, diagnostics, report, needsKatex, needsRuntime: needsRuntime || config.spa };
}
async function runtimeSource() {
  const prebuilt = textAsset("runtime.js", "runtime/runtime.js");
  if (prebuilt) return prebuilt;
  const esbuild = await import("esbuild");
  const r = await esbuild.build({
    entryPoints: [join4(pkgDir(), "src", "runtime", "index.ts")],
    bundle: true,
    format: "esm",
    write: false,
    minify: true,
    target: "es2022"
  });
  return r.outputFiles[0].text;
}
async function buildDir(projectDir, opts = {}) {
  const config = loadConfig(projectDir, opts.config);
  const files = loadFiles(projectDir, config);
  const project = compileProject(files, config, { drafts: opts.drafts, dev: opts.dev });
  const output = buildProject(project, opts);
  const outDir = join4(projectDir, config.out);
  const ok = !output.diagnostics.some((d) => d.severity === "error");
  if (ok) {
    if (existsSync3(outDir)) rmSync(outDir, { recursive: true, force: true });
    mkdirSync(outDir, { recursive: true });
    for (const [rel, content] of output.files) {
      const p = join4(outDir, rel);
      mkdirSync(dirname2(p), { recursive: true });
      writeFileSync(p, content);
    }
    if (output.needsRuntime) writeFileSync(join4(outDir, "_mk", "runtime.js"), opts.runtimeJs ?? await runtimeSource());
    if (output.needsKatex || config.math === "katex") copyKatex(outDir, output.needsKatex, config.math === "katex");
    const staticDir = join4(projectDir, "static");
    if (existsSync3(staticDir)) cpSync(staticDir, outDir, { recursive: true });
    copyAssets(join4(projectDir, config.root), outDir);
  }
  return { project, output, outDir };
}
function copyAssets(root, outDir) {
  if (!existsSync3(root)) return;
  cpSync(root, outDir, {
    recursive: true,
    filter: (src) => {
      const rel = relative2(root, src);
      if (rel.split(sep).includes("components")) return false;
      return statSync2(src).isDirectory() || !/\.(mark|json|ya?ml)$/.test(src);
    }
  });
}
function copyKatex(outDir, js, css) {
  mkdirSync(join4(outDir, "_mk"), { recursive: true });
  if (js) writeFileSync(join4(outDir, "_mk", "katex.js"), textAsset("katex.mjs", KATEX_DIST + "/katex.mjs") ?? "");
  if (css) {
    mkdirSync(join4(outDir, "_mk", "katex", "fonts"), { recursive: true });
    writeFileSync(join4(outDir, "_mk", "katex", "katex.min.css"), textAsset("katex.min.css", KATEX_DIST + "/katex.min.css") ?? "");
    for (const f of katexFontNames()) {
      const b = binaryAsset("fonts/" + f, KATEX_DIST + "/fonts/" + f);
      if (b) writeFileSync(join4(outDir, "_mk", "katex", "fonts", f), b);
    }
  }
}
function printDiagnostics(ds) {
  for (const d of ds) console.error(formatDiagnostic(d));
}
var init_build = __esm({
  "src/build.ts"() {
    "use strict";
    init_assets();
    init_buildhost();
    init_config();
    init_compile();
    init_interp();
    init_reactive();
    init_render();
    init_signal();
    init_diagnostics();
    init_emit();
    init_host();
    init_math();
  }
});

// src/dev.ts
var dev_exports = {};
__export(dev_exports, {
  devServer: () => devServer
});
import { existsSync as existsSync4, readFileSync as readFileSync4, statSync as statSync3, watch } from "node:fs";
import { createServer } from "node:http";
import { extname, join as join5, normalize } from "node:path";
async function devServer(dir, opts) {
  const clients = /* @__PURE__ */ new Set();
  let outDir = join5(dir, "dist");
  let lastErrors = [];
  let base = "/";
  const rebuild = async () => {
    const t0 = Date.now();
    try {
      const r = await buildDir(dir, { dev: true, drafts: opts.drafts, config: opts.spa ? { spa: true } : {} });
      outDir = r.outDir;
      base = r.project.config.base;
      lastErrors = r.output.diagnostics.filter((d) => d.severity === "error");
      printDiagnostics(r.output.diagnostics);
      console.error(lastErrors.length ? `\u2717 build failed (${Date.now() - t0} ms)` : `\u2713 rebuilt ${r.output.pages.length} pages in ${Date.now() - t0} ms`);
    } catch (e) {
      lastErrors = [{ file: "", line: 0, col: 0, code: "CRASH", message: String(e.stack ?? e), severity: "error" }];
      console.error(e);
    }
    for (const c of clients) c.write("data: reload\n\n");
  };
  await rebuild();
  let timer = null;
  for (const sub of ["site", "_data", "static", "mark.config.json"]) {
    const p = join5(dir, sub);
    if (!existsSync4(p)) continue;
    watch(p, { recursive: true }, () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(rebuild, 50);
    });
  }
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/_mk/__reload") {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
      res.write("data: hello\n\n");
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return;
    }
    if (lastErrors.length) {
      res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<!doctype html><title>Mark build error</title><body style="font:14px/1.5 monospace;padding:2rem;background:#300;color:#fff"><h1>Build errors</h1><pre>${escapeHtml(lastErrors.map(formatDiagnostic).join("\n"))}</pre>${RELOAD}`);
      return;
    }
    let path = decodeURIComponent(url.pathname);
    if (base !== "/" && path.startsWith(base.replace(/\/$/, ""))) path = path.slice(base.length - 1) || "/";
    let file = normalize(join5(outDir, path));
    if (!file.startsWith(outDir)) {
      res.writeHead(403);
      res.end();
      return;
    }
    if (existsSync4(file) && statSync3(file).isDirectory()) file = join5(file, "index.html");
    if (!existsSync4(file)) {
      const nf = join5(outDir, "404.html");
      res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
      res.end(existsSync4(nf) ? readFileSync4(nf, "utf8").replace("</body>", RELOAD + "</body>") : "Not found");
      return;
    }
    const ext = extname(file);
    res.writeHead(200, { "Content-Type": MIME[ext] ?? "application/octet-stream", "Cache-Control": "no-cache" });
    if (ext === ".html") res.end(readFileSync4(file, "utf8").replace("</body>", RELOAD + "</body>"));
    else res.end(readFileSync4(file));
  });
  await new Promise((resolve2) => server.listen(opts.port, resolve2));
  console.error(`mark dev \u2192 http://localhost:${opts.port}${base}`);
  await new Promise(() => {
  });
}
var MIME, RELOAD;
var init_dev = __esm({
  "src/dev.ts"() {
    "use strict";
    init_build();
    init_diagnostics();
    init_host();
    MIME = {
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".mjs": "text/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".json": "application/json",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".svg": "image/svg+xml",
      ".woff": "font/woff",
      ".woff2": "font/woff2",
      ".ttf": "font/ttf",
      ".ico": "image/x-icon",
      ".txt": "text/plain"
    };
    RELOAD = `<script>(()=>{const s=new EventSource("/_mk/__reload");s.onmessage=(e)=>{if(e.data==="reload")location.reload();};})()</script>`;
  }
});

// src/cli.ts
init_build();
init_config();
init_compile();
init_diagnostics();
init_parser();
import { readFileSync as readFileSync5 } from "node:fs";
import { resolve } from "node:path";
var USAGE = `mark \u2014 Markdown-flavored language for interactive websites

Usage:
  mark parse <file.mark>            Print the JSON AST of one document
  mark check [dir]                  Type-check a project (default: current directory)
  mark build [dir] [options]        Build the site into <out> (default dist/)
  mark dev [dir] [--port N]         Build, serve with live reload, rebuild on change

Options:
  --drafts        Include pages with \`prop draft = true\`
  --islands       Report islands per page and the vars that caused them
  --spa           Enable client-side navigation (overrides mark.config.json)
  --out <dir>     Output directory
  --port <n>      Dev server port (default 4321)
`;
function parseArgs(argv) {
  const [cmd = "help", ...rest] = argv;
  const positional = [];
  const flags = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a.startsWith("--")) {
      const name = a.slice(2);
      if (name === "out" || name === "port") flags[name] = rest[++i];
      else flags[name] = true;
    } else positional.push(a);
  }
  return { cmd, positional, flags };
}
async function main(argv = process.argv.slice(2)) {
  const { cmd, positional, flags } = parseArgs(argv);
  switch (cmd) {
    case "parse": {
      const file = positional[0];
      if (!file) {
        console.error(USAGE);
        return 2;
      }
      try {
        console.log(JSON.stringify(parseDocument(readFileSync5(file, "utf8")), null, 2));
        return 0;
      } catch (e) {
        if (e instanceof MarkError) {
          console.error(formatDiagnostic(e.toDiagnostic(file)));
          return 1;
        }
        throw e;
      }
    }
    case "check": {
      const dir = resolve(positional[0] ?? ".");
      const config = loadConfig(dir, flags.spa ? { spa: true } : {});
      const project = compileProject(loadFiles(dir, config), config, { drafts: !!flags.drafts });
      printDiagnostics(project.diagnostics);
      console.error(project.hasErrors ? "\u2717 errors found" : `\u2713 ${project.index.entries.length} pages, ${project.byName.size} components`);
      return project.hasErrors ? 1 : 0;
    }
    case "build": {
      const dir = resolve(positional[0] ?? ".");
      const over = {};
      if (flags.spa) over.spa = true;
      if (typeof flags.out === "string") over.out = flags.out;
      const t0 = Date.now();
      const { output, outDir } = await buildDir(dir, { drafts: !!flags.drafts, islands: !!flags.islands, config: over });
      printDiagnostics(output.diagnostics);
      if (flags.islands) console.log(output.report.join("\n"));
      const failed = output.diagnostics.some((d) => d.severity === "error");
      if (!failed) console.error(`\u2713 built ${output.pages.length} pages \u2192 ${outDir} in ${Date.now() - t0} ms`);
      return failed ? 1 : 0;
    }
    case "dev": {
      const dir = resolve(positional[0] ?? ".");
      const { devServer: devServer2 } = await Promise.resolve().then(() => (init_dev(), dev_exports));
      await devServer2(dir, { port: Number(flags.port ?? 4321), drafts: true, spa: !!flags.spa });
      return 0;
    }
    default:
      console.log(USAGE);
      return cmd === "help" || cmd === "--help" ? 0 : 2;
  }
}
if (process.argv[1] && /cli\.(ts|js|cjs)$/.test(process.argv[1])) {
  main().then((code) => {
    process.exitCode = code;
  }, (e) => {
    console.error(e);
    process.exitCode = 1;
  });
}
export {
  main
};
