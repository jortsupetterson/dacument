/**
 * TextRGA - state-based text CRDT.
 *
 * Model:
 *  - Each character has a globally unique id: `${nodeId}:${counter}`
 *  - Characters are never removed, only tombstoned (deleted = true)
 *  - Order is derived deterministically by sorting ids
 *  - Merge = union of characters + deleted = deletedA || deletedB
 */
export class TextRGA {
  /**
   * @param {string} localNodeId
   * @param {number} [localCounter]
   * @param {{[id: string]: {char: string, deleted: boolean}}} [entries]
   * @param {string[]} [order]
   * @param {(info: {index:number,id:string,char:string}) => void} [onInsert]
   * @param {(info: {index:number,id:string}) => void} [onDelete]
   */
  constructor(
    localNodeId,
    localCounter = 0,
    entries = {},
    order = [],
    onInsert = undefined,
    onDelete = undefined
  ) {
    // Node identifier used for generating local ids
    this.localNodeId = localNodeId;
    // Monotonic per-node counter for id allocation
    this.localCounter = localCounter;
    // Map: id -> { char, deleted }
    this.entries = { ...entries };
    // Total order of ids (including tombstoned entries)
    this.order = order.slice();
    // Optional callbacks invoked on local/remote inserts and deletes
    this.onInsert = onInsert || null;
    this.onDelete = onDelete || null;
  }

  /**
   * Allocate a new globally unique id for this replica.
   * @returns {string}
   */
  #nextId() {
    this.localCounter += 1;
    return `${this.localNodeId}:${this.localCounter}`;
  }

  /**
   * Compute the visible character index for a given id.
   * Returns -1 if the id is not present or is tombstoned.
   * @param {string} targetId
   * @returns {number}
   */
  #visibleIndexOf(targetId) {
    let visibleIndex = 0;
    for (const id of this.order) {
      const entry = this.entries[id];
      if (!entry) continue;
      if (id === targetId) {
        return entry.deleted ? -1 : visibleIndex;
      }
      if (!entry.deleted) {
        visibleIndex += 1;
      }
    }
    return -1;
  }

  /**
   * Insert a single character at logical index among visible characters.
   * @param {number} index 0-based index over visible characters
   * @param {string} char single-character string
   * @returns {string} id of the inserted character
   */
  insertAt(index, char) {
    if (typeof char !== "string" || char.length !== 1) {
      throw new TypeError(
        "TextRGA.insertAt expects a single character string."
      );
    }

    const id = this.#nextId();

    // Build the visible sequence of ids
    const visibleIds = this.order.filter(
      (entryId) => !this.entries[entryId]?.deleted
    );

    // Clamp index into the visible range
    const clampedIndex = Math.max(0, Math.min(index, visibleIds.length));

    // Insert relative to visible indices, while preserving the full order[]
    const newOrder = [];
    let visiblePos = 0;

    for (const entryId of this.order) {
      const entry = this.entries[entryId];
      if (!entry?.deleted) {
        if (visiblePos === clampedIndex) {
          newOrder.push(id);
        }
        visiblePos += 1;
      }
      newOrder.push(entryId);
    }

    // If we insert at the end, we may not have pushed id in the loop
    if (clampedIndex === visibleIds.length && !newOrder.includes(id)) {
      newOrder.push(id);
    }

    this.order = newOrder;
    this.entries[id] = { char, deleted: false };

    if (this.onInsert) {
      this.onInsert({ index: clampedIndex, id, char });
    }

    return id;
  }

  /**
   * Tombstone the character at logical index among visible characters.
   * No-op if index is out of range.
   * @param {number} index 0-based index over visible characters
   */
  deleteAt(index) {
    const visibleIds = this.order.filter(
      (entryId) => !this.entries[entryId]?.deleted
    );

    if (index < 0 || index >= visibleIds.length) return;

    const id = visibleIds[index];
    const entry = this.entries[id];
    if (!entry) return;

    entry.deleted = true;

    if (this.onDelete) {
      this.onDelete({ index, id });
    }
  }

  /**
   * Apply a remote insert given an explicit id+char pair.
   * Idempotent: if the id already exists, nothing is appended twice.
   * @param {{ id: string, char: string }} remote
   * @returns {number} visible index of the inserted character (or -1 if not visible)
   */
  applyRemoteInsert({ id, char }) {
    // If we already know this id, just report its visible index
    if (this.entries[id]) {
      return this.#visibleIndexOf(id);
    }

    // Register the new character
    this.entries[id] = { char, deleted: false };

    // Ensure id is present in the order and keep ordering deterministic
    if (!this.order.includes(id)) {
      this.order.push(id);
      this.order.sort();
    }

    const index = this.#visibleIndexOf(id);
    if (index >= 0 && this.onInsert) {
      this.onInsert({ index, id, char });
    }
    return index;
  }

  /**
   * Apply a remote delete given an explicit id.
   * Idempotent: if the id is already tombstoned, this is a no-op.
   * @param {{ id: string }} remote
   * @returns {number} visible index before deletion (or -1 if not visible)
   */
  applyRemoteDelete({ id }) {
    const entry = this.entries[id];
    if (!entry) return -1;

    const index = this.#visibleIndexOf(id);

    // Already deleted -> do not fire delete callback again
    if (entry.deleted) {
      return index;
    }

    entry.deleted = true;

    if (index >= 0 && this.onDelete) {
      this.onDelete({ index, id });
    }
    return index;
  }

  /**
   * Merge another TextRGA into this one (idempotent, commutative, associative).
   * @param {TextRGA} other
   * @returns {TextRGA} this
   */
  merge(other) {
    // Merge entries (grow-only + tombstone OR)
    for (const id in other.entries) {
      const remote = other.entries[id];
      const local = this.entries[id];

      if (!local) {
        // New character from the other replica
        this.entries[id] = { char: remote.char, deleted: !!remote.deleted };
      } else {
        // Same character: OR the deleted flags
        local.deleted = local.deleted || !!remote.deleted;
      }
    }

    // Merge order: union of ids, then deterministic sort
    const idSet = new Set([
      ...this.order,
      ...other.order,
      ...Object.keys(this.entries),
    ]);
    this.order = Array.from(idSet).sort();

    // Keep local counter at least as large as the other replica's counter
    this.localCounter = Math.max(this.localCounter, other.localCounter || 0);

    return this;
  }

  /**
   * Materialize the current visible text as a plain string.
   * @returns {string}
   */
  getText() {
    let result = "";
    for (const id of this.order) {
      const entry = this.entries[id];
      if (entry && !entry.deleted) {
        result += entry.char;
      }
    }
    return result;
  }

  /**
   * JSON representation for storage/transport (e.g. IndexedDB, network).
   * Callbacks are intentionally not serialized.
   * @returns {{localNodeId:string,localCounter:number,entries:{[id:string]:{char:string,deleted:boolean}},order:string[]}}
   */
  toJSON() {
    return {
      localNodeId: this.localNodeId,
      localCounter: this.localCounter,
      entries: this.entries,
      order: this.order,
    };
  }

  /**
   * Rehydrate from JSON into a live TextRGA instance.
   * Callbacks must be wired manually after construction.
   * @param {{localNodeId: string, localCounter?: number, entries?: {[id: string]: {char: string, deleted: boolean}}, order?: string[]}} json
   * @returns {TextRGA}
   */
  static fromJSON(json) {
    return new TextRGA(
      json.localNodeId,
      json.localCounter || 0,
      json.entries || {},
      json.order || []
    );
  }
}


