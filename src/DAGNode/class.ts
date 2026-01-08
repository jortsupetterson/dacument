import { v7 as uuidv7 } from "uuid";

export type NodeId = string;

export class DAGNode<ValueType> {
  public readonly id: NodeId;
  public readonly value: ValueType;

  public readonly after: readonly NodeId[];

  public deleted: boolean;

  constructor(params: {
    value: ValueType;
    after?: readonly NodeId[];
    deleted?: boolean;
    id?: NodeId;
  }) {
    this.id = params.id ?? uuidv7();
    this.value = params.value;
    this.after = params.after ?? [];
    this.deleted = params.deleted ?? false;
  }
}
