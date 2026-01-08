import { v7 as uuidv7 } from "uuid";
export class CRRecord {
    nodes = [];
    seenNodeIds = new Set();
    setTagsByProp = new Map();
    tombstones = new Set();
    aliveProps = new Set();
    latestValueByProp = new Map();
    listeners = new Set();
    constructor(snapshot) {
        if (snapshot?.length)
            this.merge(snapshot);
        return new Proxy(this, {
            get: (target, prop, receiver) => {
                if (typeof prop !== "string")
                    return Reflect.get(target, prop, receiver);
                if (prop in target)
                    return Reflect.get(target, prop, receiver);
                return target.get(prop);
            },
            set: (target, prop, value, receiver) => {
                if (typeof prop !== "string")
                    return Reflect.set(target, prop, value, receiver);
                if (prop in target)
                    return Reflect.set(target, prop, value, receiver);
                target.set(prop, value);
                return true;
            },
            deleteProperty: (target, prop) => {
                if (typeof prop !== "string")
                    return Reflect.deleteProperty(target, prop);
                if (prop in target)
                    return Reflect.deleteProperty(target, prop);
                return target.delete(prop);
            },
            has: (target, prop) => {
                if (typeof prop !== "string")
                    return Reflect.has(target, prop);
                if (prop in target)
                    return true;
                return target.aliveProps.has(prop);
            },
            ownKeys: (target) => [...target.aliveProps],
            getOwnPropertyDescriptor: (target, prop) => {
                if (typeof prop !== "string")
                    return Reflect.getOwnPropertyDescriptor(target, prop);
                if (prop in target)
                    return Reflect.getOwnPropertyDescriptor(target, prop);
                if (!target.aliveProps.has(prop))
                    return undefined;
                return { enumerable: true, configurable: true };
            },
        });
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
    // --- internals ---
    get(prop) {
        if (!this.aliveProps.has(prop))
            return undefined;
        return this.latestValueByProp.get(prop);
    }
    set(prop, value) {
        const node = { op: "set", id: this.newId(), prop, value };
        this.appendAndApply(node);
    }
    delete(prop) {
        const tags = this.setTagsByProp.get(prop);
        if (!tags?.size)
            return false;
        const node = {
            op: "del",
            id: this.newId(),
            prop,
            targets: [...tags.keys()],
        };
        this.appendAndApply(node);
        return true;
    }
    appendAndApply(node) {
        this.seenNodeIds.add(node.id);
        this.nodes.push(node);
        this.applyNode(node);
        this.emit([node]);
    }
    applyNode(node) {
        if (node.op === "set") {
            let tags = this.setTagsByProp.get(node.prop);
            if (!tags) {
                tags = new Map();
                this.setTagsByProp.set(node.prop, tags);
            }
            tags.set(node.id, node.value);
        }
        else {
            for (const t of node.targets)
                this.tombstones.add(t);
        }
        this.recompute(node.prop);
    }
    emit(patches) {
        for (const l of this.listeners)
            l(patches);
    }
    recompute(prop) {
        const tags = this.setTagsByProp.get(prop);
        if (!tags || tags.size === 0) {
            this.aliveProps.delete(prop);
            this.latestValueByProp.delete(prop);
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
            this.aliveProps.add(prop);
            this.latestValueByProp.set(prop, winnerValue);
            return;
        }
        this.aliveProps.delete(prop);
        this.latestValueByProp.delete(prop);
    }
    newId() {
        return uuidv7();
    }
}
