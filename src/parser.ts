import type { Attr, Document, Expr, ForNode, IfNode, IfStmt, Node, ProseNode, ProsePart, Stmt, TagNode } from "./ast.ts";
import { placeholder } from "./ast.ts";
import { MarkError, MSG, syntax } from "./diagnostics.ts";
import { ExprParser, RESERVED } from "./expr.ts";
import { IDENT, Scanner, isIdentChar, isIdentStart } from "./lexer.ts";

export const VOID_ELEMENTS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);

// Line classification (L-2). `if` and `for` are code only in their full statement shape, ending in
// `{`: a bare `{` cannot end a prose line (it would open an interpolation), so the brace is an
// unambiguous discriminator and `for the record` / `if you break the line here` stay prose.
export const DECL_LINE = /^(?:export\s+)?(?:async\s+)?(?:var|let|prop|fn)\s/;
/** `for ident[, ident] in expr [key expr] {` — the `.+` spans the source expression and the optional `key` clause. */
export const FOR_LINE = new RegExp(`^for\\s+${IDENT.source}(?:\\s*,\\s*${IDENT.source})?\\s+in\\s.+\\{\\s*$`);
export const IF_LINE = /^if\s+.+\{\s*$/;
const LINE_SHAPES = [DECL_LINE, FOR_LINE, IF_LINE, /^\}/, /^else\b/, /^<[A-Za-z]/, /^<\/[A-Za-z]/];
export const CODE_LINE = new RegExp("^(?:" + LINE_SHAPES.map((r) => r.source.slice(1)).join("|") + ")");
export const TAG_NAME = /^(?:[a-z][a-z0-9-]*|[A-Z][A-Za-z0-9]*(?:\.[A-Z][A-Za-z0-9]*)*)/;
export const ATTR_NAME = /^[A-Za-z_:][A-Za-z0-9_:.-]*/;

interface Pending { md: string; parts: ProsePart[]; line: number; touched: boolean }

interface Frame {
  kind: "doc" | "if" | "for" | "tag" | "head";
  items: Node[];
  line: number;
  prose: Pending | null;
  // tag / head
  tag?: TagNode;
  // if
  ifRoot?: IfNode;
  ifCur?: IfNode;
  inElse?: boolean;
  // for
  forNode?: ForNode;
}

/** Parse a `.mark` document into the section-13 AST. Throws MarkError on syntax errors. */
export function parseDocument(src: string): Document {
  return new DocParser(src).parse();
}

class DocParser {
  sc: Scanner;
  ep: ExprParser;
  stack: Frame[] = [];
  styleSeen = false;

  constructor(src: string) {
    this.sc = new Scanner(src.replace(/\r\n?/g, "\n"));
    this.ep = new ExprParser(this.sc);
  }

  get top(): Frame { return this.stack[this.stack.length - 1]; }

  parse(): Document {
    this.stack.push({ kind: "doc", items: [], line: 1, prose: null });
    while (!this.sc.eof) this.line();
    while (this.stack.length > 1) {
      const f = this.stack.pop()!;
      if (f.kind === "tag" || f.kind === "head") throw syntax(`Unclosed <${f.kind === "head" ? "head" : f.tag!.name}> opened at line ${f.line}`, f.line);
      throw syntax(`Unclosed \`${f.kind}\` block opened at line ${f.line}`, f.line);
    }
    const doc = this.stack.pop()!;
    this.flush(doc);
    return doc.items;
  }

  // ---- prose accumulation ----
  pending(frame: Frame, line: number): Pending {
    if (!frame.prose) frame.prose = { md: "", parts: [], line, touched: true };
    frame.prose.touched = true;
    return frame.prose;
  }
  flush(frame: Frame): void {
    const p = frame.prose;
    if (!p) return;
    frame.prose = null;
    const md = p.md.replace(/\n+$/, "\n");
    if (md.trim() === "" && p.parts.length === 0) return;
    const node: ProseNode = { t: "prose", md, parts: p.parts, line: p.line };
    frame.items.push(node);
  }
  addNode(node: Node): void {
    this.flush(this.top);
    this.top.items.push(node);
  }

