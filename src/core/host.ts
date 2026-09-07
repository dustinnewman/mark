// Evaluator whitelist (V-1) and value helpers shared by build and runtime.
import { toRaw } from "./reactive.ts";

const words = (s: string): Set<string> => new Set(s.split(" "));

export const MATH_MEMBERS = words("abs ceil floor round trunc sign sqrt cbrt pow exp log log2 log10 min max hypot sin cos tan asin acos atan atan2 PI E random");
export const NUMBER_STATIC = words("isFinite isInteger isNaN parseFloat parseInt MAX_SAFE_INTEGER EPSILON");
export const NUMBER_METHODS = words("toFixed toPrecision toString");
export const STRING_METHODS = words("length slice substring indexOf lastIndexOf includes startsWith endsWith split trim trimStart trimEnd toUpperCase toLowerCase replace replaceAll repeat padStart padEnd charAt charCodeAt at localeCompare concat");
export const ARRAY_STATIC = words("isArray from of");
export const ARRAY_METHODS = words("length map filter reduce reduceRight find findIndex findLast findLastIndex some every includes indexOf lastIndexOf join slice concat flat flatMap at keys entries values sort toSorted reverse toReversed push pop shift unshift splice fill forEach");
export const ARRAY_MUTATORS = words("sort reverse push pop shift unshift splice fill");
export const OBJECT_STATIC = words("keys values entries fromEntries assign freeze");
export const JSON_STATIC = words("parse stringify");
export const DATE_STATIC = words("now");
export const DATE_METHODS = words("getFullYear getMonth getDate getDay getHours getMinutes getSeconds getTime valueOf toISOString toLocaleDateString toLocaleTimeString toLocaleString");
export const CONSOLE_MEMBERS = words("log warn error");
export const PROMISE_STATIC = words("all allSettled race resolve reject");
export const ENV_MEMBERS = words("reducedMotion client dev touch");

/** UTC accessors so build and browser agree regardless of time zone (V-3). */
const DATE_MAP: Record<string, string> = {
  getFullYear: "getUTCFullYear", getMonth: "getUTCMonth", getDate: "getUTCDate", getDay: "getUTCDay",
  getHours: "getUTCHours", getMinutes: "getUTCMinutes", getSeconds: "getUTCSeconds",
};

export class HostError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}

export const e021 = (m: string): HostError => new HostError("E021", `\`${m}\` is not available in Mark expressions`);

/** Code-point string comparison used by both sides (V-3). */
export const compareStrings = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** M-4 formatting of an interpolated value. */
export function fmt(v: unknown): string {
  if (v === null || v === undefined || v === false) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") return String(v);
  if (Array.isArray(v)) return v.map(fmt).join("");
  if (typeof v === "function") return "";
  if (v instanceof Date) return v.toISOString();
  return JSON.stringify(v);
}

/** `style={obj}` serialization (T-6, T-26). */
export function styleToString(v: unknown): string {
  if (v === null || v === undefined || v === false) return "";
  if (typeof v === "string") return v;
  if (typeof v !== "object") return String(v);
  const raw = toRaw(v) as Record<string, unknown>;
  const out: string[] = [];
  for (const k of Object.keys(raw)) {
    const val = raw[k];
    if (val === null || val === undefined || val === false || val === "") continue;
    const name = k.startsWith("--") ? k : k.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());
    out.push(`${name}: ${String(val)}`);
  }
  return out.join("; ");
}

export const BOOLEAN_ATTRS = words("disabled checked hidden readonly required selected multiple autofocus autoplay controls loop muted open default defer async novalidate formnovalidate inert itemscope nomodule playsinline reversed");

/** Attribute text for a dynamic value: null means "omit the attribute". */
export function attrValue(name: string, v: unknown): string | null {
  if (name === "style") { const s = styleToString(v); return s === "" ? null : s; }
  if (BOOLEAN_ATTRS.has(name)) return v ? "" : null;
  if (v === null || v === undefined || v === false) return null;
  if (v === true) return "";
  return fmt(v);
}

export const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export const escapeAttr = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
