import { DAGNode } from "../DAGNode/class.js";
const ROOT = [];
function afterKey(after) {
    return after.join(",");
}
export class CRArray {
    nodes = [];
    nodeById = new Map();
    listeners = new Set();
    constructor(snapshot) {
        if (snapshot) {
            for (const node of snapshot) {
                if (this.nodeById.has(node.id))
                    continue;
                this.nodes.push(node);
                this.nodeById.set(node.id, node);
            }
        }
        this.sort();
        return new Proxy(this, {
            get: (target, property, receiver) => {
                if (typeof property === "string") {
                    if (property === "length")
                        return target.length;
                    if (/^(0|[1-9]\d*)$/.test(property))
                        return target.at(Number(property));
                }
                return Reflect.get(target, property, receiver);
            },
            set: (target, property, value, receiver) => {
                if (typeof property === "string" && /^(0|[1-9]\d*)$/.test(property)) {
                    const index = Number(property);
                    target.setAt(index, value);
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
                    if (Number(property) >= target.length)
                        return undefined;
                    return {
                        configurable: true,
                        enumerable: true,
                        writable: true,
                        value: target.at(Number(property)),
                    };
                }
                return Reflect.getOwnPropertyDescriptor(target, property);
            },
        });
    }
    get length() {
        let count = 0;
        for (const node of this.nodes)
            if (!node.deleted)
                count++;
        return count;
    }
    // --- public API ---
    onChange(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }
    snapshot() {
        return this.nodes.slice();
    }
    push(...items) {
        let after = this.lastAliveId()
            ? [this.lastAliveId()]
            : ROOT;
        const changed = [];
        for (const item of items) {
            const node = new DAGNode({ value: item, after });
            this.nodes.push(node);
            this.nodeById.set(node.id, node);
            changed.push(node);
            after = [node.id];
        }
        this.sort();
        this.emit(changed);
        return this.length;
    }
    unshift(...items) {
        let after = ROOT;
        const changed = [];
        for (const item of items) {
            const node = new DAGNode({ value: item, after });
            this.nodes.push(node);
            this.nodeById.set(node.id, node);
            changed.push(node);
            after = [node.id];
        }
        this.sort();
        this.emit(changed);
        return this.length;
    }
    pop() {
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
    shift() {
        for (const node of this.nodes) {
            if (!node.deleted) {
                node.deleted = true;
                this.emit([node]);
                return node.value;
            }
        }
        return undefined;
    }
    at(index) {
        return this.alive().at(index);
    }
    setAt(index, value) {
        if (!Number.isInteger(index))
            throw new TypeError("CRArray.setAt: index must be an integer");
        if (index < 0)
            throw new RangeError("CRArray.setAt: negative index not supported");
        let aliveIndex = 0;
        let deletedNode = null;
        for (const node of this.nodes) {
            if (node.deleted)
                continue;
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
        const newNode = new DAGNode({ value, after });
        this.nodes.push(newNode);
        this.nodeById.set(newNode.id, newNode);
        this.sort();
        const changed = deletedNode ? [deletedNode, newNode] : [newNode];
        this.emit(changed);
        return this;
    }
    slice(start, end) {
        return this.alive().slice(start, end);
    }
    includes(value) {
        return this.alive().includes(value);
    }
    indexOf(value) {
        return this.alive().indexOf(value);
    }
    find(predicate, thisArg) {
        return this.alive().find(predicate, thisArg);
    }
    findIndex(predicate, thisArg) {
        return this.alive().findIndex(predicate, thisArg);
    }
    forEach(callback, thisArg) {
        this.alive().forEach(callback, thisArg);
    }
    map(callback, thisArg) {
        return this.alive().map(callback, thisArg);
    }
    filter(predicate, thisArg) {
        return this.alive().filter(predicate, thisArg);
    }
    reduce(reducer, initialValue) {
        return this.alive().reduce(reducer, initialValue);
    }
    every(predicate, thisArg) {
        return this.alive().every(predicate, thisArg);
    }
    some(predicate, thisArg) {
        return this.alive().some(predicate, thisArg);
    }
    [Symbol.iterator]() {
        return this.alive()[Symbol.iterator]();
    }
    merge(remoteSnapshot) {
        const snapshot = Array.isArray(remoteSnapshot)
            ? remoteSnapshot
            : [remoteSnapshot];
        const changed = [];
        for (const remote of snapshot) {
            const local = this.nodeById.get(remote.id);
            if (!local) {
                const clone = structuredClone(remote);
                this.nodes.push(clone);
                this.nodeById.set(clone.id, clone);
                changed.push(clone);
            }
            else if (!local.deleted && remote.deleted) {
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
    sort(compareFn) {
        if (compareFn) {
            this.nodes.sort(compareFn);
            return this;
        }
        this.nodes.sort((left, right) => {
            const leftIsRoot = left.after.length === 0;
            const rightIsRoot = right.after.length === 0;
            if (leftIsRoot !== rightIsRoot)
                return leftIsRoot ? -1 : 1;
            const leftAfterKey = afterKey(left.after);
            const rightAfterKey = afterKey(right.after);
            if (leftAfterKey !== rightAfterKey)
                return leftAfterKey < rightAfterKey ? -1 : 1;
            if (left.id === right.id)
                return 0;
            if (leftIsRoot)
                return left.id > right.id ? -1 : 1;
            return left.id < right.id ? -1 : 1;
        });
        return this;
    }
    // --- internals ---
    alive() {
        const values = [];
        for (const node of this.nodes)
            if (!node.deleted)
                values.push(node.value);
        return values;
    }
    lastAliveId() {
        for (let index = this.nodes.length - 1; index >= 0; index--) {
            const node = this.nodes[index];
            if (!node.deleted)
                return node.id;
        }
        return null;
    }
    afterIdForAliveInsertAt(index) {
        if (index === 0)
            return ROOT;
        let aliveIndex = 0;
        let previousAliveId = null;
        for (const node of this.nodes) {
            if (node.deleted)
                continue;
            if (aliveIndex === index)
                break;
            previousAliveId = node.id;
            aliveIndex++;
        }
        if (previousAliveId)
            return [previousAliveId];
        return ROOT;
    }
    emit(nodes) {
        if (nodes.length === 0)
            return;
        for (const listener of this.listeners)
            listener(nodes);
    }
}
