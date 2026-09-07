// Markdown subset (spec 10.1) -> prose tree. Placeholders (NUL N NUL) become holes.
import { PH, type ProsePart } from "./ast.ts";
import { BLOCK_TAGS, type HNode } from "./core/tree.ts";

type El = Extract<HNode, { k: "el" }>;
const el = (tag: string, children: HNode[] = [], attrs: Record<string, string> = {}): El => ({ k: "el", tag, attrs, children });
const text = (s: string): HNode => ({ k: "text", s });

/** Parse a prose node's `md`. Inline-only when the md has no trailing newline (content on a tag line). */
export function parseMarkdown(md: string, parts: ProsePart[]): HNode[] {
  if (!md.endsWith("\n")) return parseInline(md);
  return new BlockParser(parts).parse(md.split("\n").slice(0, -1));
}

/** Plain text of a tree (for excerpts, slugs); holes are dropped. */
export function plainText(nodes: HNode[]): string {
  let s = "";
  for (const n of nodes) {
    if (n.k === "text") s += n.s;
    else if (n.k === "el") s += n.tag === "br" ? " " : plainText(n.children);
    else if (n.k === "math") s += n.tex;
  }
  return s;
}

export function slugify(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "") || "section";
}

// ---------------------------------------------------------------- blocks

const RE_FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const RE_HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const RE_HR = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const RE_QUOTE = /^ {0,3}>/;
const RE_LIST = /^( {0,3})([-*+]|\d{1,9}[.)])( {1,4}|\t|$)/;
const RE_TABLE_DELIM = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

const isBlank = (l: string): boolean => l.trim() === "";
const indentOf = (l: string): number => l.length - l.trimStart().length;

class BlockParser {
  private parts: ProsePart[];
  constructor(parts: ProsePart[]) { this.parts = parts; }

