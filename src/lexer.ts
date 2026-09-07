import { syntax } from "./diagnostics.ts";

export type TokType = "num" | "str" | "ident" | "punct" | "eof" | "nl";

export interface Token {
  type: TokType;
  value: string;
  num?: number;
  pos: number;
  end: number;
  line: number;
  col: number;
}

const PUNCT = [
  "?.", "=>", "**", "==", "!=", "<=", ">=", "&&", "||", "+=", "-=", "*=", "/=", "/>",
  "(", ")", "[", "]", "{", "}", ",", ";", ":", ".", "?", "=", "<", ">", "+", "-", "*", "/", "%", "!", "$",
];

const CONTINUATION = /^(?:\n[ \t]*)+(\?|:|&&|\|\||\.(?=[A-Za-z_]))/;

export const isIdentStart = (c: string): boolean => /[A-Za-z_]/.test(c);
export const isIdentChar = (c: string): boolean => /[A-Za-z0-9_]/.test(c);

/**
 * Character-level scanner over a whole source string. The document parser
 * works line by line on top of it; the expression parser pulls tokens from it.
 */
export class Scanner {
  pos = 0;
  src: string;
  private lineStarts: number[] = [0];
  constructor(src: string) {
    this.src = src;
    for (let i = 0; i < src.length; i++) if (src[i] === "\n") this.lineStarts.push(i + 1);
  }

  lineAt(pos: number): number {
    let lo = 0, hi = this.lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.lineStarts[mid] <= pos) lo = mid; else hi = mid - 1;
    }
    return lo + 1;
  }
  colAt(pos: number): number { return pos - this.lineStarts[this.lineAt(pos) - 1] + 1; }
  get line(): number { return this.lineAt(this.pos); }
  get eof(): boolean { return this.pos >= this.src.length; }
  peekChar(off = 0): string { return this.src[this.pos + off] ?? ""; }
  startsWith(s: string): boolean { return this.src.startsWith(s, this.pos); }

  /** Skip spaces/tabs (not newlines). */
  skipInlineWs(): void {
    while (this.pos < this.src.length && (this.src[this.pos] === " " || this.src[this.pos] === "\t")) this.pos++;
  }
  /** Skip all whitespace including newlines. */
  skipWs(): void {
    while (this.pos < this.src.length && /\s/.test(this.src[this.pos])) this.pos++;
  }
  /** Rest of the current line (not consumed). */
  restOfLine(): string {
    const nl = this.src.indexOf("\n", this.pos);
    return nl < 0 ? this.src.slice(this.pos) : this.src.slice(this.pos, nl);
  }
  /** Consume through end of current line (including the newline). */
  consumeLine(): string {
    const nl = this.src.indexOf("\n", this.pos);
    const s = nl < 0 ? this.src.slice(this.pos) : this.src.slice(this.pos, nl);
    this.pos = nl < 0 ? this.src.length : nl + 1;
    return s;
  }
  atLineEnd(): boolean {
    this.skipInlineWs();
    return this.eof || this.src[this.pos] === "\n";
  }
  /** Require nothing but whitespace/comment until end of line, then consume the newline. */
  expectEol(): void {
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
  token(multiline: boolean): Token {
    if (multiline) this.skipWs();
    else {
      this.skipInlineWs();
      const m = CONTINUATION.exec(this.src.slice(this.pos, this.pos + 200));
      if (m) this.pos += m[0].length - m[1].length;
    }
    const start = this.pos;
    const line = this.lineAt(start), col = this.colAt(start);
    const mk = (type: TokType, value: string, num?: number): Token => ({ type, value, num, pos: start, end: this.pos, line, col });
    if (this.eof) return mk("eof", "");
    if (this.src.startsWith("//", this.pos)) {
      // line comment: behaves as end of line
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
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(this.src[this.pos + 1] ?? ""))) {
      const m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(this.src.slice(this.pos))!;
      this.pos += m[0].length;
      if (isIdentStart(this.src[this.pos] ?? "")) throw syntax(`Invalid number \`${m[0]}${this.src[this.pos]}\``, line, col);
      return mk("num", m[0], Number(m[0]));
    }
    if (c === '"' || c === "'") {
      const q = c;
      let s = "";
      this.pos++;
      for (;;) {
        if (this.eof || this.src[this.pos] === "\n") throw syntax("Unterminated string", line, col);
        const ch = this.src[this.pos++];
        if (ch === q) break;
        if (ch === "\\") {
          const e = this.src[this.pos++];
          switch (e) {
            case "n": s += "\n"; break;
            case "t": s += "\t"; break;
            case "r": s += "\r"; break;
            case "b": s += "\b"; break;
            case "f": s += "\f"; break;
            case "v": s += "\v"; break;
            case "0": s += "\0"; break;
            case "x": s += String.fromCharCode(parseInt(this.src.substr(this.pos, 2), 16)); this.pos += 2; break;
            case "u": {
              if (this.src[this.pos] === "{") {
                const close = this.src.indexOf("}", this.pos);
                s += String.fromCodePoint(parseInt(this.src.slice(this.pos + 1, close), 16));
                this.pos = close + 1;
              } else { s += String.fromCharCode(parseInt(this.src.substr(this.pos, 4), 16)); this.pos += 4; }
              break;
            }
            case "\n": break;
            default: s += e;
          }
        } else s += ch;
      }
      return mk("str", s);
    }
    for (const p of PUNCT) {
      if (this.src.startsWith(p, this.pos)) { this.pos += p.length; return mk("punct", p); }
    }
    throw syntax(`Unexpected character \`${c}\``, line, col);
  }
}
