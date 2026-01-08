import { v7 as uuidv7 } from "uuid";

type LWWValue = string | number | boolean;

type HLCStamp = {
  /** Unix ms */
  readonly wallTimeMs: number;
  /** logical counter for same/older wallTimeMs */
  readonly logical: number;
  /** stable actor/node id for deterministic tie-break */
  readonly clockId: string;
};

type CRRegisterNode<TValue extends LWWValue> = {
  readonly value: TValue;
  readonly stamp: HLCStamp;
};

type CRRegisterListener<TValue extends LWWValue> = (
  patches: CRRegisterNode<TValue>[]
) => void;

function compareHLC(left: HLCStamp, right: HLCStamp): number {
  if (left.wallTimeMs !== right.wallTimeMs)
    return left.wallTimeMs - right.wallTimeMs;
  if (left.logical !== right.logical) return left.logical - right.logical;
  // final deterministic tie-break
  if (left.clockId === right.clockId) return 0;
  return left.clockId < right.clockId ? -1 : 1;
}

export class CRRegister<TValue extends LWWValue> {
  private last: HLCStamp;
  private winner: CRRegisterNode<TValue> | null = null;
  private readonly listeners = new Set<CRRegisterListener<TValue>>();

  constructor() {
    this.last = { wallTimeMs: 0, logical: 0, clockId: uuidv7() };
  }

  // --- public API ---
  onChange(listener: CRRegisterListener<TValue>): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  snapshot(): CRRegisterNode<TValue>[] {
    return this.winner ? [this.winner] : [];
  }

  merge(
    input: CRRegisterNode<TValue>[] | CRRegisterNode<TValue>
  ): CRRegisterNode<TValue>[] {
    const nodes = Array.isArray(input) ? input : [input];
    const accepted: CRRegisterNode<TValue>[] = [];

    for (const node of nodes) {
      if (this.apply(node)) accepted.push(node);
    }

    if (accepted.length) this.emit(accepted);
    return accepted;
  }

  set(value: TValue, incomingStamp?: HLCStamp): void {
    const stamp = incomingStamp ?? this.nextLocalStamp(Date.now());

    const candidate: CRRegisterNode<TValue> = { value, stamp };
    if (this.apply(candidate)) this.emit([candidate]);
  }

  get(): TValue | null {
    return this.winner ? this.winner.value : null;
  }

  // --- internals ---
  private nextLocalStamp(nowMs: number): HLCStamp {
    const wallTimeMs = Math.max(nowMs, this.last.wallTimeMs);
    const logical =
      wallTimeMs === this.last.wallTimeMs ? this.last.logical + 1 : 0;
    const next: HLCStamp = { wallTimeMs, logical, clockId: this.last.clockId };
    this.last = next;
    return next;
  }

  private apply(node: CRRegisterNode<TValue>): boolean {
    this.advanceClock(node.stamp);
    const current = this.winner;
    if (!current || compareHLC(node.stamp, current.stamp) > 0) {
      this.winner = node;
      return true;
    }
    return false;
  }

  private advanceClock(stamp: HLCStamp): void {
    // Keep local HLC monotonic even when receiving remote stamps.
    const mergedWall = Math.max(
      this.last.wallTimeMs,
      stamp.wallTimeMs,
      Date.now()
    );
    const mergedLogical =
      mergedWall === this.last.wallTimeMs
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

  private emit(patches: CRRegisterNode<TValue>[]): void {
    for (const listener of this.listeners) listener(patches);
  }
}
