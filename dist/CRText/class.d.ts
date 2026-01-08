import { DAGNode } from "../DAGNode/class.js";
export declare class CRText<CharT extends string = string> {
    private readonly nodes;
    private readonly nodeById;
    private readonly listeners;
    constructor(snapshot?: readonly DAGNode<CharT>[]);
    get length(): number;
    onChange(listener: (nodes: readonly DAGNode<CharT>[]) => void): () => void;
    snapshot(): DAGNode<CharT>[];
    toString(): string;
    at(index: number): CharT | undefined;
    insertAt(index: number, char: CharT): this;
    deleteAt(index: number): CharT | undefined;
    merge(remoteSnapshot: DAGNode<CharT>[] | DAGNode<CharT>): DAGNode<CharT>[];
    sort(compareFn?: (a: DAGNode<CharT>, b: DAGNode<CharT>) => number): this;
    private alive;
    private afterIdForAliveInsertAt;
    private emit;
}
