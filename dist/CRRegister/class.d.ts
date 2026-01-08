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
type CRRegisterListener<TValue extends LWWValue> = (patches: CRRegisterNode<TValue>[]) => void;
export declare class CRRegister<TValue extends LWWValue> {
    private last;
    private winner;
    private readonly listeners;
    constructor();
    onChange(listener: CRRegisterListener<TValue>): () => void;
    snapshot(): CRRegisterNode<TValue>[];
    merge(input: CRRegisterNode<TValue>[] | CRRegisterNode<TValue>): CRRegisterNode<TValue>[];
    set(value: TValue, incomingStamp?: HLCStamp): void;
    get(): TValue | null;
    private nextLocalStamp;
    private apply;
    private advanceClock;
    private emit;
}
export {};
