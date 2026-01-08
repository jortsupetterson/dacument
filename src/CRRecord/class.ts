import { v7 as uuidv7 } from "uuid";

type CRRecordNode<V> =
  | { op: "set"; id: string; prop: string; value: V }
  | { op: "del"; id: string; prop: string; targets: string[] };

type CRRecordListener<V> = (patches: CRRecordNode<V>[]) => void;

export class CRRecord<V = unknown> {
  private readonly nodes: CRRecordNode<V>[] = [];
  private readonly seenNodeIds = new Set<string>();

  private readonly setTagsByProp = new Map<string, Map<string, V>>();
  private readonly tombstones = new Set<string>();
  private readonly aliveProps = new Set<string>();
  private readonly latestValueByProp = new Map<string, V>();

  private readonly listeners = new Set<CRRecordListener<V>>();

  constructor(snapshot?: CRRecordNode<V>[]) {
    if (snapshot?.length) this.merge(snapshot);

    return new Proxy(this as any, {
      get: (target, prop, receiver) => {
        if (typeof prop !== "string")
          return Reflect.get(target, prop, receiver);
        if (prop in target) return Reflect.get(target, prop, receiver);
        return target.get(prop);
      },

      set: (target, prop, value, receiver) => {
        if (typeof prop !== "string")
          return Reflect.set(target, prop, value, receiver);
        if (prop in target) return Reflect.set(target, prop, value, receiver);
        target.set(prop, value);
        return true;
      },

      deleteProperty: (target, prop) => {
        if (typeof prop !== "string")
          return Reflect.deleteProperty(target, prop);
        if (prop in target) return Reflect.deleteProperty(target, prop);
        return target.delete(prop);
      },

      has: (target, prop) => {
        if (typeof prop !== "string") return Reflect.has(target, prop);
        if (prop in target) return true;
        return target.aliveProps.has(prop);
      },

      ownKeys: (target) => [...target.aliveProps],

      getOwnPropertyDescriptor: (target, prop) => {
        if (typeof prop !== "string")
          return Reflect.getOwnPropertyDescriptor(target, prop);
        if (prop in target)
          return Reflect.getOwnPropertyDescriptor(target, prop);
        if (!target.aliveProps.has(prop)) return undefined;
        return { enumerable: true, configurable: true };
      },
    });
  }

  // --- public API ---

  onChange(listener: CRRecordListener<V>): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  snapshot(): CRRecordNode<V>[] {
    return this.nodes.slice();
  }

  merge(input: CRRecordNode<V>[] | CRRecordNode<V>): CRRecordNode<V>[] {
    const nodes = Array.isArray(input) ? input : [input];
    const accepted: CRRecordNode<V>[] = [];
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

  // --- internals ---

  private get(prop: string): V | undefined {
    if (!this.aliveProps.has(prop)) return undefined;
    return this.latestValueByProp.get(prop);
  }

  private set(prop: string, value: V): void {
    const node: CRRecordNode<V> = { op: "set", id: this.newId(), prop, value };
    this.appendAndApply(node);
  }

  private delete(prop: string): boolean {
    const tags = this.setTagsByProp.get(prop);
    if (!tags?.size) return false;
    const node: CRRecordNode<V> = {
      op: "del",
      id: this.newId(),
      prop,
      targets: [...tags.keys()],
    };
    this.appendAndApply(node);
    return true;
  }

  private appendAndApply(node: CRRecordNode<V>) {
    this.seenNodeIds.add(node.id);
    this.nodes.push(node);
    this.applyNode(node);
    this.emit([node]);
  }

  private applyNode(node: CRRecordNode<V>) {
    if (node.op === "set") {
      let tags = this.setTagsByProp.get(node.prop);
      if (!tags) {
        tags = new Map<string, V>();
        this.setTagsByProp.set(node.prop, tags);
      }
      tags.set(node.id, node.value);
    } else {
      for (const t of node.targets) this.tombstones.add(t);
    }
    this.recompute(node.prop);
  }

  private emit(patches: CRRecordNode<V>[]) {
    for (const l of this.listeners) l(patches);
  }

  private recompute(prop: string): void {
    const tags = this.setTagsByProp.get(prop);
    if (!tags || tags.size === 0) {
      this.aliveProps.delete(prop);
      this.latestValueByProp.delete(prop);
      return;
    }

    let winnerTag: string | null = null;
    let winnerValue: V | undefined;
    for (const [tag, value] of tags) {
      if (this.tombstones.has(tag)) continue;
      if (!winnerTag || tag > winnerTag) {
        winnerTag = tag;
        winnerValue = value;
      }
    }

    if (winnerTag) {
      this.aliveProps.add(prop);
      this.latestValueByProp.set(prop, winnerValue as V);
      return;
    }

    this.aliveProps.delete(prop);
    this.latestValueByProp.delete(prop);
  }

  private newId(): string {
    return uuidv7();
  }
}
