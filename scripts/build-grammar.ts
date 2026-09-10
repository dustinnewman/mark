// Generate the TextMate grammar for .mark files into editors/vscode/syntaxes/mark.tmLanguage.json.
// Line classification (spec §3.1) and the tag/attribute tokens come straight from the parser's own
// regexes so the two cannot drift; the reserved-word groups below are checked against RESERVED.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { RESERVED, GT_CONTINUES } from "../src/expr.ts";
import { CONTINUATION_START, IDENT as IDENT_RE } from "../src/lexer.ts";
import { ATTR_NAME, CODE_LINE, DECL_LINE, FOR_LINE, IF_LINE, TAG_NAME } from "../src/parser.ts";

type Rule = Record<string, unknown>;

/** JS regex source → Oniguruma. The parser's regexes are all in the common subset; drop the `^`. */
const src = (re: RegExp): string => re.source.replace(/^\^/, "");
const IDENT = IDENT_RE.source;
const words = (ws: string[]): string => `\\b(?:${ws.join("|")})\\b`;

const KEYWORDS: Record<string, string[]> = {
  "storage.type.mark": ["var", "let", "prop"],
  "storage.type.function.mark": ["fn"],
  "storage.modifier.mark": ["export", "async"],
  "keyword.control.mark": ["if", "else", "for", "in", "key", "return", "await", "try"],
  "constant.language.mark": ["true", "false", "null", "undefined"],
  "keyword.other.mark": ["slot"],
};
const grouped = new Set(Object.values(KEYWORDS).flat());
for (const w of RESERVED) if (!grouped.has(w)) throw new Error(`reserved word \`${w}\` has no keyword group`);

const include = (name: string): Rule => ({ include: "#" + name });
/** A code line ends where the next line begins, unless that line continues the expression (lexer). */
const EOL_UNLESS_CONTINUED = `^(?!\\s*(?:${src(CONTINUATION_START)}))`;
const punct = (kind: string): Rule => ({ name: `punctuation.${kind}.mark` });

