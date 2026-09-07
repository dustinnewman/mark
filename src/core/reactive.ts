// Deep reactivity (C-5, R-4): objects and arrays stored in signals are wrapped in
// proxies that track reads per key and notify on writes.
import { Rx, signal } from "./signal.ts";

const RAW = Symbol("mk.raw");
const ITERATE = Symbol("mk.iterate");
const proxies = new WeakMap<object, object>();
const deps = new WeakMap<object, Map<PropertyKey, Rx<number>>>();

const isPlain = (v: unknown): v is object => {
  if (typeof v !== "object" || v === null) return false;
  if (Array.isArray(v)) return true;
  const p = Object.getPrototypeOf(v);
  return p === Object.prototype || p === null;
};

export function toRaw<T>(v: T): T {
  return (typeof v === "object" && v !== null && (v as Record<symbol, T>)[RAW]) || v;
}

/** Strict equality that sees through proxies (5.5). */
export const eq = (a: unknown, b: unknown): boolean => toRaw(a) === toRaw(b);

export function reactive<T>(v: T): T {
  if (!isPlain(v) || Object.isFrozen(v)) return v;
  const raw = toRaw(v) as object;
  if (raw !== v) return v; // already a proxy
  let p = proxies.get(raw);
  if (!p) {
    p = new Proxy(raw, handlers);
    proxies.set(raw, p);
  }
  return p as T;
}

function track(target: object, key: PropertyKey): void {
  let m = deps.get(target);
  if (!m) deps.set(target, (m = new Map()));
  let s = m.get(key);
  if (!s) m.set(key, (s = signal(0)));
  s.get();
}

function trigger(target: object, key: PropertyKey): void {
  const s = deps.get(target)?.get(key);
  if (s) s.set(s.value + 1);
}

const handlers: ProxyHandler<object> = {
  get(target, key, receiver) {
    if (key === RAW) return target;
    const res = Reflect.get(target, key, receiver);
    if (typeof key === "symbol") return res;
    track(target, key);
    if (typeof res === "function") return res;
    return reactive(res);
  },
  set(target, key, value) {
    const raw = toRaw(value);
    const had = Object.prototype.hasOwnProperty.call(target, key);
    const old = (target as Record<PropertyKey, unknown>)[key];
    const ok = Reflect.set(target, key, raw);
    if (!had) {
      trigger(target, key);
      trigger(target, ITERATE);
      if (Array.isArray(target)) trigger(target, "length");
    } else if (old !== raw || (key === "length" && Array.isArray(target))) {
      trigger(target, key);
      if (key === "length") trigger(target, ITERATE);
    }
    return ok;
  },
  deleteProperty(target, key) {
    const had = Object.prototype.hasOwnProperty.call(target, key);
    const ok = Reflect.deleteProperty(target, key);
    if (had) { trigger(target, key); trigger(target, ITERATE); }
    return ok;
  },
  has(target, key) {
    if (typeof key !== "symbol") track(target, key);
    return Reflect.has(target, key);
  },
  ownKeys(target) {
    track(target, ITERATE);
    return Reflect.ownKeys(target);
  },
};

/** Deep-freeze plain data (P-3). */
export function deepFreeze<T>(v: T): T {
  if (isPlain(v) && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const k of Object.keys(v as object)) deepFreeze((v as Record<string, unknown>)[k]);
  }
  return v;
}
