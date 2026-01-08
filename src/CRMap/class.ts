import { v7 as uuidv7 } from "uuid";

type CRMapNode<K, V> =
  | { op: "set"; id: string; key: K; keyId: string; value: V }
  | { op: "del"; id: string; keyId: string; targets: string[] };

type CRMapListener<K, V> = (patches: CRMapNode<K, V>[]) => void;

export class CRMap<K, V> implements Map<K, V> {
  private readonly nodes: CRMapNode<K, V>[] = [];
  private readonly seenNodeIds = new Set<string>();

  private readonly setTagsByKeyId = new Map<
    string,
    Map<string, { key: K; value: V }>
  >();
  private readonly tombstones = new Set<string>();
  private readonly aliveKeyIds = new Set<string>();
  private readonly latestKeyByKeyId = new Map<string, K>();
  private readonly latestValueByKeyId = new Map<string, V>();

  private readonly listeners = new Set<CRMapListener<K, V>>();

  private readonly keyIdByObjectRef = new WeakMap<object, string>();
  private objectKeyCounter = 0;
  private readonly symbolKeyByRef = new Map<symbol, string>();
  private symbolKeyCounter = 0;

  private readonly keyFn: ((key: K) => string) | undefined;

  constructor(options?: {
    snapshot?: CRMapNode<K, V>[];
    key?: (key: K) => string;
  }) {
    this.keyFn = options?.key;
    if (options?.snapshot?.length) this.merge(options.snapshot);
  }

  // --- public API ---
  onChange(listener: CRMapListener<K, V>): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  snapshot(): CRMapNode<K, V>[] {
    return this.nodes.slice();
  }

  merge(input: CRMapNode<K, V>[] | CRMapNode<K, V>): CRMapNode<K, V>[] {
    const nodes = Array.isArray(input) ? input : [input];
    const accepted: CRMapNode<K, V>[] = [];
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

  // --- Map<K, V> API ---
  get size(): number {
    return this.aliveKeyIds.size;
  }

  clear(): void {
    const patches: CRMapNode<K, V>[] = [];
    for (const keyId of this.aliveKeyIds) {
      const targets = this.currentSetTagsForKeyId(keyId);
      if (targets.length === 0) continue;
      patches.push({ op: "del", id: this.newId(), keyId, targets });
    }
    if (patches.length === 0) return;

    for (const patch of patches) {
      this.seenNodeIds.add(patch.id);
      this.nodes.push(patch);
      this.applyNode(patch);
    }
    this.emit(patches);
  }

  delete(key: K): boolean {
    const keyId = this.keyIdOf(key);
    const targets = this.currentSetTagsForKeyId(keyId);
    if (targets.length === 0) return false;

    const node: CRMapNode<K, V> = {
      op: "del",
      id: this.newId(),
      keyId,
      targets,
    };
    this.appendAndApply(node);
    return true;
  }

  forEach(
    callbackfn: (value: V, key: K, map: Map<K, V>) => void,
    thisArg?: unknown
  ): void {
    for (const [key, value] of this.entries())
      callbackfn.call(thisArg, value, key, this);
  }

  get(key: K): V | undefined {
    const keyId = this.keyIdOf(key);
    if (!this.aliveKeyIds.has(keyId)) return undefined;
    return this.latestValueByKeyId.get(keyId);
  }

  has(key: K): boolean {
    const keyId = this.keyIdOf(key);
    return this.aliveKeyIds.has(keyId);
  }

  set(key: K, value: V): this {
    const keyId = this.keyIdOf(key);
    const node: CRMapNode<K, V> = {
      op: "set",
      id: this.newId(),
      key,
      keyId,
      value,
    };
    this.appendAndApply(node);
    return this;
  }

  *entries(): MapIterator<[K, V]> {
    for (const keyId of this.aliveKeyIds) {
      if (
        !this.latestKeyByKeyId.has(keyId) ||
        !this.latestValueByKeyId.has(keyId)
      )
        continue;
      const key = this.latestKeyByKeyId.get(keyId) as K;
      const value = this.latestValueByKeyId.get(keyId) as V;
      yield [key, value];
    }
  }

  *keys(): MapIterator<K> {
    for (const [key] of this.entries()) yield key;
  }

  *values(): MapIterator<V> {
    for (const [, value] of this.entries()) yield value;
  }

  [Symbol.iterator](): MapIterator<[K, V]> {
    return this.entries();
  }

  readonly [Symbol.toStringTag] = "CRMap";

  // --- internals ---
  private appendAndApply(node: CRMapNode<K, V>): void {
    this.seenNodeIds.add(node.id);
    this.nodes.push(node);
    this.applyNode(node);
    this.emit([node]);
  }

  private applyNode(node: CRMapNode<K, V>): void {
    if (node.op === "set") {
      let tags = this.setTagsByKeyId.get(node.keyId);
      if (!tags) {
        tags = new Map<string, { key: K; value: V }>();
        this.setTagsByKeyId.set(node.keyId, tags);
      }
      tags.set(node.id, { key: node.key, value: node.value });
      this.recomputeKeyId(node.keyId);
      return;
    }

    for (const targetTag of node.targets) this.tombstones.add(targetTag);
    this.recomputeKeyId(node.keyId);
  }

  private recomputeKeyId(keyId: string): void {
    const tags = this.setTagsByKeyId.get(keyId);
    if (!tags || tags.size === 0) {
      this.aliveKeyIds.delete(keyId);
      this.latestKeyByKeyId.delete(keyId);
      this.latestValueByKeyId.delete(keyId);
      return;
    }

    let winnerTag: string | null = null;
    let winner: { key: K; value: V } | null = null;
    for (const [tag, entry] of tags) {
      if (this.tombstones.has(tag)) continue;
      if (!winnerTag || tag > winnerTag) {
        winnerTag = tag;
        winner = entry;
      }
    }

    if (winnerTag && winner) {
      this.aliveKeyIds.add(keyId);
      this.latestKeyByKeyId.set(keyId, winner.key);
      this.latestValueByKeyId.set(keyId, winner.value);
      return;
    }

    this.aliveKeyIds.delete(keyId);
    this.latestKeyByKeyId.delete(keyId);
    this.latestValueByKeyId.delete(keyId);
  }

  private currentSetTagsForKeyId(keyId: string): string[] {
    const tags = this.setTagsByKeyId.get(keyId);
    if (!tags) return [];
    return [...tags.keys()];
  }

  private emit(patches: CRMapNode<K, V>[]): void {
    for (const listener of this.listeners) listener(patches);
  }

  private newId(): string {
    return uuidv7();
  }

  private keyIdOf(key: K): string {
    if (this.keyFn) return this.keyFn(key);

    const keyType = typeof key;

    if (keyType === "string") return `str:${key}`;
    if (keyType === "number")
      return `num:${Object.is(key, -0) ? "-0" : String(key)}`;
    if (keyType === "bigint") return `big:${String(key)}`;
    if (keyType === "boolean") return `bool:${key ? "1" : "0"}`;
    if (keyType === "undefined") return "undef";
    if (key === null) return "null";
    if (keyType === "symbol") {
      const existing = this.symbolKeyByRef.get(key as symbol);
      if (existing) return existing;
      const created = `sym:${(++this.symbolKeyCounter).toString(36)}`;
      this.symbolKeyByRef.set(key as symbol, created);
      return created;
    }

    const objectRef = key as unknown as object;
    const existing = this.keyIdByObjectRef.get(objectRef);
    if (existing) return existing;

    const created = `obj:${(++this.objectKeyCounter).toString(36)}`;
    this.keyIdByObjectRef.set(objectRef, created);
    return created;
  }
}
