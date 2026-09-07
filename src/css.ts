// Scoped styles (6.5): rewrite selectors to add a per-document attribute.

/** Add `[attr]` to every selector in `css`, honoring :global(...) and nested at-rules. */
export function scopeCss(css: string, attr: string): string {
  return rewriteBlock(css, attr, false);
}

function rewriteBlock(css: string, attr: string, keyframes: boolean): string {
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
    if (/\s/.test(c)) { out += c; i++; continue; }
    // find the end of the prelude: `{` or `;`
    let j = i;
    let depthParen = 0;
    let quote: string | null = null;
    while (j < css.length) {
      const ch = css[j];
      if (quote) { if (ch === quote && css[j - 1] !== "\\") quote = null; }
      else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === "(") depthParen++;
      else if (ch === ")") depthParen--;
      else if (depthParen === 0 && (ch === "{" || ch === ";")) break;
      j++;
    }
    const prelude = css.slice(i, j).trim();
    if (j >= css.length || css[j] === ";") { out += css.slice(i, j + 1); i = j + 1; continue; }
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

function matchBrace(css: string, open: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let k = open; k < css.length; k++) {
    const ch = css[k];
    if (quote) { if (ch === quote && css[k - 1] !== "\\") quote = null; continue; }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) return k; }
  }
  return css.length;
}

function scopeSelectorList(list: string, attr: string): string {
  return splitTop(list, ",").map((s) => scopeSelector(s.trim(), attr)).join(", ");
}

/** Append the attribute to the last compound selector, leaving :global(...) parts alone. */
export function scopeSelector(sel: string, attr: string): string {
  if (!sel) return sel;
  // :global(x) wraps: strip entirely when the whole selector is global
  const wholeGlobal = /^:global\((.*)\)$/s.exec(sel);
  if (wholeGlobal) return wholeGlobal[1];
  // Split into compounds by combinators (space, >, +, ~) at top level.
  const parts: string[] = [];
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
  // find last compound
  let last = parts.length - 1;
  while (last >= 0 && /^[\s>+~]$/.test(parts[last])) last--;
  if (last < 0) return sel;
  parts[last] = scopeCompound(parts[last], attr);
  return parts.map((p) => p.replace(/^:global\((.*)\)$/s, "$1")).join("").replace(/\s+/g, " ");
}

function scopeCompound(comp: string, attr: string): string {
  const g = /^:global\((.*)\)$/s.exec(comp);
  if (g) return g[1];
  // insert before pseudo-elements (::before) and pseudo-classes that must stay last-ish
  const m = /^(.*?)((?:::?[a-zA-Z-]+(?:\([^)]*\))?)*)$/s.exec(comp);
  const base = m ? m[1] : comp;
  const pseudo = m ? m[2] : "";
  // keep pseudo-classes before the attribute? `[attr]:hover` is valid; `[attr]::before` needed order.
  // Split pseudo into pseudo-classes (single colon) and pseudo-elements (double colon).
  const pcs: string[] = [];
  const pes: string[] = [];
  for (const p of pseudo.match(/::?[a-zA-Z-]+(?:\([^)]*\))?/g) ?? []) (p.startsWith("::") ? pes : pcs).push(p);
  return `${base || ""}[${attr}]${pcs.join("")}${pes.join("")}`;
}

function splitTop(s: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "";
  let depth = 0;
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === sep && depth === 0) { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}
