import { v7 as uuidv7 } from "uuid";
export class CRSet {
    nodes = [];
    seenNodeIds = new Set();
    addTagsByKey = new Map();
    tombstones = new Set();
    aliveKeys = new Set();
    latestValueByKey = new Map();
    listeners = new Set();
    objectKeyByRef = new WeakMap();
    objectKeyCounter = 0;
    symbolKeyByRef = new Map();
    symbolKeyCounter = 0;
    keyFn;
    constructor(options) {
        this.keyFn = options?.key;
        if (options?.snapshot?.length)
            this.merge(options.snapshot);
    }
    // --- public API ---
    onChange(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }
    snapshot() {
        return this.nodes.slice();
    }
    merge(input) {
        const nodes = Array.isArray(input) ? input : [input];
        const accepted = [];
        for (const node of nodes) {
            if (this.seenNodeIds.has(node.id))
                continue;
            this.seenNodeIds.add(node.id);
            this.nodes.push(node);
            this.applyNode(node);
            accepted.push(node);
        }
        if (accepted.length)
            this.emit(accepted);
        return accepted;
    }
    // --- Set<T> API ---
    get size() {
        return this.aliveKeys.size;
    }
    add(value) {
        const key = this.keyOf(value);
        const node = { op: "add", id: this.newId(), value, key };
        this.appendAndApply(node);
        return this;
    }
    delete(value) {
        const key = this.keyOf(value);
        const targets = this.currentAddTagsForKey(key);
        if (targets.length === 0)
            return false;
        const node = { op: "rem", id: this.newId(), key, targets };
        this.appendAndApply(node);
        return true;
    }
    clear() {
        const patches = [];
        for (const key of this.aliveKeys) {
            const targets = this.currentAddTagsForKey(key);
            if (targets.length === 0)
                continue;
            patches.push({ op: "rem", id: this.newId(), key, targets });
        }
        if (patches.length === 0)
            return;
        for (const patch of patches) {
            this.seenNodeIds.add(patch.id);
            this.nodes.push(patch);
            this.applyNode(patch);
        }
        this.emit(patches);
    }
    has(value) {
        const key = this.keyOf(value);
        return this.aliveKeys.has(key);
    }
    forEach(callbackfn, thisArg) {
        for (const value of this.values())
            callbackfn.call(thisArg, value, value, this);
    }
    *values() {
        for (const key of this.aliveKeys) {
            if (!this.latestValueByKey.has(key))
                continue;
            yield this.latestValueByKey.get(key);
        }
    }
    *keys() {
        yield* this.values();
    }
    *entries() {
        for (const value of this.values())
            yield [value, value];
    }
    [Symbol.iterator]() {
        return this.values();
    }
    [Symbol.toStringTag] = "CRSet";
    // --- internals ---
    appendAndApply(node) {
        this.seenNodeIds.add(node.id);
        this.nodes.push(node);
        this.applyNode(node);
        this.emit([node]);
    }
    applyNode(node) {
        if (node.op === "add") {
            let tags = this.addTagsByKey.get(node.key);
            if (!tags) {
                tags = new Map();
                this.addTagsByKey.set(node.key, tags);
            }
            tags.set(node.id, node.value);
            this.recomputeAliveForKey(node.key);
            return;
        }
        for (const targetTag of node.targets)
            this.tombstones.add(targetTag);
        this.recomputeAliveForKey(node.key);
    }
    recomputeAliveForKey(key) {
        const tags = this.addTagsByKey.get(key);
        if (!tags || tags.size === 0) {
            this.aliveKeys.delete(key);
            this.latestValueByKey.delete(key);
            return;
        }
        let winnerTag = null;
        let winnerValue;
        for (const [tag, value] of tags) {
            if (this.tombstones.has(tag))
                continue;
            if (!winnerTag || tag > winnerTag) {
                winnerTag = tag;
                winnerValue = value;
            }
        }
        if (winnerTag) {
            this.aliveKeys.add(key);
            this.latestValueByKey.set(key, winnerValue);
            return;
        }
        this.aliveKeys.delete(key);
        this.latestValueByKey.delete(key);
    }
    currentAddTagsForKey(key) {
        const tags = this.addTagsByKey.get(key);
        if (!tags)
            return [];
        return [...tags.keys()];
    }
    emit(patches) {
        for (const listener of this.listeners)
            listener(patches);
    }
    newId() {
        return uuidv7();
    }
    keyOf(value) {
        if (this.keyFn)
            return this.keyFn(value);
        const valueType = typeof value;
        if (valueType === "string")
            return `str:${value}`;
        if (valueType === "number")
            return `num:${Object.is(value, -0) ? "-0" : String(value)}`;
        if (valueType === "bigint")
            return `big:${String(value)}`;
        if (valueType === "boolean")
            return `bool:${value ? "1" : "0"}`;
        if (valueType === "undefined")
            return "undef";
        if (value === null)
            return "null";
        if (valueType === "symbol") {
            const existing = this.symbolKeyByRef.get(value);
            if (existing)
                return existing;
            const created = `sym:${(++this.symbolKeyCounter).toString(36)}`;
            this.symbolKeyByRef.set(value, created);
            return created;
        }
        // objects + functions: stable identity key (matches native Set semantics)
        const objectRef = value;
        const existing = this.objectKeyByRef.get(objectRef);
        if (existing)
            return existing;
        const created = `obj:${(++this.objectKeyCounter).toString(36)}`;
        this.objectKeyByRef.set(objectRef, created);
        return created;
    }
}
