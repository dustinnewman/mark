// Prose tree: the compiled form of a prose node's Markdown. Shared by the
// build-time evaluator and the browser runtime (the runtime never parses Markdown).

export type HNode =
  | { k: "el"; tag: string; attrs: Record<string, string>; children: HNode[]; slug?: string }
  | { k: "text"; s: string }
  | { k: "hole"; i: number }                                  // prose part i (interp or inline tag)
  | { k: "math"; tex: string; display: boolean }              // tex may contain placeholders
  | { k: "comment"; s: string };                               // HTML comment passthrough

export const BLOCK_TAGS = new Set([
  "address", "article", "aside", "blockquote", "details", "dialog", "div", "dl", "fieldset", "figcaption", "figure",
  "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "main", "nav", "ol", "p", "pre", "section",
  "table", "ul", "li", "tr", "td", "th", "thead", "tbody", "menu", "summary", "video", "canvas", "svg", "slot",
]);

export const isList = (n: HNode): n is Extract<HNode, { k: "el" }> => n.k === "el" && (n.tag === "ul" || n.tag === "ol");
