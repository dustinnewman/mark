# Mark

A Markdown-flavored language for interactive websites, implemented from `spec.md`.

One file type (`.mark`) describes pages, layouts and components. Lines are prose unless they
start with a keyword (`var`, `let`, `prop`, `fn`, `if`, `for`, `}`) or a tag. `var` is a signal,
`let` is a computed. `mark build` evaluates every page at build time and writes plain HTML;
JavaScript is emitted only for *islands*, the subtrees that can change after load.

```
var n = 0
<button onTap={n += 1}>{n}</button>

## $\theta$ and prose with $x^{ {n} }$ math
```

## Install and run

Requires Node ≥ 22.6 (the sources run directly, no build step).

```sh
npm install
node bin/mark.js build examples/blog --islands     # static site → examples/blog/dist
node bin/mark.js dev   examples/blog               # serve with live reload
node bin/mark.js check examples/blog               # diagnostics only
node bin/mark.js parse examples/blog/site/components/CoinBox.mark   # JSON AST (spec §13)
npm test                                           # spec test suites (tests/**/*.test.json)
```

Single-file executable (Node SEA): `npm run binary` produces `build/mark`, which embeds the
browser runtime and KaTeX.

As a dependency (`npm install github:dustinnewman/mark`), `mark` runs the committed bundle
`lib/cli.js` because Node will not strip types under `node_modules`. `runtime/runtime.js` and
`lib/cli.js` are build artifacts kept in git; `npm run runtime && npm run lib` (or `npm install`,
via `prepare`) refreshes them — run that before pushing changes to `src/`.

## Project layout

```
site/            root (config "root")
  _site.mark     root layout, wraps everything
  index.mark     → /
  blog/_layout.mark, blog/[slug].mark, components/Nav.mark …
_data/*.json|yaml   → Site.data
static/**        copied verbatim to the output
site/**/*.png … non-source files next to pages are copied to the same route (site/posts/a/fig.png → /posts/a/fig.png)
mark.config.json { root, out, base, spa, math: "mathml" | "katex", katex: { macros }, lang, locale }
```

## Architecture

```
.mark ─parse─▶ AST ─check─▶ ─index (Site)─▶ ─island analysis─▶ evaluator ─▶ HTML + mark.css
                                                                     └─▶ _mk/docs/*.js + _mk/pages/*.js (islands only)
```

| Module | Role |
|---|---|
| `src/lexer.ts`, `src/expr.ts` | Scanner and Pratt expression parser producing ESTree |
| `src/parser.ts` | Line classifier, tag scanner, prose/interpolation/math scanning (§3, §4) |
| `src/markdown.ts` | Markdown subset → prose tree with holes for interpolations (§10) |
| `src/checker.ts` | Scope, assignment context, props, bindings, whitelist (§14 codes) |
| `src/site.ts` | Routing, layouts, page props, `Site` object, data files (§2, §8) |
| `src/analysis.ts` | Dynamic-ness and islands (§8.7) |
| `src/core/*` | **Shared by build and browser**: reactive graph, deep-reactive proxies, interpreter, renderer |
| `src/buildhost.ts` | Virtual tree + HTML serializer used by the evaluator |
| `src/build.ts`, `src/emit.ts` | Page evaluation, output contract (§12.3), module emission |
| `src/runtime/*` | Browser runtime: DOM host with hydration-by-adoption, `hydrate`, SPA navigation |
| `src/css.ts` | Scoped `<style>` rewriting (§6.5) |
| `scripts/build-grammar.ts` | Generates the editor grammar in `editors/vscode/` from the parser's line classifier and token regexes |

The evaluator and the runtime are the *same* interpreter and renderer driving two hosts
(a virtual tree at build time, the DOM in the browser). The emitted module for a document is
its pruned AST as data; nothing is compiled to JavaScript source and no `eval` is used. This is
what makes the build-08 invariant hold by construction: the HTML the evaluator writes is exactly
what the runtime adopts.

The runtime bundle is 13 kB min+gz (`npm run runtime` reports the size). KaTeX is a separate
chunk loaded only by pages with dynamic math.

## Editor support

`editors/vscode/` is a VS Code extension providing syntax highlighting for `.mark` files. Its
TextMate grammar is generated (`npm run grammar`) from the same regexes the parser uses for line
classification, tags, attributes and reserved words, so it stays in step with `src/`. Install it by
packaging a VSIX and reloading the window:

```sh
npm run vsix
code --install-extension build/mark-lang-vscode-0.1.0.vsix
```

## Tests

`tests/runner.ts` reads `tests/**/*.test.json`; the tier is the directory name:

- `parse` — `{src, ast | error}` structural AST comparison (§15.1)
- `check` — `{files, errors: ["E00N@file:line"]}` (§15.2)
- `eval` — `{src, html | error, islands?}` normalized body HTML (§15.4)
- `build` — `{files, config?, expect: {files, notFiles, contains, noScripts, islands, …}}` (§15.5)
- `run` — `{files, path?, steps}` executed in jsdom with the real runtime and the real emitted
  modules; steps are `click`, `input`, `keydown`, `navigate`, `expect`, `get`, `expectMutations`, … (§15.3)

Run one tier or one test: `npm test -- run-04`.

## Spec deviations (deliberate)

- **Islands are groups of adjacent dynamic top-level nodes** (declarations in between do not
  split a group). With I-1's "any child dynamic" rule this is what "maximal dynamic node whose
  parent is static" reduces to, and it yields the three islands of build-04.
- **`false` renders as nothing** in interpolations (M-4), so eval-01 expects `12 6 ` rather than
  `12 6 false false`.
- **Multi-line expressions** continue on a following line that starts with `?`, `:`, `&&`, `||`
  or `.name` (used by the spec's own Appendix A).
- **`fn` bodies may call functions declared later** (mutual recursion, run-16); all other
  forward references are E003.
- **`sort`/`reverse`** are not flagged E006 in static context because the spec's blog example
  uses `.sort(...)` in a `for` source; `push`/`pop`/`shift`/`unshift`/`splice`/`fill` are.
- **Dates are UTC** on both sides (`getFullYear` → `getUTCFullYear`, `toLocaleDateString` with
  `timeZone: "UTC"`) so build and browser agree regardless of time zone (V-3).
- **`Page.title`** in SPA mode is the page's own title (`info.title`); `document.title` holds
  the composed `<title>`.
- Head nodes are never islands; in SPA mode heads are re-rendered per navigation instead.
- The `aria-live` attribute on `<Matrix>` in Appendix A is an unknown prop (E008 per T-8) and
  was dropped from the example.
- `Fragment` has no `slot` prop (`slot` is reserved); the attribute is handled syntactically.
- Inline `<b>` inside a paragraph is an inline part; a paragraph consisting only of block-level
  tags or components is emitted without `<p>`.
- YAML support is a small subset (block maps/lists, scalars, flow collections as JSON).

## Known limitations

- A layout `<slot />` inside an island (e.g. `<main class={x}><slot/></main>`) is not
  hydratable in non-SPA mode; keep slots in static markup.
- Dev-mode error overlays are not implemented; runtime errors are logged and collected.