  // ---- lines ----
  line(): void {
    const sc = this.sc;
    const lineNo = sc.line;
    const raw = sc.restOfLine();
    const stripped = raw.trimStart();

    // Blank line: paragraph separator inside prose, otherwise ignored (L-8).
    if (stripped === "") {
      sc.consumeLine();
      const p = this.top.prose;
      if (p && p.md !== "") p.md += "\n";
      return;
    }
    // Comments (L-11).
    if (stripped.startsWith("//")) { sc.consumeLine(); return; }

    // L-3: a `\` before a line L-2 would classify as code makes it prose. Any other leading `\` is
    // ordinary prose text, so `\for the record` keeps its backslash now that `for the record` is prose.
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
    // Fenced code block (L-4).
    const fence = /^(`{3,}|~{3,})/.exec(stripped);
    if (fence && (raw.length - stripped.length) <= 3) {
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
    // Display math block (L-5).
    if (stripped === "$$") {
      const p = this.pending(this.top, lineNo);
      p.md += sc.consumeLine() + "\n";
      while (!sc.eof) {
        const l = sc.restOfLine();
        if (l.trim() === "$$") { p.md += sc.consumeLine() + "\n"; return; }
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
  proseLine(lineNo: number): void {
    const p = this.pending(this.top, lineNo);
    this.inline(p, "prose", null);
    p.md += "\n";
    p.touched = false;
    if (!this.sc.eof) this.sc.pos++;
  }

  codeLine(lineNo: number, stripped: string): void {
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
    if (stripped.startsWith("}")) { this.closer(lineNo); return; }
    if (/^else\b/.test(stripped)) throw new MarkError("E001", MSG.E001(), lineNo, sc.colAt(sc.pos));
    const kw = /^(?:(export)\s+)?(?:(async)\s+)?(var|let|prop|fn|if|for)\b/.exec(stripped)!;
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
        const init = sc.peekChar() === "=" ? (sc.pos++, this.expr()) : undefined;
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
        const node: Node = { t: "let", name, init, line: lineNo };
        if (exported) node.export = true;
        this.addNode(node);
        return;
      }
      case "prop": {
        const name = this.declName();
        sc.skipInlineWs();
        const init = sc.peekChar() === "=" ? (sc.pos++, this.expr()) : undefined;
        sc.expectEol();
        this.addNode(init ? { t: "prop", name, init, line: lineNo } : { t: "prop", name, line: lineNo });
        return;
      }
      case "fn": {
        const name = this.declName();
        const params = this.params();
        sc.skipInlineWs();
        let body: Expr | Stmt[];
        if (sc.peekChar() === "=") { sc.pos++; body = this.expr(); sc.expectEol(); }
        else if (sc.peekChar() === "{") {
          sc.pos++;
          if (sc.atLineEnd()) { sc.expectEol(); body = this.stmtBlock(); }
          else {
            // one-line body: `fn f(e) { k = e.key }`
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
        }
        else throw syntax("Expected `=` or `{` after function parameters", lineNo);
        const node: Node = { t: "fn", name, params, async: isAsync, body, line: lineNo };
        if (exported) node.export = true;
        this.addNode(node);
        return;
      }
      case "if": {
        const cond = this.expr();
        this.openBrace(lineNo);
        this.flush(this.top);
        const node: IfNode = { t: "if", cond, then: [], line: lineNo };
        this.stack.push({ kind: "if", items: [], line: lineNo, prose: null, ifRoot: node, ifCur: node });
        return;
      }
      case "for": {
        const node = this.forHeader(lineNo) as ForNode;
        this.flush(this.top);
        this.stack.push({ kind: "for", items: [], line: lineNo, prose: null, forNode: node });
        return;
      }
    }
  }

  /** `item[, index] in src [key e] {` */
  forHeader(lineNo: number, stmt = false): ForNode | Extract<Stmt, { s: "for" }> {
    const sc = this.sc;
    const item = this.declName();
    sc.skipInlineWs();
    let index: string | undefined;
    if (sc.peekChar() === ",") { sc.pos++; index = this.declName(); }
    sc.skipInlineWs();
    if (!/^in\b/.test(sc.restOfLine())) throw syntax("Expected `in` in `for` header", lineNo);
    sc.pos += 2;
    const src = this.expr();
    let key: Expr | undefined;
    sc.skipInlineWs();
    if (!stmt && /^key\b/.test(sc.restOfLine())) { sc.pos += 3; key = this.expr(); }
    this.openBrace(lineNo);
    if (stmt) {
      const n: Extract<Stmt, { s: "for" }> = { s: "for", item, src, body: [], line: lineNo };
      if (index) n.index = index;
      return n;
    }
    const n: ForNode = { t: "for", item, src, body: [], line: lineNo };
    if (index) n.index = index;
    if (key) n.key = key;
    return n;
  }

  openBrace(lineNo: number): void {
    this.sc.skipInlineWs();
    if (this.sc.peekChar() !== "{") throw syntax("Expected `{` at end of line", lineNo, this.sc.colAt(this.sc.pos));
    this.sc.pos++;
    this.sc.expectEol();
  }

  /** `}` / `} else {` / `} else if cond {` at document level. */
  closer(lineNo: number): void {
    const sc = this.sc;
    sc.pos++;
    const f = this.top;
    if (f.kind === "tag" || f.kind === "head") throw syntax(`Expected </${f.kind === "head" ? "head" : f.tag!.name}> (opened at line ${f.line}) before \`}\``, lineNo);
    if (f.kind === "doc") throw syntax("Unexpected `}`", lineNo);
    this.flush(f);
    sc.skipInlineWs();
    const rest = sc.restOfLine();
    if (f.kind === "if" && /^else\b/.test(rest)) {
      if (f.inElse) throw syntax("Unexpected `else` after `else`", lineNo);
      sc.pos += 4;
      sc.skipInlineWs();
      f.ifCur!.then = f.items;
      f.items = [];
      if (/^if\b/.test(sc.restOfLine())) {
        sc.pos += 2;
        const cond = this.expr();
        this.openBrace(lineNo);
        const node: IfNode = { t: "if", cond, then: [], line: lineNo };
        f.ifCur!.else = node;
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
      if (f.inElse) f.ifCur!.else = f.items; else f.ifCur!.then = f.items;
      this.top.items.push(f.ifRoot!);
    } else {
      f.forNode!.body = f.items;
      this.top.items.push(f.forNode!);
    }
  }

  // ---- tags ----
  readTagName(): string {
    const m = TAG_NAME.exec(this.sc.restOfLine());
    if (!m) throw syntax("Invalid tag name", this.sc.line, this.sc.colAt(this.sc.pos));
    this.sc.pos += m[0].length;
    return m[0];
  }

  /** At `<name` on a block-level line: open (push frame) or self-close. */
  tagStart(lineNo: number): void {
    const sc = this.sc;
    sc.pos++;
    const name = this.readTagName();
    if (name === "style") { this.styleBlock(lineNo); return; }
    const { attrs, selfClose } = this.attrs(lineNo);
    if (name === "head") {
      if (attrs.length) throw syntax("<head> takes no attributes", lineNo);
      if (selfClose) { this.addNode({ t: "head", children: [], line: lineNo }); return; }
      this.flush(this.top);
      this.stack.push({ kind: "head", items: [], line: lineNo, prose: null });
      return;
    }
    const node = mkTag(name, attrs, selfClose || VOID_ELEMENTS.has(name), lineNo);
    if (node.selfClose) { this.addNode(node); return; }
    this.flush(this.top);
    this.stack.push({ kind: "tag", items: [], line: lineNo, prose: null, tag: node });
  }

  closeTag(name: string, lineNo: number): void {
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
    if (f.tag!.name !== name) throw new MarkError("E002", MSG.E002(name, f.tag!.name, f.line), lineNo);
    this.flush(f);
    this.stack.pop();
    f.tag!.children = f.items;
    this.top.items.push(f.tag!);
  }

  /** Rest of a block-level tag line: inline content; tags may stay open (become frames). */
  blockRemainder(lineNo: number): void {
    this.inline(null, "block", null, lineNo);
    const f = this.top;
    if (f.prose && f.prose.touched) { f.prose.md += "\n"; f.prose.touched = false; }
    if (!this.sc.eof) this.sc.pos++;
  }

  styleBlock(lineNo: number): void {
    const sc = this.sc;
    sc.skipInlineWs();
    let global = false;
    if (/^global\b/.test(sc.restOfLine())) { sc.pos += 6; global = true; sc.skipInlineWs(); }
    if (sc.peekChar() !== ">") throw syntax("Expected `>` after <style", lineNo);
    sc.pos++;
    sc.expectEol();
    if (this.top.kind !== "doc" || this.styleSeen) throw new MarkError("E020", MSG.E020(), lineNo);
    this.styleSeen = true;
    let css = "";
    for (;;) {
      if (sc.eof) throw syntax("Unclosed <style> block", lineNo);
      const l = sc.consumeLine();
      if (l.trim() === "</style>") break;
      css += l + "\n";
    }
    this.addNode({ t: "style", css, global, line: lineNo });
  }

  /** Attribute list up to `>` or `/>`; may span lines (L-7). */
  attrs(lineNo: number): { attrs: Attr[]; selfClose: boolean } {
    const sc = this.sc;
    const attrs: Attr[] = [];
    for (;;) {
      sc.skipWs();
      if (sc.eof) throw syntax(`Unterminated tag started at line ${lineNo}`, lineNo);
      if (sc.startsWith("/>")) { sc.pos += 2; return { attrs, selfClose: true }; }
      if (sc.peekChar() === ">") { sc.pos++; return { attrs, selfClose: false }; }
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
      let attr: Attr;
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
  bindPath(): (string | Expr)[] {
    const sc = this.sc;
    const start = sc.pos;
    if (!isIdentStart(sc.peekChar())) throw syntax("Expected identifier after `$`", sc.line, sc.colAt(sc.pos));
    while (isIdentChar(sc.peekChar())) sc.pos++;
    const path: (string | Expr)[] = [sc.src.slice(start, sc.pos)];
    for (;;) {
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
  inline(p: Pending | null, mode: "prose" | "block", closeName: string | null, lineNo = this.sc.line): boolean {
    const sc = this.sc;
    const target = (): Pending => mode === "block" ? this.pending(this.top, lineNo) : p!;
    while (!sc.eof && sc.peekChar() !== "\n") {
      const c = sc.peekChar();
      if (c === "\\") {
        const n = sc.peekChar(1);
        if (n === "{" || n === "}") { target().md += n; sc.pos += 2; continue; }
        if (n === "$") { target().md += "\\$"; sc.pos += 2; continue; }
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
          if (mode === "block") { this.closeTag(name, sc.lineAt(save)); continue; }
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
            const child: Pending = { md: "", parts: [], line: tagLine, touched: true };
            const save = sc.pos;
            const closed = this.inline(child, "prose", name, tagLine);
            if (!closed) {
              if (mode === "prose") throw syntax(`Inline tag <${name}> must be closed on the same line`, tagLine);
              // Stays open past the line: it becomes a frame.
              sc.pos = save;
              this.flush(this.top);
              this.stack.push({ kind: "tag", items: [], line: tagLine, prose: null, tag: node });
              continue;
            }
            if (child.md !== "" || child.parts.length) node.children.push({ t: "prose", md: child.md, parts: child.parts, line: tagLine });
          }
          if (mode === "block" && !(this.top.prose && this.top.prose.touched)) {
            // Nothing precedes it on this line: a sibling node rather than an inline part.
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
  codeSpan(): string {
    const sc = this.sc;
    const rest = sc.restOfLine();
    const open = /^`+/.exec(rest)![0];
    const closeIdx = rest.indexOf(open, open.length);
    if (closeIdx < 0) { sc.pos += open.length; return open; }
    const s = rest.slice(0, closeIdx + open.length);
    sc.pos += s.length;
    return s;
  }

  /** Try to scan `$…$` or `$$…$$` at the cursor (M-8). Returns false if literal. */
  mathSpan(t: Pending): boolean {
    const sc = this.sc;
    const rest = sc.restOfLine();
    const delim = rest.startsWith("$$") ? "$$" : "$";
    const after = rest[delim.length] ?? "";
    if (after === "" || /\s/.test(after)) return false;
    const before = sc.src[sc.pos - 1] ?? "";
    if (delim === "$" && /\d/.test(before) && /\d/.test(after)) return false;
    // find closing delimiter
    let i = delim.length;
    let close = -1;
    while (i < rest.length) {
      if (rest[i] === "\\") { i += 2; continue; }
      if (rest.startsWith(delim, i)) {
        if (/\d/.test(rest[i + delim.length] ?? "")) { i++; continue; }
        close = i; break;
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
  mathBody(t: Pending, from: number, to: number): void {
    const sc = this.sc;
    let i = from;
    while (i < to) {
      const c = sc.src[i];
      if (c === "{" && (i === from || /\s/.test(sc.src[i - 1]))) {
        const save = sc.pos;
        sc.pos = i + 1;
        let expr: Expr | null = null;
        try {
          expr = this.ep.parse({ multiline: false });
          sc.skipInlineWs();
          const closeOk = sc.peekChar() === "}" && sc.pos < to && (sc.pos + 1 === to || /\s/.test(sc.src[sc.pos + 1]));
          if (!closeOk) expr = null;
        } catch { expr = null; }
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
  declName(): string {
    const sc = this.sc;
    sc.skipInlineWs();
    const t = sc.token(false);
    if (t.type !== "ident") throw syntax("Expected a name", t.line, t.col);
    if (isReserved(t.value)) throw syntax(`\`${t.value}\` is a reserved word`, t.line, t.col);
    return t.value;
  }
  params(): string[] {
    const sc = this.sc;
    sc.skipInlineWs();
    if (sc.peekChar() !== "(") throw syntax("Expected `(` after function name", sc.line, sc.colAt(sc.pos));
    sc.pos++;
    const out: string[] = [];
    sc.skipWs();
    if (sc.peekChar() === ")") { sc.pos++; return out; }
    for (;;) {
      sc.skipWs();
      out.push(this.declName());
      sc.skipWs();
      if (sc.peekChar() === ")") { sc.pos++; return out; }
      if (sc.peekChar() !== ",") throw syntax("Expected `,` or `)` in parameter list", sc.line, sc.colAt(sc.pos));
      sc.pos++;
    }
  }
  expr(): Expr { return this.ep.parse({ multiline: false }); }

  // ---- fn bodies (L-12) ----
  stmtBlock(): Stmt[] {
    const sc = this.sc;
    const out: Stmt[] = [];
    for (;;) {
      if (sc.eof) throw syntax("Unclosed function body", sc.line);
      const lineNo = sc.line;
      const raw = sc.restOfLine();
      const s = raw.trim();
      if (s === "" || s.startsWith("//")) { sc.consumeLine(); continue; }
      sc.pos += raw.length - raw.trimStart().length;
      if (s.startsWith("}")) { sc.pos++; return out; }
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
        case "let": case "var": {
          const name = this.declName();
          sc.skipInlineWs();
          let init: Expr | undefined;
          if (sc.peekChar() === "=") { sc.pos++; init = this.expr(); }
          else if (kw[1] === "let") throw syntax("`let` requires an initializer", lineNo);
          sc.expectEol();
          out.push(init ? { s: kw[1], name, init, line: lineNo } : { s: kw[1], name, line: lineNo });
          break;
        }
        case "return": {
          sc.skipInlineWs();
          if (sc.atLineEnd() || sc.startsWith("//")) { sc.expectEol(); out.push({ s: "return", line: lineNo }); }
          else { const value = this.expr(); sc.expectEol(); out.push({ s: "return", value, line: lineNo }); }
          break;
        }
        case "for": {
          const n = this.forHeader(lineNo, true) as Extract<Stmt, { s: "for" }>;
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
  ifStmt(lineNo: number): IfStmt {
    const sc = this.sc;
    const cond = this.expr();
    this.openBrace(lineNo);
    const node: IfStmt = { s: "if", cond, then: this.stmtBlock(), line: lineNo };
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
}

function mkTag(name: string, attrs: Attr[], selfClose: boolean, line: number): TagNode {
  return { t: "tag", name, kind: /^[A-Z]/.test(name) ? "comp" : "html", attrs, children: [], selfClose, line };
}

/** C-16: pass through identifiers, member accesses and arrows; wrap everything else. */
function needsWrap(e: Expr): boolean {
  if (e.type === "ChainExpression") return true;
  return !(e.type === "Identifier" || e.type === "MemberExpression" || e.type === "ArrowFunctionExpression");
}

function isReserved(s: string): boolean { return RESERVED.has(s); }
