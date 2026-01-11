import type { HLCStamp } from "./clock.js";
export type Role = "owner" | "manager" | "editor" | "viewer" | "revoked";
export type CRType = "register" | "text" | "array" | "map" | "set" | "record";
export type JsValue = string | number | boolean | null | JsValue[] | {
    [key: string]: JsValue;
};
export type JsTypeName = "string" | "number" | "boolean" | "json" | "any";
export type JsTypeMap = {
    string: string;
    number: number;
    boolean: boolean;
    json: JsValue;
    any: unknown;
};
export type JsTypeValue<T extends JsTypeName> = JsTypeMap[T];
export type RoleKeyPair = {
    publicKey: JsonWebKey;
    privateKey: JsonWebKey;
};
export type RoleKeys = {
    owner: RoleKeyPair;
    manager: RoleKeyPair;
    editor: RoleKeyPair;
};
export type RolePublicKeys = {
    owner: JsonWebKey;
    manager: JsonWebKey;
    editor: JsonWebKey;
};
export type ActorInfo = {
    id: string;
    privateKeyJwk: JsonWebKey;
    publicKeyJwk: JsonWebKey;
};
export type RegisterSchema<T extends JsTypeName = JsTypeName> = {
    crdt: "register";
    jsType: T;
    regex?: RegExp;
    initial?: JsTypeValue<T>;
};
export type TextSchema = {
    crdt: "text";
    jsType: "string";
    initial?: string;
};
export type ArraySchema<T extends JsTypeName = JsTypeName> = {
    crdt: "array";
    jsType: T;
    initial?: JsTypeValue<T>[];
    key?: (value: JsTypeValue<T>) => string;
};
export type SetSchema<T extends JsTypeName = JsTypeName> = {
    crdt: "set";
    jsType: T;
    initial?: JsTypeValue<T>[];
    key?: (value: JsTypeValue<T>) => string;
};
export type MapSchema<T extends JsTypeName = JsTypeName> = {
    crdt: "map";
    jsType: T;
    initial?: Array<[unknown, JsTypeValue<T>]>;
    key?: (value: unknown) => string;
};
export type RecordSchema<T extends JsTypeName = JsTypeName> = {
    crdt: "record";
    jsType: T;
    initial?: Record<string, JsTypeValue<T>>;
};
export type FieldSchema = RegisterSchema | TextSchema | ArraySchema | SetSchema | MapSchema | RecordSchema;
export type SchemaDefinition = Record<string, FieldSchema>;
export type SchemaId = string;
export type OpKind = "acl.set" | "register.set" | "text.patch" | "array.patch" | "map.patch" | "set.patch" | "record.patch" | "ack" | "reset";
export type OpPayload = {
    iss: string;
    sub: string;
    iat: number;
    stamp: HLCStamp;
    kind: OpKind;
    schema: SchemaId;
    field?: string;
    patch?: unknown;
};
export type SignedOp = {
    token: string;
    actorSig?: string;
};
export type ResetPatch = {
    newDocId: string;
    reason?: string;
};
export type ResetState = {
    ts: HLCStamp;
    by: string;
    newDocId: string;
    reason?: string;
};
export type DacumentChangeEvent = {
    type: "change";
    ops: SignedOp[];
};
export type DacumentMergeEvent = {
    type: "merge";
    actor: string;
    target: string;
    method: string;
    data: unknown;
};
export type DacumentErrorEvent = {
    type: "error";
    error: Error;
};
export type DacumentRevokedEvent = {
    type: "revoked";
    actorId: string;
    previous: Role;
    by: string;
    stamp: HLCStamp;
};
export type DacumentResetEvent = {
    type: "reset";
    oldDocId: string;
    newDocId: string;
    ts: HLCStamp;
    by: string;
    reason?: string;
};
export type DacumentEventMap = {
    change: DacumentChangeEvent;
    merge: DacumentMergeEvent;
    error: DacumentErrorEvent;
    revoked: DacumentRevokedEvent;
    reset: DacumentResetEvent;
};
export type AclAssignment = {
    id: string;
    actorId: string;
    role: Role;
    stamp: HLCStamp;
    by: string;
    publicKeyJwk?: JsonWebKey;
};
export type VerifyActorIntegrityOptions = {
    token?: string | SignedOp;
    ops?: Array<string | SignedOp>;
    snapshot?: DocSnapshot;
};
export type VerificationFailure = {
    index: number;
    reason: string;
};
export type VerificationResult = {
    ok: boolean;
    verified: number;
    failed: number;
    missing: number;
    failures: VerificationFailure[];
};
export type DocSnapshot = {
    docId: string;
    roleKeys: RolePublicKeys;
    ops: SignedOp[];
};
export type TextView = {
    length: number;
    toString(): string;
    at(index: number): string | undefined;
    insertAt(index: number, value: string): unknown;
    deleteAt(index: number): string | undefined;
    [Symbol.iterator](): Iterator<string>;
};
export type ArrayView<T> = {
    length: number;
    at(index: number): T | undefined;
    slice(start?: number, end?: number): T[];
    push(...items: T[]): number;
    unshift(...items: T[]): number;
    pop(): T | undefined;
    shift(): T | undefined;
    setAt(index: number, value: T): unknown;
    map<U>(callback: (value: T, index: number, array: T[]) => U, thisArg?: unknown): U[];
    filter(callback: (value: T, index: number, array: T[]) => boolean, thisArg?: unknown): T[];
    reduce<U>(reducer: (prev: U, curr: T, index: number, array: T[]) => U, initialValue: U): U;
    forEach(callback: (value: T, index: number, array: T[]) => void, thisArg?: unknown): void;
    includes(value: T): boolean;
    indexOf(value: T): number;
    [Symbol.iterator](): Iterator<T>;
};
export type SetView<T> = {
    size: number;
    add(value: T): unknown;
    delete(value: T): boolean;
    clear(): void;
    has(value: T): boolean;
    entries(): SetIterator<[T, T]>;
    keys(): SetIterator<T>;
    values(): SetIterator<T>;
    forEach(callback: (value: T, value2: T, set: Set<T>) => void, thisArg?: unknown): void;
    [Symbol.iterator](): SetIterator<T>;
    [Symbol.toStringTag]: string;
};
export type MapView<V> = {
    size: number;
    get(key: unknown): V | undefined;
    set(key: unknown, value: V): unknown;
    has(key: unknown): boolean;
    delete(key: unknown): boolean;
    clear(): void;
    entries(): MapIterator<[unknown, V]>;
    keys(): MapIterator<unknown>;
    values(): MapIterator<V>;
    forEach(callback: (value: V, key: unknown, map: Map<unknown, V>) => void, thisArg?: unknown): void;
    [Symbol.iterator](): MapIterator<[unknown, V]>;
    [Symbol.toStringTag]: string;
};
export type RecordView<T> = Record<string, T> & {};
export type FieldValue<F extends FieldSchema> = F["crdt"] extends "register" ? JsTypeValue<F["jsType"]> : F["crdt"] extends "text" ? TextView : F["crdt"] extends "array" ? ArrayView<JsTypeValue<F["jsType"]>> : F["crdt"] extends "set" ? SetView<JsTypeValue<F["jsType"]>> : F["crdt"] extends "map" ? MapView<JsTypeValue<F["jsType"]>> : F["crdt"] extends "record" ? RecordView<JsTypeValue<F["jsType"]>> : never;
export type DocFieldAccess<S extends SchemaDefinition> = {
    [K in keyof S]: FieldValue<S[K]>;
};
export declare function isJsValue(value: unknown): value is JsValue;
export declare function isValueOfType(value: unknown, jsType: JsTypeName): boolean;
export type SchemaIdInput = Record<string, {
    crdt: CRType;
    jsType: JsTypeName;
    regex?: string;
}>;
export declare function schemaIdInput(schema: SchemaDefinition): SchemaIdInput;
export declare function register<T extends JsTypeName = "any">(options?: {
    jsType?: T;
    regex?: RegExp;
    initial?: JsTypeValue<T>;
}): RegisterSchema<T>;
export declare function text(options?: {
    initial?: string;
}): TextSchema;
export declare function array<T extends JsTypeName>(options: {
    jsType: T;
    initial?: JsTypeValue<T>[];
    key?: (value: JsTypeValue<T>) => string;
}): ArraySchema<T>;
export declare function set<T extends JsTypeName>(options: {
    jsType: T;
    initial?: JsTypeValue<T>[];
    key?: (value: JsTypeValue<T>) => string;
}): SetSchema<T>;
export declare function map<T extends JsTypeName>(options: {
    jsType: T;
    initial?: Array<[unknown, JsTypeValue<T>]>;
    key?: (value: unknown) => string;
}): MapSchema<T>;
export declare function record<T extends JsTypeName>(options: {
    jsType: T;
    initial?: Record<string, JsTypeValue<T>>;
}): RecordSchema<T>;
