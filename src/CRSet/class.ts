import { v7 as uuidv7 } from "uuid";

type CRSetNode<T> =
  | { op: "add"; id: string; value: T; key: string }
  | { op: "rem"; id: string; key: string; targets: string[] };

type CRSetListener<T> = (patches: CRSetNode<T>[]) => void;

export class CRSet<T> implements Set<T> {
  private readonly nodes: CRSetNode<T>[] = [];
  private readonly seenNodeIds = new Set<string>();

  private readonly addTagsByKey = new Map<string, Map<string, T>>();
  private readonly tombstones = new Set<string>();
  private readonly aliveKeys = new Set<string>();
  private readonly latestValueByKey = new Map<string, T>();

  private readonly listeners = new Set<CRSetListener<T>>();

  private readonly objectKeyByRef = new WeakMap<object, string>();
  private objectKeyCounter = 0;
  private readonly symbolKeyByRef = new Map<symbol, string>();
  private symbolKeyCounter = 0;

  private readonly keyFn: ((value: T) => string) | undefined;

  constructor(options?: {
    snapshot?: CRSetNode<T>[];
    key?: (value: T) => string;
  }) {
    this.keyFn = options?.key;
    if (options?.snapshot?.length) this.merge(options.snapshot);
  }

  // --- public API ---
  onChange(listener: CRSetListener<T>): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  snapshot(): CRSetNode<T>[] {
    return this.nodes.slice();
  }

  merge(input: CRSetNode<T>[] | CRSetNode<T>): CRSetNode<T>[] {
    const nodes = Array.isArray(input) ? input : [input];
    const accepted: CRSetNode<T>[] = [];
    for (const node of nodes) {
      if (this.seenNodeIds.has(node.id)) continue;
      this.seenNodeIds.add(node.id);
      this.nodes.push(node);
      this.applyNode(node);
      accepted.push(node);
    }
    if (accepted.length) this.emit(accepted);
    return accepted;
  }

  // --- Set<T> API ---
  get size(): number {
    return this.aliveKeys.size;
  }

  add(value: T): this {
    const key = this.keyOf(value);
    const node: CRSetNode<T> = { op: "add", id: this.newId(), value, key };
    this.appendAndApply(node);
    return this;
  }

  delete(value: T): boolean {
    const key = this.keyOf(value);
    const targets = this.currentAddTagsForKey(key);
    if (targets.length === 0) return false;

    const node: CRSetNode<T> = { op: "rem", id: this.newId(), key, targets };
    this.appendAndApply(node);
    return true;
  }

  clear(): void {
    const patches: CRSetNode<T>[] = [];
    for (const key of this.aliveKeys) {
      const targets = this.currentAddTagsForKey(key);
      if (targets.length === 0) continue;
      patches.push({ op: "rem", id: this.newId(), key, targets });
    }
    if (patches.length === 0) return;

    for (const patch of patches) {
      this.seenNodeIds.add(patch.id);
      this.nodes.push(patch);
      this.applyNode(patch);
    }
    this.emit(patches);
  }

  has(value: T): boolean {
    const key = this.keyOf(value);
    return this.aliveKeys.has(key);
  }

  forEach(
    callbackfn: (value: T, value2: T, set: Set<T>) => void,
    thisArg?: unknown
  ): void {
    for (const value of this.values())
      callbackfn.call(thisArg, value, value, this);
  }

  *values(): SetIterator<T> {
    for (const key of this.aliveKeys) {
      if (!this.latestValueByKey.has(key)) continue;
      yield this.latestValueByKey.get(key) as T;
    }
  }

  *keys(): SetIterator<T> {
    yield* this.values();
  }

  *entries(): SetIterator<[T, T]> {
    for (const value of this.values()) yield [value, value];
  }

  [Symbol.iterator](): SetIterator<T> {
    return this.values();
  }

  readonly [Symbol.toStringTag] = "CRSet";

  // --- internals ---
  private appendAndApply(node: CRSetNode<T>): void {
    this.seenNodeIds.add(node.id);
    this.nodes.push(node);
    this.applyNode(node);
    this.emit([node]);
  }

  private applyNode(node: CRSetNode<T>): void {
    if (node.op === "add") {
      let tags = this.addTagsByKey.get(node.key);
      if (!tags) {
        tags = new Map<string, T>();
        this.addTagsByKey.set(node.key, tags);
      }
      tags.set(node.id, node.value);
      this.recomputeAliveForKey(node.key);
      return;
    }

    for (const targetTag of node.targets) this.tombstones.add(targetTag);
    this.recomputeAliveForKey(node.key);
  }

  private recomputeAliveForKey(key: string): void {
    const tags = this.addTagsByKey.get(key);
    if (!tags || tags.size === 0) {
      this.aliveKeys.delete(key);
      this.latestValueByKey.delete(key);
      return;
    }

    let winnerTag: string | null = null;
    let winnerValue: T | undefined;
    for (const [tag, value] of tags) {
      if (this.tombstones.has(tag)) continue;
      if (!winnerTag || tag > winnerTag) {
        winnerTag = tag;
        winnerValue = value;
      }
    }

    if (winnerTag) {
      this.aliveKeys.add(key);
      this.latestValueByKey.set(key, winnerValue as T);
      return;
    }

    this.aliveKeys.delete(key);
    this.latestValueByKey.delete(key);
  }

  private currentAddTagsForKey(key: string): string[] {
    const tags = this.addTagsByKey.get(key);
    if (!tags) return [];
    return [...tags.keys()];
  }

  private emit(patches: CRSetNode<T>[]): void {
    for (const listener of this.listeners) listener(patches);
  }

  private newId(): string {
    return uuidv7();
  }

  private keyOf(value: T): string {
    if (this.keyFn) return this.keyFn(value);

    const valueType = typeof value;

    if (valueType === "string") return `str:${value}`;
    if (valueType === "number")
      return `num:${Object.is(value, -0) ? "-0" : String(value)}`;
    if (valueType === "bigint") return `big:${String(value)}`;
    if (valueType === "boolean") return `bool:${value ? "1" : "0"}`;
    if (valueType === "undefined") return "undef";
    if (value === null) return "null";
    if (valueType === "symbol") {
      const existing = this.symbolKeyByRef.get(value as symbol);
      if (existing) return existing;
      const created = `sym:${(++this.symbolKeyCounter).toString(36)}`;
      this.symbolKeyByRef.set(value as symbol, created);
      return created;
    }

    // objects + functions: stable identity key (matches native Set semantics)
    const objectRef = value as unknown as object;
    const existing = this.objectKeyByRef.get(objectRef);
    if (existing) return existing;

    const created = `obj:${(++this.objectKeyCounter).toString(36)}`;
    this.objectKeyByRef.set(objectRef, created);
    return created;
  }
}
