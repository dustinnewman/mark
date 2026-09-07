import type { Expr, Property } from "./ast.ts";
import { MarkError, MSG, syntax } from "./diagnostics.ts";
import { Scanner, type Token } from "./lexer.ts";

export const RESERVED = new Set([
  "var", "let", "prop", "fn", "if", "else", "for", "in", "key", "try", "return", "await", "async",
  "true", "false", "null", "undefined", "slot",
]);

const BIN_PREC: Record<string, number> = {
  "||": 1, "&&": 2, "==": 3, "!=": 3, "<": 4, ">": 4, "<=": 4, ">=": 4,
  "+": 5, "-": 5, "*": 6, "/": 6, "%": 6,
};
const ASSIGN_OPS = new Set(["=", "+=", "-=", "*=", "/="]);

export interface ParseOpts {
  /** Whitespace (and newlines) may separate tokens at the outermost level. */
  multiline?: boolean;
  /** Inside a tag: a bare `>` or `/>` at nesting depth 0 ends the expression. */
  tag?: boolean;
}

/** Pratt parser for Mark expressions, reading tokens from a shared Scanner. */
export class ExprParser {
  private peeked: Token | null = null;
  private peekedMulti = false;
  private multiline = false;
  private tag = false;

  private sc: Scanner;
  constructor(sc: Scanner) { this.sc = sc; }

