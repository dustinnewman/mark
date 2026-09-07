# Mark — Language & Framework Specification

Version 0.3 (draft). Audience: an implementer building the parser, compiler, runtime, and site builder from scratch. Everything not marked *optional* is required for conformance. Every normative rule has an ID (`L-3`, `R-7`, …) that tests reference.

---

## 0. Summary

Mark is a Markdown-flavored language for interactive websites. One file type (`.mark`) describes everything: blog posts, components, layouts, the home page, the nav header. The distinguishing rules:

1. **A file is a component.** Pages, layouts, and reusable widgets are all `.mark` files with the same grammar. A page is a component the router mounts; a layout is a component with a `<slot />`.
2. **Lines are prose unless they start with a keyword.** `var`, `let`, `prop`, `fn`, `if`, `else`, `for`, `}`, or a tag `<X` make a line code; everything else is Markdown.
3. **`var` is a signal, `let` is a computed.** Reactivity is fine-grained and automatic; there is no `setState`, no `useEffect`.
4. **The site is data.** A build step walks the directory and exposes it as `Site`; the router exposes `Page`. Nav, indexes, and breadcrumbs are ordinary `for` loops over these objects.
5. **Math is first-class.** `$…$` and `$$…$$` render via KaTeX.

6. **The output is static.** `mark build` evaluates every page at build time and writes HTML, CSS, and MathML. JavaScript is emitted only for *islands*: subtrees that can change after load. A blog with no `var` ships no script tags. Client-side (SPA) navigation is opt-in.
7. **Components can be imperative when they must.** A small, explicit set of intrinsics (`try`, `await`, `next()`, `after()`, `measure()`, `env`, `ref`) covers parsing, timing, and DOM geometry without opening the door to arbitrary host globals, and each is a defined no-op in the build-time evaluator.
8. **Styles live with the component.** A `<style>` block is scoped to its document by default.

Non-goals for 0.2: server-side data fetching, forms with server actions, a plugin system, CSS preprocessing.

---

## 1. Glossary

| Term | Meaning |
|---|---|
| Document | One `.mark` file. |
| Component | Any document. Capitalized name derived from file stem. |
| Page | A component at a routable path (not prefixed `_`, not in `components/`). |
| Layout | `_site.mark` or `_layout.mark`; wraps pages beneath it. |
| Prose | Markdown text lines. |
| Code line | A line classified as a statement, block delimiter, or tag. |
| Tag | `<html-element>` (lowercase) or `<Component>` (capitalized). |
| Signal | Mutable reactive cell (from `var`). |
| Computed | Derived reactive cell (from `let`). |
| Effect | Reactive subscriber that patches the DOM. |
| Site | Build-time index object, global, read-only. |
| Page | Runtime route object, global; `Page.path` is writable via navigation. |

---

## 2. Project Layout & Routing

### 2.1 Directory structure

```
myblog/
  mark.config.json        optional
  site/
    _site.mark            root layout (required)
    index.mark            → /
    about.mark            → /about
    posterior.mark        → /posterior
    blog/
      _layout.mark        wraps /blog/**
      index.mark          → /blog
      coins.mark          → /blog/coins
      [slug].mark         → /blog/:slug   (dynamic; see 2.4)
    components/
      Nav.mark            <Nav />
      CoinBox.mark        <CoinBox />
      post/Card.mark      <post.Card />   (namespaced by subdir)
  _data/
    authors.json          → Site.data.authors
    links.yaml            → Site.data.links
  static/
    style.css             copied verbatim to output root
```

**S-1** The root directory is `site/` unless `mark.config.json` sets `"root"`.
**S-2** Files and directories whose name starts with `_` are never pages. `_site.mark` and `_layout.mark` are layouts; any other `_`-prefixed `.mark` file is a compile error.
**S-3** `components/` at any depth is never routable. Files inside are components named by path relative to the nearest `components/`, with `/` → `.` and the `.mark` stripped. `components/post/Card.mark` is `<post.Card>`.
**S-4** Component names must match `[A-Z][A-Za-z0-9]*` (each segment). A file whose stem is not a valid name is a compile error unless it is a page.
**S-5** Page paths are the file path relative to root, with `.mark` stripped and `index` collapsed: `blog/index.mark` → `/blog`, `blog/coins.mark` → `/blog/coins`. Paths never have trailing slashes except `/`.
**S-6** Two files mapping to the same path is a compile error.

### 2.2 Layout nesting

**S-7** A page's layout chain is: `_site.mark`, then every `_layout.mark` in ancestor directories from outermost to innermost. Each renders its `<slot />` with the next element of the chain; the innermost renders the page.
**S-8** A layout without a `<slot />` is a compile warning; pages under it render nothing.
**S-9** A layout may have at most one unnamed `<slot />`.

### 2.3 Config

`mark.config.json` (all optional):

```json
{
  "root": "site",
  "out": "dist",
  "base": "/",
  "spa": false,
  "math": "mathml",
  "katex": { "macros": { "\\R": "\\mathbb{R}" } }
}
```

- `spa` — enable client-side navigation (8.6). Default `false`.
- `math` — `"mathml"` (default, no JS or CSS) or `"katex"` (HTML+CSS output). See 10.2.

### 2.4 Dynamic routes

**S-10** A file or directory segment `[name]` matches one path segment and binds `Page.params.name`. `[...name]` matches the rest of the path. Static segments take priority over dynamic ones; `[x]` over `[...x]`.
**S-11** A dynamic page must declare `prop paths = [...]` with a literal array of param objects (see 8.3) so the build knows which pages to emit. Without it, the page is emitted only in SPA mode (8.6) as a client-rendered fallback route; otherwise it is a compile error.

---

## 3. Lexical Structure

Processing is line-oriented. The parser reads a document line by line and classifies each line before any Markdown parsing.

### 3.1 Line classification

**L-1** Leading whitespace is stripped for classification (but preserved for Markdown list nesting in prose).
**L-2** A line is a **code line** if, after stripping, it matches one of:
  - `^(var|let|prop|fn)\s`  — declaration
  - `^(if|for)\s` — block opener
  - `^\}` — block closer (optionally followed by `else` clause)
  - `^else\b` — else clause (only valid immediately after `}` on the same line; see L-6)
  - `^<[A-Za-z]` — tag start
  - `^</[A-Za-z]` — closing tag
