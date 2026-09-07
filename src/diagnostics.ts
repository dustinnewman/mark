export interface Diagnostic {
  file: string;
  line: number;
  col: number;
  code: string;
  message: string;
  severity: "error" | "warning";
}

export class MarkError extends Error {
  code: string;
  line: number;
  col: number;
  file: string;
  constructor(code: string, message: string, line = 0, col = 0, file = "") {
    super(message);
    this.code = code;
    this.line = line;
    this.col = col;
    this.file = file;
  }
  toDiagnostic(file = this.file): Diagnostic {
    return {
      file,
      line: this.line,
      col: this.col,
      code: this.code,
      message: this.message,
      severity: this.code.startsWith("W") ? "warning" : "error",
    };
  }
}

/** Syntax errors carry code "SYNTAX" unless a specific rule applies. */
export const syntax = (message: string, line: number, col = 0): MarkError => new MarkError("SYNTAX", message, line, col);

export const formatDiagnostic = (d: Diagnostic): string =>
  `${d.file}:${d.line}${d.col ? ":" + d.col : ""} ${d.severity} ${d.code}: ${d.message}`;

/** Message templates (section 14). */
export const MSG = {
  E001: () => "`else` must follow `}` on the same line",
  E002: (x: string, y: string, n: number) => `Mismatched closing tag </${x}> for <${y}> opened at line ${n}`,
  E003: (n: string, l: number) => `\`${n}\` is used before its declaration (line ${l})`,
  E004: (n: string, l: number) => `\`${n}\` is already declared at line ${l}`,
  E005: (kind: string, n: string) => `Cannot assign to ${kind} \`${n}\``,
  E006: () => "Assignment is only allowed inside handlers and functions",
  E007: (x: string) => `Unknown component <${x}>`,
  E008: (x: string, y: string, avail: string[]) => `Component ${x} has no prop \`${y}\` (available: ${avail.join(", ") || "none"})`,
  E009: (p: string, root: string) => `Cannot bind \`$${p}\`: root \`${root}\` is not a \`var\`, loop item, or bound prop`,
  E010: (n: string) => `Page prop \`${n}\` must have a literal default`,
  E011: (p: string, a: string, b: string) => `Path \`${p}\` is produced by both \`${a}\` and \`${b}\``,
  E013: () => "`export var` is not allowed",
  E014: (x: string) => `Void element <${x}> cannot have children`,
  E016: () => "`await` is only allowed in `async fn`, handlers, and async arrows",
  E017: () => "`return` outside a function body",
  E018: () => "`try` takes exactly two operands: `try(expr, fallback)`",
  E019: () => "`$` shorthand cannot end in `[…]`; give the prop a name",
  E020: () => "`<style>` must be at document top level; at most one per document",
  E021: (m: string) => `\`${m}\` is not available in Mark expressions`,
  E022: () => "`Math.random`/`Date.now` cannot be used in static content; use it in a `var` or handler",
  E023: () => "Page evaluation exceeded the operation limit",
  E024: (f: string) => `Dynamic page \`${f}\` has no \`prop paths\` and SPA mode is off`,
  W001: () => "Layout has no <slot />",
  W002: (n: string) => `\`${n}\` shadows outer declaration`,
  W003: (x: string) => `Unknown HTML element <${x}>`,
  W004: () => "Expression statement has no effect",
};
