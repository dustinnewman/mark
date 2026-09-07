// AST per spec section 13. Expressions are an ESTree subset.

export type Expr =
  | { type: "Literal"; value: string | number | boolean | null | undefined }
  | { type: "Identifier"; name: string }
  | { type: "MemberExpression"; object: Expr; property: Expr; computed: boolean; optional?: true }
  | { type: "CallExpression"; callee: Expr; arguments: Expr[]; optional?: true }
  | { type: "NewExpression"; callee: Expr; arguments: Expr[] }
  | { type: "ChainExpression"; expression: Expr }
  | { type: "ArrayExpression"; elements: Expr[] }
  | { type: "ObjectExpression"; properties: Property[] }
  | { type: "ArrowFunctionExpression"; async: boolean; params: Expr[]; body: Expr; expression: true }
  | { type: "UnaryExpression"; operator: "!" | "-" | "+"; prefix: true; argument: Expr }
  | { type: "BinaryExpression"; operator: string; left: Expr; right: Expr }
  | { type: "LogicalExpression"; operator: "&&" | "||"; left: Expr; right: Expr }
  | { type: "ConditionalExpression"; test: Expr; consequent: Expr; alternate: Expr }
  | { type: "AssignmentExpression"; operator: string; left: Expr; right: Expr }
  | { type: "SequenceExpression"; expressions: Expr[] }
  | { type: "AwaitExpression"; argument: Expr }
  | { type: "TryExpression"; expr: Expr; fallback: Expr };

export interface Property {
  type: "Property";
  key: Expr;
  value: Expr;
  computed: false;
  shorthand: boolean;
  kind: "init";
}

export type Stmt =
  | { s: "let" | "var"; name: string; init?: Expr; line: number }
  | { s: "if"; cond: Expr; then: Stmt[]; else?: Stmt[] | IfStmt; line: number }
  | { s: "for"; item: string; index?: string; src: Expr; body: Stmt[]; line: number }
  | { s: "return"; value?: Expr; line: number }
  | { s: "expr"; expr: Expr; line: number };
export type IfStmt = Extract<Stmt, { s: "if" }>;

export type Attr =
  | { k: "static"; name: string; value: string | true; if?: Expr }
  | { k: "dyn"; name: string; value: Expr; if?: Expr }
  | { k: "bind"; name: string; path: (string | Expr)[] }
  | { k: "event"; name: string; handler: Expr; wrap: boolean };

export type ProsePart =
  | { p: "text"; s: string }
  | { p: "interp"; expr: Expr; inMath: boolean }
  | { p: "tag"; node: TagNode };

export interface VarNode { t: "var"; name: string; init?: Expr; line: number }
export interface LetNode { t: "let"; name: string; init: Expr; line: number; export?: true }
export interface PropNode { t: "prop"; name: string; init?: Expr; line: number }
export interface FnNode { t: "fn"; name: string; params: string[]; async: boolean; body: Expr | Stmt[]; line: number; export?: true }
export interface StyleNode { t: "style"; css: string; global: boolean; line: number }
export interface IfNode { t: "if"; cond: Expr; then: Node[]; else?: Node[] | IfNode; line: number }
export interface ForNode { t: "for"; item: string; index?: string; src: Expr; key?: Expr; body: Node[]; line: number }
export interface TagNode { t: "tag"; name: string; kind: "html" | "comp"; attrs: Attr[]; children: Node[]; selfClose: boolean; line: number }
export interface ProseNode { t: "prose"; md: string; parts: ProsePart[]; line: number }
export interface HeadNode { t: "head"; children: Node[]; line: number }

export type Node = VarNode | LetNode | PropNode | FnNode | StyleNode | IfNode | ForNode | TagNode | ProseNode | HeadNode;
export type Decl = VarNode | LetNode | PropNode | FnNode;
export type Document = Node[];

/** Placeholder for prose part N inside `md` (A-8): NUL + N + NUL. */
export const PH = String.fromCharCode(0);
export const placeholder = (n: number): string => PH + n + PH;
export const PLACEHOLDER_RE = new RegExp(PH + "(\\d+)" + PH, "g");