const repository: Record<string, Rule> = {
  // ---- line-level (anchored; the parser classifies each line before anything else) ----
  comment: { match: "^\\s*//.*$", name: "comment.line.double-slash.mark" },
  "escaped-line": { match: `^\\s*(\\\\)(?=${src(CODE_LINE)})`, captures: { 1: { name: "constant.character.escape.mark" } } },
  fence: {
    begin: "^\\s{0,3}(`{3,}|~{3,})\\s*(\\S*)", end: "^\\s{0,3}\\1[`~]*\\s*$",
    name: "markup.fenced_code.block.mark",
    beginCaptures: { 1: punct("definition.raw"), 2: { name: "fenced_code.block.language.mark" } },
    endCaptures: { 1: punct("definition.raw") },
  },
  "math-block": {
    begin: "^\\s*(\\$\\$)\\s*$", end: "^\\s*(\\$\\$)\\s*$", name: "markup.math.block.mark",
    beginCaptures: { 1: punct("definition.math") }, endCaptures: { 1: punct("definition.math") },
    patterns: [include("math-interpolation")],
  },
  style: {
    begin: "^\\s*(<)(style)(?:\\s+(global))?\\s*(>)", end: "(</)(style)\\s*(>)",
    beginCaptures: { 1: punct("definition.tag.begin"), 2: { name: "entity.name.tag.mark" }, 3: { name: "storage.modifier.mark" }, 4: punct("definition.tag.end") },
    endCaptures: { 1: punct("definition.tag.begin"), 2: { name: "entity.name.tag.mark" }, 3: punct("definition.tag.end") },
    contentName: "source.css.embedded.mark",
    patterns: [{ include: "source.css" }],
  },
  // Block-form fn: every line until the matching `}` is a statement (L-12).
  "fn-block": {
    begin: `^\\s*(?:(export)\\s+)?(?:(async)\\s+)?(fn)\\s+(${IDENT})\\s*(\\()([^)]*)(\\))\\s*(\\{)\\s*$`,
    end: "^\\s*(\\})",
    beginCaptures: {
      1: { name: "storage.modifier.mark" }, 2: { name: "storage.modifier.mark" }, 3: { name: "storage.type.function.mark" },
      4: { name: "entity.name.function.mark" }, 5: punct("definition.parameters.begin"),
      6: { name: "variable.parameter.mark" }, 7: punct("definition.parameters.end"), 8: punct("section.block.begin"),
    },
    endCaptures: { 1: punct("section.block.end") },
    patterns: [include("statements")],
  },
  statements: { patterns: [include("comment"), include("stmt-block"), include("else-block"), include("block-open"), include("expression")] },
  "stmt-block": { begin: "^\\s*(if|for)\\b", end: "^\\s*(\\})", beginCaptures: { 1: { name: "keyword.control.mark" } }, endCaptures: { 1: punct("section.block.end") }, patterns: [include("statements")] },
  "else-block": { begin: "\\b(else)\\b", end: "^\\s*(\\})", beginCaptures: { 1: { name: "keyword.control.mark" } }, endCaptures: { 1: punct("section.block.end") }, patterns: [include("statements")] },
  // Any other code line: declarations and block openers run to the end of the line (plus continuation
  // lines); the body lines of a top-level `if`/`for` are classified again on their own. The lookahead is
  // the parser's L-2 test, so `if`/`for` only highlight in their full brace-terminated shape.
  "decl-line": {
    begin: `^\\s*(?=${src(DECL_LINE)}|${src(FOR_LINE)}|${src(IF_LINE)})((?:export\\s+)?(?:async\\s+)?(?:var|let|prop|fn|if|for))\\b`, end: EOL_UNLESS_CONTINUED,
    beginCaptures: { 1: { patterns: [include("keywords")] } }, patterns: [include("block-open"), include("expression")],
  },
  closer: { begin: "^\\s*(\\})", end: EOL_UNLESS_CONTINUED, beginCaptures: { 1: punct("section.block.end") }, patterns: [include("block-open"), include("expression")] },
  "block-open": { match: "(\\{)\\s*$", captures: { 1: punct("section.block.begin") } },

  // ---- tags (line-level or inline; the parser scans both the same way) ----
  tag: {
    begin: `(<)(${src(TAG_NAME)})`, end: "(/?>)", name: "meta.tag.mark",
    beginCaptures: {
      1: punct("definition.tag.begin"),
      2: { patterns: [include("tag-name")] },
    },
    endCaptures: { 1: punct("definition.tag.end") },
    patterns: [include("attributes")],
  },
  "close-tag": {
    match: `(</)(${src(TAG_NAME)})\\s*(>)`, name: "meta.tag.mark",
    captures: {
      1: punct("definition.tag.begin"),
      2: { patterns: [include("tag-name")] },
      3: punct("definition.tag.end"),
    },
  },
  // A capture's patterns are not anchored, so try the component form first (§6.1).
  "tag-name": { patterns: [{ match: "[A-Z][A-Za-z0-9.]*", name: "support.class.component.mark" }, { match: "[a-z][a-z0-9-]*", name: "entity.name.tag.mark" }] },
  attributes: {
    patterns: [
      { begin: "\\b(if)\\b", end: `(?=/>|>(?!${src(GT_CONTINUES)}))|(?=\\s+\\$?${IDENT}\\s*=)|$`, beginCaptures: { 1: { name: "keyword.control.mark" } }, patterns: [include("expression")] },
      { match: `\\$${IDENT}(?:\\.${IDENT})*`, name: "variable.other.binding.mark" },
      { match: `(=)\\s*([^\\s>"'{$][^\\s>]*)`, captures: { 1: punct("separator.key-value"), 2: { name: "string.unquoted.mark" } } },
      { match: "=", name: "punctuation.separator.key-value.mark" },
      { match: src(ATTR_NAME), name: "entity.other.attribute-name.mark" },
      include("interpolation"),
      include("string"),
    ],
  },

  // ---- prose (anything else; only inline constructs are scoped) ----
  inline: {
    patterns: [
      { match: "\\\\.", name: "constant.character.escape.mark" },
      { match: "<!--.*?(?:-->|$)", name: "comment.block.html.mark" },
      { match: "(`+)(.+?)(\\1)", name: "markup.inline.raw.mark" },
      include("math-inline"),
      include("interpolation"),
      include("tag"),
      include("close-tag"),
      { match: "(\\*\\*|__)(?=\\S)(.+?)(?<=\\S)\\1", name: "markup.bold.mark" },
      { match: "(\\*|_)(?=\\S)(.+?)(?<=\\S)\\1", name: "markup.italic.mark" },
      {
        match: "(\\[)([^\\]]*)(\\])(\\()([^)]*)(\\))",
        captures: {
          1: punct("definition.link"), 2: { name: "string.other.link.title.mark", patterns: [include("interpolation")] }, 3: punct("definition.link"),
          4: punct("definition.link"), 5: { name: "markup.underline.link.mark", patterns: [include("interpolation")] }, 6: punct("definition.link"),
        },
      },
    ],
  },
  heading: { begin: "^\\s{0,3}(#{1,6})\\s", end: "$", name: "markup.heading.mark", beginCaptures: { 1: punct("definition.heading") }, patterns: [include("inline")] },
  bullet: { match: "^\\s*([-*+]|\\d+\\.)\\s", captures: { 1: punct("definition.list") } },
  // M-8: `$…$` / `$$…$$` on one line; a `$` between digits is literal and a closing `$` before a digit is skipped.
  "math-inline": {
    match: "(?<!\\\\)(?:(?<!\\d)|(?!\\$\\d))(\\$\\$?)(?=\\S)((?:\\\\.|[^\\\\])*?)(\\1)(?!\\d)", name: "markup.math.inline.mark",
    captures: { 1: punct("definition.math"), 2: { patterns: [include("math-interpolation")] }, 3: punct("definition.math") },
  },
  // Inside math a `{` is an interpolation only when whitespace-delimited (M-4).
  "math-interpolation": {
    begin: "(?<=\\s|\\$)(\\{)", end: "(\\})(?=\\s|\\$|$)", name: "meta.embedded.expression.mark",
    beginCaptures: { 1: punct("section.embedded.begin") }, endCaptures: { 1: punct("section.embedded.end") },
    patterns: [include("expression")],
  },
  interpolation: {
    begin: "\\{", end: "\\}", name: "meta.embedded.expression.mark",
    beginCaptures: { 0: punct("section.embedded.begin") }, endCaptures: { 0: punct("section.embedded.end") },
    patterns: [include("expression")],
  },

  // ---- expressions (spec §4) ----
  expression: {
    patterns: [
      { match: "//.*$", name: "comment.line.double-slash.mark" },
      include("string"),
      { match: "\\b\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?\\b", name: "constant.numeric.mark" },
      include("keywords"),
      { match: `\\.(${IDENT})`, captures: { 1: { name: "variable.other.property.mark" } } },
      { match: `\\b(${IDENT})\\s*(?=\\()`, captures: { 1: { name: "entity.name.function.mark" } } },
      { match: "=>", name: "keyword.operator.arrow.mark" },
      { match: "\\?\\.|\\*\\*|==|!=|<=|>=|&&|\\|\\||[-+*/%]=?|[=<>!?:]", name: "keyword.operator.mark" },
      { begin: "\\{", end: "\\}", beginCaptures: { 0: punct("definition.object.begin") }, endCaptures: { 0: punct("definition.object.end") }, patterns: [include("expression")] },
      { begin: "\\[", end: "\\]", beginCaptures: { 0: punct("definition.array.begin") }, endCaptures: { 0: punct("definition.array.end") }, patterns: [include("expression")] },
      { begin: "\\(", end: "\\)", beginCaptures: { 0: punct("definition.group.begin") }, endCaptures: { 0: punct("definition.group.end") }, patterns: [include("expression")] },
      { match: "[,;]", name: "punctuation.separator.mark" },
      { match: `\\b${IDENT}\\b`, name: "variable.other.mark" },
    ],
  },
  keywords: { patterns: Object.entries(KEYWORDS).map(([name, ws]) => ({ match: words(ws), name })) },
  string: {
    patterns: [
      { begin: '"', end: '"', name: "string.quoted.double.mark", patterns: [{ match: "\\\\.", name: "constant.character.escape.mark" }] },
      { begin: "'", end: "'", name: "string.quoted.single.mark", patterns: [{ match: "\\\\.", name: "constant.character.escape.mark" }] },
    ],
  },
};

const grammar = {
  $schema: "https://raw.githubusercontent.com/martinring/tmlanguage/master/tmlanguage.json",
  name: "Mark",
  scopeName: "source.mark",
  fileTypes: ["mark"],
  patterns: [
    "comment", "escaped-line", "fence", "math-block", "style", "fn-block", "decl-line", "closer", "heading", "bullet", "inline",
  ].map(include),
  repository,
};

const out = join(new URL("..", import.meta.url).pathname, "editors/vscode/syntaxes/mark.tmLanguage.json");
writeFileSync(out, JSON.stringify(grammar, null, 2) + "\n");
console.log(`wrote ${out}`);
