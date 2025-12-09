/**
 * Last-Writer-Wins register with a hybrid resolution model:
 * - Large timestamp gaps -> timestamp decides
 * - Close timestamps -> counter wins, nodeId breaks ties
 */
export class LWW {
  /** 30 minutes threshold for "fresh vs stale" writes */
  static STALE_THRESHOLD_MS = 1000 * 60 * 30;
  /** 30 seconds threshold for "nearly simultaneous" writes */
  static COUNTER_WINDOW_MS = 1000 * 30;

  /**
   * @param {any} value
   * @param {string} nodeId
   * @param {number} [counter]
   * @param {number} [timestamp]
   */
  constructor(value, nodeId = "", counter = 0, timestamp = Date.now()) {
    this.value = value;
    this.timestamp = timestamp;
    this.counter = counter;
    this.nodeId = nodeId;
  }

  /**
   * CRDT-style conflict resolution (LWW merge).
   * @param {LWW} contender
   * @returns {LWW} this
   */
  competition(contender) {
    const timeDiff = contender.timestamp - this.timestamp;

    // If the contender is clearly newer -> adopt it
    if (timeDiff > LWW.STALE_THRESHOLD_MS) {
      return this.#adopt(contender);
    }

    // If the contender is clearly older -> keep current
    if (timeDiff < -LWW.STALE_THRESHOLD_MS) {
      return this;
    }

    // Nearly simultaneous writes -> counter decides, nodeId as deterministic tie-break
    if (Math.abs(timeDiff) <= LWW.COUNTER_WINDOW_MS) {
      if (contender.counter > this.counter) {
        return this.#adopt(contender);
      }
      if (
        contender.counter === this.counter &&
        contender.nodeId > this.nodeId
      ) {
        return this.#adopt(contender);
      }
      return this;
    }

    // Otherwise: larger timestamp wins
    if (contender.timestamp > this.timestamp) {
      return this.#adopt(contender);
    }

    return this;
  }

  /**
   * JSON storage/transport shape (IDB, network).
   */
  toJSON() {
    return {
      value: this.value,
      timestamp: this.timestamp,
      counter: this.counter,
      nodeId: this.nodeId,
    };
  }

  /**
   * @param {{value:any, timestamp:number, counter:number, nodeId:string}} json
   * @returns {LWW}
   */
  static fromJSON(json) {
    return new LWW(json.value, json.nodeId, json.counter, json.timestamp);
  }

  /**
   * Adopt the other instance's state.
   * @param {LWW} other
   * @returns {LWW}
   */
  #adopt(other) {
    this.value = other.value;
    this.timestamp = other.timestamp;
    this.counter = other.counter;
    this.nodeId = other.nodeId;
    return this;
  }
}
