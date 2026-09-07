// Reactive core (spec section 11): signals, computeds, effects with automatic
// dependency tracking; push-based invalidation, pull-based evaluation.

const CLEAN = 0, CHECK = 1, DIRTY = 2;

export class CycleError extends Error {
  code = "RT03";
  constructor(names: string[]) { super("Cycle: " + names.join(" → ")); }
}

/** Something that owns computations and cleanups and can be disposed (R-7). */
export class Owner {
  children: (Owner | Rx)[] = [];
  cleanups: (() => void)[] = [];
  disposed = false;
  parent: Owner | null;
  constructor(parent: Owner | null = currentOwner) {
    this.parent = parent;
    if (parent) parent.children.push(this);
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.disposeChildren();
    if (this.parent) {
      const i = this.parent.children.indexOf(this);
      if (i >= 0) this.parent.children.splice(i, 1);
    }
  }
  disposeChildren(): void {
    const kids = this.children;
    this.children = [];
    for (let i = kids.length - 1; i >= 0; i--) {
      const k = kids[i];
      k.parent = null;
      k.dispose();
    }
    const cl = this.cleanups;
    this.cleanups = [];
    for (let i = cl.length - 1; i >= 0; i--) cl[i]();
  }
}

/** A reactive node: a signal (no fn), a computed (fn, not effect) or an effect. */
export class Rx<T = unknown> extends Owner {
  value: T;
  fn: (() => T) | null;
  sources: Rx[] = [];
  observers: Rx[] = [];
  state: number;
  effect: boolean;
  running = false;
  name: string;

  constructor(value: T, fn: (() => T) | null, effect = false, name = "") {
    super(fn ? currentOwner : null);
    this.value = value;
    this.fn = fn;
    this.effect = effect;
    this.state = fn ? DIRTY : CLEAN;
    this.name = name;
    if (effect) this.update();
  }

  get(): T {
    if (currentRx && tracking) {
      const obs = this.observers;
      if (obs[obs.length - 1] !== currentRx) {
        obs.push(currentRx);
        currentRx.sources.push(this);
      }
    }
    if (this.fn) {
      if (this.running) throw new CycleError([this.name, this.name]);
      this.updateIfNecessary();
    }
    return this.value;
  }

  peek(): T {
    if (this.fn) this.updateIfNecessary();
    return this.value;
  }

  set(v: T): void {
    if (this.fn) throw new Error("Cannot assign to a computed value");
    if (v === this.value) return; // R-6
    this.value = v;
    this.mark(DIRTY);
    if (batchDepth === 0) scheduleFlush();
  }

  /** Mark observers stale. Direct observers become DIRTY, transitive ones CHECK. */
  private mark(state: number): void {
    for (const o of this.observers) {
      if (o.state < state) {
        o.state = state;
        if (o.effect) queue.push(o);
        if (state === DIRTY || o.state === CHECK) o.markCheck();
      }
    }
  }
  private markCheck(): void {
    for (const o of this.observers) {
      if (o.state === CLEAN) {
        o.state = CHECK;
        if (o.effect) queue.push(o);
        o.markCheck();
      }
    }
  }

  updateIfNecessary(): void {
    if (this.state === CHECK) {
      for (const s of this.sources) {
        s.updateIfNecessary();
        if ((this.state as number) === DIRTY) break;
      }
    }
    if (this.state === DIRTY) this.update();
    this.state = CLEAN;
  }

  private unlink(): void {
    for (const s of this.sources) {
      const i = s.observers.indexOf(this);
      if (i >= 0) s.observers.splice(i, 1);
    }
    this.sources = [];
  }

  update(): void {
    if (this.disposed || !this.fn) return;
    if (this.running) throw new CycleError([this.name, this.name]);
    this.disposeChildren();
    this.unlink();
    const prevRx = currentRx, prevOwner = currentOwner, prevTracking = tracking;
    currentRx = this;
    currentOwner = this;
    tracking = true;
    this.running = true;
    let next: T;
    try {
      next = this.fn();
    } finally {
      this.running = false;
      currentRx = prevRx;
      currentOwner = prevOwner;
      tracking = prevTracking;
    }
    this.state = CLEAN;
    if (this.effect) return;
    if (next !== this.value) {
      this.value = next;
      for (const o of this.observers) o.state = DIRTY;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    super.dispose();
    this.unlink();
    this.fn = null;
  }
}

let currentRx: Rx | null = null;
let currentOwner: Owner | null = null;
let tracking = true;
let batchDepth = 0;
let queue: Rx[] = [];
let flushScheduled = false;

export const signal = <T>(value: T, name = ""): Rx<T> => new Rx<T>(value, null, false, name);
export const computed = <T>(fn: () => T, name = ""): Rx<T> => new Rx<T>(undefined as T, fn, false, name);
export const effect = (fn: () => void, name = ""): Rx<void> => new Rx<void>(undefined, fn, true, name);

export function untrack<T>(fn: () => T): T {
  const prev = tracking;
  tracking = false;
  try { return fn(); } finally { tracking = prev; }
}

export function getOwner(): Owner | null { return currentOwner; }

export function runWithOwner<T>(owner: Owner | null, fn: () => T): T {
  const prevOwner = currentOwner, prevRx = currentRx, prevTracking = tracking;
  currentOwner = owner;
  currentRx = null;
  tracking = false;
  try { return fn(); } finally { currentOwner = prevOwner; currentRx = prevRx; tracking = prevTracking; }
}

export function onCleanup(fn: () => void): void {
  if (currentOwner) currentOwner.cleanups.push(fn);
}

/** Run `fn` with effects deferred until it returns (C-17). */
export function batch<T>(fn: () => T): T {
  batchDepth++;
  try { return fn(); } finally {
    batchDepth--;
    if (batchDepth === 0) flush();
  }
}

/** Run all pending effects now (R-3). */
export function flush(): void {
  flushScheduled = false;
  let guard = 0;
  while (queue.length) {
    const q = queue;
    queue = [];
    for (const e of q) if (!e.disposed && e.state !== CLEAN) e.updateIfNecessary();
    if (++guard > 1000) throw new Error("Effect loop: effects keep scheduling each other");
  }
}

function scheduleFlush(): void {
  if (flushScheduled) return;
  flushScheduled = true;
  queueMicrotask(() => { if (flushScheduled) flush(); });
}
