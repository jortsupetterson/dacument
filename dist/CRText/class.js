import { DAGNode } from "../DAGNode/class.js";
const ROOT = [];
function afterKey(after) {
    return after.join(",");
}
export class CRText {
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
    toString() {
        let output = "";
        for (const node of this.nodes)
            if (!node.deleted)
                output += String(node.value);
        return output;
    }
    at(index) {
        return this.alive().at(index);
    }
    insertAt(index, char) {
        if (!Number.isInteger(index))
            throw new TypeError("CRText.insertAt: index must be an integer");
        if (index < 0)
            throw new RangeError("CRText.insertAt: negative index not supported");
        if (index > this.length)
            throw new RangeError("CRText.insertAt: index out of bounds");
        const after = this.afterIdForAliveInsertAt(index);
        const node = new DAGNode({ value: char, after });
        this.nodes.push(node);
        this.nodeById.set(node.id, node);
        this.sort();
        this.emit([node]);
        return this;
    }
    deleteAt(index) {
        if (!Number.isInteger(index))
            throw new TypeError("CRText.deleteAt: index must be an integer");
        if (index < 0)
            throw new RangeError("CRText.deleteAt: negative index not supported");
        let aliveIndex = 0;
        for (const node of this.nodes) {
            if (node.deleted)
                continue;
            if (aliveIndex === index) {
                node.deleted = true;
                this.emit([node]);
                return node.value;
            }
            aliveIndex++;
        }
        return undefined;
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
