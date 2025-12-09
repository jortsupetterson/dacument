export interface LWWJSON<T = unknown> {
  value: T;
  timestamp: number;
  counter: number;
  nodeId: string;
}

export class LWW<T = unknown> {
  static STALE_THRESHOLD_MS: number;
  static COUNTER_WINDOW_MS: number;
  value: T;
  timestamp: number;
  counter: number;
  nodeId: string;
  constructor(value: T, nodeId?: string, counter?: number, timestamp?: number);
  competition(contender: LWW<T>): this;
  toJSON(): LWWJSON<T>;
  static fromJSON<T = unknown>(json: LWWJSON<T>): LWW<T>;
}

export interface PNCounterState {
  localNodeId: string;
  increments?: Record<string, number>;
  decrements?: Record<string, number>;
}

export class PNCounter {
  localNodeId: string;
  increments: Record<string, number>;
  decrements: Record<string, number>;
  constructor(
    localNodeId: string,
    increments?: Record<string, number>,
    decrements?: Record<string, number>
  );
  increment(): this;
  decrement(): this;
  merge(other: PNCounter): this;
  getCount(): number;
  toJSON(): Required<PNCounterState>;
  static fromJSON(json: PNCounterState): PNCounter;
}

export interface TextRGAEntry {
  char: string;
  deleted: boolean;
}

export interface TextRGAJSON {
  localNodeId: string;
  localCounter?: number;
  entries?: Record<string, TextRGAEntry>;
  order?: string[];
}

export interface TextRGAInsertInfo {
  index: number;
  id: string;
  char: string;
}

export interface TextRGADeleteInfo {
  index: number;
  id: string;
}

export class TextRGA {
  localNodeId: string;
  localCounter: number;
  entries: Record<string, TextRGAEntry>;
  order: string[];
  onInsert: ((info: TextRGAInsertInfo) => void) | null;
  onDelete: ((info: TextRGADeleteInfo) => void) | null;
  constructor(
    localNodeId: string,
    localCounter?: number,
    entries?: Record<string, TextRGAEntry>,
    order?: string[],
    onInsert?: ((info: TextRGAInsertInfo) => void) | null,
    onDelete?: ((info: TextRGADeleteInfo) => void) | null
  );
  insertAt(index: number, char: string): string;
  deleteAt(index: number): void;
  applyRemoteInsert(remote: { id: string; char: string }): number;
  applyRemoteDelete(remote: { id: string }): number;
  merge(other: TextRGA): this;
  getText(): string;
  toJSON(): Required<TextRGAJSON>;
  static fromJSON(json: TextRGAJSON): TextRGA;
}
