/**
 * PN-Counter (Positive-Negative Counter)
 * CRDT model where:
 *   - Each replica tracks its own increments and decrements
 *   - Merge = element-wise max
 *   - Final value = sum(increments) − sum(decrements)
 */
export class PNCounter {
  /**
   * @param {string} localNodeId
   * @param {{[nodeId: string]: number}} [increments]
   * @param {{[nodeId: string]: number}} [decrements]
   */
  constructor(localNodeId, increments = {}, decrements = {}) {
    this.localNodeId = localNodeId;
    this.increments = { ...increments };
    this.decrements = { ...decrements };
  }

  /**
   * Increase local node's increment register.
   */
  increment() {
    const value = this.increments[this.localNodeId] || 0;
    this.increments[this.localNodeId] = value + 1;
    return this;
  }

  /**
   * Increase local node's decrement register.
   */
  decrement() {
    const value = this.decrements[this.localNodeId] || 0;
    this.decrements[this.localNodeId] = value + 1;
    return this;
  }

  /**
   * CRDT merge: elementwise max for both maps.
   * @param {PNCounter} other
   * @returns {PNCounter} this
   */
  merge(other) {
    for (const nodeId in other.increments) {
      const local = this.increments[nodeId] || 0;
      const remote = other.increments[nodeId] || 0;
      this.increments[nodeId] = Math.max(local, remote);
    }

    for (const nodeId in other.decrements) {
      const local = this.decrements[nodeId] || 0;
      const remote = other.decrements[nodeId] || 0;
      this.decrements[nodeId] = Math.max(local, remote);
    }

    return this;
  }

  /**
   * Final conflict-free value.
   * @returns {number}
   */
  getCount() {
    let sumIncrements = 0;
    let sumDecrements = 0;

    for (const nodeId in this.increments) {
      sumIncrements += this.increments[nodeId];
    }
    for (const nodeId in this.decrements) {
      sumDecrements += this.decrements[nodeId];
    }

    return sumIncrements - sumDecrements;
  }

  /**
   * JSON storage/transport representation (IDB, network).
   */
  toJSON() {
    return {
      localNodeId: this.localNodeId,
      increments: this.increments,
      decrements: this.decrements,
    };
  }

  /**
   * Rehydrate from JSON.
   * @param {{localNodeId: string, increments?: {[id: string]: number}, decrements?: {[id: string]: number}}} json
   * @returns {PNCounter}
   */
  static fromJSON(json) {
    return new PNCounter(
      json.localNodeId,
      json.increments || {},
      json.decrements || {}
    );
  }
}