**L-3** A line starting with `\` followed by any of the above is prose; the `\` is removed. Example: `\for the record…` is the prose "for the record…".
**L-4** Inside a fenced code block (``` or ~~~), all lines are literal prose until the closing fence. Fences are detected before L-2.
**L-5** Inside a display math block (`$$` on its own line … `$$`), all lines are literal.
**L-6** `} else {` and `} else if cond {` must be on one line. A `}` alone closes; `else` on its own line is a syntax error.
**L-7** A tag whose attributes span multiple lines is continued until the first unquoted `>` or `/>` at brace depth 0. Continuation lines are not re-classified.
**L-8** Blank lines separate prose paragraphs and are otherwise ignored in code.
**L-9** A prose line may contain **inline tags** (`<b>`, `<Badge n={3} />`) and **interpolations** `{expr}`. Inline tags must open and close on the same line unless the line is block-level (L-2).
**L-10** `\{` and `\}` in prose are literal braces. Braces inside code spans (`` ` ``) and math (`$…$`, `$$…$$`) are literal.
**L-11** Comments: a code line beginning with `//` is ignored. Prose has no comment syntax (use `<!-- -->` which passes through Markdown).
**L-12** Inside a block-form `fn` body (from `fn name(…) {` to its matching `}`), every line is a statement; prose is not allowed. Blank lines and `//` comments are permitted.
**L-13** Lines between `<style>` and `</style>` are literal CSS and are not classified. `<style>` must be at top level of the document (not inside `if`/`for`/tags).

### 3.2 Tokens in code

Identifiers `[A-Za-z_][A-Za-z0-9_]*`; numbers (JS syntax, decimal only); strings `"…"` and `'…'` with JS escapes; template strings are **not** supported; punctuation as in section 5.

Reserved words: `var let prop fn if else for in key try return await async true false null undefined slot`.

---

## 4. Grammar

EBNF. `prose` and `tag` productions are line-level; `expr` is token-level.

```
document    := { item }
item        := decl | block | tagBlock | proseBlock | styleBlock

decl        := varDecl | letDecl | propDecl | fnDecl
varDecl     := "var" ident [ "=" expr ] EOL
letDecl     := "let" ident "=" expr EOL
propDecl    := "prop" ident [ "=" expr ] EOL
fnDecl      := [ "async" ] "fn" ident "(" [ ident { "," ident } ] ")" "=" expr EOL
             | [ "async" ] "fn" ident "(" [ ident { "," ident } ] ")" "{" EOL { stmt } "}" EOL
stmt        := "let" ident "=" expr EOL     (* immutable local *)
             | "var" ident [ "=" expr ] EOL (* mutable local, NOT reactive *)
             | "if" expr "{" EOL { stmt } "}" [ stmtElse ] EOL
             | "for" ident [ "," ident ] "in" expr "{" EOL { stmt } "}" EOL
             | "return" [ expr ] EOL
             | expr EOL
stmtElse    := "else" "if" expr "{" EOL { stmt } "}" [ stmtElse ] | "else" "{" EOL { stmt } "}"
styleBlock  := "<style" [ "global" ] ">" EOL { cssLine } "</style>" EOL

block       := ifBlock | forBlock
ifBlock     := "if" expr "{" EOL { item } "}" [ elseTail ] EOL
elseTail    := "else" "if" expr "{" EOL { item } "}" [ elseTail ]
             | "else" "{" EOL { item } "}"
forBlock    := "for" ident [ "," ident ] "in" expr [ "key" expr ] "{" EOL { item } "}" EOL
             (* second ident is the index *)

tagBlock    := openTag EOL { item } closeTag EOL
             | selfTag EOL
openTag     := "<" tagName { attr } ">"
selfTag     := "<" tagName { attr } "/>"
closeTag    := "</" tagName ">"
tagName     := htmlName | compName
htmlName    := [a-z][a-z0-9-]*
compName    := [A-Z][A-Za-z0-9]* { "." [A-Z][A-Za-z0-9]* }

attr        := attrName [ "=" attrValue ] [ "if" expr ]
             | "$" path                           (* bind shorthand, 6.4 *)
attrName    := [A-Za-z_:][A-Za-z0-9_:.-]*
attrValue   := string | "{" expr "}" | "$" path
path        := ident { "." ident | "[" expr "]" }

proseBlock  := proseLine { proseLine }           (* until blank line or code line *)
```

Expressions (precedence low → high):

```
expr        := seq
seq         := assign { ";" assign }              (* only valid in handler/fn context, 5.4 *)
assign      := ternary [ ("=" | "+=" | "-=" | "*=" | "/=") assign ]
ternary     := or [ "?" expr ":" ternary ]
or          := and { "||" and }
and         := eq { "&&" eq }
eq          := rel { ("==" | "!=") rel }          (* strict equality semantics *)
rel         := add { ("<" | ">" | "<=" | ">=") add }
add         := mul { ("+" | "-") mul }
mul         := pow { ("*" | "/" | "%") pow }
pow         := unary [ "**" pow ]
unary       := ("!" | "-" | "+") unary | "await" unary | postfix
postfix     := primary { "." ident | "[" expr "]" | "(" [ expr { "," expr } ] ")" | "?." ident }
primary     := number | string | "true" | "false" | "null" | "undefined"
             | ident | "(" expr ")" | array | object | arrow | tryExpr
tryExpr     := "try" "(" expr "," expr ")"      (* both operands lazy; see 5.6 *)
array       := "[" [ expr { "," expr } ] "]"
object      := "{" [ prop { "," prop } ] "}"
prop        := (ident | string) ":" expr | ident   (* shorthand *)
arrow       := ident "=>" expr | "(" [ ident { "," ident } ] ")" "=>" expr
```

**G-1** `==` and `!=` are JavaScript `===` / `!==`.
**G-2** Inside an interpolation or attribute `{…}`, the expression is parsed after the opening brace, so a leading `{` is always an object literal: `style={{color: "red"}}` and `{{a: 1}.a}` are both valid. Mark has no block statements in expression position, so there is no ambiguity to resolve. In `fn` bodies a statement beginning with `{` is likewise an object literal (and yields warning W004 if its value is unused).
**G-3** A `tagBlock` open tag and its close tag must have identical `tagName`. Mismatch is a syntax error reporting both line numbers.
**G-4** `try` is a keyword form, not a call: `try` used as an identifier is a syntax error, and `try(e)` with one operand is E018.

---

## 5. Semantics of Code

### 5.1 Scope

**C-1** A document is a single lexical scope. Declarations are visible from their line to the end of the document, including inside later blocks and handlers. Referencing a name before its declaration line is a compile error.
**C-2** `for` introduces `item` (and optional `index`) scoped to its body. `if` introduces nothing.
**C-3** Redeclaring a name in the same scope is a compile error. Shadowing an outer name in a `for` is allowed with a warning.
**C-4** Globals always in scope: `Site`, `Page`, `Math`, `JSON`, `Number`, `String`, `Array`, `Object`, `Date`, `Promise`, `console`, `env`, and the intrinsics `next`, `after`, `measure`. No other host globals (no `window`, `document`, `fetch`, `setTimeout`) — this is what makes build-time evaluation possible. DOM nodes obtained through `ref` (T-9) are ordinary nodes and their methods may be called (5.6).

### 5.2 Declarations

**C-5** `var x = e` creates a signal initialized to `e` evaluated once. `var x` with no initializer is `undefined`. Values are made **deeply reactive**: objects and arrays stored in a signal (at any depth) are wrapped in proxies so that `coins.push(c)`, `coin.heads = true`, `obj.a.b = 1` all notify dependents.
**C-6** `let y = e` creates a computed. It re-evaluates lazily whenever any signal/computed read during its last evaluation changes. Assigning to a `let` is a compile error.
**C-7** `prop p = e` declares a component input with default `e` (evaluated once per instance at mount, in the component's scope, so it may reference earlier props). `prop p` with no default is required; omitting it at a call site is a runtime error in dev, `undefined` in prod. Props are signals: the caller writes them whenever its expression changes, and the component may assign to them too (C-15, T-17).
**C-8** `fn f(a, b) = e` defines a function. Block form allows statements (grammar `stmt`): `let`/`var` locals (plain JS bindings, not reactive), `if`/`else`, `for` (plain loop, no rendering), `return`, and expressions. The value of a block `fn` is the `return`ed value, else `undefined`. Functions close over the document scope. Calling a `fn` inside a computed makes the computed depend on whatever the function reads. `async fn` returns a Promise and may use `await`.
**C-9** Evaluation order: all declarations execute in document order at mount. Prose and tags render after declarations on preceding lines are available; a tag on line 10 can use a `var` from line 3 but not line 12.

### 5.3 Blocks

**C-10** `if` re-evaluates its condition reactively. When it flips, the old branch is unmounted (its `var`s are discarded) and the new one mounted.
**C-11** `for item, i in list` renders the body once per element. `list` must be an array or `null`/`undefined` (treated as empty). Other types are a runtime error.
**C-12** Identity: with `key e`, `e` is evaluated per item and must be unique (duplicate keys are a runtime error in dev). Without `key`, identity is the item itself for objects (proxy identity) and the value for primitives. When the array changes, bodies for surviving keys are moved, not re-created; their internal `var` state is preserved.
**C-13** Mutating `list` from inside its own body is allowed and takes effect after the current render pass.

### 5.4 Assignment and handlers

**C-14** Assignment (`=`, `+=`, …) and sequences (`;`) are only valid in **handler context**: an `on*` attribute value, an arrow function body, or a `fn` body. Using them in `var`/`let` initializers, `if` conditions, `for` sources, or `{}` prose interpolations is a compile error.
**C-15** Assignment targets are `ident`, `expr.ident`, or `expr[e]`. The root of the target must resolve to a `var`, a `prop`, or a `for` item. Assigning to a `let`, `fn`, or global is a compile error.
**C-16** `on*` attribute expressions are **lazily wrapped**: `onTap={coins.push({heads:true})}` compiles to `() => coins.push(…)`. If the expression is already a function value (identifier or arrow), it is passed as-is and receives the event as its first argument. Rule: if the expression's top-level form is an identifier, member access, or arrow, pass it through; otherwise wrap.
**C-17** Within a handler, all signal writes are batched; effects run once after the handler returns (or, for async handlers, at each `await` boundary and at completion).
**C-18** `await` is valid only in an `async fn` body, an `on*` handler expression, or an arrow function marked `async`. Handlers are implicitly async. Elsewhere it is E016. `return` outside a `fn` body is E017.

### 5.6 Imperative intrinsics

These exist so that components like animations and parsers can be written without host globals. Each has a defined behavior in the build-time evaluator (section 12) so that a page using them still builds.

| Intrinsic | Signature | Client behavior | Build-time (evaluator) behavior |
|---|---|---|---|
| `try(e, f)` | expression form | Evaluate `e`; if it throws, result is `f` — or `f(err)` if `f` is a function. `f` is evaluated only on failure. | Same. |
| `await next()` | `() => Promise<void>` | Resolves after pending effects have flushed and the DOM reflects all writes so far. | Resolves immediately. |
| `await after(ms)` | `(number) => Promise<void>` | Resolves after `ms` milliseconds. | Never resolves; the awaiting function is abandoned after the page's synchronous render. |
| `measure(node, rel?)` | `(Node, Node?) => {x,y,w,h}` | Bounding rect of `node`, relative to `rel` (or the viewport). Forces layout. | Returns `{x:0,y:0,w:0,h:0}`. |
| `env` | object | `env.reducedMotion` (bool), `env.client` (true), `env.dev` (bool), `env.touch` (bool). | `env.client` is false; other flags false. |
| `ref={x}` | attribute | Assigns the DOM node to `var x` after mount; `null` after unmount. Node methods (`querySelector`, `focus`, …) are permitted. | `x` stays `null`. |

**C-19** Inside a `let`, `try` still tracks every signal read before the throw, so a computed such as `let parsed = try(JSON.parse(text), null)` re-evaluates when `text` changes.
**C-20** A `var` written from an async function after an `await` behaves like a handler write: batched, flushed at the next boundary. Guard against stale continuations with a token (see Appendix A); the runtime does not cancel promises when a component unmounts, but writes to signals of an unmounted component are ignored with a dev warning.
**C-21** `measure` on a node that is not mounted throws; wrap in `try` or call after `await next()`.

### 5.5 Values

Mark values are JS values. Strings, numbers, booleans, null, undefined, arrays, plain objects, functions. No classes. Dates are permitted via `Date`. The proxy wrapping (C-5) is transparent to `==` between two references to the same underlying object.

---

## 6. Tags

### 6.1 HTML vs. component

**T-1** Lowercase tag names are HTML elements, emitted as-is. Any element in the HTML5 spec is allowed; unknown lowercase names are passed through with a warning.
**T-2** Capitalized names resolve to components (S-3) or built-ins (section 9). Unresolved names are a compile error.
**T-3** Void HTML elements (`img`, `br`, `input`, `hr`, `meta`, `link`) must be self-closing or have no close tag. Components are always either self-closing or explicitly closed.

### 6.2 Attributes

**T-4** `name="literal"` is a static string. `name={expr}` is reactive. `name` alone is `true`.
**T-5** `name={expr} if cond` renders the attribute only while `cond` is truthy. For `class` specifically, multiple `class` attributes on one tag are allowed and their truthy values are joined with spaces: `<a class="link" class="current" if isCurrent(s)>`.
**T-6** On HTML elements, `class` and `style` accept strings; `style` also accepts an object `{color: "red"}` (camelCase keys). Boolean attributes (`disabled`, `checked`, `hidden`, …) are present iff the value is truthy.
**T-7** On HTML elements, `on*` attributes attach DOM listeners for the event named by lowercasing the remainder: `onClick` → `click`, `onKeydown` → `keydown`. `onTap` is an alias for `click` everywhere.
**T-8** On components, attributes become props. Unknown props are a compile error (props are statically known from the component's `prop` lines). Attribute names are case-sensitive.
**T-9** `ref={x}` on an HTML element assigns the DOM node to `var x` after mount. (Escape hatch; the only way to touch the DOM.)

### 6.3 Children and slots

**T-10** Content between an open and close tag is the element's children. For components it is delivered to `<slot />`.
**T-11** `<slot />` in a component renders the caller's children or nothing. `<slot name="x" />` renders children the caller marked `<Fragment slot="x">…</Fragment>`. A component may have one unnamed and any number of named slots.
**T-12** Slot content is evaluated in the **caller's** scope. A component cannot pass data back into slot content in 0.1 (no scoped slots).

### 6.4 Bindings

**T-13** `name=$path` establishes a two-way binding to prop `name`. It compiles to `name={path} onNameChange={v => path = v}` where `NameChange` is `name` with its first letter uppercased plus `Change`. The component receiving it must declare `prop name` and should declare `prop onNameChange = {}` (a no-op default) so it works uncontrolled.
**T-13a** Path segments may be `.ident` or `[expr]`: `value=$a[i][j]`, `$rows[cursor].name`. Index expressions are evaluated on every read and every write (they are not captured at bind time), so a binding whose index is a `var` follows that `var` reactively.
**T-13b** Bindings are syntactic. They exist only as attributes; a path cannot be stored in a variable or passed as a value. A first-class reference type is deferred (section 17).
**T-14** `$path` alone (no `name=`) binds a prop whose name is the **last `.ident` segment** of the path: `$theta` → `theta=$theta`; `$coin.heads` → `heads=$coin.heads`. If the last segment is `[expr]`, shorthand is not allowed (E019); write `name=$path`.
**T-15** The root of `path` must be a `var`, a `prop`, or a `for` item (this is how bindings chain upward through several components). Binding a `let` is a compile error.
**T-16** On HTML elements, `value=$x` binds `input`, `textarea`, `select` via the `input` event; `checked=$x` binds checkboxes/radios via `change`. `value` is coerced with `Number()` when the input has `type="number"` or `type="range"`.
**T-17** Assigning to a prop inside a component writes the prop's signal locally **and**, if the caller bound it with `$`, calls `onNameChange(newValue)`. The caller's echo of the same value is a no-op (R-6). If the caller passed a plain expression instead, the local value stands until the caller's expression next changes, at which point the caller's value wins. This is how one component serves both controlled (`<X $v />`, `<X v={expr} />`) and uncontrolled (`<X />`) use with no extra code.

---

### 6.5 Styles

**T-22** A document may contain one `<style>` block (L-13). Its rules are scoped to elements rendered by that document: the compiler rewrites each selector to add a per-document attribute (`[data-mk-Xyz]`) and stamps that attribute on every HTML element the document emits. Elements emitted by child components or slot content are not matched.
**T-23** `:global(sel)` inside a selector opts that part out of scoping. `<style global>` disables scoping for the whole block (intended for `_site.mark`).
**T-24** Keyframes and CSS custom properties are not renamed. `@keyframes` names are therefore global; prefix them.
**T-25** Style blocks are emitted once per document, not per instance, into a single stylesheet (`_mk/mark.css`) at build time; in SPA mode styles for lazily loaded documents are injected into `<head>` on first mount (SPA mode). Order is: `_site.mark`, layouts outer→inner, then components in first-use order.
**T-26** `style={obj}` (T-6) accepts keys beginning with `--` and sets them as custom properties. Combined with `<style>` this is the intended way to drive per-instance animation parameters.

## 7. Components

### 7.1 API surface

A component's public API is exactly its `prop` declarations (and its slots). Everything else is private.

```
// components/Counter.mark
prop count = 0
prop onCountChange = {}
prop step = 1
prop label = "Count"

<div class="counter">
<span>{label}: {count}</span>
<button onTap={count -= step}>−</button>
<button onTap={count += step}>+</button>
<slot />
</div>
```

All three call forms work with that one definition (T-17):

| Call | Behavior |
|---|---|
| `<Counter />` | Uncontrolled. Starts at 0, keeps its own count. |
| `<Counter count={start} />` | Seeded. Keeps its own count until `start` changes, then resets to it. |
| `<Counter $n />` | Controlled. Every click calls `onCountChange`; the parent's `n` and the counter agree. |

### 7.2 Conventions

- Declare `prop onXChange = {}` for any prop you expect callers to bind. Without it, `$x` at a call site is E008.
- A component that must *reject* a value (clamping, validation) does so in the handler before assigning: `onTap={count = Math.min(count + step, max)}`. There is no separate "controlled" mode to write.
- Props with object or array defaults get a fresh copy per instance (C-7 evaluates the default per instance).

### 7.3 Lifecycle

**T-20** A component instance is created when its tag mounts and destroyed when the tag's enclosing `if`/`for`/route unmounts. Declarations run once at creation. There are no lifecycle hooks in 0.1 except `onMount={fn}` and `onUnmount={fn}`, which are valid on any tag and receive the DOM node (HTML) or nothing (component).

### 7.4 Exports

**T-21** A component may declare `export let name = e` or `export fn`. Other documents access these as `ComponentName.name`. Exports are evaluated once at module load, cannot read props or `var`s, and are how shared constants and helper functions are published. `export var` is a compile error (no shared mutable state via modules — put it in `_site.mark` instead).

---

## 8. Site & Page

### 8.1 `Site` (build-time, read-only, identical on every page)

```ts
interface Site {
  base: string;                    // config.base
  pages: PageInfo[];               // all routable pages, sorted by path
  sections: Record<string, Section>;
  nav: PageInfo[];                 // pages with `order`, sorted by order then title
  data: Record<string, any>;       // _data/*.json|yaml by file stem
  page(path: string): PageInfo | undefined;
  under(path: string): PageInfo[]; // pages whose path starts with `path + "/"`
}
interface PageInfo {
  path: string;                    // "/blog/coins"
  dir: string;                     // "/blog"
  file: string;                    // "blog/coins.mark"
  title: string;                   // prop title, else derived from filename ("coins" → "Coins")
  section?: string;
  order?: number;
  date?: string;                   // ISO date if prop date given
  tags: string[];                  // prop tags, default []
  props: Record<string, any>;      // all literal props of the page
  excerpt: string;                 // first prose paragraph, plain text
  dynamic: boolean;
}
interface Section { name: string; path: string; pages: PageInfo[]; }
```

**P-1** `Site.sections` groups pages by their `section` prop. A section's `path` is the shortest path among its pages, or the directory containing them if they share one. Pages with no `section` are not in any section.
**P-2** `Site.pages` for a dynamic page lists one `PageInfo` per entry in `prop paths` (S-11), with `props` merged from the param object; if `paths` is absent, the dynamic page appears once with `dynamic: true` and its template path (`/blog/[slug]`).
**P-3** `Site.data` values are parsed JSON/YAML, deeply frozen.

### 8.2 `Page` (runtime)

```ts
interface Page {
  path: string;                    // var: assigning navigates (P-6)
  params: Record<string, string>;
  query: Record<string, string>;
  hash: string;
  info: PageInfo;                  // Site.page(Page.path) resolved for dynamic routes
  title: string;                   // == info.title; assignable, updates document.title
  layouts: string[];               // e.g. ["_site.mark", "blog/_layout.mark"]
}
```

**P-4** By default `Page` is a **build-time constant** for each emitted page: `Page.path`, `params`, `info`, `title`, and `layouts` are known when the page is evaluated and the compiler folds expressions that depend on them (12.2). `Page.query` and `Page.hash` are the exception: they are only known in the browser, so reading them makes the enclosing subtree an island (8.7) with empty values at build time.
**P-5** `<a href>` is a plain link. `href` values starting with `/` are resolved against `Site.base`. In non-SPA mode, `Page.path = "/x"` inside a handler compiles to a full-page `location.assign`; `Page.replace` to `location.replace`; `Page.back()` to `history.back()`.
**P-6** *(SPA only, 8.6)* Same-origin, non-modifier, left-button clicks on `<a href>` are intercepted and become client-side navigations. `target="_blank"`, `download`, and a `native` attribute opt out.
**P-7** *(SPA only)* On navigation the layout chain is diffed: layouts common to old and new page keep their state; the page component and layouts not in the new chain are destroyed. `Page.*` are signals and any subtree reading them is an island.
**P-8** The build emits `dist/404.html` from `_404.mark` (rendered inside `_site.mark`) if present. Static hosts serve it for unknown paths. In SPA mode unknown paths render it client-side. `Page.info` is `undefined` there.

### 8.3 Page props (front matter)

**P-9** `prop` lines in a **page** are metadata, not inputs (nothing calls a page with props). They must appear before any prose or tag and their defaults must be literals (strings, numbers, booleans, arrays/objects of literals) so the site indexer can read them without executing code. Non-literal defaults in page props are a compile error.
**P-10** Recognized page props: `title`, `section`, `order`, `date` (ISO 8601 or `YYYY-MM-DD`), `tags`, `draft` (excluded from build unless `--drafts`), `paths` (S-11), `layout` (`false` to skip all layouts, or a component name to use instead of the chain). Any other props are user-defined and land in `PageInfo.props`.
**P-11** Layout `prop` lines follow component rules (C-7), not page rules. A layout receives no props from the router; it reads `Page`.

### 8.4 Document head

**P-12** A `<head>` tag may appear in any layout or page. Its children are hoisted into the HTML `<head>`; when several are present, inner ones come later (so pages can override `<title>` by emitting one). `<title>` is special-cased: the last one wins and it also sets `Page.title`. If no `<title>` is emitted, `Page.title` is used.
**P-13** Children of `<head>` are limited to `title`, `meta`, `link`, `style`, `script`, and interpolations.

### 8.5 A complete blog

```
// site/_site.mark
<head>
<meta charset="utf-8" />
<link rel="stylesheet" href="/style.css" />
<title>{Page.title} · My Blog</title>
</head>
<Nav />
<main>
<slot />
</main>
<footer>© {new Date().getFullYear()}</footer>
```

```
// site/components/Nav.mark
fn current(p) = Page.path == p.path || Page.path.startsWith(p.path + "/")
<nav>
<a href="/" class="brand">My Blog</a>
for p in Site.nav {
<a href={p.path} class="current" if current(p)>{p.title}</a>
}
</nav>
```

```
// site/blog/_layout.mark
<article class="post">
<slot />
</article>
<aside>
### More posts
for p in Site.under("/blog") key p.path {
if p.path != Page.path {
- [{p.title}]({p.path})
}
}
</aside>
```

```
// site/blog/index.mark
prop title = "Blog"
prop order = 2

# Posts

for p in Site.under("/blog").filter(p => p.date).sort((a,b) => b.date.localeCompare(a.date)) key p.path {
## [{p.title}]({p.path})
<small>{p.date}</small> — {p.excerpt}
}
```

```
// site/blog/coins.mark
prop title = "A posterior for coins"
prop section = "blog"
prop date = "2026-09-01"
prop tags = ["bayes", "interactive"]

Here's my posterior probability calculator! Play around with it.

## $\theta$

var theta = 0.5
<Slider value=$theta min={0} max={1} step={0.01} />
if theta == 0.5 {
This is a fair coin!
}

## $X$

var coins = []
for coin in coins {
<CoinBox $coin.heads />
}
<Stepper onTap={coins.push({heads: true})} />

## The likelihood $p(X \mid \theta)$

let h = coins.filter(c => c.heads).length
let lik = theta ** h * (1 - theta) ** (coins.length - h)

$$p(X \mid \theta) = \theta^{ {h} }(1-\theta)^{ {coins.length - h} } = {lik.toFixed(4)}$$
```

Note the last line: interpolation inside math is allowed only via the double-brace-with-space form ` {expr} ` (see M-4), because bare `{}` is LaTeX grouping.

Build output for this project: every file is static HTML with inline MathML. Only `blog/coins/index.html` includes a `<script type="module">`, and it hydrates only the three interactive sections; the heading, first paragraph, nav, and aside are plain HTML that the script never touches.

### 8.6 SPA mode

Setting `config.spa: true` changes navigation from full page loads to in-document route changes. The trade: layout state and long-lived components (a media player, a scroll position) survive navigation, at the cost of shipping the runtime on every page and making every `Page`-dependent subtree an island. It exists for app-like sites; content sites should leave it off.

**P-14** In SPA mode, P-6 and P-7 apply, `Page` is reactive, and each page's compiled module is fetched on first navigation to it. The build still emits full static HTML for every page (so deep links and no-JS visitors work); the runtime adopts the initial page's DOM and takes over from there.
**P-15** In SPA mode the same `Site` object is shared across navigations. It is still immutable.

### 8.7 Islands

The compiler decides, per node, whether it can change after load. Only those nodes get JavaScript.

**I-1** A node is **dynamic** if any expression it evaluates (attributes, interpolations, `if` condition, `for` source, `key`) transitively reads a `var`, a `ref`, `env.client`, `Page.query`, `Page.hash`, or (SPA mode) any `Page.*`; or if it has an `on*`, `onMount`, or `onUnmount` attribute; or if it is a component whose instance is dynamic; or if any child is dynamic.
**I-2** A `let` is dynamic iff its initializer is. A `prop` is dynamic iff the caller passed a dynamic expression or a binding.
**I-3** A node that is not dynamic is **static**: it is evaluated at build time (12.2), emitted as HTML, and never referenced by emitted JavaScript.
**I-4** An **island** is a maximal dynamic node whose parent is static. The build wraps each island's HTML in an anchor comment pair `<!--mk:N-->…<!--/mk:N-->` and emits a hydration entry for it. Islands in the same document share that document's signals: `var`s live at document scope, so two islands reading the same `var` stay in sync.
**I-5** A page ships a `<script type="module">` iff it, its layouts, or any component it renders contains at least one island. Otherwise no script tag is emitted and the runtime is not referenced.
**I-6** Hydration adopts the island's existing DOM rather than re-rendering; `var` initializers re-run (they are pure by C-4), effects attach, and a mismatch between adopted DOM and expected structure is a dev warning followed by a re-render of that island only.
**I-7** Dynamic-ness is reported: `mark build --islands` prints each page with its island count and the `var`s that caused each. This is the main tool for keeping a content page JS-free.

---

## 9. Built-in Components

All built-ins are implemented in Mark on top of HTML elements and shipped with the runtime. Their source is part of the reference implementation and doubles as examples. Each is controlled via `$`.

| Component | Props | Notes |
|---|---|---|
| `Slider` | `value`, `onValueChange`, `min=0`, `max=1`, `step=0.01`, `label` | `<input type=range>` plus a live readout. |
| `Stepper` | `onTap`, `label="+"` | A button. Exists for parity with the motivating example. |
| `Button` | `onTap`, `disabled` | `<button>` with slot. |
| `Toggle` | `value`, `onValueChange`, `label` | Checkbox. |
| `Input` | `value`, `onValueChange`, `type="text"`, `placeholder` | Text/number input. |
| `Select` | `value`, `onValueChange`, `options` (array of `{value,label}` or strings) | |
| `Fragment` | `slot` | Groups children; used for named slots (T-11). |
| `Math` | `tex`, `display=false` | Programmatic KaTeX when the string is computed. |
| `Link` | `href`, `active` (class when current) | Wraps `<a>` with the P-5 current-path check. |

---

## 10. Prose

### 10.1 Markdown subset

**M-1** Required: ATX headings (`#`–`######`), paragraphs, `*em*`, `**strong**`, `` `code` ``, fenced code blocks with language info string, links `[t](u)`, images `![a](u)`, unordered/ordered lists with nesting, blockquotes, horizontal rules, hard breaks (two trailing spaces or `\`), inline HTML passthrough for tags not recognized as Mark tags (which, by L-2/L-9, is none — all `<x>` are Mark tags; so effectively raw HTML *is* Mark).
**M-2** Optional but recommended: GFM tables, task lists, strikethrough, footnotes, autolinks.
**M-3** Headings automatically get `id` attributes from a slug of their plain text; duplicates get `-2`, `-3`.
**M-4** Interpolation `{expr}` is replaced by the expression's value: strings and numbers as text (HTML-escaped), `null`/`undefined`/`false` as nothing, arrays joined with `""`, objects via `JSON.stringify`. Inside `$…$`/`$$…$$` interpolation requires ` {expr} ` — a space before `{` and after `}` — to disambiguate from LaTeX grouping; the result is substituted into the TeX source *before* rendering and re-renders reactively.
**M-5** Interpolations and inline tags are parsed **before** Markdown inline parsing, and their output is inserted as opaque nodes, so `{"*not em*"}` renders literally.
**M-6** Prose within a `for`/`if` body is a separate Markdown fragment per iteration/branch, but list items across iterations merge into one list if adjacent (so the `- [{p.title}]` example produces one `<ul>`).
**M-7** Code fences with info string `mark` are highlighted but never executed. There is no "live code block" feature; interactivity uses tags.

### 10.2 Math

**M-8** `$…$` renders inline KaTeX; `$$…$$` renders display mode. A `$` followed by whitespace, or a `$` preceded by a digit and followed by a digit (`$5 and $10`), is literal. `\$` is always a literal dollar sign.
**M-9** `$$` on its own line opens a display block ending at the next `$$` line (L-5). Everything between is TeX.
**M-10** Macros come from `config.katex.macros` and apply in both output modes. Rendering errors display the raw TeX in a `.mk-math-error` span in dev and prod (never throw).
**M-11** Output mode `mathml` (default): the build converts TeX to MathML and inlines it; no JS, no CSS, no fonts are required. Output mode `katex`: the build emits KaTeX's HTML output and a link to the KaTeX stylesheet. Either way static math is visible without JS.
**M-12** Math containing an interpolation that is dynamic (I-1) is an island. It ships a client-side renderer matching the output mode and re-renders on change. Math with only static interpolations is folded at build time like any other expression.
**M-13** The two renderers must agree on the supported TeX subset; a construct supported by one but not the other is a compile warning listing the construct, so a page does not render differently before and after hydration.

---

## 11. Reactivity Model

**R-1** The runtime implements signals, computeds, and effects with automatic dependency tracking (push-based invalidation, pull-based evaluation; the standard "glitch-free" topological scheme). A computed reading nothing reactive is evaluated once.
**R-2** Every `var` is a signal; every `let` is a computed; every reactive attribute, interpolation, `if` condition, and `for` source is an effect.
**R-3** Writes are synchronous in effect on subsequent reads within the same handler, but DOM effects are flushed once per handler/microtask (C-17). Tests may call `flush()` to force.
**R-4** Deep reactivity (C-5): reading `a.b.c` subscribes to the `c` key of that specific inner object; `push`/`splice`/index assignment on arrays notifies `length` and the affected indices; `for` bodies subscribe to the array's iteration key, so unrelated element mutations do not re-run the loop, only the affected body.
**R-5** Cycle detection: a computed that reads itself (transitively) throws `CycleError` naming the declarations.
**R-6** Equality: a signal write with a `===`-equal value is a no-op.
**R-7** Effects are disposed when their owning block unmounts; no leaks across navigation (P-7).

---

## 12. Compiler, Evaluator & Runtime Architecture

```
.mark source ──parse──▶ AST ──check──▶ typed AST ──island analysis──▶ AST + dynamic marks
                                                                         │
_data/*, tree walk ──index──▶ Site ──────────────────────────────────────┤
                                                                         ▼
                                    ┌────────── build-time evaluator ────────────┐
                                    │ evaluates every page once with initial     │
                                    │ values; emits HTML, MathML, mark.css       │
                                    └───────────┬──────────────────┬─────────────┘
                                                ▼                  ▼
                                     dist/**/index.html    dist/_mk/<doc>.js  (islands only)
                                                                   +
                                                           dist/_mk/runtime.js (islands only)
```

### 12.1 Pipeline

**A-1** The parser produces the JSON AST of section 13 and is usable standalone (`mark parse <file>`), because tests target it.
**A-2** The checker resolves component names, validates props (T-8), scope (C-1..C-3), assignment contexts (C-14/15), page prop literalness (P-9), and the evaluator whitelist (12.2). Errors carry `{file, line, col, code, message}`.
**A-3** Island analysis marks nodes per 8.7.
**A-4** The **evaluator** executes each page at build time and produces its HTML. It is an interpreter for the Mark expression language written in the compiler's host language; it does not require a JavaScript engine. It evaluates static and dynamic nodes alike (dynamic nodes get their initial HTML this way), applying the build-time column of the 5.6 intrinsics table.
**A-5** The **emitter** produces one ES module per document that contains at least one island. The module includes code only for dynamic nodes and the declarations they depend on; static nodes are not represented. Generated code must not use `eval`/`new Function`.
**A-6** The **runtime** (`runtime.js`) exposes `signal`, `computed`, `effect`, `flush`, `hydrate`, and, in SPA mode, `navigate`, `Site`, `Page`. It is under 15 kB min+gz, excluding the math renderer, which is a separate chunk loaded only by pages with dynamic math.
**A-7** `mark build` writes `dist/` as described in the diagram, plus `static/**` copied verbatim, non-source files under the root copied to the same relative path (so assets can sit next to the page that uses them; `components/` is skipped), and `404.html` (P-8). `mark dev` serves the same output with live reload; on change it recompiles the affected document and its dependents.

### 12.2 The evaluator and its whitelist

The evaluator implements the expression grammar of section 4 with JavaScript semantics for the constructs it covers: number and string coercion in `+`, truthiness, `==` as strict equality, short-circuit `&&`/`||`, optional chaining, and arrow closures. It must be observably identical to running the same expression in a browser, because the initial HTML it produces is what the client later adopts (I-6).

**V-1** The following host members are available in expressions and must be implemented natively by the evaluator. Using any other member is E021.

| Global | Members |
|---|---|
| `Math` | `abs ceil floor round trunc sign sqrt cbrt pow exp log log2 log10 min max hypot sin cos tan asin acos atan atan2 PI E random` (`random` is E022 outside a dynamic context — its value is not reproducible) |
| `Number` | `isFinite isInteger isNaN parseFloat parseInt MAX_SAFE_INTEGER EPSILON`; method `toFixed toPrecision toString` |
| `String` | methods `length slice substring indexOf includes startsWith endsWith split trim trimStart trimEnd toUpperCase toLowerCase replace replaceAll repeat padStart padEnd charAt at localeCompare` |
| `Array` | `Array.isArray Array.from`; methods `length map filter reduce reduceRight find findIndex findLast some every includes indexOf join slice concat flat flatMap at keys entries sort toSorted reverse toReversed push pop shift unshift splice` (mutators are E006 outside handler context, like assignment) |
| `Object` | `keys values entries fromEntries assign freeze` |
| `JSON` | `parse stringify` |
| `Date` | `new Date(...)`, `Date.now` (E022 outside dynamic context), `getFullYear getMonth getDate getDay getHours getMinutes toISOString toLocaleDateString` |
| `console` | `log warn error` (no-ops in the evaluator's output; printed to the build log) |

**V-2** `replace`/`split` accept string patterns only in 0.3; regular expressions are not in the language.
**V-3** `sort`/`toSorted`/`localeCompare` must use the same collation at build and in the browser: the evaluator uses code-point ordering and the runtime patches `localeCompare` to match. `toLocaleDateString` is fixed to `en-US` unless `config.locale` is set, and the runtime is configured with the same locale.
**V-4** Non-determinism (`Math.random`, `Date.now`, `new Date()` with no arguments) is allowed only in expressions that are dynamic (I-1) and only in handler or `var` initializer context; the evaluator substitutes `0` / the build timestamp and the island re-runs the initializer on hydration. In a static expression it is E022.
**V-5** The evaluator halts a page after 10 million operations or 10 s and reports E023 (likely a runaway `for` or recursive `fn`). In the browser the operation count restarts at every event handler and binding write, so the limit bounds one turn, not the whole session.

### 12.3 Output contract

For each emitted page:

- `<!doctype html>`, `<html lang>` from `config.lang` (default `en`), hoisted `<head>` (P-12), `<link rel="stylesheet" href="/_mk/mark.css">` if any document has a `<style>`.
- Body HTML from the evaluator, with island anchors per I-4.
- If the page has islands: `<script type="module" src="/_mk/<page>.js">` where that module imports `runtime.js`, the document modules it needs, and hydrates each island by anchor id.
- Nothing else. No inline scripts, no analytics, no framework markers on static nodes.

## 13. AST

```ts
type Node =
  | { t: "var";   name: string; init?: Expr; line: number }
  | { t: "let";   name: string; init: Expr;  line: number }
  | { t: "prop";  name: string; init?: Expr; line: number }
  | { t: "fn";    name: string; params: string[]; async: boolean; body: Expr | Stmt[]; line: number }
  | { t: "style"; css: string; global: boolean; line: number }
  | { t: "if";    cond: Expr; then: Node[]; else?: Node[] | { t: "if", ... }; line: number }
  | { t: "for";   item: string; index?: string; src: Expr; key?: Expr; body: Node[]; line: number }
  | { t: "tag";   name: string; kind: "html" | "comp"; attrs: Attr[]; children: Node[]; selfClose: boolean; line: number }
  | { t: "prose"; md: string; parts: ProsePart[]; line: number }   // md is the raw text with placeholders
  | { t: "head";  children: Node[]; line: number }

type Attr =
  | { k: "static";  name: string; value: string | true; if?: Expr }
  | { k: "dyn";     name: string; value: Expr; if?: Expr }
  | { k: "bind";    name: string; path: (string | Expr)[] }   // string = ".ident", Expr = "[expr]"; path[0] is always a string
  | { k: "event";   name: string; handler: Expr; wrap: boolean }   // wrap per C-16

type ProsePart =
  | { p: "text"; s: string }
  | { p: "interp"; expr: Expr; inMath: boolean }
  | { p: "tag"; node: Node }

// Expr is an ESTree subset: Literal, Identifier, MemberExpression (computed/optional),
// CallExpression, ArrayExpression, ObjectExpression, ArrowFunctionExpression (async flag),
// UnaryExpression, BinaryExpression, LogicalExpression, ConditionalExpression,
// AssignmentExpression, SequenceExpression, AwaitExpression, plus one non-ESTree node:
//   { type: "TryExpression", expr: Expr, fallback: Expr }
//
// Stmt (fn bodies):
//   { s: "let" | "var"; name: string; init?: Expr }
//   { s: "if"; cond: Expr; then: Stmt[]; else?: Stmt[] | IfStmt }
//   { s: "for"; item: string; index?: string; src: Expr; body: Stmt[] }
//   { s: "return"; value?: Expr }
//   { s: "expr"; expr: Expr }
```

**A-8** In `prose.md`, each interpolation or inline tag is replaced by the placeholder `\u0000N\u0000` where N is the index into `parts`, so the Markdown parser can run on `md` and the renderer substitutes afterward.

---

## 14. Errors & Diagnostics

Error codes. Each is a compile error unless noted.

| Code | Rule | Message template |
|---|---|---|
| E001 | L-6 | `else` must follow `}` on the same line |
| E002 | G-3 | Mismatched closing tag `</X>` for `<Y>` opened at line N |
| E003 | C-1 | `name` is used before its declaration (line N) |
| E004 | C-3 | `name` is already declared at line N |
| E005 | C-6/C-15 | Cannot assign to `let`/`prop`/`fn`/global `name` |
| E006 | C-14 | Assignment is only allowed inside handlers and functions |
| E007 | T-2 | Unknown component `<X>` |
| E008 | T-8 | Component `X` has no prop `y` (available: …) |
| E009 | T-15 | Cannot bind `$path`: root `name` is not a `var`, loop item, or bound prop |
| E010 | P-9 | Page prop `name` must have a literal default |
| E011 | S-6 | Path `/x` is produced by both `a.mark` and `b.mark` |
| E013 | T-21 | `export var` is not allowed |
| E014 | T-3 | Void element `<img>` cannot have children |
| W004 | G-2 | Expression statement has no effect |
| E016 | C-18 | `await` is only allowed in `async fn`, handlers, and async arrows |
| E017 | C-18 | `return` outside a function body |
| E018 | G-4 | `try` takes exactly two operands: `try(expr, fallback)` |
| E019 | T-14 | `$` shorthand cannot end in `[…]`; give the prop a name |
| E020 | L-13 | `<style>` must be at document top level; at most one per document |
| E021 | V-1 | `X.y` is not available in Mark expressions |
| E022 | V-4 | `Math.random`/`Date.now` cannot be used in static content; use it in a `var` or handler |
| E023 | V-5 | Page evaluation exceeded the operation limit |
| E024 | S-11 | Dynamic page `[x].mark` has no `prop paths` and SPA mode is off |
| W001 | S-8 | Layout has no `<slot />` |
| W002 | C-3 | `name` shadows outer declaration |
| W003 | T-1 | Unknown HTML element `<x>` |
| RT01 | C-11 | `for` source is not an array (got `type`) — runtime |
| RT02 | C-12 | Duplicate key `k` in `for` at line N — runtime, dev only |
| RT03 | R-5 | Cycle: `a` → `b` → `a` — runtime |
| RT04 | C-7 | Required prop `p` of `<X>` not provided — runtime, dev only |

**D-1** Dev mode renders compile errors as an overlay and runtime errors as an inline `<div class="mark-error">` replacing the failing block, never blanking the page. Prod mode logs and renders nothing for the failing block.

---

## 15. Test Suite

Tests are organized in three tiers. The reference test runner reads `tests/**/*.test.json`.

### 15.1 Parser tests (`parse`)

Format: `{ "name", "src", "ast" }` or `{ "name", "src", "error": "E00N" }`. `ast` is compared structurally; `line` fields are checked, `Expr` nodes are compared as ESTree JSON.

**parse-01 · prose only**
```
src: "# Hello\n\nSome *text*.\n"
ast: [
  {"t":"prose","md":"# Hello\n\nSome *text*.\n","parts":[],"line":1}
]
```

**parse-02 · keyword line is code, escaped keyword is prose**
```
src: "var x = 1\n\\for the record\n"
ast: [
  {"t":"var","name":"x","init":{"type":"Literal","value":1},"line":1},
  {"t":"prose","md":"for the record\n","parts":[],"line":2}
]
```

**parse-03 · interpolation placeholder**
```
src: "Value is {x + 1}.\n"
ast: [
  {"t":"prose","md":"Value is \u00000\u0000.\n",
   "parts":[{"p":"interp","expr":{"type":"BinaryExpression","operator":"+",
             "left":{"type":"Identifier","name":"x"},"right":{"type":"Literal","value":1}},"inMath":false}],
   "line":1}
]
```

**parse-04 · escaped braces and code spans are literal**
```
src: "Literal \\{x\\} and `{y}`\n"
ast: [{"t":"prose","md":"Literal {x} and `{y}`\n","parts":[],"line":1}]
```

**parse-05 · if / else if / else**
```
src: "if a {\nA\n} else if b {\nB\n} else {\nC\n}\n"
ast: [{"t":"if","cond":{"type":"Identifier","name":"a"},
       "then":[{"t":"prose","md":"A\n","parts":[],"line":2}],
       "else":{"t":"if","cond":{"type":"Identifier","name":"b"},
               "then":[{"t":"prose","md":"B\n","parts":[],"line":4}],
               "else":[{"t":"prose","md":"C\n","parts":[],"line":6}],"line":3},
       "line":1}]
```

**parse-06 · else on its own line is an error**
```
src: "if a {\nA\n}\nelse {\nB\n}\n"
error: "E001"
```

**parse-07 · for with index and key**
```
src: "for p, i in Site.pages key p.path {\n- {p.title}\n}\n"
ast: [{"t":"for","item":"p","index":"i",
       "src":{"type":"MemberExpression","object":{"type":"Identifier","name":"Site"},"property":{"type":"Identifier","name":"pages"},"computed":false},
       "key":{"type":"MemberExpression","object":{"type":"Identifier","name":"p"},"property":{"type":"Identifier","name":"path"},"computed":false},
       "body":[{"t":"prose","md":"- \u00000\u0000\n","parts":[{"p":"interp","expr":{"type":"MemberExpression","object":{"type":"Identifier","name":"p"},"property":{"type":"Identifier","name":"title"},"computed":false},"inMath":false}],"line":2}],
       "line":1}]
```

**parse-08 · tag attributes: static, dynamic, conditional, bind shorthand, bind named, event**
```
src: "<a href={s.path} class=\"link\" class=\"current\" if cur(s) value=$theta $coin.heads onTap={n += 1} onKeydown={handle}>x</a>\n"
ast: [{"t":"tag","name":"a","kind":"html","selfClose":false,"line":1,
  "attrs":[
    {"k":"dyn","name":"href","value":{"type":"MemberExpression","object":{"type":"Identifier","name":"s"},"property":{"type":"Identifier","name":"path"},"computed":false}},
    {"k":"static","name":"class","value":"link"},
    {"k":"static","name":"class","value":"current","if":{"type":"CallExpression","callee":{"type":"Identifier","name":"cur"},"arguments":[{"type":"Identifier","name":"s"}]}},
    {"k":"bind","name":"value","path":["theta"]},
    {"k":"bind","name":"heads","path":["coin","heads"]},
    {"k":"event","name":"onTap","handler":{"type":"AssignmentExpression","operator":"+=","left":{"type":"Identifier","name":"n"},"right":{"type":"Literal","value":1}},"wrap":true},
    {"k":"event","name":"onKeydown","handler":{"type":"Identifier","name":"handle"},"wrap":false}
  ],
  "children":[{"t":"prose","md":"x","parts":[],"line":1}]}]
```

**parse-09 · multi-line tag (L-7)**
```
src: "<Slider\n  value=$theta\n  min={0}\n/>\n"
ast: [{"t":"tag","name":"Slider","kind":"comp","selfClose":true,"line":1,
       "attrs":[{"k":"bind","name":"value","path":["theta"]},{"k":"dyn","name":"min","value":{"type":"Literal","value":0}}],"children":[]}]
```

**parse-10 · mismatched close tag**
```
src: "<div>\nhi\n</span>\n"
error: "E002"
```

**parse-11 · fenced code is opaque**
```
src: "```js\nfor (;;) {}\nvar x\n```\n"
ast: [{"t":"prose","md":"```js\nfor (;;) {}\nvar x\n```\n","parts":[],"line":1}]
```

**parse-12 · display math block is opaque; inline math interpolation**
```
src: "$$\n\\sum_{i} x_i\n$$\n\nSo $p = {lik} $ here.\n"
ast: [
  {"t":"prose","md":"$$\n\\sum_{i} x_i\n$$\n\nSo $p = \u00000\u0000 $ here.\n",
   "parts":[{"p":"interp","expr":{"type":"Identifier","name":"lik"},"inMath":true}],"line":1}
]
```

**parse-13 · fn forms**
```
src: "fn sq(x) = x * x\nfn f(a, b) {\na = a + 1; b\n}\n"
ast: [
  {"t":"fn","name":"sq","params":["x"],"body":{"type":"BinaryExpression","operator":"*","left":{"type":"Identifier","name":"x"},"right":{"type":"Identifier","name":"x"}},"line":1},
  {"t":"fn","name":"f","params":["a","b"],"body":[{"type":"SequenceExpression","expressions":[
     {"type":"AssignmentExpression","operator":"=","left":{"type":"Identifier","name":"a"},"right":{"type":"BinaryExpression","operator":"+","left":{"type":"Identifier","name":"a"},"right":{"type":"Literal","value":1}}},
     {"type":"Identifier","name":"b"}]}],"line":2}
]
```

**parse-14 · head block**
```
src: "<head>\n<title>{Page.title} · Blog</title>\n</head>\n"
ast: [{"t":"head","line":1,"children":[
  {"t":"tag","name":"title","kind":"html","selfClose":false,"line":2,"attrs":[],
   "children":[{"t":"prose","md":"\u00000\u0000 · Blog","parts":[{"p":"interp","expr":{"type":"MemberExpression","object":{"type":"Identifier","name":"Page"},"property":{"type":"Identifier","name":"title"},"computed":false},"inMath":false}],"line":2}]}]}]
```

**parse-15 · object literal directly inside braces (G-2)**
```
src: "<div style={{color: \"red\"}} />\n{{a: 1}.a}\n"
ast: [
  {"t":"tag","name":"div","kind":"html","selfClose":true,"line":1,"children":[],
   "attrs":[{"k":"dyn","name":"style","value":{"type":"ObjectExpression","properties":[{"type":"Property","key":{"type":"Identifier","name":"color"},"value":{"type":"Literal","value":"red"},"computed":false,"shorthand":false,"kind":"init"}]}}]},
  {"t":"prose","md":"\u00000\u0000\n","line":2,
   "parts":[{"p":"interp","inMath":false,"expr":{"type":"MemberExpression","computed":false,
     "object":{"type":"ObjectExpression","properties":[{"type":"Property","key":{"type":"Identifier","name":"a"},"value":{"type":"Literal","value":1},"computed":false,"shorthand":false,"kind":"init"}]},
     "property":{"type":"Identifier","name":"a"}}}]}
]
```

**parse-16 · try expression, lazy operands**
```
src: "let p = try(JSON.parse(t), e => null)\n"
ast: [{"t":"let","name":"p","line":1,"init":{"type":"TryExpression",
  "expr":{"type":"CallExpression","callee":{"type":"MemberExpression","object":{"type":"Identifier","name":"JSON"},"property":{"type":"Identifier","name":"parse"},"computed":false},"arguments":[{"type":"Identifier","name":"t"}]},
  "fallback":{"type":"ArrowFunctionExpression","async":false,"params":[{"type":"Identifier","name":"e"}],"body":{"type":"Literal","value":null},"expression":true}}}]
```
`src: "let p = try(x)\n"` → error `E018`. `src: "var try = 1\n"` → syntax error.

**parse-17 · bind path with computed members**
```
src: "<input value=$a[i][j] />\n<Cell $rows[k].name />\n"
ast: [
  {"t":"tag","name":"input","kind":"html","selfClose":true,"line":1,"children":[],
   "attrs":[{"k":"bind","name":"value","path":["a",{"type":"Identifier","name":"i"},{"type":"Identifier","name":"j"}]}]},
  {"t":"tag","name":"Cell","kind":"comp","selfClose":true,"line":2,"children":[],
   "attrs":[{"k":"bind","name":"name","path":["rows",{"type":"Identifier","name":"k"},"name"]}]}
]
```
`src: "<Cell $rows[k] />\n"` → error `E019`.

**parse-18 · block fn with statements, async, await**
```
src: "async fn go(n) {\nlet t = (id += 1)\nawait next()\nif t != id {\nreturn\n}\nfor x in xs {\ntotal += x\n}\nreturn total\n}\n"
ast: [{"t":"fn","name":"go","params":["n"],"async":true,"line":1,"body":[
  {"s":"let","name":"t","init":{"type":"AssignmentExpression","operator":"+=","left":{"type":"Identifier","name":"id"},"right":{"type":"Literal","value":1}}},
  {"s":"expr","expr":{"type":"AwaitExpression","argument":{"type":"CallExpression","callee":{"type":"Identifier","name":"next"},"arguments":[]}}},
  {"s":"if","cond":{"type":"BinaryExpression","operator":"!=","left":{"type":"Identifier","name":"t"},"right":{"type":"Identifier","name":"id"}},"then":[{"s":"return"}]},
  {"s":"for","item":"x","src":{"type":"Identifier","name":"xs"},"body":[{"s":"expr","expr":{"type":"AssignmentExpression","operator":"+=","left":{"type":"Identifier","name":"total"},"right":{"type":"Identifier","name":"x"}}}]},
  {"s":"return","value":{"type":"Identifier","name":"total"}}
]}]
```
A prose line inside the body (`src: "fn f() {\nhello\n}\n"`) is a syntax error (L-12).

**parse-19 · style block is opaque**
```
src: "<style>\n.x { color: red }\nfor { }\n</style>\n"
ast: [{"t":"style","css":".x { color: red }\nfor { }\n","global":false,"line":1}]
```
`src: "if a {\n<style>\n</style>\n}\n"` → error `E020`.

### 15.2 Checker tests (`check`)

Format: `{ "name", "files": { path: src }, "errors": ["E00N@file:line", …] }`. Empty `errors` means the project compiles.

**check-01 · use before declare** — `files: {"site/index.mark": "{x}\nvar x = 1\n"}` → `["E003@site/index.mark:1"]`
**check-02 · assign to let** — `"var a = 1\nlet b = a\n<button onTap={b = 2} />\n"` → `["E005@site/index.mark:3"]`
**check-03 · assignment in let initializer** — `"var a = 1\nlet b = (a = 2)\n"` → `["E006@site/index.mark:2"]`
**check-04 · unknown component** — `"<Nope />\n"` → `["E007@site/index.mark:1"]`
**check-05 · unknown prop** — files `site/components/Box.mark: "prop n = 0\n<div>{n}</div>\n"`, `site/index.mark: "<Box m={1} />\n"` → `["E008@site/index.mark:1"]`
**check-06 · bind a let** — `"var a = 1\nlet b = a\n<Input value=$b />\n"` → `["E009@site/index.mark:3"]`; binding a prop is fine: `X.mark: "prop v = 0\nprop onVChange = {}\n<Input value=$v />\n"` → `[]`
**check-07 · non-literal page prop** — `"prop title = 1 + 1\n"` → `["E010@site/index.mark:1"]`
**check-08 · duplicate path** — files `site/blog.mark`, `site/blog/index.mark` → `["E011@site/blog/index.mark:1"]`
**check-09 · bound prop is assignable** — `Box.mark: "prop n = 0\nprop onNChange = {}\n<button onTap={n += 1} />\n"`, `index.mark: "var k = 0\n<Box $k />\n"` — wait, `$k` binds prop `k`, not `n` → `["E008@site/index.mark:2"]`. Then `index.mark: "var k = 0\n<Box n=$k />\n"` → `[]`.
**check-10 · assigning a prop is allowed; assigning a let is not** — `X.mark: "prop v = 0\nlet w = v\n<button onTap={v += 1} />\n<button onTap={w += 1} />\n"` → `["E005@site/components/X.mark:4"]`
**check-11 · shadow warning only** — `"var p = 1\nfor p in [1] {\n{p}\n}\n"` → `["W002@site/index.mark:2"]`
**check-12 · layout without slot** — `site/_site.mark: "# hi\n"` → `["W001@site/_site.mark:1"]`

**check-13 · await outside async** — `"fn f() = await next()\n"` → `["E016@site/index.mark:1"]`; `"async fn f() = await next()\n"` → `[]`; `"<button onTap={await next(); x = 1} />\n"` → `[]` (handlers are implicitly async; `x` must exist).
**check-14 · return at top level** — `"return 1\n"` is prose by L-2? No: `return` is not in the L-2 keyword list, so this line is prose and compiles clean. `"fn f() = (return 1)\n"` → syntax error. Test asserts the first case yields a prose node and no diagnostics.
**check-15 · fn-local var is not bindable** — `"fn f() {\nvar q = 1\nreturn q\n}\n<Input value=$q />\n"` → `["E003@site/index.mark:5"]` (q is not in document scope).

### 15.3 Runtime tests (`run`)

Harness API (must be provided by the implementation, runnable in jsdom):

```ts
const app = await mount({ files, path? });     // compiles a project in memory, mounts at path (default "/")
app.html(selector?)                             // serialized innerHTML, whitespace-normalized
await app.click(selector); await app.input(selector, value); await app.keydown(selector, key)
await app.navigate(path); app.flush()
app.get(name)                                   // read a top-level var/let of the current page by name
app.errors                                      // runtime errors captured
```

Format: `{ "name", "files", "path", "steps": [ {op, args...}, {"expect": {selector: html}} … ] }`. Below, steps are written as prose; the JSON form is mechanical.

**run-01 · var + interpolation + handler**
files: `index.mark = "var n = 0\n<button id=b onTap={n += 1}>{n}</button>\n"`
- expect `#b` = `0`; click `#b`; expect `#b` = `1`; click; expect `2`.

**run-02 · let recomputes lazily**
`"var a = 2\nlet sq = a * a\n<p id=p>{sq}</p>\n<button id=b onTap={a += 1} />\n"`
- expect `#p` = `4`; click `#b`; expect `9`. `app.get("sq")` = 9.

**run-03 · if flips and unmounts state**
`"var on = false\nvar clicks = 0\n<button id=t onTap={on = !on} />\nif on {\nvar inner = 0\n<button id=i onTap={inner += 1}>{inner}</button>\n}\n"`
- `#i` absent; click `#t`; `#i` = `0`; click `#i` twice → `2`; click `#t` (hides); click `#t` (shows) → `#i` = `0` (state discarded, C-10).

**run-04 · for with deep reactivity, no loop re-run**
`"var xs = [{v:1},{v:2}]\n<ul>\nfor x in xs {\n<li class=row onTap={x.v += 10}>{x.v}</li>\n}\n</ul>\n<button id=add onTap={xs.push({v:3})} />\n"`
- expect `ul` = `<li class="row">1</li><li class="row">2</li>`; click first `.row` → `11`; the second `<li>` DOM node is the same object (harness exposes `app.node(sel)` identity check); click `#add` → three rows, first two nodes unchanged.

**run-05 · for key preserves state on reorder**
`"var xs = [{id:1},{id:2}]\nfor x in xs key x.id {\nvar c = 0\n<button class=k onTap={c += 1}>{x.id}:{c}</button>\n}\n<button id=rev onTap={xs.reverse()} />\n"`
- click first `.k` → `1:1`; click `#rev`; expect `.k` texts `2:0`, `1:1`.

**run-06 · two-way bind through component**
files: `components/Num.mark = "prop value = 0\nprop onValueChange = {}\n<button class=inc onTap={value += 1}>{value}</button>\n"`, `index.mark = "var t = 5\n<Num value=$t />\n<p id=p>{t}</p>\n"`
- click `.inc`; expect `.inc` = `6`, `#p` = `6`.

**run-07 · same component, seeded and uncontrolled (T-17)**
Same `Num`. `index.mark = "var s = 5\n<Num value={s} />\n<Num />\n<button id=r onTap={s = 100} />\n"`
- first `.inc` = `5`, second = `0`; click first `.inc` twice → `7`, second still `0`; click second → `1`.
- click `#r` → first `.inc` = `100` (parent's new value wins), second still `1`.
- click first `.inc` → `101`; `app.get("s")` is still `100` (unbound: nothing flows up).

**run-08 · bind shorthand name (T-14) through loop item**
`components/CoinBox.mark = "prop heads = true\nprop onHeadsChange = {}\n<button class=coin onTap={heads = !heads}>{heads ? \"H\" : \"T\"}</button>\n"`, `index.mark = "var coins = [{heads:true},{heads:true}]\nfor coin in coins {\n<CoinBox $coin.heads />\n}\n<p id=n>{coins.filter(c => c.heads).length}</p>\n"`
- click second `.coin` → texts `H`,`T`; `#n` = `1`.

**run-09 · HTML input binding with number coercion**
`"var x = 0.5\n<input id=r type=range min=0 max=1 step=0.01 value=$x />\n<p id=p>{x * 2}</p>\n"`
- input `#r` "0.25" → `#p` = `0.5`; `app.get("x")` is the number 0.25.

**run-10 · conditional class merging**
`"var cur = true\n<a id=a class=\"link\" class=\"current\" if cur>x</a>\n<button id=t onTap={cur = !cur} />\n"`
- `#a` class = `link current`; click `#t` → `link`.

**run-11 · event pass-through receives event (C-16)**
`"var k = \"\"\nfn onKey(e) { k = e.key }\n<input id=i onKeydown={onKey} />\n<p id=p>{k}</p>\n"`
- keydown `#i` "a" → `#p` = `a`.

**run-12 · slots evaluate in caller scope**
`components/Card.mark = "prop title\n<section><h2>{title}</h2><slot /></section>\n"`, `index.mark = "var n = 3\n<Card title=\"T\">\nInside {n}\n</Card>\n"`
- `section` contains `<h2>T</h2><p>Inside 3</p>`.

**run-13 · math renders and re-renders**
`"var a = 2\n<p id=m>$x^{ {a} }$</p>\n<button id=b onTap={a += 1} />\n"`
- `#m .katex` exists and its `annotation` text = `x^{ 2 }`; click `#b` → `x^{ 3 }`.

**run-14 · math with literal braces unaffected**
`"$\\frac{a}{b}$\n"` → `.katex annotation` = `\frac{a}{b}`; `app.errors` empty.

**run-15 · handler batching**
`"var a = 0\nvar renders = 0\nlet both = (renders += 0, a)\n"` is invalid (E006). Correct test: `"var a = 0\nvar b = 0\n<p id=p>{a + b}</p>\n<button id=t onTap={a += 1; b += 1} />\n"` — the harness counts DOM mutations on `#p`; after one click exactly one text mutation occurred and `#p` = `2`.

**run-16 · cycle error**
`"var a = 1\nlet b = c + 1\nlet c = b + 1\n"` → E003 at compile (c before declaration). Runtime cycle: `"var a = 1\nfn f() = g()\nfn g() = f()\nlet b = f()\n<p>{b}</p>\n"` → `app.errors[0].code` = `RT03` (or a stack overflow caught and reported as RT03).

**run-17 · Site index and nav**
files:
```
site/_site.mark:        "<Nav />\n<main><slot /></main>\n"
site/components/Nav.mark: "fn cur(p) = Page.path == p.path || Page.path.startsWith(p.path + \"/\")\n<nav>\nfor p in Site.nav key p.path {\n<a href={p.path} class=\"current\" if cur(p)>{p.title}</a>\n}\n</nav>\n"
site/index.mark:        "prop title = \"Home\"\nprop order = 1\n# Home\n"
site/blog/index.mark:   "prop title = \"Blog\"\nprop order = 2\n# Posts\n"
site/blog/one.mark:     "prop title = \"One\"\nprop section = \"blog\"\nprop date = \"2026-01-02\"\nFirst para.\n\nSecond.\n"
site/about.mark:        "# About\n"
```
- `Site.pages` paths = `["/", "/about", "/blog", "/blog/one"]`; `Site.nav` titles = `["Home","Blog"]`; `Site.page("/about").title` = `"About"`; `Site.page("/blog/one").excerpt` = `"First para."`; `Site.sections.blog.pages.length` = 1.
- at `/`: `nav a.current` text = `Home`. navigate `/blog/one` → `nav a.current` text = `Blog`; `main h1` absent, `main p` = `First para.`.

**run-18 · (SPA mode) layout chain and state preservation across navigation** — project config `spa: true`.
```
site/_site.mark:       "var clicks = 0\n<button id=g onTap={clicks += 1}>{clicks}</button>\n<slot />\n"
site/blog/_layout.mark: "var local = 0\n<button id=l onTap={local += 1}>{local}</button>\n<div class=post><slot /></div>\n"
site/blog/a.mark:      "A\n"
site/blog/b.mark:      "B\n"
site/index.mark:       "Home\n"
```
- mount `/blog/a`; click `#g`, `#l` → `1`,`1`; navigate `/blog/b` → `#g`=`1`, `#l`=`1`, `.post` = `<p>B</p>`; navigate `/` → `#g`=`1`, `#l` absent; navigate `/blog/a` → `#l`=`0`.

**run-19 · (SPA mode) link interception and Page.path assignment** — config `spa: true`. Also run with `spa: false`: clicking `#x` triggers a full navigation (harness observes `location.assign`) and no runtime module is loaded.
`index.mark = "<a id=x href=\"/two\">go</a>\n<button id=y onTap={Page.path = \"/two\"} />\n"`, `two.mark = "Two\n"`, `_site.mark = "<slot />\n"`
- click `#x` → `Page.path` = `/two`, body contains `Two`, `history.length` grew by 1; navigate `/`; click `#y` → same.

**run-20 · dynamic route with params and paths**
`blog/[slug].mark = "prop paths = [{slug:\"x\"},{slug:\"y\"}]\n# {Page.params.slug}\n"` plus trivial `_site.mark`
- `Site.pages` paths include `/blog/x`, `/blog/y`; mount `/blog/y` → `h1` = `y`; in SPA mode, mount `/blog/zzz` → `h1` = `zzz` (client-rendered fallback); mount `/nope` → 404 content. Without `paths` and with `spa: false` → E024.

**run-21 · (SPA mode) head hoisting and title** — config `spa: true`. In non-SPA mode assert the same via build output: each `dist/**/index.html` has the right `<title>` and only `about/index.html` has the meta.
`_site.mark = "<head><title>{Page.title} · S</title></head>\n<slot />\n"`, `index.mark = "prop title = \"Home\"\nhi\n"`, `about.mark = "prop title = \"About\"\n<head><meta name=\"x\" content=\"y\" /></head>\nhi\n"`
- at `/`: `document.title` = `Home · S`, no `meta[name=x]`; navigate `/about` → title `About · S`, `meta[name=x]` present; navigate `/` → meta removed.

**run-22 · Site.data**
`_data/authors.json = {"me": {"name":"Ada"}}`, `index.mark = "{Site.data.authors.me.name}\n"` → body `Ada`. Assigning `Site.data.authors.me.name = "x"` inside a handler → E005.

**run-23 · list merging across iterations (M-6)**
`"for p in [\"a\",\"b\"] {\n- {p}\n}\n"` → exactly one `ul` with two `li`.

**run-24 · exports**
`components/Util.mark = "export fn double(x) = x * 2\nexport let LIMIT = 10\n"`, `index.mark = "{Util.double(4)} {Util.LIMIT}\n"` → `8 10`.

**run-25 · draft excluded**
`hidden.mark = "prop draft = true\nx\n"` → not in `Site.pages`; with `--drafts` it is.

**run-26 · matrix multiplier core (no animation)**
files: `index.mark` =
```
var a = [[1,2],[3,4]]
var b = [[5,6],[7,8]]
var hovered = null
var aText = ""
var aTouched = false
let conformable = a[0].length == b.length
let product = conformable ? a.map(row => b[0].map((_, j) => row.reduce((s, v, k) => s + Number(v) * Number(b[k][j]), 0))) : null
fn parseMatrix(text) {
let v = try(JSON.parse(text), null)
if !Array.isArray(v) || v.length == 0 {
return null
}
if v.every(x => Number.isFinite(x)) {
return [v]
}
let w = Array.isArray(v[0]) ? v[0].length : 0
return w > 0 && v.every(r => Array.isArray(r) && r.length == w && r.every(Number.isFinite)) ? v : null
}
let aParsed = parseMatrix(aText.trim())
let aError = aTouched && aText.trim() != "" && aParsed == null
<table id="A">
for row, i in a {
<tr>
for _, j in row {
<td class="trace" if hovered?.i == i><input value=$a[i][j] /></td>
}
</tr>
}
</table>
if conformable {
<table id="P">
for row, i in product {
<tr>
for v, j in row {
<td class="r" class="trace" if hovered?.i == i && hovered?.j == j onMouseenter={hovered = {i, j}} onMouseleave={hovered = null}>{v}</td>
}
</tr>
}
</table>
} else {
<p id="mm">undefined</p>
}
<input id="at" value=$aText onInput={aParsed && (a = aParsed)} onChange={aTouched = true} />
if aError {
<p id="err">bad</p>
}
```
- `#P td.r` texts = `19 22 43 50`.
- input `#A tr:nth-child(1) td:nth-child(1) input` "2" → `#P td.r` texts = `24 26 43 50`; `app.get("a")[0][0]` is the string `"2"` (bindings on text inputs don't coerce, T-16).
- mouseenter second `.r` → that cell has `trace`, `#A tr:nth-child(1) td` both have `trace`; mouseleave → none.
- input `#at` `"[[1,0],[0,1]]"` → `#P td.r` = `5 6 7 8`; `#err` absent.
- input `#at` `"[[1,2,3]]"` → `#mm` present, `#P` absent (1×3 times 2×2 is non-conformable).
- input `#at` `"nope"`; `#err` absent (not touched); change `#at` → `#err` present; input `#at` `"[[1]]"` → `#err` absent, `#A` has one cell.

**run-27 · try inside let re-tracks deps (C-19)**
`"var t = \"x\"\nlet n = try(JSON.parse(t).n, -1)\n<p id=p>{n}</p>\n<button id=b onTap={t = '{\"n\":7}'} />\n"`
- `#p` = `-1`; click `#b` → `7`; `app.errors` empty.

**run-28 · async fn, next(), after(), stale-token guard**
```
var id = 0
var msg = "start"
var w = 0
var box = null
async fn go() {
let t = (id += 1)
msg = "measuring"
await next()
w = measure(box).w
await after(50)
if t == id {
msg = "done"
}
}
<div id=box ref={box} style="width:120px">x</div>
<p id=m>{msg}</p><p id=w>{w}</p>
<button id=g onTap={go()} />
```
- click `#g`; immediately `#m` = `measuring`, `#w` = `120` after `await next()` resolves in the harness; after 100 ms `#m` = `done`.
- click `#g` twice within 10 ms → after 100 ms `#m` = `done` exactly once (harness counts text mutations on `#m`: `measuring`, `measuring`, `done`).

**run-29 · scoped styles**
`components/Box.mark = "<div class=x>b</div>\n<style>\n.x { color: rgb(1, 2, 3) }\n</style>\n"`, `index.mark = "<div class=x id=outer>a</div>\n<Box />\n"`
- computed color of `Box`'s `.x` is `rgb(1, 2, 3)`; of `#outer` is not. With `<style global>` in Box, both are.

**run-30 · style object with custom properties (T-26)**
`"var x = 10\n<div id=d style={{\"--x0\": x + \"px\", color: \"red\"}}>a</div>\n<button id=b onTap={x = 20} />\n"`
- `#d` style attribute contains `--x0: 10px`; click `#b` → `--x0: 20px`.

### 15.4 Evaluator tests (`eval`)

Format: `{ "name", "src", "html" }` — a single page evaluated at path `/` with a trivial `_site.mark`, compared as normalized HTML. Or `{ "name", "src", "error" }`.

**eval-01 · coercion and equality** — `"{1 + \"2\"} {\"3\" * 2} {1 == \"1\"} {null == undefined} {[] + []}"` → `<p>12 6 false false </p>`.
**eval-02 · truthiness and short circuit** — `"{0 || \"a\"} {\"\" && 1} {null ?? 1}"` — note `??` is not in the grammar → syntax error; the test is `"{0 || \"a\"} {\"\" && 1} {[] ? 1 : 0}"` → `<p>a  1</p>`.
**eval-03 · arrows and array methods** — `"{[3,1,2].toSorted((x,y) => x - y).map(x => x * 2).join(\",\")}"` → `<p>2,4,6</p>`.
**eval-04 · optional chaining** — `"var o = null\n{o?.a?.b} {o?.a ?? 1}"` → syntax error on `??`; use `"{o?.a?.b}|{o?.f?.()}"` → `<p>|</p>`.
**eval-05 · number formatting matches JS** — `"{0.1 + 0.2} {(1/3).toFixed(4)} {1e21} {-0} {100/0}"` → `<p>0.30000000000000004 0.3333 1e+21 0 Infinity</p>`.
**eval-06 · string methods** — `"{\"héllo\".toUpperCase()} {\"a-b-c\".split(\"-\").length} {\"x\".padStart(3, \"0\")}"` → `<p>HÉLLO 3 00x</p>`.
**eval-07 · whitelist violation** — `"{Math.fround(1)}"` → `E021`; `"{Math.random()}"` → `E022`; `"var r = Math.random()\n<p>{r}</p>"` → compiles, html has an island whose initial text is `0`.
**eval-08 · fn with statements and locals** — `"fn fib(n) {\nvar a = 0\nvar b = 1\nfor _ in Array.from({length: n}) {\nlet t = a + b\na = b\nb = t\n}\nreturn a\n}\n{fib(20)}"` → `<p>6765</p>`.
**eval-09 · runaway** — `"fn f(n) = f(n + 1)\n{f(0)}"` → `E023`.
**eval-10 · JSON round trip** — `"{JSON.stringify({a: [1, \"x\", null], b: true})}"` → `<p>{"a":[1,"x",null],"b":true}</p>`.
**eval-11 · sort stability and collation** — `"{[\"b\",\"B\",\"a\"].toSorted().join(\"\")}"` → `<p>Bab</p>` (code-point order, V-3).
**eval-12 · try in evaluator** — `"{try(JSON.parse(\"{\"), \"bad\")}"` → `<p>bad</p>`.
**eval-13 · Page folded** — `"<a class=\"current\" if Page.path == \"/\">x</a>"` at `/` → `<a class="current">x</a>` and the page has zero islands.
**eval-14 · dates** — `"{new Date(\"2026-09-01\").getFullYear()} {new Date(\"2026-09-01\").toLocaleDateString()}"` → `<p>2026 9/1/2026</p>`.

### 15.5 Build tests (`build`)

**build-01 · zero JS for a static blog** The run-17 project builds to `dist/index.html`, `dist/about/index.html`, `dist/blog/index.html`, `dist/blog/one/index.html`; each contains the nav with the correct `current` class as plain HTML, and **no `<script>` tag anywhere** and no `_mk/*.js` files in `dist/`.
**build-02 · math is static** The run-14 source builds to HTML containing `<math>` and no script; with `config.math: "katex"` it contains `class="katex"` and a stylesheet link. Either way it renders with JS disabled.
**build-03 · dynamic paths** run-20 with `paths` produces `dist/blog/x/index.html` and `dist/blog/y/index.html`; without `paths` and `spa: false` → E024; with `spa: true` the build succeeds and emits a fallback route.
**build-04 · islands are minimal** The 8.5 coins page builds to HTML with exactly three island anchor pairs (slider section, coin section, likelihood math), one `<script type="module">`, and the `<h2>` headings, first paragraph, nav, and aside outside any anchor. Hydrating it and clicking `Stepper` works; the harness asserts the `<nav>` node identity is unchanged after hydration and that no effect was registered on it.
**build-04b · shared var across islands** `"var n = 0\n<button id=b onTap={n += 1}>+</button>\n\nSome static prose.\n\n<p id=p>{n}</p>"` builds to two islands separated by static prose; after hydration clicking `#b` updates `#p`.
**build-05** `static/style.css` is copied to `dist/style.css`; `base: "/sub/"` prefixes all emitted `href`s and asset paths.
**build-06** run-29's project builds to a `dist/mark.css` containing the scoped selector (e.g. `.x[data-mk-Box]`) and the emitted HTML carries the attribute; the page renders with the right color with JS disabled.
**build-07** run-28's page evaluates without error or hang: `#m` = `start`, `#w` = `0`, and the build completes in under 2 s (the `after()` promise must not block).
**build-08 · evaluator/runtime agreement** For every `run-*` test, the initial `app.html()` after hydration equals the evaluator's output for the same page (normalized). This is the single most important invariant in the system.
**build-09 · SPA still emits static pages** run-18's project with `spa: true` emits full HTML for all three pages; each page loads correctly as a deep link with JS disabled.

---

## 16. Implementation Guidance

### 16.1 Language choice

Two components have fixed languages: the runtime and the client-side math renderer are JavaScript because they run in the browser. Everything else (parser, checker, indexer, evaluator, emitter, CLI) is one program in one language, and because the evaluator is a native interpreter there is no JavaScript engine in the build. Recommended:

- **Reference implementation: TypeScript**, so the evaluator and the runtime can share the tiny set of semantics they must agree on (coercion, formatting, collation) as one module rather than two implementations. Ship via npm; `bun build --compile` gives a single executable.
- **Production implementation: Rust**, once the grammar is stable. Parser/checker/evaluator/emitter in Rust, Markdown via a CommonMark crate, TeX→MathML via a native crate, the JS runtime embedded as a static asset. No Node dependency; the parser compiles to WASM for an in-browser playground and an LSP. The JSON test suites in section 15 are the contract that makes the port safe.

Do not begin in Rust while the syntax is moving.

### 16.2 Order of work

1. **Line classifier + tag scanner** (L-1..L-13), then the expression parser (Pratt parser producing ESTree). Pass 15.1.
2. **Markdown** on the placeholder string (A-8), plus the math recognizer (M-8).
3. **Evaluator** (12.2) and the site indexer; emit HTML for pages with no `var`. Pass 15.2, 15.4, and build-01/02. At this point the tool already builds a complete static blog with math.
4. **Reactivity core** (R-1..R-7) and **runtime DOM ops**, then the **emitter** for dynamic nodes and **island analysis** (8.7). Pass run-01..16, build-04, build-08.
5. **Layouts, head, dynamic routes, styles.** Pass run-17, 20..30, build-03/05/06.
6. **SPA mode** last; it is optional for most sites. Pass run-18/19/21, build-09.

### 16.3 Pitfalls the tests are designed to catch

- Treating `for the record` as a loop (L-3).
- Re-running a whole `for` body when one item's field changes (R-4, run-04).
- Losing loop-body state on reorder (C-12, run-05).
- Forgetting to call `onXChange` on a bound prop write, or letting the parent's echo trigger a second write (T-17, run-06/07).
- Parsing `{` inside `$…$` as interpolation (M-4, run-14).
- Emitting `eval` in generated code (A-5).
- Capturing bind-path indices at bind time instead of re-reading them (T-13a).
- Evaluating `try`'s fallback eagerly, or losing dependency tracking after a throw (C-19).
- Letting `after()` hang the evaluator (5.6, build-07).
- Scoping `<style>` rules onto child-component elements (T-22).
- Evaluator and runtime disagreeing on number formatting or sort order (V-3, eval-05/11, build-08).
- Marking a whole page dynamic because a layout reads `Page.path` in non-SPA mode (P-4, eval-13, build-01).
- Shipping the runtime on a page with no islands (I-5, build-01).

## 17. Open Questions (deferred past 0.1)

- Scoped slots (child passing data into slot content).
- Async: `await` in initializers, data loading at build time from remote sources.
- First-class references (`ref(a[i][j])` as a value; T-13b).
- A `switch`/`match` block.
- Typed props (`prop n: number = 0`) and editor tooling.
- Whether `let` should permit a block body like `fn`.
- Regular expressions in the expression language (needs a regex engine shared by evaluator and runtime).
- Build-time data loading from remote sources (`Site.data` from URLs).
- A FLIP/`fly` intrinsic that measures two nodes and animates a transform between them, so Appendix A's geometry code shrinks further.

---

## Appendix A — Reference port: matrix multiplier

A complete port of a ~520-line Svelte component (script + markup + styles). This is the canonical "real component" and should be kept compiling as the spec evolves. CSS is scoped automatically, so the Svelte stylesheet is used unchanged and omitted here except where it changed.

```
// site/components/Matrix.mark — brackets around a table, used three times
prop kind = ""
<div class={"matrix " + kind}><table><tbody><slot /></tbody></table></div>
<style>
.matrix { position: relative; padding: 0.3rem 1rem; }
.matrix::before, .matrix::after { /* bracket rules, unchanged */ }
</style>
```

```
// site/components/MatMul.mark
prop a0 = [[1, 2], [3, 4]]
prop b0 = [[5, 6], [7, 8]]

var a = a0
var b = b0
var aText = ""
var bText = ""
var aTouched = false
var bTouched = false
var hovered = null
var root = null
var phase = "idle"        // idle → running → done
var step = 0
var flying = false
var landed = false
var chips = []
var flightId = 0

let FLY_MS = env.reducedMotion ? 0 : 650
let conformable = a[0].length == b.length
let product = conformable
  ? a.map(row => b[0].map((_, j) => row.reduce((s, v, k) => s + Number(v) * Number(b[k][j]), 0)))
  : null
let total = a.length * b[0].length
let cur = phase == "idle" ? null : {i: step % a.length, j: Math.floor(step / a.length)}
let label = phase == "idle" ? "Compute" : phase == "done" ? "Restart" : "Next"

fn cellStep(i, j) = j * a.length + i
fn shown(i, j) = phase == "idle" || cellStep(i, j) < step || (cellStep(i, j) == step && landed)

// ---- parsing (derived, not event-driven) ----
fn parseMatrix(text) {
let v = try(JSON.parse(text), null)
if !Array.isArray(v) || v.length == 0 {
return null
}
if v.every(x => Number.isFinite(x)) {
return [v]
}
let w = Array.isArray(v[0]) ? v[0].length : 0
return w > 0 && v.every(r => Array.isArray(r) && r.length == w && r.every(Number.isFinite)) ? v : null
}
let aParsed = parseMatrix(aText.trim())
let bParsed = parseMatrix(bText.trim())
let aError = aTouched && aText.trim() != "" && aParsed == null
let bError = bTouched && bText.trim() != "" && bParsed == null
fn apply(which, m) {
reset()
if which == "a" {
a = m
} else {
b = m
}
}

// ---- geometry ----
fn cellRect(sel) = measure(root.querySelector(sel), root)
fn columnStrip(col) {
let cells = b.map((_, k) => cellRect("[data-cell=b-" + k + "-" + col + "]"))
let first = cells[0]
let last = cells[cells.length - 1]
return {x: first.x, y: first.y, w: first.w, h: last.y + last.h - first.y, values: b.map(r => Number(r[col]))}
}
fn rowBox(i) {
let first = cellRect("[data-cell=a-" + i + "-0]")
let last = cellRect("[data-cell=a-" + i + "-" + (a[0].length - 1) + "]")
return {cx: (first.x + last.x + last.w) / 2, cy: first.y + first.h / 2, w: last.x + last.w - first.x, h: first.h}
}
fn stripFlight(kind, col, fromRow, toRow) {
let strip = columnStrip(col)
let place = row => row == null
  ? {x: strip.x, y: strip.y, r: 0, w: strip.w, h: strip.h}
  : (box => ({x: box.cx - box.h / 2, y: box.cy - box.w / 2, r: -90, w: box.h, h: box.w}))(rowBox(row))
let f = place(fromRow)
let t = place(toRow)
return {key: kind + "-" + col, values: strip.values,
        x0: f.x, y0: f.y, r0: f.r, w0: f.w, h0: f.h, x1: t.x, y1: t.y, r1: t.r, w1: t.w, h1: t.h}
}

// ---- stepping ----
async fn beginStep(to, prev) {
let token = (flightId += 1)
flying = true
landed = false
await next()                       // let landed terms revert before measuring
if token != flightId {
return
}
let m = a.length
let i = to % m
let j = Math.floor(to / m)
let sameColumn = prev != null && Math.floor(prev / m) == j
chips = [sameColumn ? stripFlight("hop", j, prev % m, i) : stripFlight("out", j, null, i)]
await after(FLY_MS + 80)
if token == flightId {
finishFlight()
}
}
fn finishFlight() {
flightId += 1
chips = []
flying = false
landed = true
if step == total - 1 {
phase = "done"
}
}
fn reset() {
flightId += 1
chips = []
flying = false
landed = false
step = 0
phase = "idle"
}
fn advance() {
if flying {
finishFlight()
} else if phase == "idle" {
phase = "running"
step = 0
beginStep(0, null)
} else if phase == "running" {
let prev = step
step += 1
beginStep(step, prev)
} else {
reset()
}
}

// ---- markup ----
<div class="matmul" ref={root}>
<Matrix kind="m-a">
for row, i in a {
<tr>
for _, j in row {
<td data-cell={"a-" + i + "-" + j} class="trace" if phase == "idle" && hovered?.i == i>
if landed && cur?.i == i {
<span class="term">{j > 0 ? "+ " : ""}{Number(a[i][j])}·{Number(b[j][cur.j])}</span>
} else {
<input value=$a[i][j] readonly={phase != "idle"} />
}
</td>
}
</tr>
}
</Matrix>
<span class="operator">×</span>
<Matrix kind="m-b">
for row, i in b {
<tr>
for _, j in row {
<td data-cell={"b-" + i + "-" + j} class="trace" if phase == "idle" && hovered?.j == j>
<input value=$b[i][j] readonly={phase != "idle"} />
</td>
}
</tr>
}
</Matrix>
<span class="operator">=</span>
if conformable {
<Matrix kind="m-ab" aria-live="polite">
for row, i in product {
<tr>
for v, j in row {
<td class="result" class="trace" if phase == "idle" && hovered?.i == i && hovered?.j == j
    onMouseenter={hovered = {i, j}} onMouseleave={hovered = null}>
<span class="pending" if !shown(i, j)>{v}</span>
</td>
}
</tr>
}
</Matrix>
} else {
<p class="mismatch">A has {a[0].length} column{a[0].length == 1 ? "" : "s"} but B has {b.length} row{b.length == 1 ? "" : "s"} — the product is undefined.</p>
}
for c in chips key c.key {
<div class="chip" style={{"--x0": c.x0 + "px", "--y0": c.y0 + "px", "--x1": c.x1 + "px", "--y1": c.y1 + "px",
                          "--r0": c.r0 + "deg", "--r1": c.r1 + "deg", "--w0": c.w0 + "px", "--h0": c.h0 + "px",
                          "--w1": c.w1 + "px", "--h1": c.h1 + "px", animationDuration: FLY_MS + "ms"}}>
for v, k in c.values key k {
<span class="chip-cell" style={{"--s0": -c.r0 + "deg", "--s1": -c.r1 + "deg", animationDuration: FLY_MS + "ms"}}>{v}</span>
}
</div>
}
</div>

<div class="controls">
<label>A = <input type="text" placeholder="[[1,2],[3,4]]" value=$aText
       onInput={aParsed && apply("a", aParsed)} onChange={aTouched = true} /></label>
<label>B = <input type="text" placeholder="[[5,6],[7,8]] or [5,6] for a row vector" value=$bText
       onInput={bParsed && apply("b", bParsed)} onChange={bTouched = true} /></label>
if aError || bError {
<p class="parse-error">Couldn't parse {aError ? "A" : "B"} — use [[1,2],[3,4]], or [1,2,3] for a row vector.</p>
}
<button onTap={advance()} disabled={!conformable}>{label}</button>
</div>

<p class="hint">Edit cells directly, or type a whole matrix into A or B. Hover (or tap) an output cell to see the row and column that produce it.</p>

<style>
/* Identical to the Svelte stylesheet except: .matrix rules moved to Matrix.mark,
   and the `span` class="pending" toggles visibility instead of the if/else. */
</style>
```

Usage on a page: `<MatMul />`, or `<MatMul a0={[[2,0],[0,2]]} />`.

Notes on the port:

- Every `class:x={…}` became `class="x" if …`; every `{#if}` became `if`; `bind:this` became `ref`; `$derived` became `let`; `tick()` became `await next()`; `setTimeout` became `await after()`; `matchMedia` became `env.reducedMotion`; the `try/catch` became `try(…, null)`.
- `aError`/`bError` are derived, so the `showError` plumbing disappeared.
- The bracketed-table markup is a component used three times instead of three copies.
- The geometry functions are the same length as in Svelte; that code is about the animation, not the framework, and is the candidate for a `fly` intrinsic (section 17).
- Line count: ≈190 excluding CSS versus ≈370 excluding CSS in Svelte.
