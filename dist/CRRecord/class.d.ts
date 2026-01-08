type CRRecordNode<V> = {
    op: "set";
    id: string;
    prop: string;
    value: V;
} | {
    op: "del";
    id: string;
    prop: string;
    targets: string[];
};
type CRRecordListener<V> = (patches: CRRecordNode<V>[]) => void;
export declare class CRRecord<V = unknown> {
    private readonly nodes;
    private readonly seenNodeIds;
    private readonly setTagsByProp;
    private readonly tombstones;
    private readonly aliveProps;
    private readonly latestValueByProp;
    private readonly listeners;
    constructor(snapshot?: CRRecordNode<V>[]);
    onChange(listener: CRRecordListener<V>): () => void;
    snapshot(): CRRecordNode<V>[];
    merge(input: CRRecordNode<V>[] | CRRecordNode<V>): CRRecordNode<V>[];
    private get;
    private set;
    private delete;
    private appendAndApply;
    private applyNode;
    private emit;
    private recompute;
    private newId;
}
export {};
