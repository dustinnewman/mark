// Tier runners for check / eval / build / run tests (spec 15.2–15.5).
import { buildProject } from "../src/build.ts";
import { compileProject } from "../src/compile.ts";
import { type Config, defaultConfig } from "../src/config.ts";
import type { Diagnostic } from "../src/diagnostics.ts";

export function filesOf(t: { files: Record<string, string> }): Map<string, string> {
  return new Map(Object.entries(t.files));
}

export function configOf(t: { config?: Partial<Config> }): Config {
  const c = { ...defaultConfig(), ...(t.config ?? {}) };
  if (!c.base.endsWith("/")) c.base += "/";
  return c;
}

const fmtDiag = (d: Diagnostic): string => `${d.code}@${d.file}:${d.line}`;

export async function runCheckTest(t: any): Promise<string | null> {
  const project = compileProject(filesOf(t), configOf(t), { drafts: !!t.drafts });
  const got = project.diagnostics.map(fmtDiag);
  const want: string[] = t.errors ?? [];
  const missing = want.filter((w) => !got.includes(w));
  const extra = got.filter((g) => !want.includes(g));
  if (!missing.length && !extra.length) return null;
  return `expected [${want.join(", ")}] got [${got.join(", ")}]\n` + project.diagnostics.map((d) => `  ${d.code} ${d.file}:${d.line} ${d.message}`).join("\n");
}

/** Whitespace-normalized HTML: collapse runs, drop whitespace between tags. */
export function normalizeHtml(s: string): string {
  return s.replace(/\s+/g, " ").replace(/>\s+</g, "><").trim();
}

export function bodyOf(html: string): string {
  const m = /<body>([\s\S]*)<\/body>/.exec(html);
  let b = m ? m[1] : html;
  b = b.replace(/<script type="module"[^>]*><\/script>/g, "");
  return normalizeHtml(b);
}

export async function runEvalTest(t: any): Promise<string | null> {
  const files = new Map<string, string>([["site/_site.mark", "<slot />\n"], ["site/index.mark", t.src]]);
  if (t.files) for (const [k, v] of Object.entries(t.files)) files.set(k, v as string);
  const project = compileProject(files, configOf(t), {});
  const output = project.hasErrors ? null : buildProject(project, {});
  const diags = output ? output.diagnostics : project.diagnostics;
  const errors = diags.filter((d) => d.severity === "error");
  if (t.error) {
    if (errors.some((d) => d.code === t.error)) return null;
    return `expected error ${t.error}, got [${errors.map(fmtDiag).join(", ")}]` + (output ? `\n  html: ${bodyOf(output.pages[0]?.html ?? "")}` : "");
  }
  if (errors.length) return `unexpected errors: ${errors.map((d) => `${fmtDiag(d)} ${d.message}`).join("; ")}`;
  const page = output!.pages.find((p) => p.path === "/")!;
  const body = bodyOf(page.html);
  if (t.html !== undefined && body !== normalizeHtml(t.html)) return `html mismatch\n    expected: ${normalizeHtml(t.html)}\n    got:      ${body}`;
  if (t.islands !== undefined && page.islands.length !== t.islands) return `expected ${t.islands} islands, got ${page.islands.length}`;
  return null;
}

export async function runBuildTest(t: any): Promise<string | null> {
  const project = compileProject(filesOf(t), configOf(t), { drafts: !!t.drafts });
  const output = project.hasErrors ? null : buildProject(project, { islands: true });
  const diags = output ? output.diagnostics : project.diagnostics;
  const errors = diags.filter((d) => d.severity === "error");
  if (t.error) return errors.some((d) => d.code === t.error) ? null : `expected error ${t.error}, got [${errors.map(fmtDiag).join(", ")}]`;
  if (errors.length || !output) return `unexpected errors: ${errors.map((d) => `${fmtDiag(d)} ${d.message}`).join("; ")}`;
  const e = t.expect ?? {};
  const files = output.files;
  for (const f of e.files ?? []) if (!files.has(f)) return `missing output file ${f} (have: ${[...files.keys()].join(", ")})`;
  for (const f of e.notFiles ?? []) if (files.has(f)) return `unexpected output file ${f}`;
  for (const [f, subs] of Object.entries(e.contains ?? {})) {
    const content = files.get(f);
    if (content === undefined) return `missing output file ${f}`;
    for (const s of subs as string[]) if (!normalizeHtml(content).includes(normalizeHtml(s))) return `${f} does not contain ${JSON.stringify(s)}\n    got: ${normalizeHtml(content)}`;
  }
  for (const [f, subs] of Object.entries(e.notContains ?? {})) {
    const content = files.get(f) ?? "";
    for (const s of subs as string[]) if (normalizeHtml(content).includes(normalizeHtml(s))) return `${f} unexpectedly contains ${JSON.stringify(s)}`;
  }
  if (e.noScripts) for (const [f, content] of files) if (f.endsWith(".html") && /<script/.test(content)) return `${f} contains a <script> tag`;
  if (e.noRuntime && [...files.keys()].some((f) => f.startsWith("_mk/") && f.endsWith(".js"))) return `runtime JS was emitted: ${[...files.keys()].filter((f) => f.endsWith(".js")).join(", ")}`;
  if (e.islands) for (const [path, n] of Object.entries(e.islands)) {
    const p = output.pages.find((x) => x.path === path);
    if (!p) return `no page ${path}`;
    if (p.islands.length !== n) return `${path}: expected ${n} islands, got ${p.islands.length}\n${output.report.join("\n")}`;
  }
  return null;
}

export async function runRunTest(t: any): Promise<string | null> {
  const { runRun } = await import("./harness.ts");
  return runRun(t);
}