  /** Parse one full expression (with `;` sequences) starting at the scanner position. */
  parse(opts: ParseOpts = {}): Expr {
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
  private drop(): void {
    if (this.peeked) { this.sc.pos = this.peeked.pos; this.peeked = null; }
  }
  private peek(): Token {
    if (this.peeked && this.peekedMulti === this.multiline) return this.peeked;
    this.drop();
    const save = this.sc.pos;
    const t = this.sc.token(this.multiline);
    this.sc.pos = save;
    this.peeked = t;
    this.peekedMulti = this.multiline;
    return t;
  }
  private next(): Token {
    const t = this.peek();
    this.peeked = null;
    this.sc.pos = t.end;
    return t;
  }
  private is(value: string, type: "punct" | "ident" = "punct"): boolean {
    const t = this.peek();
    return t.type === type && t.value === value;
  }
  private eat(value: string, type: "punct" | "ident" = "punct"): boolean {
    if (this.is(value, type)) { this.next(); return true; }
    return false;
  }
  private expect(value: string): Token {
    const t = this.peek();
    if (t.type !== "punct" || t.value !== value) throw this.err(`Expected \`${value}\` but found ${describe(t)}`, t);
    return this.next();
  }
  private err(msg: string, t: Token = this.peek()): MarkError {
    return syntax(msg, t.line, t.col);
  }
  /** Run `f` with multiline enabled (inside brackets). */
  private nested<T>(f: () => T): T {
    const m = this.multiline, tg = this.tag;
    this.multiline = true; this.tag = false;
    try { return f(); } finally { this.multiline = m; this.tag = tg; }
  }
  private ident(): string {
    const t = this.peek();
    if (t.type !== "ident") throw this.err(`Expected identifier but found ${describe(t)}`, t);
    if (RESERVED.has(t.value)) throw this.err(`\`${t.value}\` is a reserved word`, t);
    this.next();
    return t.value;
  }

  // ---- grammar ----
  private seq(): Expr {
    const first = this.assign();
    if (!this.is(";")) return first;
    const expressions = [first];
    while (this.eat(";")) expressions.push(this.assign());
    return { type: "SequenceExpression", expressions };
  }

  private assign(): Expr {
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

  private ternary(): Expr {
    const test = this.binary(1);
    if (!this.eat("?")) return test;
    const consequent = this.nested(() => this.assignNoSeq());
    this.expect(":");
    const alternate = this.ternary();
    return { type: "ConditionalExpression", test, consequent, alternate };
  }
  /** `expr` inside a ternary branch: everything but `;`. */
  private assignNoSeq(): Expr { return this.assign(); }

  private binary(minPrec: number): Expr {
    let left = this.pow();
    for (;;) {
      const t = this.peek();
      if (t.type !== "punct") break;
      if (this.tag && (t.value === "/>" || (t.value === ">" && !/^[ \t]+[\w("'\[{!\-.]/.test(this.sc.src.slice(t.end))))) break;
      const prec = BIN_PREC[t.value];
      if (prec === undefined || prec < minPrec) break;
      this.next();
      const right = this.binary(prec + 1);
      left = t.value === "&&" || t.value === "||"
        ? { type: "LogicalExpression", operator: t.value, left, right }
        : { type: "BinaryExpression", operator: t.value, left, right };
    }
    return left;
  }

  private pow(): Expr {
    const base = this.unary();
    if (this.eat("**")) {
      const exp = this.pow();
      return { type: "BinaryExpression", operator: "**", left: base, right: exp };
    }
    return base;
  }

  private unary(): Expr {
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

  private postfix(): Expr {
    let e = this.primary();
    let chained = false;
    for (;;) {
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
  private propName(): string {
    const t = this.peek();
    if (t.type !== "ident") throw this.err(`Expected property name but found ${describe(t)}`, t);
    this.next();
    return t.value;
  }

  private args(): Expr[] {
    this.expect("(");
    return this.nested(() => {
      const out: Expr[] = [];
      if (this.eat(")")) return out;
      for (;;) {
        out.push(this.assign());
        if (this.eat(")")) return out;
        this.expect(",");
      }
    });
  }

  private primary(): Expr {
    const t = this.peek();
    switch (t.type) {
      case "num": this.next(); return { type: "Literal", value: t.num! };
      case "str": this.next(); return { type: "Literal", value: t.value };
      case "ident": break;
      case "punct":
        if (t.value === "(") return this.parenOrArrow();
        if (t.value === "[") return this.array();
        if (t.value === "{") return this.object();
        throw this.err(`Unexpected \`${t.value}\``, t);
      default: throw this.err(`Unexpected ${describe(t)}`, t);
    }
    switch (t.value) {
      case "true": this.next(); return { type: "Literal", value: true };
      case "false": this.next(); return { type: "Literal", value: false };
      case "null": this.next(); return { type: "Literal", value: null };
      case "undefined": this.next(); return { type: "Literal", value: undefined };
      case "try": return this.tryExpr();
      case "new": return this.newExpr();
      case "async": {
        this.next();
        const n = this.peek();
        if (n.type === "ident" || (n.type === "punct" && n.value === "(")) {
          const fn = this.arrowOrIdent();
          if (fn.type === "ArrowFunctionExpression") return { ...fn, async: true };
        }
        throw this.err("`async` must be followed by an arrow function", t);
      }
    }
    return this.arrowOrIdent();
  }

  /** `ident` or `ident => expr`. */
  private arrowOrIdent(): Expr {
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
  private parenOrArrow(): Expr {
    const open = this.next();
    // Look ahead for an arrow: scan to the matching `)` and check for `=>`.
    const save = this.sc.pos;
    let depth = 1;
    let isArrow = false;
    try {
      for (;;) {
        const tk = this.sc.token(true);
        if (tk.type === "eof") break;
        if (tk.type === "punct") {
          if (tk.value === "(" || tk.value === "[" || tk.value === "{") depth++;
          else if (tk.value === ")" || tk.value === "]" || tk.value === "}") { depth--; if (depth === 0) break; }
        }
      }
      if (depth === 0) { const n = this.sc.token(true); isArrow = n.type === "punct" && n.value === "=>"; }
    } catch { isArrow = false; }
    this.sc.pos = save;
    this.peeked = null;
    if (isArrow) {
      const params = this.nested(() => {
        const ps: Expr[] = [];
        if (this.eat(")")) return ps;
        for (;;) {
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

  private array(): Expr {
    this.expect("[");
    return this.nested(() => {
      const elements: Expr[] = [];
      if (this.eat("]")) return { type: "ArrayExpression", elements };
      for (;;) {
        elements.push(this.assign());
        if (this.eat("]")) return { type: "ArrayExpression", elements };
        this.expect(",");
        if (this.eat("]")) return { type: "ArrayExpression", elements };
      }
    });
  }

  private object(): Expr {
    this.expect("{");
    return this.nested(() => {
      const properties: Property[] = [];
      if (this.eat("}")) return { type: "ObjectExpression", properties };
      for (;;) {
        const t = this.peek();
        let key: Expr;
        let shorthandName: string | null = null;
        if (t.type === "str") { this.next(); key = { type: "Literal", value: t.value }; }
        else if (t.type === "num") { this.next(); key = { type: "Literal", value: t.num! }; }
        else if (t.type === "ident") { this.next(); key = { type: "Identifier", name: t.value }; shorthandName = t.value; }
        else throw this.err(`Expected property key but found ${describe(t)}`, t);
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

  private tryExpr(): Expr {
    const t = this.next();
    if (!this.is("(")) throw this.err("`try` is a reserved word; write `try(expr, fallback)`", t);
    const args = this.args();
    if (args.length !== 2) throw new MarkError("E018", MSG.E018(), t.line, t.col);
    return { type: "TryExpression", expr: args[0], fallback: args[1] };
  }

  private newExpr(): Expr {
    this.next();
    const callee: Expr = { type: "Identifier", name: this.ident() };
    const args = this.is("(") ? this.args() : [];
    return { type: "NewExpression", callee, arguments: args };
  }
}

function describe(t: Token): string {
  if (t.type === "eof") return "end of input";
  if (t.type === "nl") return "end of line";
  return `\`${t.value}\``;
}
