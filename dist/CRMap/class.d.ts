type CRMapNode<K, V> = {
    op: "set";
    id: string;
    key: K;
    keyId: string;
    value: V;
} | {
    op: "del";
    id: string;
    keyId: string;
    targets: string[];
};
type CRMapListener<K, V> = (patches: CRMapNode<K, V>[]) => void;
export declare class CRMap<K, V> implements Map<K, V> {
    private readonly nodes;
    private readonly seenNodeIds;
    private readonly setTagsByKeyId;
    private readonly tombstones;
    private readonly aliveKeyIds;
    private readonly latestKeyByKeyId;
    private readonly latestValueByKeyId;
    private readonly listeners;
    private readonly keyIdByObjectRef;
    private objectKeyCounter;
    private readonly symbolKeyByRef;
    private symbolKeyCounter;
    private readonly keyFn;
    constructor(options?: {
        snapshot?: CRMapNode<K, V>[];
        key?: (key: K) => string;
    });
    onChange(listener: CRMapListener<K, V>): () => void;
    snapshot(): CRMapNode<K, V>[];
    merge(input: CRMapNode<K, V>[] | CRMapNode<K, V>): CRMapNode<K, V>[];
    get size(): number;
    clear(): void;
    delete(key: K): boolean;
    forEach(callbackfn: (value: V, key: K, map: Map<K, V>) => void, thisArg?: unknown): void;
    get(key: K): V | undefined;
    has(key: K): boolean;
    set(key: K, value: V): this;
    entries(): MapIterator<[K, V]>;
    keys(): MapIterator<K>;
    values(): MapIterator<V>;
    [Symbol.iterator](): MapIterator<[K, V]>;
    readonly [Symbol.toStringTag] = "CRMap";
    private appendAndApply;
    private applyNode;
    private recomputeKeyId;
    private currentSetTagsForKeyId;
    private emit;
    private newId;
    private keyIdOf;
}
export {};
