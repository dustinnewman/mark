// Browser Host: creates DOM nodes, or adopts existing ones during hydration (I-6).
import type { Host } from "../core/render.ts";

export class Mismatch extends Error {}

interface Cursor { parent: Node; next: Node | null }

export class DomHost implements Host<Node> {
  doc: Document;
  private stack: Cursor[] = [];
  constructor(doc: Document) { this.doc = doc; }

  get adopting(): boolean { return this.stack.length > 0; }
  private get cur(): Cursor { return this.stack[this.stack.length - 1]; }

  /** Start adopting the siblings after `start` (an island start anchor). */
  beginAdopt(parent: Node, next: Node | null): void { this.stack = [{ parent, next }]; }
  endAdopt(): Node | null {
    const n = this.stack.length ? this.stack[0].next : null;
    this.stack = [];
    return n;
  }

  private claim(check: (n: Node) => boolean, what: string): Node {
    const c = this.cur;
    const n = c.next;
    if (!n || !check(n)) throw new Mismatch(`expected ${what}, found ${n ? describe(n) : "end of children"}`);
    c.next = n.nextSibling;
    return n;
  }

  el(tag: string): Node {
    if (this.adopting) return this.claim((n) => n.nodeType === 1 && (n as Element).localName === tag, `<${tag}>`);
    return this.doc.createElement(tag);
  }
  text(s: string): Node {
    if (this.adopting) {
      if (s === "") return this.doc.createTextNode("");
      const c = this.cur;
      const n = c.next;
      if (!n || n.nodeType !== 3) throw new Mismatch(`expected text ${JSON.stringify(s)}, found ${n ? describe(n) : "end"}`);
      const t = n as Text;
      if (t.data === s) { c.next = t.nextSibling; return t; }
      if (t.data.startsWith(s)) { t.splitText(s.length); c.next = t.nextSibling; return t; }
      throw new Mismatch(`expected text ${JSON.stringify(s)}, found ${JSON.stringify(t.data)}`);
    }
    return this.doc.createTextNode(s);
  }
  comment(s: string, _marker: boolean): Node {
    if (this.adopting) return this.claim((n) => n.nodeType === 8, "comment");
    return this.doc.createComment(s);
  }
  html(html: string): Node {
    if (this.adopting) return this.claim((n) => n.nodeType === 1, "element (raw html)");
    const t = this.doc.createElement("template");
    t.innerHTML = html;
    const first = t.content.firstElementChild;
    if (first && t.content.childNodes.length === 1) return first;
    const span = this.doc.createElement("span");
    span.append(...Array.from(t.content.childNodes));
    return span;
  }
  setAttr(n: Node, name: string, value: string | null): void {
    const el = n as Element;
    if (value === null) el.removeAttribute(name);
    else if (el.getAttribute(name) !== value) el.setAttribute(name, value);
  }
  setProp(n: Node, name: string, value: unknown): void {
    const el = n as unknown as Record<string, unknown>;
    if (el[name] !== value) el[name] = value;
  }
  setText(n: Node, s: string): void { if ((n as Text).data !== s) (n as Text).data = s; }
  insert(parent: Node, n: Node, before: Node | null): void {
    if (this.adopting && n.parentNode === parent) return;
    parent.insertBefore(n, before);
  }
  remove(n: Node): void { n.parentNode?.removeChild(n); }
  next(n: Node): Node | null { return n.nextSibling; }
  first(n: Node): Node | null { return n.firstChild; }
  enter(n: Node): void { if (this.adopting) this.stack.push({ parent: n, next: n.firstChild }); }
  exit(n: Node): void {
    if (!this.adopting) return;
    while (this.stack.length > 1 && this.cur.parent !== n) this.stack.pop();
    if (this.stack.length > 1 && this.cur.parent === n) this.stack.pop();
  }
  tagOf(n: Node): string { return n.nodeType === 1 ? (n as Element).localName : ""; }
  listen(n: Node, event: string, fn: (e: unknown) => void): () => void {
    n.addEventListener(event, fn);
    return () => n.removeEventListener(event, fn);
  }
}

function describe(n: Node): string {
  if (n.nodeType === 1) return `<${(n as Element).localName}>`;
  if (n.nodeType === 3) return `text ${JSON.stringify((n as Text).data.slice(0, 30))}`;
  if (n.nodeType === 8) return `comment`;
  return `node ${n.nodeType}`;
}
