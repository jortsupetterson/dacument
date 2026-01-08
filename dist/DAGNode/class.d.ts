export type NodeId = string;
export declare class DAGNode<ValueType> {
    readonly id: NodeId;
    readonly value: ValueType;
    readonly after: readonly NodeId[];
    deleted: boolean;
    constructor(params: {
        value: ValueType;
        after?: readonly NodeId[];
        deleted?: boolean;
        id?: NodeId;
    });
}
