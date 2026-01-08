import { v7 as uuidv7 } from "uuid";
function compareHLC(left, right) {
    if (left.wallTimeMs !== right.wallTimeMs)
        return left.wallTimeMs - right.wallTimeMs;
    if (left.logical !== right.logical)
        return left.logical - right.logical;
    // final deterministic tie-break
    if (left.clockId === right.clockId)
        return 0;
    return left.clockId < right.clockId ? -1 : 1;
}
export class CRRegister {
    last;
    winner = null;
    listeners = new Set();
    constructor() {
        this.last = { wallTimeMs: 0, logical: 0, clockId: uuidv7() };
    }
    // --- public API ---
    onChange(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }
    snapshot() {
        return this.winner ? [this.winner] : [];
    }
    merge(input) {
        const nodes = Array.isArray(input) ? input : [input];
        const accepted = [];
        for (const node of nodes) {
            if (this.apply(node))
                accepted.push(node);
        }
        if (accepted.length)
            this.emit(accepted);
        return accepted;
    }
    set(value, incomingStamp) {
        const stamp = incomingStamp ?? this.nextLocalStamp(Date.now());
        const candidate = { value, stamp };
        if (this.apply(candidate))
            this.emit([candidate]);
    }
    get() {
        return this.winner ? this.winner.value : null;
    }
    // --- internals ---
    nextLocalStamp(nowMs) {
        const wallTimeMs = Math.max(nowMs, this.last.wallTimeMs);
        const logical = wallTimeMs === this.last.wallTimeMs ? this.last.logical + 1 : 0;
        const next = { wallTimeMs, logical, clockId: this.last.clockId };
        this.last = next;
        return next;
    }
    apply(node) {
        this.advanceClock(node.stamp);
        const current = this.winner;
        if (!current || compareHLC(node.stamp, current.stamp) > 0) {
            this.winner = node;
            return true;
        }
        return false;
    }
    advanceClock(stamp) {
        // Keep local HLC monotonic even when receiving remote stamps.
        const mergedWall = Math.max(this.last.wallTimeMs, stamp.wallTimeMs, Date.now());
        const mergedLogical = mergedWall === this.last.wallTimeMs
            ? Math.max(this.last.logical, stamp.logical) + 1
            : mergedWall === stamp.wallTimeMs
                ? stamp.logical
                : 0;
        this.last = {
            wallTimeMs: mergedWall,
            logical: mergedLogical,
            clockId: this.last.clockId,
        };
    }
    emit(patches) {
        for (const listener of this.listeners)
            listener(patches);
    }
}
