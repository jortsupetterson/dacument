import { v7 as uuidv7 } from "uuid";
export class DAGNode {
    id;
    value;
    after;
    deleted;
    constructor(params) {
        this.id = params.id ?? uuidv7();
        this.value = params.value;
        this.after = params.after ?? [];
        this.deleted = params.deleted ?? false;
    }
}
