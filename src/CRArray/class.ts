import { DAGNode } from "../DAGNode/class.js";

const ROOT: readonly string[] = [];

function afterKey(after: readonly string[]): string {
  return after.join(",");
}

export class CRArray<T> {
  private readonly nodes: DAGNode<T>[] = [];
  private readonly nodeById = new Map<string, DAGNode<T>>();
  private readonly listeners = new Set<
    (nodes: readonly DAGNode<T>[]) => void
  >();

  constructor(snapshot?: readonly DAGNode<T>[]) {
    if (snapshot) {
      for (const node of snapshot) {
        if (this.nodeById.has(node.id)) continue;
        this.nodes.push(node);
        this.nodeById.set(node.id, node);
      }
    }
    this.sort();
    return new Proxy(this, {
      get: (target, property, receiver) => {
        if (typeof property === "string") {
          if (property === "length") return target.length;
          if (/^(0|[1-9]\d*)$/.test(property))
            return target.at(Number(property));
        }
        return Reflect.get(target, property, receiver);
      },
      set: (target, property, value, receiver) => {
        if (typeof property === "string" && /^(0|[1-9]\d*)$/.test(property)) {
          const index = Number(property);
          target.setAt(index, value as T);
          return true;
        }
        return Reflect.set(target, property, value, receiver);
      },
      has: (target, property) => {
        if (typeof property === "string" && /^(0|[1-9]\d*)$/.test(property)) {
          return Number(property) < target.length;
        }
        return Reflect.has(target, property);
      },
      ownKeys: (target) => {
        const keys = Reflect.ownKeys(target);
        const aliveCount = target.length;
        for (let index = 0; index < aliveCount; index++)
          keys.push(String(index));
        return keys;
      },
      getOwnPropertyDescriptor: (target, property) => {
        if (typeof property === "string" && /^(0|[1-9]\d*)$/.test(property)) {
          if (Number(property) >= target.length) return undefined;
          return {
            configurable: true,
            enumerable: true,
            writable: true,
            value: target.at(Number(property)),
          };
        }
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
    }) as this;
  }

  get length(): number {
    let count = 0;
    for (const node of this.nodes) if (!node.deleted) count++;
    return count;
  }

  // --- public API ---
  onChange(listener: (nodes: readonly DAGNode<T>[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  snapshot(): DAGNode<T>[] {
    return this.nodes.slice();
  }

  push(...items: T[]): number {
    let after = this.lastAliveId()
      ? ([this.lastAliveId() as string] as const)
      : ROOT;

    const changed: DAGNode<T>[] = [];
    for (const item of items) {
      const node = new DAGNode<T>({ value: item, after });
      this.nodes.push(node);
      this.nodeById.set(node.id, node);
      changed.push(node);
      after = [node.id] as const;
    }

    this.sort();
    this.emit(changed);
    return this.length;
  }

  unshift(...items: T[]): number {
    let after: readonly string[] = ROOT;

    const changed: DAGNode<T>[] = [];
    for (const item of items) {
      const node = new DAGNode<T>({ value: item, after });
      this.nodes.push(node);
      this.nodeById.set(node.id, node);
      changed.push(node);
      after = [node.id] as const;
    }

    this.sort();
    this.emit(changed);
    return this.length;
  }

  pop(): T | undefined {
    for (let index = this.nodes.length - 1; index >= 0; index--) {
      const node = this.nodes[index];
      if (!node.deleted) {
        node.deleted = true;
        this.emit([node]);
        return node.value;
      }
    }
    return undefined;
  }

  shift(): T | undefined {
    for (const node of this.nodes) {
      if (!node.deleted) {
        node.deleted = true;
        this.emit([node]);
        return node.value;
      }
    }
    return undefined;
  }

  at(index: number): T | undefined {
    return this.alive().at(index);
  }

  setAt(index: number, value: T): this {
    if (!Number.isInteger(index))
      throw new TypeError("CRArray.setAt: index must be an integer");
    if (index < 0)
      throw new RangeError("CRArray.setAt: negative index not supported");

    let aliveIndex = 0;
    let deletedNode: DAGNode<T> | null = null;
    for (const node of this.nodes) {
      if (node.deleted) continue;
      if (aliveIndex === index) {
        node.deleted = true;
        deletedNode = node;
        break;
      }
      aliveIndex++;
    }

    if (index > aliveIndex)
      throw new RangeError("CRArray.setAt: index out of bounds");

    const after = this.afterIdForAliveInsertAt(index);
    const newNode = new DAGNode<T>({ value, after });
    this.nodes.push(newNode);
    this.nodeById.set(newNode.id, newNode);
    this.sort();
    const changed = deletedNode ? [deletedNode, newNode] : [newNode];
    this.emit(changed);
    return this;
  }

  slice(start?: number, end?: number): T[] {
    return this.alive().slice(start, end);
  }

  includes(value: T): boolean {
    return this.alive().includes(value);
  }

  indexOf(value: T): number {
    return this.alive().indexOf(value);
  }

  find(
    predicate: (value: T, index: number, array: T[]) => boolean,
    thisArg?: unknown
  ): T | undefined {
    return this.alive().find(predicate, thisArg as never);
  }

  findIndex(
    predicate: (value: T, index: number, array: T[]) => boolean,
    thisArg?: unknown
  ): number {
    return this.alive().findIndex(predicate, thisArg as never);
  }

  forEach(
    callback: (value: T, index: number, array: T[]) => void,
    thisArg?: unknown
  ): void {
    this.alive().forEach(callback, thisArg as never);
  }

  map<U>(
    callback: (value: T, index: number, array: T[]) => U,
    thisArg?: unknown
  ): U[] {
    return this.alive().map(callback, thisArg as never);
  }

  filter(
    predicate: (value: T, index: number, array: T[]) => boolean,
    thisArg?: unknown
  ): T[] {
    return this.alive().filter(predicate, thisArg as never);
  }

  reduce<U>(
    reducer: (prev: U, curr: T, index: number, array: T[]) => U,
    initialValue: U
  ): U {
    return this.alive().reduce(reducer, initialValue);
  }

  every(
    predicate: (value: T, index: number, array: T[]) => boolean,
    thisArg?: unknown
  ): boolean {
    return this.alive().every(predicate, thisArg as never);
  }

  some(
    predicate: (value: T, index: number, array: T[]) => boolean,
    thisArg?: unknown
  ): boolean {
    return this.alive().some(predicate, thisArg as never);
  }

  [Symbol.iterator](): Iterator<T> {
    return this.alive()[Symbol.iterator]();
  }

  merge(remoteSnapshot: DAGNode<T>[] | DAGNode<T>): DAGNode<T>[] {
    const snapshot = Array.isArray(remoteSnapshot)
      ? remoteSnapshot
      : [remoteSnapshot];

    const changed: DAGNode<T>[] = [];
    for (const remote of snapshot) {
      const local = this.nodeById.get(remote.id);
      if (!local) {
        const clone = structuredClone(remote) as DAGNode<T>;
        this.nodes.push(clone);
        this.nodeById.set(clone.id, clone);
        changed.push(clone);
      } else if (!local.deleted && remote.deleted) {
        local.deleted = true;
        changed.push(local);
      }
    }

    if (changed.length) {
      this.sort();
      this.emit(changed);
    }
    return changed;
  }

  sort(compareFn?: (a: DAGNode<T>, b: DAGNode<T>) => number): this {
    if (compareFn) {
      this.nodes.sort(compareFn);
      return this;
    }

    this.nodes.sort((left, right) => {
      const leftIsRoot = left.after.length === 0;
      const rightIsRoot = right.after.length === 0;
      if (leftIsRoot !== rightIsRoot) return leftIsRoot ? -1 : 1;

      const leftAfterKey = afterKey(left.after);
      const rightAfterKey = afterKey(right.after);
      if (leftAfterKey !== rightAfterKey)
        return leftAfterKey < rightAfterKey ? -1 : 1;

      if (left.id === right.id) return 0;
      if (leftIsRoot) return left.id > right.id ? -1 : 1;
      return left.id < right.id ? -1 : 1;
    });

    return this;
  }

  // --- internals ---
  private alive(): T[] {
    const values: T[] = [];
    for (const node of this.nodes) if (!node.deleted) values.push(node.value);
    return values;
  }

  private lastAliveId(): string | null {
    for (let index = this.nodes.length - 1; index >= 0; index--) {
      const node = this.nodes[index];
      if (!node.deleted) return node.id;
    }
    return null;
  }

  private afterIdForAliveInsertAt(index: number): readonly string[] {
    if (index === 0) return ROOT;

    let aliveIndex = 0;
    let previousAliveId: string | null = null;

    for (const node of this.nodes) {
      if (node.deleted) continue;
      if (aliveIndex === index) break;
      previousAliveId = node.id;
      aliveIndex++;
    }

    if (previousAliveId) return [previousAliveId] as const;
    return ROOT;
  }

  private emit(nodes: readonly DAGNode<T>[]): void {
    if (nodes.length === 0) return;
    for (const listener of this.listeners) listener(nodes);
  }
}
