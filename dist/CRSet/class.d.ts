type CRSetNode<T> = {
    op: "add";
    id: string;
    value: T;
    key: string;
} | {
    op: "rem";
    id: string;
    key: string;
    targets: string[];
};
type CRSetListener<T> = (patches: CRSetNode<T>[]) => void;
export declare class CRSet<T> implements Set<T> {
    private readonly nodes;
    private readonly seenNodeIds;
    private readonly addTagsByKey;
    private readonly tombstones;
    private readonly aliveKeys;
    private readonly latestValueByKey;
    private readonly listeners;
    private readonly objectKeyByRef;
    private objectKeyCounter;
    private readonly symbolKeyByRef;
    private symbolKeyCounter;
    private readonly keyFn;
    constructor(options?: {
        snapshot?: CRSetNode<T>[];
        key?: (value: T) => string;
    });
    onChange(listener: CRSetListener<T>): () => void;
    snapshot(): CRSetNode<T>[];
    merge(input: CRSetNode<T>[] | CRSetNode<T>): CRSetNode<T>[];
    get size(): number;
    add(value: T): this;
    delete(value: T): boolean;
    clear(): void;
    has(value: T): boolean;
    forEach(callbackfn: (value: T, value2: T, set: Set<T>) => void, thisArg?: unknown): void;
    values(): SetIterator<T>;
    keys(): SetIterator<T>;
    entries(): SetIterator<[T, T]>;
    [Symbol.iterator](): SetIterator<T>;
    readonly [Symbol.toStringTag] = "CRSet";
    private appendAndApply;
    private applyNode;
    private recomputeAliveForKey;
    private currentAddTagsForKey;
    private emit;
    private newId;
    private keyOf;
}
export {};
