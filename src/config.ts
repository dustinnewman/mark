// mark.config.json (2.3)
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface Config {
  root: string;
  out: string;
  base: string;
  spa: boolean;
  math: "mathml" | "katex";
  katex: { macros?: Record<string, string> };
  lang: string;
  locale: string;
}

export const defaultConfig = (): Config => ({
  root: "site", out: "dist", base: "/", spa: false, math: "mathml", katex: {}, lang: "en", locale: "en-US",
});

export function loadConfig(projectDir: string, overrides: Partial<Config> = {}): Config {
  const cfg = defaultConfig();
  const file = join(projectDir, "mark.config.json");
  if (existsSync(file)) Object.assign(cfg, JSON.parse(readFileSync(file, "utf8")));
  Object.assign(cfg, overrides);
  if (!cfg.base.startsWith("/")) cfg.base = "/" + cfg.base;
  if (!cfg.base.endsWith("/")) cfg.base += "/";
  return cfg;
}
