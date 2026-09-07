// `mark dev`: build, serve dist/, rebuild on change, live-reload via server-sent events.
import { existsSync, readFileSync, statSync, watch } from "node:fs";
import { createServer, type ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";
import { buildDir, printDiagnostics } from "./build.ts";
import type { Diagnostic } from "./diagnostics.ts";
import { formatDiagnostic } from "./diagnostics.ts";
import { escapeHtml } from "./core/host.ts";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml",
  ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".ico": "image/x-icon", ".txt": "text/plain",
};

const RELOAD = `<script>(()=>{const s=new EventSource("/_mk/__reload");s.onmessage=(e)=>{if(e.data==="reload")location.reload();};})()</script>`;

export async function devServer(dir: string, opts: { port: number; drafts: boolean; spa: boolean }): Promise<void> {
  const clients = new Set<ServerResponse>();
  let outDir = join(dir, "dist");
  let lastErrors: Diagnostic[] = [];
  let base = "/";

  const rebuild = async (): Promise<void> => {
    const t0 = Date.now();
    try {
      const r = await buildDir(dir, { dev: true, drafts: opts.drafts, config: opts.spa ? { spa: true } : {} });
      outDir = r.outDir;
      base = r.project.config.base;
      lastErrors = r.output.diagnostics.filter((d) => d.severity === "error");
      printDiagnostics(r.output.diagnostics);
      console.error(lastErrors.length ? `✗ build failed (${Date.now() - t0} ms)` : `✓ rebuilt ${r.output.pages.length} pages in ${Date.now() - t0} ms`);
    } catch (e) {
      lastErrors = [{ file: "", line: 0, col: 0, code: "CRASH", message: String((e as Error).stack ?? e), severity: "error" }];
      console.error(e);
    }
    for (const c of clients) c.write("data: reload\n\n");
  };
  await rebuild();

  let timer: NodeJS.Timeout | null = null;
  for (const sub of ["site", "_data", "static", "mark.config.json"]) {
    const p = join(dir, sub);
    if (!existsSync(p)) continue;
    watch(p, { recursive: true }, () => { if (timer) clearTimeout(timer); timer = setTimeout(rebuild, 50); });
  }

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/_mk/__reload") {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
      res.write("data: hello\n\n");
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return;
    }
    if (lastErrors.length) {
      res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<!doctype html><title>Mark build error</title><body style="font:14px/1.5 monospace;padding:2rem;background:#300;color:#fff"><h1>Build errors</h1><pre>${escapeHtml(lastErrors.map(formatDiagnostic).join("\n"))}</pre>${RELOAD}`);
      return;
    }
    let path = decodeURIComponent(url.pathname);
    if (base !== "/" && path.startsWith(base.replace(/\/$/, ""))) path = path.slice(base.length - 1) || "/";
    let file = normalize(join(outDir, path));
    if (!file.startsWith(outDir)) { res.writeHead(403); res.end(); return; }
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
    if (!existsSync(file)) {
      const nf = join(outDir, "404.html");
      res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
      res.end(existsSync(nf) ? readFileSync(nf, "utf8").replace("</body>", RELOAD + "</body>") : "Not found");
      return;
    }
    const ext = extname(file);
    res.writeHead(200, { "Content-Type": MIME[ext] ?? "application/octet-stream", "Cache-Control": "no-cache" });
    if (ext === ".html") res.end(readFileSync(file, "utf8").replace("</body>", RELOAD + "</body>"));
    else res.end(readFileSync(file));
  });
  await new Promise<void>((resolve) => server.listen(opts.port, resolve));
  console.error(`mark dev → http://localhost:${opts.port}${base}`);
  await new Promise(() => {});
}
