// Build-time Host: a tiny virtual tree that serializes to HTML. Marker comments
// (runtime anchors) are only serialized inside island anchor pairs (I-4, 12.3).
import type { Host } from "./core/render.ts";
import { escapeAttr, escapeHtml } from "./core/host.ts";
import { VOID_ELEMENTS } from "./parser.ts";

export type VNode =
  | { type: "el"; tag: string; attrs: Map<string, string>; children: VNode[]; parent: VNode | null }
  | { type: "text"; s: string; parent: VNode | null }
  | { type: "comment"; s: string; marker: boolean; parent: VNode | null }
  | { type: "html"; html: string; parent: VNode | null };

const RAW_TEXT = new Set(["script", "style"]);

export class BuildHost implements Host<VNode> {
  root(tag = "#root"): VNode { return { type: "el", tag, attrs: new Map(), children: [], parent: null }; }
  el(tag: string): VNode { return { type: "el", tag, attrs: new Map(), children: [], parent: null }; }
  text(s: string): VNode { return { type: "text", s, parent: null }; }
  comment(s: string, marker: boolean): VNode { return { type: "comment", s, marker, parent: null }; }
  html(html: string): VNode { return { type: "html", html, parent: null }; }
  setAttr(n: VNode, name: string, value: string | null): void {
    if (n.type !== "el") return;
    if (value === null) n.attrs.delete(name); else n.attrs.set(name, value);
  }
  setProp(): void {}
  setText(n: VNode, s: string): void { if (n.type === "text") n.s = s; }
  insert(parent: VNode, n: VNode, before: VNode | null): void {
    if (parent.type !== "el") throw new Error("insert into non-element");
    if (n.parent) this.remove(n);
    const idx = before ? parent.children.indexOf(before) : -1;
    if (idx < 0) parent.children.push(n); else parent.children.splice(idx, 0, n);
    n.parent = parent;
  }
  remove(n: VNode): void {
    const p = n.parent;
    if (!p || p.type !== "el") return;
    const i = p.children.indexOf(n);
    if (i >= 0) p.children.splice(i, 1);
    n.parent = null;
  }
  next(n: VNode): VNode | null {
    const p = n.parent;
    if (!p || p.type !== "el") return null;
    const i = p.children.indexOf(n);
    return p.children[i + 1] ?? null;
  }
  first(n: VNode): VNode | null { return n.type === "el" ? n.children[0] ?? null : null; }
  enter(): void {}
  exit(): void {}
  tagOf(n: VNode): string { return n.type === "el" ? n.tag : ""; }
  listen(): () => void { return () => {}; }
}

/** Serialize children of `root`. Marker comments appear only inside islands. */
export function serialize(root: VNode, inIsland = false): string {
  if (root.type !== "el") return "";
  const st = { inIsland };
  return root.children.map((c) => ser(c, st, root.tag)).join("");
}

function ser(n: VNode, st: { inIsland: boolean }, parentTag: string): string {
  switch (n.type) {
    case "text": return RAW_TEXT.has(parentTag) ? n.s : escapeHtml(n.s);
    case "html": return n.html;
    case "comment":
      if (n.s.startsWith("mk:")) { st.inIsland = true; return `<!--${n.s}-->`; }
      if (n.s.startsWith("/mk:")) { st.inIsland = false; return `<!--${n.s}-->`; }
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

/** Find elements by tag (used for <title> handling). */
export function findAll(root: VNode, tag: string, out: VNode[] = []): VNode[] {
  if (root.type !== "el") return out;
  for (const c of root.children) {
    if (c.type === "el") { if (c.tag === tag) out.push(c); findAll(c, tag, out); }
  }
  return out;
}

export function textOf(n: VNode): string {
  if (n.type === "text") return n.s;
  if (n.type === "el") return n.children.map(textOf).join("");
  return "";
}
