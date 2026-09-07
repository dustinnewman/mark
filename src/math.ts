// TeX rendering via KaTeX (10.2). Build-time renderer; the browser loads the same
// library as a separate chunk only when a page has dynamic math.
import katex from "katex";
import type { MathRenderer } from "./core/render.ts";
import { escapeHtml } from "./core/host.ts";

export function makeMathRenderer(mode: "mathml" | "katex", macros: Record<string, string> = {}): MathRenderer {
  return (tex, display) => {
    try {
      return katex.renderToString(tex, {
        displayMode: display,
        output: mode === "mathml" ? "mathml" : "htmlAndMathml",
        throwOnError: true,
        macros: { ...macros },
        strict: "ignore",
        trust: false,
      });
    } catch {
      return `<span class="mk-math-error">${escapeHtml(tex)}</span>`;
    }
  };
}