  parse(lines: string[]): HNode[] {
    const out: HNode[] = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (isBlank(line)) { i++; continue; }
      let m: RegExpExecArray | null;
      if ((m = RE_FENCE.exec(line))) {
        const fence = m[1], info = m[2].trim();
        const close = new RegExp("^ {0,3}" + fence[0] + "{" + fence.length + ",}[ \\t]*$");
        const indent = indentOf(line);
        const body: string[] = [];
        i++;
        while (i < lines.length && !close.test(lines[i])) body.push(stripIndent(lines[i], indent)), i++;
        i++;
        const code = el("code", [text(body.join("\n") + (body.length ? "\n" : ""))]);
        if (info) code.attrs.class = "language-" + info.split(/\s+/)[0];
        out.push(el("pre", [code]));
        continue;
      }
      if (line.trim() === "$$") {
        const body: string[] = [];
        i++;
        while (i < lines.length && lines[i].trim() !== "$$") body.push(lines[i]), i++;
        i++;
        out.push({ k: "math", tex: body.join("\n"), display: true });
        continue;
      }
      if ((m = RE_HEADING.exec(line))) {
        const children = parseInline(m[2] ?? "");
        const h = el("h" + m[1].length, children);
        h.slug = slugify(plainText(children));
        out.push(h);
        i++;
        continue;
      }
      if (RE_HR.test(line)) { out.push(el("hr")); i++; continue; }
      if (RE_QUOTE.test(line)) {
        const inner: string[] = [];
        while (i < lines.length) {
          const l = lines[i];
          if (RE_QUOTE.test(l)) inner.push(l.replace(/^ {0,3}> ?/, ""));
          else if (!isBlank(l) && inner.length && !isBlank(inner[inner.length - 1]) && !isBlockStart(l)) inner.push(l); // lazy continuation
          else break;
          i++;
        }
        out.push(el("blockquote", this.parse(inner)));
        continue;
      }
      if ((m = RE_LIST.exec(line))) { i = this.list(lines, i, out); continue; }
      if (line.includes("|") && i + 1 < lines.length && RE_TABLE_DELIM.test(lines[i + 1]) && lines[i + 1].includes("-")) {
        i = this.table(lines, i, out);
        continue;
      }
      if (line.trimStart().startsWith("<!--")) {
        const body: string[] = [];
        while (i < lines.length) { body.push(lines[i]); if (lines[i].includes("-->")) { i++; break; } i++; }
        const joined = body.join("\n");
        out.push({ k: "comment", s: joined.slice(4, joined.indexOf("-->") < 0 ? undefined : joined.indexOf("-->")) });
        continue;
      }
      // paragraph
      const para: string[] = [line];
      i++;
      while (i < lines.length && !isBlank(lines[i]) && !isBlockStart(lines[i])) para.push(lines[i]), i++;
      const children = parseInline(para.map((l) => l.trimStart()).join("\n").replace(/[ \t]+$/, ""));
      out.push(...this.paragraph(children));
    }
    return out;
  }

  /** A paragraph made only of block-level tag holes is emitted unwrapped. */
  private paragraph(children: HNode[]): HNode[] {
    const onlyBlocks = children.length > 0 && children.every((c) => {
      if (c.k === "text") return c.s.trim() === "";
      if (c.k !== "hole") return false;
      const p = this.parts[c.i];
      return p?.p === "tag" && (p.node.kind === "comp" || BLOCK_TAGS.has(p.node.name));
    });
    if (onlyBlocks) return children.filter((c) => c.k !== "text");
    return [el("p", children)];
  }

  private list(lines: string[], i: number, out: HNode[]): number {
    const first = RE_LIST.exec(lines[i])!;
    const ordered = /\d/.test(first[2]);
    const kind = ordered ? first[2].slice(-1) : first[2];
    const start = ordered ? parseInt(first[2], 10) : 1;
    const items: string[][] = [];
    let loose = false;
    let sawBlankBetween = false;
    while (i < lines.length) {
      const m = RE_LIST.exec(lines[i]);
      if (!m) break;
      const mk = ordered ? m[2].slice(-1) : m[2];
      if (mk !== kind || /\d/.test(m[2]) !== ordered) break;
      let contentIndent = m[1].length + m[2].length + (m[3] === "\t" ? 1 : m[3].length);
      if (m[3].length > 4) contentIndent = m[1].length + m[2].length + 1;
      const firstContent = m[3].length > 4 ? lines[i].slice(m[1].length + m[2].length + 1) : lines[i].slice(m[0].length);
      const item: string[] = [firstContent];
      i++;
      if (sawBlankBetween) loose = true;
      sawBlankBetween = false;
      let blanks = 0;
      while (i < lines.length) {
        const l = lines[i];
        if (isBlank(l)) { blanks++; i++; continue; }
        if (indentOf(l) >= contentIndent) {
          for (let b = 0; b < blanks; b++) item.push("");
          if (blanks) loose = true;
          blanks = 0;
          item.push(l.slice(contentIndent));
          i++;
          continue;
        }
        if (blanks === 0 && !isBlockStart(l) && !isBlank(item[item.length - 1])) { item.push(l); i++; continue; }
        break;
      }
      if (blanks && i < lines.length && RE_LIST.test(lines[i])) sawBlankBetween = true;
      items.push(item);
    }
    const list = el(ordered ? "ol" : "ul");
    if (ordered && start !== 1) list.attrs.start = String(start);
    for (const item of items) {
      let children = this.parse(item);
      if (!loose) children = children.flatMap((c) => (c.k === "el" && c.tag === "p" ? c.children : [c]));
      // task list items (GFM)
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

  private table(lines: string[], i: number, out: HNode[]): number {
    const split = (l: string): string[] => {
      const cells: string[] = [];
      let cur = "";
      let t = l.trim();
      if (t.startsWith("|")) t = t.slice(1);
      if (t.endsWith("|") && !t.endsWith("\\|")) t = t.slice(0, -1);
      for (let k = 0; k < t.length; k++) {
        if (t[k] === "\\" && t[k + 1] === "|") { cur += "|"; k++; }
        else if (t[k] === "|") { cells.push(cur.trim()); cur = ""; }
        else cur += t[k];
      }
      cells.push(cur.trim());
      return cells;
    };
    const header = split(lines[i]);
    const aligns = split(lines[i + 1]).map((d) => (d.startsWith(":") && d.endsWith(":") ? "center" : d.endsWith(":") ? "right" : d.startsWith(":") ? "left" : ""));
    const cell = (tag: string, s: string, j: number): El => {
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
}

function isBlockStart(l: string): boolean {
  return RE_FENCE.test(l) || RE_HEADING.test(l) || RE_HR.test(l) || RE_QUOTE.test(l) || RE_LIST.test(l) || l.trim() === "$$";
}
function stripIndent(l: string, n: number): string {
  let k = 0;
  while (k < n && l[k] === " ") k++;
  return l.slice(k);
}

// ---------------------------------------------------------------- inline

interface Delim { idx: number; ch: string; count: number; canOpen: boolean; canClose: boolean }
type Tok = { n: HNode } | { d: Delim } | { bracket: "[" | "![" ; idx: number; active: boolean };

const PUNCT_RE = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~\p{P}\p{S}]/u;
const ESCAPABLE = "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~";
const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", copy: "©", mdash: "—", ndash: "–", hellip: "…", laquo: "«", raquo: "»" };

export function parseInline(s: string): HNode[] {
  const toks: Tok[] = [];
  let buf = "";
  const flushText = (): void => { if (buf) { toks.push({ n: text(buf) }); buf = ""; } };
  const n = s.length;
  let i = 0;
  while (i < n) {
    const c = s[i];
    // placeholder
    if (c === PH) {
      const end = s.indexOf(PH, i + 1);
      flushText();
      toks.push({ n: { k: "hole", i: parseInt(s.slice(i + 1, end), 10) } });
      i = end + 1;
      continue;
    }
    if (c === "\\") {
      const nx = s[i + 1] ?? "";
      if (nx === "\n") { flushText(); toks.push({ n: el("br") }); i += 2; continue; }
      if (ESCAPABLE.includes(nx)) { buf += nx; i += 2; continue; }
      buf += "\\"; i++; continue;
    }
    if (c === "`") {
      const run = /^`+/.exec(s.slice(i))![0];
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
      buf += run; i += run.length; continue;
    }
    if (c === "$") {
      const m = mathAt(s, i);
      if (m) { flushText(); toks.push({ n: m.node }); i = m.end; continue; }
      buf += "$"; i++; continue;
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
    if (c === "!" && s[i + 1] === "[") { flushText(); toks.push({ bracket: "![", idx: toks.length, active: true }); i += 2; continue; }
    if (c === "[") { flushText(); toks.push({ bracket: "[", idx: toks.length, active: true }); i++; continue; }
    if (c === "]") {
      // find matching opener
      let oi = -1;
      for (let k = toks.length - 1; k >= 0; k--) { const t = toks[k]; if ("bracket" in t) { oi = k; break; } }
      if (oi < 0 || !(toks[oi] as { active: boolean }).active) { buf += "]"; i++; continue; }
      const opener = toks[oi] as { bracket: "[" | "!["; active: boolean };
      const link = linkTail(s, i + 1);
      if (!link) {
        opener.active = false;
        buf += "]"; i++; continue;
      }
      flushText();
      const inner = toks.splice(oi + 1);
      toks.pop(); // opener
      const children = processEmphasis(inner);
      if (opener.bracket === "![") {
        const attrs: Record<string, string> = { src: link.dest, alt: plainText(children) };
        if (link.title) attrs.title = link.title;
        toks.push({ n: el("img", [], attrs) });
      } else {
        const attrs: Record<string, string> = { href: link.dest };
        if (link.title) attrs.title = link.title;
        toks.push({ n: el("a", children, attrs) });
        for (const t of toks) if ("bracket" in t && t.bracket === "[") t.active = false;
      }
      i = link.end;
      continue;
    }
    if (c === "<") {
      const am = /^<((?:[a-zA-Z][a-zA-Z0-9+.-]*:|www\.)[^\s<>]*)>/.exec(s.slice(i));
      if (am) { flushText(); toks.push({ n: el("a", [text(am[1])], { href: am[1] }) }); i += am[0].length; continue; }
      const cm = /^<!--[\s\S]*?-->/.exec(s.slice(i));
      if (cm) { flushText(); toks.push({ n: { k: "comment", s: cm[0].slice(4, -3) } }); i += cm[0].length; continue; }
      buf += "<"; i++; continue;
    }
    if (c === "&") {
      const em = /^&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]*);/.exec(s.slice(i));
      if (em) {
        const name = em[1];
        let decoded: string | null = null;
        if (name.startsWith("#x")) decoded = String.fromCodePoint(parseInt(name.slice(2), 16));
        else if (name.startsWith("#")) decoded = String.fromCodePoint(parseInt(name.slice(1), 10));
        else if (name in ENTITIES) decoded = ENTITIES[name];
        if (decoded !== null) { flushText(); toks.push({ n: text(decoded) }); i += em[0].length; continue; }
      }
    }
    if (c === "\n") {
      const hard = buf.endsWith("  ");
      buf = buf.replace(/ +$/, "");
      flushText();
      toks.push({ n: hard ? el("br") : text("\n") });
      i++;
      // strip leading spaces of next line
      while (s[i] === " ") i++;
      continue;
    }
    buf += c;
    i++;
  }
  flushText();
  return processEmphasis(toks);
}

/** Parse `(dest "title")` after `]`; returns the end index. */
function linkTail(s: string, i: number): { dest: string; title?: string; end: number } | null {
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
      if (c === "\\" && j + 1 < s.length) { dest += s[j + 1]; j += 2; continue; }
      if (/\s/.test(c)) break;
      if (c === "(") depth++;
      if (c === ")") { if (depth === 0) break; depth--; }
      dest += c;
      j++;
    }
  }
  while (s[j] === " ") j++;
  let title: string | undefined;
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

/** CommonMark "process emphasis" over the token list. */
function processEmphasis(toks: Tok[]): HNode[] {
  // Convert to a mutable node array with delimiter markers.
  type Item = { node?: HNode; delim?: Delim & { alive: boolean } };
  const items: Item[] = toks.map((t) => ("n" in t ? { node: t.n } : "d" in t ? { delim: { ...t.d, alive: true } } : { node: text(t.bracket) }));
  for (let ci = 0; ci < items.length; ci++) {
    const closer = items[ci].delim;
    if (!closer || !closer.canClose || !closer.alive) continue;
    // search back for an opener
    let oi = ci - 1;
    for (; oi >= 0; oi--) {
      const o = items[oi].delim;
      if (o && o.alive && o.ch === closer.ch && o.canOpen && o.count > 0) {
        // rule of three
        if ((o.canClose || closer.canOpen) && (o.count + closer.count) % 3 === 0 && !(o.count % 3 === 0 && closer.count % 3 === 0)) continue;
        break;
      }
    }
    if (oi < 0) { if (!closer.canOpen) closer.alive = false; continue; }
    const opener = items[oi].delim!;
    const use = opener.count >= 2 && closer.count >= 2 ? 2 : 1;
    const inner = items.slice(oi + 1, ci).flatMap((it) => (it.node ? [it.node] : it.delim ? [text(it.delim.ch.repeat(it.delim.count))] : []));
    const wrapped = el(use === 2 ? "strong" : "em", inner);
    opener.count -= use;
    closer.count -= use;
    const replacement: Item[] = [];
    if (opener.count > 0) replacement.push({ delim: opener });
    replacement.push({ node: wrapped });
    if (closer.count > 0) replacement.push({ delim: closer });
    items.splice(oi, ci - oi + 1, ...replacement);
    ci = oi + replacement.length - 1 - (closer.count > 0 ? 1 : 0);
    if (closer.count > 0) ci = oi + replacement.length - 2; // re-examine the same closer
  }
  const out: HNode[] = [];
  for (const it of items) {
    if (it.node) out.push(it.node);
    else if (it.delim && it.delim.count > 0) out.push(text(it.delim.ch.repeat(it.delim.count)));
  }
  // merge adjacent text nodes
  const merged: HNode[] = [];
  for (const n of out) {
    const last = merged[merged.length - 1];
    if (n.k === "text" && last && last.k === "text") last.s += n.s;
    else merged.push(n.k === "text" ? { k: "text", s: n.s } : n);
  }
  return merged;
}

/** Inline math at s[i] === "$" per M-8. Returns the node and end index, or null when literal. */
export function mathAt(s: string, i: number): { node: HNode; end: number } | null {
  const delim = s.startsWith("$$", i) ? "$$" : "$";
  const after = s[i + delim.length] ?? "";
  if (after === "" || /\s/.test(after)) return null;
  const before = s[i - 1] ?? "";
  if (delim === "$" && /\d/.test(before) && /\d/.test(after)) return null;
  let j = i + delim.length;
  while (j < s.length) {
    if (s[j] === "\\") { j += 2; continue; }
    if (s.startsWith(delim, j)) {
      if (/\d/.test(s[j + delim.length] ?? "")) { j++; continue; }
      return { node: { k: "math", tex: s.slice(i + delim.length, j), display: delim === "$$" }, end: j + delim.length };
    }
    j++;
  }
  return null;
}
