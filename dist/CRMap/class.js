import { v7 as uuidv7 } from "uuid";
export class CRMap {
    nodes = [];
    seenNodeIds = new Set();
    setTagsByKeyId = new Map();
    tombstones = new Set();
    aliveKeyIds = new Set();
    latestKeyByKeyId = new Map();
    latestValueByKeyId = new Map();
    listeners = new Set();
    keyIdByObjectRef = new WeakMap();
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
    // --- Map<K, V> API ---
    get size() {
        return this.aliveKeyIds.size;
    }
    clear() {
        const patches = [];
        for (const keyId of this.aliveKeyIds) {
            const targets = this.currentSetTagsForKeyId(keyId);
            if (targets.length === 0)
                continue;
            patches.push({ op: "del", id: this.newId(), keyId, targets });
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
    delete(key) {
        const keyId = this.keyIdOf(key);
        const targets = this.currentSetTagsForKeyId(keyId);
        if (targets.length === 0)
            return false;
        const node = {
            op: "del",
            id: this.newId(),
            keyId,
            targets,
        };
        this.appendAndApply(node);
        return true;
    }
    forEach(callbackfn, thisArg) {
        for (const [key, value] of this.entries())
            callbackfn.call(thisArg, value, key, this);
    }
    get(key) {
        const keyId = this.keyIdOf(key);
        if (!this.aliveKeyIds.has(keyId))
            return undefined;
        return this.latestValueByKeyId.get(keyId);
    }
    has(key) {
        const keyId = this.keyIdOf(key);
        return this.aliveKeyIds.has(keyId);
    }
    set(key, value) {
        const keyId = this.keyIdOf(key);
        const node = {
            op: "set",
            id: this.newId(),
            key,
            keyId,
            value,
        };
        this.appendAndApply(node);
        return this;
    }
    *entries() {
        for (const keyId of this.aliveKeyIds) {
            if (!this.latestKeyByKeyId.has(keyId) ||
                !this.latestValueByKeyId.has(keyId))
                continue;
            const key = this.latestKeyByKeyId.get(keyId);
            const value = this.latestValueByKeyId.get(keyId);
            yield [key, value];
        }
    }
    *keys() {
        for (const [key] of this.entries())
            yield key;
    }
    *values() {
        for (const [, value] of this.entries())
            yield value;
    }
    [Symbol.iterator]() {
        return this.entries();
    }
    [Symbol.toStringTag] = "CRMap";
    // --- internals ---
    appendAndApply(node) {
        this.seenNodeIds.add(node.id);
        this.nodes.push(node);
        this.applyNode(node);
        this.emit([node]);
    }
    applyNode(node) {
        if (node.op === "set") {
            let tags = this.setTagsByKeyId.get(node.keyId);
            if (!tags) {
                tags = new Map();
                this.setTagsByKeyId.set(node.keyId, tags);
            }
            tags.set(node.id, { key: node.key, value: node.value });
            this.recomputeKeyId(node.keyId);
            return;
        }
        for (const targetTag of node.targets)
            this.tombstones.add(targetTag);
        this.recomputeKeyId(node.keyId);
    }
    recomputeKeyId(keyId) {
        const tags = this.setTagsByKeyId.get(keyId);
        if (!tags || tags.size === 0) {
            this.aliveKeyIds.delete(keyId);
            this.latestKeyByKeyId.delete(keyId);
            this.latestValueByKeyId.delete(keyId);
            return;
        }
        let winnerTag = null;
        let winner = null;
        for (const [tag, entry] of tags) {
            if (this.tombstones.has(tag))
                continue;
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
    currentSetTagsForKeyId(keyId) {
        const tags = this.setTagsByKeyId.get(keyId);
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
    keyIdOf(key) {
        if (this.keyFn)
            return this.keyFn(key);
        const keyType = typeof key;
        if (keyType === "string")
            return `str:${key}`;
        if (keyType === "number")
            return `num:${Object.is(key, -0) ? "-0" : String(key)}`;
        if (keyType === "bigint")
            return `big:${String(key)}`;
        if (keyType === "boolean")
            return `bool:${key ? "1" : "0"}`;
        if (keyType === "undefined")
            return "undef";
        if (key === null)
            return "null";
        if (keyType === "symbol") {
            const existing = this.symbolKeyByRef.get(key);
            if (existing)
                return existing;
            const created = `sym:${(++this.symbolKeyCounter).toString(36)}`;
            this.symbolKeyByRef.set(key, created);
            return created;
        }
        const objectRef = key;
        const existing = this.keyIdByObjectRef.get(objectRef);
        if (existing)
            return existing;
        const created = `obj:${(++this.objectKeyCounter).toString(36)}`;
        this.keyIdByObjectRef.set(objectRef, created);
        return created;
    }
}
