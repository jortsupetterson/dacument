import { Bytes, generateNonce } from "bytecodec";
import { SigningAgent, generateSignPair } from "zeyra";
import { v7 as uuidv7 } from "uuid";
import { CRArray } from "../CRArray/class.js";
import { CRMap } from "../CRMap/class.js";
import { CRRecord } from "../CRRecord/class.js";
import { CRRegister } from "../CRRegister/class.js";
import { CRSet } from "../CRSet/class.js";
import { CRText } from "../CRText/class.js";
import { AclLog } from "./acl.js";
import { HLC, compareHLC } from "./clock.js";
import { decodeToken, signToken, validateActorKeyPair, verifyDetached, verifyToken, } from "./crypto.js";
import { array, map, record, register, set, text, isJsValue, isValueOfType, schemaIdInput, } from "./types.js";
const TOKEN_TYP = "DACOP";
function nowSeconds() {
    return Math.floor(Date.now() / 1000);
}
function isObject(value) {
    return typeof value === "object" && value !== null;
}
function isStringArray(value) {
    return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}
function isValidNonceId(value) {
    if (typeof value !== "string")
        return false;
    try {
        const bytes = Bytes.fromBase64UrlString(value);
        return bytes.byteLength === 32 && value.length === 43;
    }
    catch {
        return false;
    }
}
function stableKey(value) {
    if (value === null)
        return "null";
    if (Array.isArray(value))
        return `[${value.map((entry) => stableKey(entry)).join(",")}]`;
    if (typeof value === "object") {
        const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
        const body = entries
            .map(([key, val]) => `${JSON.stringify(key)}:${stableKey(val)}`)
            .join(",");
        return `{${body}}`;
    }
    return JSON.stringify(value);
}
function normalizeJwk(jwk) {
    const entries = Object.entries(jwk).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    return JSON.stringify(Object.fromEntries(entries));
}
function jwkEquals(left, right) {
    if (!left || !right)
        return false;
    return normalizeJwk(left) === normalizeJwk(right);
}
function isDagNode(node) {
    if (!isObject(node))
        return false;
    if (typeof node.id !== "string")
        return false;
    if (!Array.isArray(node.after) || !node.after.every((id) => typeof id === "string"))
        return false;
    if (node.deleted !== undefined && typeof node.deleted !== "boolean")
        return false;
    return true;
}
function isAclPatch(value) {
    if (!isObject(value))
        return false;
    if (typeof value.id !== "string")
        return false;
    if (typeof value.target !== "string")
        return false;
    if (typeof value.role !== "string")
        return false;
    if ("publicKeyJwk" in value && value.publicKeyJwk !== undefined) {
        if (!isObject(value.publicKeyJwk))
            return false;
        const jwk = value.publicKeyJwk;
        if (jwk.kty && jwk.kty !== "EC")
            return false;
    }
    return true;
}
function isAckPatch(value) {
    if (!isObject(value))
        return false;
    if (!isObject(value.seen))
        return false;
    const seen = value.seen;
    return (typeof seen.wallTimeMs === "number" &&
        typeof seen.logical === "number" &&
        typeof seen.clockId === "string");
}
function isResetPatch(value) {
    if (!isObject(value))
        return false;
    if (typeof value.newDocId !== "string")
        return false;
    if (!isValidNonceId(value.newDocId))
        return false;
    if ("reason" in value && value.reason !== undefined && typeof value.reason !== "string")
        return false;
    return true;
}
function isPatchEnvelope(value) {
    return isObject(value) && Array.isArray(value.nodes);
}
function indexMapForNodes(nodes) {
    const map = new Map();
    let aliveIndex = 0;
    for (const node of nodes) {
        map.set(node.id, aliveIndex);
        if (!node.deleted)
            aliveIndex += 1;
    }
    return map;
}
function createEmptyField(crdt) {
    switch (crdt.crdt) {
        case "register":
            return new CRRegister();
        case "text":
            return new CRText();
        case "array":
            return new CRArray();
        case "map":
            return new CRMap({ key: crdt.key });
        case "set":
            return new CRSet({ key: crdt.key });
        case "record":
            return new CRRecord();
    }
}
function roleNeedsKey(role) {
    return role === "owner" || role === "manager" || role === "editor";
}
function parseSignerKind(kid, issuer) {
    if (!kid)
        return null;
    const [kidIssuer, role] = kid.split(":");
    if (kidIssuer !== issuer)
        return null;
    if (role === "owner" || role === "manager" || role === "editor")
        return role;
    if (role === "actor")
        return "actor";
    return null;
}
async function generateRoleKeys() {
    const ownerPair = await generateSignPair();
    const managerPair = await generateSignPair();
    const editorPair = await generateSignPair();
    return {
        owner: { privateKey: ownerPair.signingJwk, publicKey: ownerPair.verificationJwk },
        manager: { privateKey: managerPair.signingJwk, publicKey: managerPair.verificationJwk },
        editor: { privateKey: editorPair.signingJwk, publicKey: editorPair.verificationJwk },
    };
}
function toPublicRoleKeys(roleKeys) {
    return {
        owner: roleKeys.owner.publicKey,
        manager: roleKeys.manager.publicKey,
        editor: roleKeys.editor.publicKey,
    };
}
export class Dacument {
    static actorInfo;
    static actorSigner;
    static actorInfoPrevious;
    static async setActorInfo(info) {
        const existing = Dacument.actorInfo;
        if (existing) {
            if (info.id !== existing.id)
                throw new Error("Dacument.setActorInfo: actor id already set");
            const samePrivate = jwkEquals(info.privateKeyJwk, existing.privateKeyJwk);
            const samePublic = jwkEquals(info.publicKeyJwk, existing.publicKeyJwk);
            if (samePrivate && samePublic)
                return;
            if (!info.currentPrivateKeyJwk || !info.currentPublicKeyJwk)
                throw new Error("Dacument.setActorInfo: current keys required to update actor info");
            if (!jwkEquals(info.currentPrivateKeyJwk, existing.privateKeyJwk) ||
                !jwkEquals(info.currentPublicKeyJwk, existing.publicKeyJwk))
                throw new Error("Dacument.setActorInfo: current keys do not match existing actor info");
        }
        if (!Dacument.isValidActorId(info.id))
            throw new Error("Dacument.setActorInfo: id must be 256-bit base64url");
        Dacument.assertActorPrivateKey(info.privateKeyJwk);
        Dacument.assertActorPublicKey(info.publicKeyJwk);
        await validateActorKeyPair(info.privateKeyJwk, info.publicKeyJwk);
        if (existing)
            Dacument.actorInfoPrevious = existing;
        Dacument.actorInfo = {
            id: info.id,
            privateKeyJwk: info.privateKeyJwk,
            publicKeyJwk: info.publicKeyJwk,
        };
        Dacument.actorSigner = new SigningAgent(info.privateKeyJwk);
    }
    static requireActorInfo() {
        if (!Dacument.actorInfo)
            throw new Error("Dacument: actor info not set; call Dacument.setActorInfo()");
        return Dacument.actorInfo;
    }
    static requireActorSigner() {
        if (!Dacument.actorSigner)
            throw new Error("Dacument: actor info not set; call Dacument.setActorInfo()");
        return Dacument.actorSigner;
    }
    static async signActorToken(token, privateKeyJwk) {
        const current = Dacument.actorInfo;
        const signer = privateKeyJwk &&
            current &&
            jwkEquals(privateKeyJwk, current.privateKeyJwk)
            ? Dacument.requireActorSigner()
            : privateKeyJwk
                ? new SigningAgent(privateKeyJwk)
                : Dacument.requireActorSigner();
        const signature = await signer.sign(Bytes.fromString(token));
        return Bytes.toBase64UrlString(signature);
    }
    static isValidActorId(actorId) {
        return isValidNonceId(actorId);
    }
    static actorInfoForPublicKey(publicKeyJwk) {
        if (!publicKeyJwk)
            return null;
        if (Dacument.actorInfo && jwkEquals(publicKeyJwk, Dacument.actorInfo.publicKeyJwk))
            return Dacument.actorInfo;
        if (Dacument.actorInfoPrevious &&
            jwkEquals(publicKeyJwk, Dacument.actorInfoPrevious.publicKeyJwk))
            return Dacument.actorInfoPrevious;
        return null;
    }
    static assertActorKeyJwk(jwk, label) {
        if (!jwk || typeof jwk !== "object")
            throw new Error(`Dacument.setActorInfo: ${label} must be a JWK object`);
        if (jwk.kty !== "EC")
            throw new Error(`Dacument.setActorInfo: ${label} must be EC (P-256)`);
        if (jwk.crv && jwk.crv !== "P-256")
            throw new Error(`Dacument.setActorInfo: ${label} must use P-256`);
        if (jwk.alg && jwk.alg !== "ES256")
            throw new Error(`Dacument.setActorInfo: ${label} must use ES256`);
    }
    static assertActorPrivateKey(jwk) {
        Dacument.assertActorKeyJwk(jwk, "privateKeyJwk");
        if (!jwk.d)
            throw new Error("Dacument.setActorInfo: privateKeyJwk must include 'd'");
    }
    static assertActorPublicKey(jwk) {
        Dacument.assertActorKeyJwk(jwk, "publicKeyJwk");
    }
    static schema = (schema) => {
        Dacument.requireActorInfo();
        return schema;
    };
    static register = register;
    static text = text;
    static array = array;
    static set = set;
    static map = map;
    static record = record;
    static async computeSchemaId(schema) {
        const normalized = schemaIdInput(schema);
        const sortedKeys = Object.keys(normalized).sort();
        const ordered = {};
        for (const key of sortedKeys)
            ordered[key] = normalized[key];
        const json = JSON.stringify(ordered);
        const data = new Uint8Array(Bytes.fromString(json));
        const digest = await crypto.subtle.digest("SHA-256", data);
        return Bytes.toBase64UrlString(new Uint8Array(digest));
    }
    static async create(params) {
        const ownerInfo = Dacument.requireActorInfo();
        const ownerId = ownerInfo.id;
        const docId = params.docId ?? generateNonce();
        const schemaId = await Dacument.computeSchemaId(params.schema);
        const roleKeys = await generateRoleKeys();
        const publicKeys = toPublicRoleKeys(roleKeys);
        const clock = new HLC(ownerId);
        const header = {
            alg: "ES256",
            typ: TOKEN_TYP,
            kid: `${ownerId}:owner`,
        };
        const ops = [];
        const capturePatches = (subscribe, mutate) => {
            const patches = [];
            const stop = subscribe((nodes) => patches.push(...nodes));
            try {
                mutate();
            }
            finally {
                stop();
            }
            return patches;
        };
        const sign = async (payload) => {
            const token = await signToken(roleKeys.owner.privateKey, header, payload);
            const actorSig = await Dacument.signActorToken(token);
            ops.push({ token, actorSig });
        };
        await sign({
            iss: ownerId,
            sub: docId,
            iat: nowSeconds(),
            stamp: clock.next(),
            kind: "acl.set",
            schema: schemaId,
            patch: {
                id: uuidv7(),
                target: ownerId,
                role: "owner",
                publicKeyJwk: ownerInfo.publicKeyJwk,
            },
        });
        for (const [field, schema] of Object.entries(params.schema)) {
            if (schema.crdt === "register") {
                if (schema.initial === undefined)
                    continue;
                if (!isValueOfType(schema.initial, schema.jsType))
                    throw new Error(`Dacument.create: invalid initial value for '${field}'`);
                if (schema.regex &&
                    typeof schema.initial === "string" &&
                    !schema.regex.test(schema.initial))
                    throw new Error(`Dacument.create: '${field}' failed regex`);
                await sign({
                    iss: ownerId,
                    sub: docId,
                    iat: nowSeconds(),
                    stamp: clock.next(),
                    kind: "register.set",
                    schema: schemaId,
                    field,
                    patch: { value: schema.initial },
                });
                continue;
            }
            if (schema.crdt === "text") {
                const initial = schema.initial ?? "";
                if (typeof initial !== "string")
                    throw new Error(`Dacument.create: invalid initial value for '${field}'`);
                if (!initial)
                    continue;
                const crdt = new CRText();
                const nodes = capturePatches((listener) => crdt.onChange(listener), () => {
                    for (const char of initial)
                        crdt.insertAt(crdt.length, char);
                });
                if (nodes.length)
                    await sign({
                        iss: ownerId,
                        sub: docId,
                        iat: nowSeconds(),
                        stamp: clock.next(),
                        kind: "text.patch",
                        schema: schemaId,
                        field,
                        patch: { nodes },
                    });
                continue;
            }
            if (schema.crdt === "array") {
                const initial = schema.initial ?? [];
                if (!Array.isArray(initial))
                    throw new Error(`Dacument.create: invalid initial value for '${field}'`);
                if (initial.length === 0)
                    continue;
                for (const value of initial) {
                    if (!isValueOfType(value, schema.jsType))
                        throw new Error(`Dacument.create: invalid initial value for '${field}'`);
                }
                const crdt = new CRArray();
                const nodes = capturePatches((listener) => crdt.onChange(listener), () => {
                    crdt.push(...initial);
                });
                if (nodes.length)
                    await sign({
                        iss: ownerId,
                        sub: docId,
                        iat: nowSeconds(),
                        stamp: clock.next(),
                        kind: "array.patch",
                        schema: schemaId,
                        field,
                        patch: { nodes },
                    });
                continue;
            }
            if (schema.crdt === "set") {
                const initial = schema.initial ?? [];
                if (!Array.isArray(initial))
                    throw new Error(`Dacument.create: invalid initial value for '${field}'`);
                if (initial.length === 0)
                    continue;
                for (const value of initial) {
                    if (!isValueOfType(value, schema.jsType))
                        throw new Error(`Dacument.create: invalid initial value for '${field}'`);
                }
                const crdt = new CRSet({
                    key: schema.key,
                });
                const nodes = capturePatches((listener) => crdt.onChange(listener), () => {
                    for (const value of initial)
                        crdt.add(value);
                });
                if (nodes.length)
                    await sign({
                        iss: ownerId,
                        sub: docId,
                        iat: nowSeconds(),
                        stamp: clock.next(),
                        kind: "set.patch",
                        schema: schemaId,
                        field,
                        patch: { nodes },
                    });
                continue;
            }
            if (schema.crdt === "map") {
                const initial = schema.initial ?? [];
                if (!Array.isArray(initial))
                    throw new Error(`Dacument.create: invalid initial value for '${field}'`);
                if (initial.length === 0)
                    continue;
                for (const entry of initial) {
                    if (!Array.isArray(entry) || entry.length !== 2)
                        throw new Error(`Dacument.create: invalid initial entry for '${field}'`);
                    const [key, value] = entry;
                    if (!isJsValue(key))
                        throw new Error(`Dacument.create: map key for '${field}' must be JSON-compatible`);
                    if (!isValueOfType(value, schema.jsType))
                        throw new Error(`Dacument.create: invalid initial value for '${field}'`);
                }
                const crdt = new CRMap({
                    key: schema.key,
                });
                const nodes = capturePatches((listener) => crdt.onChange(listener), () => {
                    for (const [key, value] of initial)
                        crdt.set(key, value);
                });
                if (nodes.length)
                    await sign({
                        iss: ownerId,
                        sub: docId,
                        iat: nowSeconds(),
                        stamp: clock.next(),
                        kind: "map.patch",
                        schema: schemaId,
                        field,
                        patch: { nodes },
                    });
                continue;
            }
            if (schema.crdt === "record") {
                const initial = schema.initial ?? {};
                if (!isObject(initial) || Array.isArray(initial))
                    throw new Error(`Dacument.create: invalid initial value for '${field}'`);
                const props = Object.keys(initial);
                if (props.length === 0)
                    continue;
                for (const prop of props) {
                    const value = initial[prop];
                    if (!isValueOfType(value, schema.jsType))
                        throw new Error(`Dacument.create: invalid initial value for '${field}'`);
                }
                const crdt = new CRRecord();
                const nodes = capturePatches((listener) => crdt.onChange(listener), () => {
                    for (const prop of props)
                        crdt[prop] = initial[prop];
                });
                if (nodes.length)
                    await sign({
                        iss: ownerId,
                        sub: docId,
                        iat: nowSeconds(),
                        stamp: clock.next(),
                        kind: "record.patch",
                        schema: schemaId,
                        field,
                        patch: { nodes },
                    });
                continue;
            }
        }
        const snapshot = {
            docId,
            roleKeys: publicKeys,
            ops,
        };
        return { docId, schemaId, roleKeys, snapshot };
    }
    static async load(params) {
        const actorId = Dacument.requireActorInfo().id;
        const schemaId = await Dacument.computeSchemaId(params.schema);
        const doc = new Dacument({
            schema: params.schema,
            schemaId,
            docId: params.snapshot.docId,
            roleKey: params.roleKey,
            roleKeys: params.snapshot.roleKeys,
        });
        await doc.merge(params.snapshot.ops);
        return doc;
    }
    docId;
    actorId;
    schema;
    schemaId;
    fields = new Map();
    aclLog = new AclLog();
    clock;
    roleKey;
    roleKeys;
    opLog = [];
    opTokens = new Set();
    verifiedOps = new Map();
    opIndexByToken = new Map();
    actorSigByToken = new Map();
    appliedTokens = new Set();
    currentRole;
    resetState = null;
    revokedCrdtByField = new Map();
    deleteStampsByField = new Map();
    tombstoneStampsByField = new Map();
    deleteNodeStampsByField = new Map();
    eventListeners = new Map();
    pending = new Set();
    ackByActor = new Map();
    suppressMerge = false;
    ackScheduled = false;
    actorKeyPublishPending = false;
    lastGcBarrier = null;
    snapshotFieldValues() {
        const values = new Map();
        for (const key of this.fields.keys())
            values.set(key, this.fieldValue(key));
        return values;
    }
    resetError() {
        const newDocId = this.resetState?.newDocId ?? "unknown";
        return new Error(`Dacument is reset/deprecated. Use newDocId: ${newDocId}`);
    }
    assertNotReset() {
        if (this.resetState)
            throw this.resetError();
    }
    currentRoleFor(actorId) {
        if (this.resetState)
            return "revoked";
        return this.aclLog.currentRole(actorId);
    }
    roleAt(actorId, stamp) {
        if (this.resetState && compareHLC(stamp, this.resetState.ts) > 0)
            return "revoked";
        return this.aclLog.roleAt(actorId, stamp);
    }
    recordActorSig(token, actorSig) {
        if (!actorSig || this.actorSigByToken.has(token))
            return;
        this.actorSigByToken.set(token, actorSig);
        const index = this.opIndexByToken.get(token);
        if (index === undefined)
            return;
        const entry = this.opLog[index];
        if (!entry.actorSig)
            entry.actorSig = actorSig;
    }
    acl;
    constructor(params) {
        const actorId = Dacument.requireActorInfo().id;
        this.schema = params.schema;
        this.schemaId = params.schemaId;
        this.docId = params.docId;
        this.actorId = actorId;
        this.roleKey = params.roleKey;
        this.roleKeys = params.roleKeys;
        this.clock = new HLC(this.actorId);
        this.assertSchemaKeys();
        for (const [key, schema] of Object.entries(this.schema)) {
            const crdt = createEmptyField(schema);
            this.fields.set(key, { schema, crdt });
        }
        this.acl = {
            setRole: (actorId, role) => this.setRole(actorId, role),
            getRole: (actorId) => this.currentRoleFor(actorId),
            knownActors: () => this.aclLog.knownActors(),
            snapshot: () => this.aclLog.snapshot(),
        };
        this.currentRole = this.currentRoleFor(this.actorId);
        return new Proxy(this, {
            get: (target, property, receiver) => {
                if (typeof property !== "string")
                    return Reflect.get(target, property, receiver);
                if (property in target)
                    return Reflect.get(target, property, receiver);
                if (!target.fields.has(property))
                    return undefined;
                const field = target.fields.get(property);
                if (field.schema.crdt === "register") {
                    const crdt = target.readCrdt(property, field);
                    return crdt.get();
                }
                if (!field.view)
                    field.view = target.createFieldView(property, field);
                return field.view;
            },
            set: (target, property, value, receiver) => {
                if (typeof property !== "string")
                    return Reflect.set(target, property, value, receiver);
                if (property in target)
                    return Reflect.set(target, property, value, receiver);
                const field = target.fields.get(property);
                if (!field)
                    throw new Error(`Dacument: unknown field '${property}'`);
                if (field.schema.crdt !== "register")
                    throw new Error(`Dacument: field '${property}' is read-only`);
                target.setRegisterValue(property, value);
                return true;
            },
            has: (target, property) => {
                if (typeof property !== "string")
                    return Reflect.has(target, property);
                if (property in target)
                    return true;
                return target.fields.has(property);
            },
            ownKeys: (target) => [...target.fields.keys()],
            getOwnPropertyDescriptor: (target, property) => {
                if (typeof property !== "string")
                    return Reflect.getOwnPropertyDescriptor(target, property);
                if (target.fields.has(property))
                    return { configurable: true, enumerable: true };
                return Reflect.getOwnPropertyDescriptor(target, property);
            },
            deleteProperty: () => false,
        });
    }
    addEventListener(type, listener) {
        const listeners = this.eventListeners.get(type) ??
            new Set();
        listeners.add(listener);
        this.eventListeners.set(type, listeners);
    }
    removeEventListener(type, listener) {
        const listeners = this.eventListeners.get(type);
        if (!listeners)
            return;
        listeners.delete(listener);
        if (listeners.size === 0)
            this.eventListeners.delete(type);
    }
    async flush() {
        await Promise.all([...this.pending]);
    }
    snapshot() {
        if (this.isRevoked() && !this.resetState)
            throw new Error("Dacument: revoked actors cannot snapshot");
        const ops = this.opLog.map((op) => {
            const actorSig = this.actorSigByToken.get(op.token);
            return actorSig ? { token: op.token, actorSig } : { token: op.token };
        });
        return {
            docId: this.docId,
            roleKeys: this.roleKeys,
            ops,
        };
    }
    getResetState() {
        return this.resetState
            ? {
                ts: this.resetState.ts,
                by: this.resetState.by,
                newDocId: this.resetState.newDocId,
                reason: this.resetState.reason,
            }
            : null;
    }
    selfRevoke() {
        this.assertNotReset();
        const stamp = this.clock.next();
        const role = this.roleAt(this.actorId, stamp);
        if (role === "revoked")
            return;
        const actorInfo = Dacument.requireActorInfo();
        const entry = this.aclLog.currentEntry(this.actorId);
        const patch = {
            id: uuidv7(),
            target: this.actorId,
            role: "revoked",
        };
        if (!entry?.publicKeyJwk)
            patch.publicKeyJwk = actorInfo.publicKeyJwk;
        const payload = {
            iss: this.actorId,
            sub: this.docId,
            iat: nowSeconds(),
            stamp,
            kind: "acl.set",
            schema: this.schemaId,
            patch,
        };
        if (roleNeedsKey(role) && this.roleKey) {
            this.queueLocalOp(payload, role);
            return;
        }
        this.queueActorOp(payload);
    }
    async accessReset(options = {}) {
        this.assertNotReset();
        const stamp = this.clock.next();
        const role = this.roleAt(this.actorId, stamp);
        if (role !== "owner")
            throw new Error("Dacument: only owner can accessReset");
        if (!this.roleKey)
            throw new Error("Dacument: missing owner private key");
        const schema = this.materializeSchema();
        const created = await Dacument.create({ schema });
        const newDoc = await Dacument.load({
            schema,
            roleKey: created.roleKeys.owner.privateKey,
            snapshot: created.snapshot,
        });
        const patch = {
            newDocId: created.docId,
        };
        if (options.reason)
            patch.reason = options.reason;
        const payload = {
            iss: this.actorId,
            sub: this.docId,
            iat: nowSeconds(),
            stamp,
            kind: "reset",
            schema: this.schemaId,
            patch,
        };
        const header = {
            alg: "ES256",
            typ: TOKEN_TYP,
            kid: `${this.actorId}:owner`,
        };
        const token = await signToken(this.roleKey, header, payload);
        const actorSig = await Dacument.signActorToken(token);
        const oldDocOps = [{ token, actorSig }];
        this.emitEvent("change", { type: "change", ops: oldDocOps });
        await this.merge(oldDocOps);
        return {
            newDoc,
            oldDocOps,
            newDocSnapshot: created.snapshot,
            roleKeys: created.roleKeys,
        };
    }
    async verifyActorIntegrity(options = {}) {
        const input = options.token !== undefined
            ? [options.token]
            : options.ops ?? options.snapshot?.ops ?? this.opLog;
        let verified = 0;
        let failed = 0;
        let missing = 0;
        const failures = [];
        for (let index = 0; index < input.length; index++) {
            const item = input[index];
            const token = typeof item === "string" ? item : item.token;
            const actorSig = typeof item === "string"
                ? this.actorSigByToken.get(token)
                : item.actorSig ?? this.actorSigByToken.get(token);
            const decoded = decodeToken(token);
            if (!decoded) {
                failed++;
                failures.push({ index, reason: "invalid token" });
                continue;
            }
            const payload = decoded.payload;
            if (!this.isValidPayload(payload)) {
                failed++;
                failures.push({ index, reason: "invalid payload" });
                continue;
            }
            if (!actorSig) {
                missing++;
                continue;
            }
            const publicKey = this.aclLog.publicKeyAt(payload.iss, payload.stamp);
            if (!publicKey) {
                missing++;
                continue;
            }
            try {
                const ok = await verifyDetached(publicKey, token, actorSig);
                if (!ok) {
                    failed++;
                    failures.push({ index, reason: "actor signature mismatch" });
                    continue;
                }
            }
            catch (error) {
                failed++;
                failures.push({
                    index,
                    reason: error instanceof Error ? error.message : "actor signature error",
                });
                continue;
            }
            verified++;
        }
        return {
            ok: failed === 0,
            verified,
            failed,
            missing,
            failures,
        };
    }
    async merge(input) {
        const tokens = Array.isArray(input) ? input : [input];
        const decodedOps = [];
        const accepted = [];
        let rejected = 0;
        let sawNewToken = false;
        let diffActor = null;
        let diffStamp = null;
        for (const item of tokens) {
            const token = typeof item === "string" ? item : item.token;
            const actorSig = typeof item === "string" ? undefined : item.actorSig;
            const decoded = decodeToken(token);
            if (!decoded) {
                rejected++;
                continue;
            }
            const payload = decoded.payload;
            if (!this.isValidPayload(payload)) {
                rejected++;
                continue;
            }
            if (payload.sub !== this.docId || payload.schema !== this.schemaId) {
                rejected++;
                continue;
            }
            if (decoded.header.alg === "none") {
                rejected++;
                continue;
            }
            let stored = this.verifiedOps.get(token);
            if (!stored) {
                const signerKind = parseSignerKind(decoded.header.kid, payload.iss);
                if (!signerKind) {
                    rejected++;
                    continue;
                }
                if (signerKind === "actor") {
                    if (payload.kind === "ack") {
                        const publicKey = this.aclLog.publicKeyAt(payload.iss, payload.stamp);
                        if (!publicKey) {
                            rejected++;
                            continue;
                        }
                        const verified = await verifyToken(publicKey, token, TOKEN_TYP);
                        if (!verified) {
                            rejected++;
                            continue;
                        }
                        stored = { payload, signerRole: "actor" };
                    }
                    else if (payload.kind === "acl.set") {
                        const patch = isAclPatch(payload.patch) ? payload.patch : null;
                        if (!patch || patch.target !== payload.iss) {
                            rejected++;
                            continue;
                        }
                        const wantsSelfRevoke = patch.role === "revoked";
                        const wantsKeyAttach = Boolean(patch.publicKeyJwk);
                        if (!wantsSelfRevoke && !wantsKeyAttach) {
                            rejected++;
                            continue;
                        }
                        const existingKey = this.aclLog.publicKeyAt(payload.iss, payload.stamp);
                        const publicKey = existingKey ?? patch.publicKeyJwk;
                        if (!publicKey) {
                            rejected++;
                            continue;
                        }
                        const verified = await verifyToken(publicKey, token, TOKEN_TYP);
                        if (!verified) {
                            rejected++;
                            continue;
                        }
                        stored = { payload, signerRole: "actor" };
                    }
                    else {
                        rejected++;
                        continue;
                    }
                }
                else {
                    if (payload.kind === "ack") {
                        rejected++;
                        continue;
                    }
                    const publicKey = this.roleKeys[signerKind];
                    const verified = await verifyToken(publicKey, token, TOKEN_TYP);
                    if (!verified) {
                        rejected++;
                        continue;
                    }
                    stored = { payload, signerRole: signerKind };
                }
                this.verifiedOps.set(token, stored);
                if (!this.opTokens.has(token)) {
                    this.opTokens.add(token);
                    const opEntry = { token };
                    if (typeof actorSig === "string") {
                        opEntry.actorSig = actorSig;
                        this.actorSigByToken.set(token, actorSig);
                    }
                    this.opLog.push(opEntry);
                    this.opIndexByToken.set(token, this.opLog.length - 1);
                }
                sawNewToken = true;
                if (payload.kind === "acl.set") {
                    if (!diffStamp || compareHLC(payload.stamp, diffStamp) > 0) {
                        diffStamp = payload.stamp;
                        diffActor = payload.iss;
                    }
                }
            }
            this.recordActorSig(token, actorSig);
            decodedOps.push({
                token,
                payload: stored.payload,
                signerRole: stored.signerRole,
            });
        }
        const prevRole = this.currentRole;
        let appliedNonAck = false;
        if (sawNewToken) {
            const beforeValues = this.isRevoked() ? undefined : this.snapshotFieldValues();
            const result = await this.rebuildFromVerified(new Set(this.appliedTokens), {
                beforeValues,
                diffActor: diffActor ?? this.actorId,
            });
            appliedNonAck = result.appliedNonAck;
        }
        for (const { token } of decodedOps) {
            if (this.appliedTokens.has(token)) {
                accepted.push({ token });
            }
            else {
                rejected++;
            }
        }
        const nextRole = this.currentRole;
        if (nextRole !== prevRole && nextRole === "revoked") {
            const entry = this.aclLog.currentEntry(this.actorId);
            this.emitRevoked(prevRole, entry?.by ?? this.actorId, entry?.stamp ?? this.clock.current);
        }
        if (appliedNonAck && !this.resetState)
            this.scheduleAck();
        this.maybeGc();
        this.maybePublishActorKey();
        return { accepted, rejected };
    }
    async rebuildFromVerified(previousApplied, options) {
        const invalidated = new Set(previousApplied);
        let appliedNonAck = false;
        this.aclLog.reset();
        this.ackByActor.clear();
        this.appliedTokens.clear();
        this.deleteStampsByField.clear();
        this.tombstoneStampsByField.clear();
        this.deleteNodeStampsByField.clear();
        this.revokedCrdtByField.clear();
        this.resetState = null;
        let resetStamp = null;
        for (const state of this.fields.values()) {
            state.crdt = createEmptyField(state.schema);
        }
        const ops = [...this.verifiedOps.entries()].map(([token, data]) => ({
            token,
            payload: data.payload,
            signerRole: data.signerRole,
        }));
        ops.sort((left, right) => {
            const cmp = compareHLC(left.payload.stamp, right.payload.stamp);
            if (cmp !== 0)
                return cmp;
            if (left.token === right.token)
                return 0;
            return left.token < right.token ? -1 : 1;
        });
        for (const { token, payload, signerRole } of ops) {
            if (resetStamp && compareHLC(payload.stamp, resetStamp) > 0)
                continue;
            let allowed = false;
            const isReset = payload.kind === "reset";
            if (isReset) {
                if (this.resetState)
                    continue;
                if (!isResetPatch(payload.patch))
                    continue;
                const roleAt = this.roleAt(payload.iss, payload.stamp);
                if (signerRole === "owner" && roleAt === "owner") {
                    allowed = true;
                }
            }
            else if (payload.kind === "acl.set") {
                const patch = isAclPatch(payload.patch) ? payload.patch : null;
                if (!patch)
                    continue;
                if (this.aclLog.isEmpty() &&
                    patch.role === "owner" &&
                    patch.target === payload.iss &&
                    signerRole === "owner") {
                    allowed = true;
                }
                else {
                    const roleAt = this.roleAt(payload.iss, payload.stamp);
                    const isSelf = patch.target === payload.iss;
                    const isSelfRevoke = isSelf && patch.role === "revoked";
                    const targetKey = this.aclLog.publicKeyAt(patch.target, payload.stamp);
                    const keyMismatch = Boolean(patch.publicKeyJwk) &&
                        Boolean(targetKey) &&
                        !jwkEquals(targetKey, patch.publicKeyJwk);
                    const isSelfKeyUpdate = isSelf &&
                        patch.publicKeyJwk &&
                        patch.role === roleAt &&
                        roleAt !== "revoked";
                    if (keyMismatch && signerRole !== "actor")
                        continue;
                    if (isSelfRevoke) {
                        if (signerRole === "actor") {
                            allowed = true;
                        }
                        else if (signerRole && roleAt === signerRole) {
                            allowed = true;
                        }
                    }
                    else if (signerRole === "actor") {
                        if (isSelfKeyUpdate)
                            allowed = true;
                    }
                    else if (signerRole && roleAt === signerRole) {
                        if (this.canWriteAclTarget(signerRole, patch.role, patch.target, payload.stamp)) {
                            allowed = true;
                        }
                        else if (isSelfKeyUpdate && !keyMismatch) {
                            allowed = true;
                        }
                    }
                }
            }
            else {
                const roleAt = this.roleAt(payload.iss, payload.stamp);
                if (payload.kind === "ack") {
                    if (roleAt === "revoked")
                        continue;
                    if (signerRole !== "actor")
                        continue;
                    allowed = true;
                }
                else if (signerRole && roleAt === signerRole) {
                    if (this.canWriteField(signerRole))
                        allowed = true;
                }
            }
            if (!allowed)
                continue;
            const emit = !previousApplied.has(token);
            this.suppressMerge = !emit;
            try {
                const applied = isReset
                    ? this.applyResetPayload(payload, emit)
                    : this.applyRemotePayload(payload, signerRole);
                if (!applied)
                    continue;
            }
            finally {
                this.suppressMerge = false;
            }
            if (isReset)
                resetStamp = payload.stamp;
            this.appliedTokens.add(token);
            invalidated.delete(token);
            if (emit && payload.kind !== "ack")
                appliedNonAck = true;
        }
        this.currentRole = this.currentRoleFor(this.actorId);
        if (invalidated.size > 0 &&
            options?.beforeValues &&
            options.diffActor &&
            !this.isRevoked()) {
            this.emitInvalidationDiffs(options.beforeValues, options.diffActor);
        }
        return { appliedNonAck };
    }
    maybePublishActorKey() {
        if (this.resetState)
            return;
        const entry = this.aclLog.currentEntry(this.actorId);
        if (entry?.publicKeyJwk) {
            const actorInfo = Dacument.requireActorInfo();
            if (jwkEquals(entry.publicKeyJwk, actorInfo.publicKeyJwk)) {
                this.actorKeyPublishPending = false;
                return;
            }
        }
        if (this.actorKeyPublishPending)
            return;
        if (this.isRevoked())
            return;
        if (!entry)
            return;
        const actorInfo = Dacument.requireActorInfo();
        const signerInfo = entry.publicKeyJwk
            ? Dacument.actorInfoForPublicKey(entry.publicKeyJwk)
            : actorInfo;
        if (entry.publicKeyJwk && !signerInfo) {
            this.emitError(new Error("Dacument: actor key mismatch; update requires current key material"));
            return;
        }
        const stamp = this.clock.next();
        const payload = {
            iss: this.actorId,
            sub: this.docId,
            iat: nowSeconds(),
            stamp,
            kind: "acl.set",
            schema: this.schemaId,
            patch: {
                id: uuidv7(),
                target: this.actorId,
                role: entry.role,
                publicKeyJwk: actorInfo.publicKeyJwk,
            },
        };
        this.actorKeyPublishPending = true;
        this.queueActorOp(payload, {
            signer: (signerInfo ?? actorInfo).privateKeyJwk,
            onError: () => {
                this.actorKeyPublishPending = false;
            },
        });
    }
    actorSignatureKey() {
        const entry = this.aclLog.currentEntry(this.actorId);
        if (!entry?.publicKeyJwk)
            return null;
        const actorInfo = Dacument.actorInfoForPublicKey(entry.publicKeyJwk);
        return actorInfo?.privateKeyJwk ?? null;
    }
    ack() {
        this.assertNotReset();
        const stamp = this.clock.next();
        const role = this.roleAt(this.actorId, stamp);
        if (role === "revoked")
            throw new Error("Dacument: revoked actors cannot acknowledge");
        const entry = this.aclLog.currentEntry(this.actorId);
        if (!entry?.publicKeyJwk)
            return;
        const actorInfo = Dacument.actorInfoForPublicKey(entry.publicKeyJwk);
        if (!actorInfo) {
            this.emitError(new Error("Dacument: actor key not available to sign ack"));
            return;
        }
        const seen = this.clock.current;
        this.ackByActor.set(this.actorId, seen);
        this.queueActorOp({
            iss: this.actorId,
            sub: this.docId,
            iat: nowSeconds(),
            stamp,
            kind: "ack",
            schema: this.schemaId,
            patch: { seen },
        }, { signer: actorInfo.privateKeyJwk });
    }
    scheduleAck() {
        if (this.ackScheduled)
            return;
        if (this.currentRole === "revoked")
            return;
        if (this.resetState)
            return;
        this.ackScheduled = true;
        queueMicrotask(() => {
            this.ackScheduled = false;
            try {
                this.ack();
            }
            catch (error) {
                this.emitError(error instanceof Error ? error : new Error(String(error)));
            }
        });
    }
    computeGcBarrier() {
        const actors = this.aclLog
            .knownActors()
            .filter((actorId) => this.aclLog.currentRole(actorId) !== "revoked");
        if (actors.length === 0)
            return null;
        let barrier = null;
        for (const actorId of actors) {
            const seen = this.ackByActor.get(actorId);
            if (!seen)
                return null;
            if (!barrier || compareHLC(seen, barrier) < 0)
                barrier = seen;
        }
        return barrier;
    }
    maybeGc() {
        if (this.resetState)
            return;
        const barrier = this.computeGcBarrier();
        if (!barrier)
            return;
        if (this.lastGcBarrier && compareHLC(barrier, this.lastGcBarrier) <= 0)
            return;
        this.lastGcBarrier = barrier;
        this.compactFields(barrier);
    }
    compactFields(barrier) {
        for (const [field, state] of this.fields.entries()) {
            if (state.schema.crdt === "text" || state.schema.crdt === "array") {
                this.compactListField(field, state, barrier);
                continue;
            }
            if (state.schema.crdt === "set" ||
                state.schema.crdt === "map" ||
                state.schema.crdt === "record") {
                this.compactTombstoneField(field, state, barrier);
            }
        }
    }
    compactListField(field, state, barrier) {
        const deleteMap = this.deleteStampsByField.get(field);
        if (!deleteMap || deleteMap.size === 0)
            return;
        const removable = new Set();
        for (const [nodeId, stamp] of deleteMap.entries()) {
            if (compareHLC(stamp, barrier) <= 0)
                removable.add(nodeId);
        }
        if (removable.size === 0)
            return;
        const crdt = state.crdt;
        const snapshot = crdt.snapshot();
        const filtered = snapshot.filter((node) => !(node.deleted && removable.has(node.id)));
        if (filtered.length === snapshot.length)
            return;
        state.crdt =
            state.schema.crdt === "text"
                ? new CRText(filtered)
                : new CRArray(filtered);
        for (const nodeId of removable)
            deleteMap.delete(nodeId);
    }
    compactTombstoneField(field, state, barrier) {
        const tombstoneMap = this.tombstoneStampsByField.get(field);
        const deleteNodeMap = this.deleteNodeStampsByField.get(field);
        if (!tombstoneMap || tombstoneMap.size === 0 || !deleteNodeMap)
            return;
        const removableTags = new Set();
        for (const [tagId, stamp] of tombstoneMap.entries()) {
            if (compareHLC(stamp, barrier) <= 0)
                removableTags.add(tagId);
        }
        if (removableTags.size === 0)
            return;
        const snapshot = state.crdt.snapshot();
        const filtered = [];
        const remainingDeletes = new Map();
        const remainingTombstones = new Map();
        for (const node of snapshot) {
            if ("op" in node && node.op === "add") {
                if (removableTags.has(node.id))
                    continue;
                filtered.push(node);
                continue;
            }
            if ("op" in node && node.op === "set") {
                if (removableTags.has(node.id))
                    continue;
                filtered.push(node);
                continue;
            }
            if ("op" in node && (node.op === "rem" || node.op === "del")) {
                const stamp = deleteNodeMap.get(node.id);
                const targets = node.targets;
                const allTargetsRemovable = targets.every((target) => removableTags.has(target));
                if (stamp &&
                    compareHLC(stamp, barrier) <= 0 &&
                    allTargetsRemovable) {
                    continue;
                }
                filtered.push(node);
                if (stamp) {
                    remainingDeletes.set(node.id, stamp);
                    for (const target of targets) {
                        const existing = remainingTombstones.get(target);
                        if (!existing || compareHLC(stamp, existing) < 0)
                            remainingTombstones.set(target, stamp);
                    }
                }
                continue;
            }
            filtered.push(node);
        }
        if (filtered.length === snapshot.length)
            return;
        if (state.schema.crdt === "set") {
            state.crdt = new CRSet({
                snapshot: filtered,
                key: state.schema.key,
            });
        }
        else if (state.schema.crdt === "map") {
            state.crdt = new CRMap({
                snapshot: filtered,
                key: state.schema.key,
            });
        }
        else {
            state.crdt = new CRRecord(filtered);
        }
        this.deleteNodeStampsByField.set(field, remainingDeletes);
        this.tombstoneStampsByField.set(field, remainingTombstones);
    }
    setRegisterValue(field, value) {
        const state = this.fields.get(field);
        if (!state)
            throw new Error(`Dacument: unknown field '${field}'`);
        const schema = state.schema;
        if (schema.crdt !== "register")
            throw new Error(`Dacument: field '${field}' is not a register`);
        if (!isValueOfType(value, schema.jsType))
            throw new Error(`Dacument: invalid value for '${field}'`);
        if (schema.regex && typeof value === "string" && !schema.regex.test(value))
            throw new Error(`Dacument: '${field}' failed regex`);
        this.assertNotReset();
        const stamp = this.clock.next();
        const role = this.roleAt(this.actorId, stamp);
        if (!this.canWriteField(role))
            throw new Error(`Dacument: role '${role}' cannot write '${field}'`);
        this.queueLocalOp({
            iss: this.actorId,
            sub: this.docId,
            iat: nowSeconds(),
            stamp,
            kind: "register.set",
            schema: this.schemaId,
            field,
            patch: { value },
        }, role);
    }
    createFieldView(field, state) {
        switch (state.schema.crdt) {
            case "text":
                return this.createTextView(field, state);
            case "array":
                return this.createArrayView(field, state);
            case "set":
                return this.createSetView(field, state);
            case "map":
                return this.createMapView(field, state);
            case "record":
                return this.createRecordView(field, state);
            default:
                return undefined;
        }
    }
    shadowFor(field, state) {
        const snapshot = state.crdt.snapshot?.();
        const cloned = snapshot ? structuredClone(snapshot) : undefined;
        switch (state.schema.crdt) {
            case "text":
                return new CRText(cloned);
            case "array":
                return new CRArray(cloned);
            case "set":
                return new CRSet({
                    snapshot: cloned,
                    key: state.schema.key,
                });
            case "map":
                return new CRMap({
                    snapshot: cloned,
                    key: state.schema.key,
                });
            case "record":
                return new CRRecord(cloned);
            case "register": {
                const reg = new CRRegister();
                if (cloned && Array.isArray(cloned))
                    reg.merge(cloned);
                return reg;
            }
            default:
                throw new Error(`Dacument: unknown field '${field}'`);
        }
    }
    isRevoked() {
        return this.currentRole === "revoked";
    }
    readCrdt(field, state) {
        if (!this.isRevoked())
            return state.crdt;
        return this.revokedCrdt(field, state);
    }
    revokedCrdt(field, state) {
        const existing = this.revokedCrdtByField.get(field);
        if (existing)
            return existing;
        const schema = state.schema;
        let crdt;
        switch (schema.crdt) {
            case "register": {
                const reg = new CRRegister();
                if (schema.initial !== undefined)
                    reg.set(schema.initial);
                crdt = reg;
                break;
            }
            case "text": {
                const text = new CRText();
                const initial = typeof schema.initial === "string" ? schema.initial : "";
                for (const char of initial)
                    text.insertAt(text.length, char);
                crdt = text;
                break;
            }
            case "array": {
                const arr = new CRArray();
                const initial = Array.isArray(schema.initial) ? schema.initial : [];
                if (initial.length)
                    arr.push(...initial);
                crdt = arr;
                break;
            }
            case "set": {
                const setCrdt = new CRSet({
                    key: schema.key,
                });
                const initial = Array.isArray(schema.initial) ? schema.initial : [];
                for (const value of initial)
                    setCrdt.add(value);
                crdt = setCrdt;
                break;
            }
            case "map": {
                const mapCrdt = new CRMap({
                    key: schema.key,
                });
                const initial = Array.isArray(schema.initial) ? schema.initial : [];
                for (const entry of initial) {
                    if (!Array.isArray(entry) || entry.length !== 2)
                        continue;
                    const [key, value] = entry;
                    mapCrdt.set(key, value);
                }
                crdt = mapCrdt;
                break;
            }
            case "record": {
                const recordCrdt = new CRRecord();
                const initial = schema.initial && isObject(schema.initial) && !Array.isArray(schema.initial)
                    ? schema.initial
                    : {};
                for (const [prop, value] of Object.entries(initial))
                    recordCrdt[prop] = value;
                crdt = recordCrdt;
                break;
            }
            default:
                throw new Error(`Dacument: unknown field '${field}'`);
        }
        this.revokedCrdtByField.set(field, crdt);
        return crdt;
    }
    stampMapFor(map, field) {
        const existing = map.get(field);
        if (existing)
            return existing;
        const created = new Map();
        map.set(field, created);
        return created;
    }
    setMinStamp(map, id, stamp) {
        const existing = map.get(id);
        if (!existing || compareHLC(stamp, existing) < 0)
            map.set(id, stamp);
    }
    recordDeletedNode(field, nodeId, stamp) {
        const map = this.stampMapFor(this.deleteStampsByField, field);
        this.setMinStamp(map, nodeId, stamp);
    }
    recordTombstone(field, tagId, stamp) {
        const map = this.stampMapFor(this.tombstoneStampsByField, field);
        this.setMinStamp(map, tagId, stamp);
    }
    recordDeleteNodeStamp(field, nodeId, stamp) {
        const map = this.stampMapFor(this.deleteNodeStampsByField, field);
        this.setMinStamp(map, nodeId, stamp);
    }
    createTextView(field, state) {
        const doc = this;
        const readCrdt = () => doc.readCrdt(field, state);
        return {
            get length() {
                return readCrdt().length;
            },
            toString() {
                return readCrdt().toString();
            },
            at(index) {
                return readCrdt().at(index);
            },
            insertAt(index, value) {
                doc.assertValueType(field, value);
                const stamp = doc.clock.next();
                const role = doc.roleAt(doc.actorId, stamp);
                doc.assertWritable(field, role);
                const shadow = doc.shadowFor(field, state);
                const { patches, result } = doc.capturePatches((listener) => shadow.onChange(listener), () => shadow.insertAt(index, value));
                if (patches.length === 0)
                    return result;
                doc.queueLocalOp({
                    iss: doc.actorId,
                    sub: doc.docId,
                    iat: nowSeconds(),
                    stamp,
                    kind: "text.patch",
                    schema: doc.schemaId,
                    field,
                    patch: { nodes: patches },
                }, role);
                return result;
            },
            deleteAt(index) {
                const stamp = doc.clock.next();
                const role = doc.roleAt(doc.actorId, stamp);
                doc.assertWritable(field, role);
                const shadow = doc.shadowFor(field, state);
                const { patches, result } = doc.capturePatches((listener) => shadow.onChange(listener), () => shadow.deleteAt(index));
                if (patches.length === 0)
                    return result;
                doc.queueLocalOp({
                    iss: doc.actorId,
                    sub: doc.docId,
                    iat: nowSeconds(),
                    stamp,
                    kind: "text.patch",
                    schema: doc.schemaId,
                    field,
                    patch: { nodes: patches },
                }, role);
                return result;
            },
            [Symbol.iterator]() {
                return readCrdt().toString()[Symbol.iterator]();
            },
        };
    }
    createArrayView(field, state) {
        const doc = this;
        const readCrdt = () => doc.readCrdt(field, state);
        return {
            get length() {
                return readCrdt().length;
            },
            at(index) {
                return readCrdt().at(index);
            },
            slice(start, end) {
                return readCrdt().slice(start, end);
            },
            push(...items) {
                doc.assertValueArray(field, items);
                return doc.commitArrayMutation(field, (shadow) => shadow.push(...items));
            },
            unshift(...items) {
                doc.assertValueArray(field, items);
                return doc.commitArrayMutation(field, (shadow) => shadow.unshift(...items));
            },
            pop() {
                return doc.commitArrayMutation(field, (shadow) => shadow.pop());
            },
            shift() {
                return doc.commitArrayMutation(field, (shadow) => shadow.shift());
            },
            setAt(index, value) {
                doc.assertValueType(field, value);
                return doc.commitArrayMutation(field, (shadow) => shadow.setAt(index, value));
            },
            map(callback, thisArg) {
                return readCrdt().map(callback, thisArg);
            },
            filter(callback, thisArg) {
                return readCrdt().filter(callback, thisArg);
            },
            reduce(callback, initialValue) {
                return readCrdt().reduce(callback, initialValue);
            },
            forEach(callback, thisArg) {
                return readCrdt().forEach(callback, thisArg);
            },
            includes(value) {
                return readCrdt().includes(value);
            },
            indexOf(value) {
                return readCrdt().indexOf(value);
            },
            [Symbol.iterator]() {
                return readCrdt()[Symbol.iterator]();
            },
        };
    }
    createSetView(field, state) {
        const doc = this;
        const readCrdt = () => doc.readCrdt(field, state);
        return {
            get size() {
                return readCrdt().size;
            },
            add(value) {
                doc.assertValueType(field, value);
                return doc.commitSetMutation(field, (shadow) => shadow.add(value));
            },
            delete(value) {
                return doc.commitSetMutation(field, (shadow) => shadow.delete(value));
            },
            clear() {
                return doc.commitSetMutation(field, (shadow) => shadow.clear());
            },
            has(value) {
                return readCrdt().has(value);
            },
            entries() {
                return readCrdt().entries();
            },
            keys() {
                return readCrdt().keys();
            },
            values() {
                return readCrdt().values();
            },
            forEach(callback, thisArg) {
                return readCrdt().forEach(callback, thisArg);
            },
            [Symbol.iterator]() {
                return readCrdt()[Symbol.iterator]();
            },
            get [Symbol.toStringTag]() {
                return "CRSet";
            },
        };
    }
    createMapView(field, state) {
        const doc = this;
        const readCrdt = () => doc.readCrdt(field, state);
        return {
            get size() {
                return readCrdt().size;
            },
            get(key) {
                return readCrdt().get(key);
            },
            set(key, value) {
                doc.assertMapKey(field, key);
                doc.assertValueType(field, value);
                return doc.commitMapMutation(field, (shadow) => shadow.set(key, value));
            },
            has(key) {
                return readCrdt().has(key);
            },
            delete(key) {
                doc.assertMapKey(field, key);
                return doc.commitMapMutation(field, (shadow) => shadow.delete(key));
            },
            clear() {
                return doc.commitMapMutation(field, (shadow) => shadow.clear());
            },
            entries() {
                return readCrdt().entries();
            },
            keys() {
                return readCrdt().keys();
            },
            values() {
                return readCrdt().values();
            },
            forEach(callback, thisArg) {
                return readCrdt().forEach(callback, thisArg);
            },
            [Symbol.iterator]() {
                return readCrdt()[Symbol.iterator]();
            },
            get [Symbol.toStringTag]() {
                return "CRMap";
            },
        };
    }
    createRecordView(field, state) {
        const doc = this;
        const readCrdt = () => doc.readCrdt(field, state);
        return new Proxy({}, {
            get: (target, prop, receiver) => {
                if (typeof prop !== "string")
                    return Reflect.get(target, prop, receiver);
                if (prop in target)
                    return Reflect.get(target, prop, receiver);
                return readCrdt()[prop];
            },
            set: (_target, prop, value) => {
                if (typeof prop !== "string")
                    return false;
                doc.assertValueType(field, value);
                doc.commitRecordMutation(field, (shadow) => {
                    shadow[prop] = value;
                });
                return true;
            },
            deleteProperty: (_target, prop) => {
                if (typeof prop !== "string")
                    return false;
                doc.commitRecordMutation(field, (shadow) => {
                    delete shadow[prop];
                });
                return true;
            },
            has: (_target, prop) => {
                if (typeof prop !== "string")
                    return false;
                return prop in readCrdt();
            },
            ownKeys: () => Object.keys(readCrdt()),
            getOwnPropertyDescriptor: (_target, prop) => {
                if (typeof prop !== "string")
                    return undefined;
                if (prop in readCrdt())
                    return { enumerable: true, configurable: true };
                return undefined;
            },
        });
    }
    commitArrayMutation(field, mutate) {
        const state = this.fields.get(field);
        const stamp = this.clock.next();
        const role = this.roleAt(this.actorId, stamp);
        this.assertWritable(field, role);
        const shadow = this.shadowFor(field, state);
        const { patches, result } = this.capturePatches((listener) => shadow.onChange(listener), () => mutate(shadow));
        if (patches.length === 0)
            return result;
        this.queueLocalOp({
            iss: this.actorId,
            sub: this.docId,
            iat: nowSeconds(),
            stamp,
            kind: "array.patch",
            schema: this.schemaId,
            field,
            patch: { nodes: patches },
        }, role);
        return result;
    }
    commitSetMutation(field, mutate) {
        const state = this.fields.get(field);
        const stamp = this.clock.next();
        const role = this.roleAt(this.actorId, stamp);
        this.assertWritable(field, role);
        const shadow = this.shadowFor(field, state);
        const { patches, result } = this.capturePatches((listener) => shadow.onChange(listener), () => mutate(shadow));
        if (patches.length === 0)
            return result;
        this.queueLocalOp({
            iss: this.actorId,
            sub: this.docId,
            iat: nowSeconds(),
            stamp,
            kind: "set.patch",
            schema: this.schemaId,
            field,
            patch: { nodes: patches },
        }, role);
        return result;
    }
    commitMapMutation(field, mutate) {
        const state = this.fields.get(field);
        const stamp = this.clock.next();
        const role = this.roleAt(this.actorId, stamp);
        this.assertWritable(field, role);
        const shadow = this.shadowFor(field, state);
        const { patches, result } = this.capturePatches((listener) => shadow.onChange(listener), () => mutate(shadow));
        if (patches.length === 0)
            return result;
        this.queueLocalOp({
            iss: this.actorId,
            sub: this.docId,
            iat: nowSeconds(),
            stamp,
            kind: "map.patch",
            schema: this.schemaId,
            field,
            patch: { nodes: patches },
        }, role);
        return result;
    }
    commitRecordMutation(field, mutate) {
        const state = this.fields.get(field);
        const stamp = this.clock.next();
        const role = this.roleAt(this.actorId, stamp);
        this.assertWritable(field, role);
        const shadow = this.shadowFor(field, state);
        const { patches, result } = this.capturePatches((listener) => shadow.onChange(listener), () => mutate(shadow));
        if (patches.length === 0)
            return;
        this.queueLocalOp({
            iss: this.actorId,
            sub: this.docId,
            iat: nowSeconds(),
            stamp,
            kind: "record.patch",
            schema: this.schemaId,
            field,
            patch: { nodes: patches },
        }, role);
        return result;
    }
    capturePatches(subscribe, mutate) {
        const patches = [];
        const stop = subscribe((nodes) => patches.push(...nodes));
        let result;
        try {
            result = mutate();
        }
        finally {
            stop();
        }
        return { patches, result };
    }
    queueLocalOp(payload, role) {
        this.assertNotReset();
        if (payload.kind === "ack") {
            throw new Error("Dacument: ack ops must be actor-signed");
        }
        if (!roleNeedsKey(role))
            throw new Error(`Dacument: role '${role}' cannot sign ops`);
        if (!this.roleKey)
            throw new Error("Dacument: missing role private key");
        const header = { alg: "ES256", typ: TOKEN_TYP, kid: `${payload.iss}:${role}` };
        const promise = signToken(this.roleKey, header, payload)
            .then(async (token) => {
            const actorSigKey = this.actorSignatureKey();
            const actorSig = actorSigKey
                ? await Dacument.signActorToken(token, actorSigKey)
                : undefined;
            const op = actorSig ? { token, actorSig } : { token };
            this.emitEvent("change", { type: "change", ops: [op] });
        })
            .catch((error) => this.emitError(error instanceof Error ? error : new Error(String(error))));
        this.pending.add(promise);
        promise.finally(() => this.pending.delete(promise));
    }
    queueActorOp(payload, options) {
        this.assertNotReset();
        const actorInfo = Dacument.requireActorInfo();
        const signingKey = options?.signer ?? actorInfo.privateKeyJwk;
        const header = {
            alg: "ES256",
            typ: TOKEN_TYP,
            kid: `${payload.iss}:actor`,
        };
        const promise = signToken(signingKey, header, payload)
            .then(async (token) => {
            const actorSig = await Dacument.signActorToken(token, signingKey);
            const op = { token, actorSig };
            this.emitEvent("change", { type: "change", ops: [op] });
        })
            .catch((error) => {
            options?.onError?.();
            this.emitError(error instanceof Error ? error : new Error(String(error)));
        });
        this.pending.add(promise);
        promise.finally(() => this.pending.delete(promise));
    }
    applyResetPayload(payload, emit) {
        if (!isResetPatch(payload.patch))
            return false;
        if (this.resetState)
            return false;
        this.clock.observe(payload.stamp);
        const patch = payload.patch;
        this.resetState = {
            ts: payload.stamp,
            by: payload.iss,
            newDocId: patch.newDocId,
            reason: patch.reason,
        };
        if (emit)
            this.emitReset(this.resetState);
        return true;
    }
    applyRemotePayload(payload, signerRole) {
        this.clock.observe(payload.stamp);
        if (payload.kind === "ack") {
            if (!isAckPatch(payload.patch))
                return false;
            this.ackByActor.set(payload.iss, payload.patch.seen);
            return true;
        }
        if (payload.kind === "acl.set") {
            if (!signerRole)
                return false;
            if (signerRole === "actor")
                return this.applyAclPayload(payload, null, { skipAuth: true });
            return this.applyAclPayload(payload, signerRole);
        }
        if (!signerRole || signerRole === "actor")
            return false;
        if (!payload.field)
            return false;
        const state = this.fields.get(payload.field);
        if (!state)
            return false;
        switch (payload.kind) {
            case "register.set":
                return this.applyRegisterPayload(payload, state);
            case "text.patch":
            case "array.patch":
            case "set.patch":
            case "map.patch":
            case "record.patch":
                return this.applyNodePayload(payload, state);
            default:
                return false;
        }
    }
    applyAclPayload(payload, signerRole, options) {
        if (!isAclPatch(payload.patch))
            return false;
        const patch = payload.patch;
        if (!options?.skipAuth) {
            if (!signerRole)
                return false;
            if (!this.canWriteAclTarget(signerRole, patch.role, patch.target, payload.stamp))
                return false;
        }
        const assignment = {
            id: patch.id,
            actorId: patch.target,
            role: patch.role,
            stamp: payload.stamp,
            by: payload.iss,
            publicKeyJwk: patch.publicKeyJwk,
        };
        const accepted = this.aclLog.merge(assignment);
        if (accepted.length)
            return true;
        return false;
    }
    applyRegisterPayload(payload, state) {
        if (!isObject(payload.patch))
            return false;
        if (!("value" in payload.patch))
            return false;
        const value = payload.patch.value;
        const schema = state.schema;
        if (schema.crdt !== "register")
            return false;
        if (!isValueOfType(value, schema.jsType))
            return false;
        if (schema.regex && typeof value === "string" && !schema.regex.test(value))
            return false;
        const crdt = state.crdt;
        const before = crdt.get();
        crdt.set(value, payload.stamp);
        const after = crdt.get();
        if (Object.is(before, after))
            return true;
        this.emitMerge(payload.iss, payload.field, "set", { value: after });
        return true;
    }
    applyNodePayload(payload, state) {
        if (!isPatchEnvelope(payload.patch))
            return false;
        const nodes = payload.patch.nodes;
        switch (state.schema.crdt) {
            case "text":
            case "array": {
                const typedNodes = nodes.filter(isDagNode);
                if (typedNodes.length !== nodes.length)
                    return false;
                if (!this.validateDagNodeValues(typedNodes, state.schema.jsType))
                    return false;
                const crdt = state.crdt;
                const beforeNodes = crdt.snapshot();
                const beforeIndex = indexMapForNodes(beforeNodes);
                const changed = crdt.merge(typedNodes);
                if (changed.length === 0)
                    return true;
                const afterNodes = crdt.snapshot();
                const afterIndex = indexMapForNodes(afterNodes);
                const beforeLength = beforeNodes.filter((node) => !node.deleted).length;
                for (const node of changed) {
                    if (node.deleted)
                        this.recordDeletedNode(payload.field, node.id, payload.stamp);
                }
                this.emitListOps(payload.iss, payload.field, state.schema.crdt, changed, beforeIndex, afterIndex, beforeLength);
                return true;
            }
            case "set":
                return this.applySetNodes(nodes, state, payload.field, payload.iss, payload.stamp);
            case "map":
                return this.applyMapNodes(nodes, state, payload.field, payload.iss, payload.stamp);
            case "record":
                return this.applyRecordNodes(nodes, state, payload.field, payload.iss, payload.stamp);
            default:
                return false;
        }
    }
    applySetNodes(nodes, state, field, actor, stamp) {
        const crdt = state.crdt;
        for (const node of nodes) {
            if (!isObject(node) || typeof node.op !== "string" || typeof node.id !== "string")
                return false;
            if (node.op === "add") {
                if (!isValueOfType(node.value, state.schema.jsType))
                    return false;
                if (typeof node.key !== "string")
                    return false;
            }
            else if (node.op === "rem") {
                if (typeof node.key !== "string" || !isStringArray(node.targets))
                    return false;
            }
            else {
                return false;
            }
        }
        const before = [...crdt.values()];
        const accepted = crdt.merge(nodes);
        if (accepted.length === 0)
            return true;
        for (const node of accepted) {
            if (node.op !== "rem")
                continue;
            this.recordDeleteNodeStamp(field, node.id, stamp);
            for (const targetTag of node.targets)
                this.recordTombstone(field, targetTag, stamp);
        }
        const after = [...crdt.values()];
        const { added, removed } = this.diffSet(before, after);
        for (const value of added)
            this.emitMerge(actor, field, "add", { value });
        for (const value of removed)
            this.emitMerge(actor, field, "delete", { value });
        return true;
    }
    applyMapNodes(nodes, state, field, actor, stamp) {
        const crdt = state.crdt;
        for (const node of nodes) {
            if (!isObject(node) || typeof node.op !== "string" || typeof node.id !== "string")
                return false;
            if (node.op === "set") {
                if (!isValueOfType(node.value, state.schema.jsType))
                    return false;
                if (!isJsValue(node.key))
                    return false;
                if (typeof node.keyId !== "string")
                    return false;
            }
            else if (node.op === "del") {
                if (typeof node.keyId !== "string" || !isStringArray(node.targets))
                    return false;
            }
            else {
                return false;
            }
        }
        const before = this.mapValue(crdt);
        const accepted = crdt.merge(nodes);
        if (accepted.length === 0)
            return true;
        for (const node of accepted) {
            if (node.op !== "del")
                continue;
            this.recordDeleteNodeStamp(field, node.id, stamp);
            for (const targetTag of node.targets)
                this.recordTombstone(field, targetTag, stamp);
        }
        const after = this.mapValue(crdt);
        const { set, removed } = this.diffMap(before, after);
        for (const entry of set)
            this.emitMerge(actor, field, "set", entry);
        for (const key of removed)
            this.emitMerge(actor, field, "delete", { key });
        return true;
    }
    applyRecordNodes(nodes, state, field, actor, stamp) {
        const crdt = state.crdt;
        for (const node of nodes) {
            if (!isObject(node) || typeof node.op !== "string" || typeof node.id !== "string")
                return false;
            if (node.op === "set") {
                if (typeof node.prop !== "string")
                    return false;
                if (!isValueOfType(node.value, state.schema.jsType))
                    return false;
            }
            else if (node.op === "del") {
                if (typeof node.prop !== "string" || !isStringArray(node.targets))
                    return false;
            }
            else {
                return false;
            }
        }
        const before = this.recordValue(crdt);
        const accepted = crdt.merge(nodes);
        if (accepted.length === 0)
            return true;
        for (const node of accepted) {
            if (node.op !== "del")
                continue;
            this.recordDeleteNodeStamp(field, node.id, stamp);
            for (const targetTag of node.targets)
                this.recordTombstone(field, targetTag, stamp);
        }
        const after = this.recordValue(crdt);
        const { set, removed } = this.diffRecord(before, after);
        for (const [key, value] of Object.entries(set))
            this.emitMerge(actor, field, "set", { key, value });
        for (const key of removed)
            this.emitMerge(actor, field, "delete", { key });
        return true;
    }
    validateDagNodeValues(nodes, jsType) {
        for (const node of nodes) {
            if (!isValueOfType(node.value, jsType))
                return false;
        }
        return true;
    }
    emitListOps(actor, field, crdt, changed, beforeIndex, afterIndex, beforeLength) {
        const deletes = [];
        if (crdt === "text") {
            const inserts = [];
            for (const node of changed) {
                if (node.deleted) {
                    const index = beforeIndex.get(node.id);
                    if (index === undefined)
                        continue;
                    deletes.push({ type: "delete", index, count: 1 });
                }
                else {
                    const index = afterIndex.get(node.id);
                    if (index === undefined)
                        continue;
                    inserts.push({ type: "insert", index, value: String(node.value) });
                }
            }
            deletes.sort((a, b) => b.index - a.index);
            inserts.sort((a, b) => a.index - b.index);
            for (const op of deletes)
                this.emitMerge(actor, field, "deleteAt", { index: op.index });
            for (const op of inserts)
                this.emitMerge(actor, field, "insertAt", { index: op.index, value: op.value });
            return;
        }
        const inserts = [];
        for (const node of changed) {
            if (node.deleted) {
                const index = beforeIndex.get(node.id);
                if (index === undefined)
                    continue;
                deletes.push({ type: "delete", index, count: 1 });
            }
            else {
                const index = afterIndex.get(node.id);
                if (index === undefined)
                    continue;
                inserts.push({ type: "insert", index, value: node.value });
            }
        }
        deletes.sort((a, b) => b.index - a.index);
        inserts.sort((a, b) => a.index - b.index);
        for (const op of deletes) {
            if (op.index === 0) {
                this.emitMerge(actor, field, "shift", null);
                continue;
            }
            if (op.index === beforeLength - 1) {
                this.emitMerge(actor, field, "pop", null);
                continue;
            }
            this.emitMerge(actor, field, "deleteAt", { index: op.index });
        }
        for (const op of inserts) {
            if (op.index === 0) {
                this.emitMerge(actor, field, "unshift", { value: op.value });
                continue;
            }
            if (op.index >= beforeLength) {
                this.emitMerge(actor, field, "push", { value: op.value });
                continue;
            }
            this.emitMerge(actor, field, "insertAt", { index: op.index, value: op.value });
        }
    }
    diffSet(before, after) {
        const beforeSet = new Set(before);
        const afterSet = new Set(after);
        const added = after.filter((value) => !beforeSet.has(value));
        const removed = before.filter((value) => !afterSet.has(value));
        return { added, removed };
    }
    diffMap(before, after) {
        const beforeMap = new Map();
        for (const [key, value] of before)
            beforeMap.set(stableKey(key), { key, value });
        const afterMap = new Map();
        for (const [key, value] of after)
            afterMap.set(stableKey(key), { key, value });
        const set = [];
        const removed = [];
        for (const [keyId, entry] of afterMap) {
            const prev = beforeMap.get(keyId);
            if (!prev || !Object.is(prev.value, entry.value))
                set.push(entry);
        }
        for (const [keyId, entry] of beforeMap) {
            if (!afterMap.has(keyId))
                removed.push(entry.key);
        }
        return { set, removed };
    }
    diffRecord(before, after) {
        const set = {};
        const removed = [];
        for (const [key, value] of Object.entries(after)) {
            if (!(key in before) || !Object.is(before[key], value))
                set[key] = value;
        }
        for (const key of Object.keys(before)) {
            if (!(key in after))
                removed.push(key);
        }
        return { set, removed };
    }
    emitInvalidationDiffs(beforeValues, actor) {
        for (const [field, state] of this.fields.entries()) {
            const before = beforeValues.get(field);
            const after = this.fieldValue(field);
            this.emitFieldDiff(actor, field, state.schema, before, after);
        }
    }
    emitFieldDiff(actor, field, schema, before, after) {
        switch (schema.crdt) {
            case "register":
                if (!Object.is(before, after))
                    this.emitMerge(actor, field, "set", { value: after });
                return;
            case "text": {
                const beforeText = typeof before === "string" ? before : "";
                const afterText = typeof after === "string" ? after : "";
                if (beforeText === afterText)
                    return;
                this.emitTextDiff(actor, field, beforeText, afterText);
                return;
            }
            case "array": {
                const beforeArr = Array.isArray(before) ? before : [];
                const afterArr = Array.isArray(after) ? after : [];
                if (this.arrayEquals(beforeArr, afterArr))
                    return;
                this.emitArrayDiff(actor, field, beforeArr, afterArr);
                return;
            }
            case "set": {
                const beforeArr = Array.isArray(before) ? before : [];
                const afterArr = Array.isArray(after) ? after : [];
                const { added, removed } = this.diffSet(beforeArr, afterArr);
                for (const value of added)
                    this.emitMerge(actor, field, "add", { value });
                for (const value of removed)
                    this.emitMerge(actor, field, "delete", { value });
                return;
            }
            case "map": {
                const beforeArr = Array.isArray(before) ? before : [];
                const afterArr = Array.isArray(after) ? after : [];
                const { set, removed } = this.diffMap(beforeArr, afterArr);
                for (const entry of set)
                    this.emitMerge(actor, field, "set", entry);
                for (const key of removed)
                    this.emitMerge(actor, field, "delete", { key });
                return;
            }
            case "record": {
                const beforeRec = before && isObject(before) && !Array.isArray(before) ? before : {};
                const afterRec = after && isObject(after) && !Array.isArray(after) ? after : {};
                const { set, removed } = this.diffRecord(beforeRec, afterRec);
                for (const [key, value] of Object.entries(set))
                    this.emitMerge(actor, field, "set", { key, value });
                for (const key of removed)
                    this.emitMerge(actor, field, "delete", { key });
            }
        }
    }
    emitTextDiff(actor, field, before, after) {
        const beforeChars = [...before];
        const afterChars = [...after];
        const prefix = this.commonPrefix(beforeChars, afterChars);
        const suffix = this.commonSuffix(beforeChars, afterChars, prefix);
        const beforeEnd = beforeChars.length - suffix;
        const afterEnd = afterChars.length - suffix;
        for (let index = beforeEnd - 1; index >= prefix; index--) {
            this.emitMerge(actor, field, "deleteAt", { index });
        }
        for (let index = prefix; index < afterEnd; index++) {
            this.emitMerge(actor, field, "insertAt", {
                index,
                value: afterChars[index],
            });
        }
    }
    emitArrayDiff(actor, field, before, after) {
        const prefix = this.commonPrefix(before, after);
        const suffix = this.commonSuffix(before, after, prefix);
        const beforeEnd = before.length - suffix;
        const afterEnd = after.length - suffix;
        for (let index = beforeEnd - 1; index >= prefix; index--) {
            this.emitMerge(actor, field, "deleteAt", { index });
        }
        for (let index = prefix; index < afterEnd; index++) {
            this.emitMerge(actor, field, "insertAt", {
                index,
                value: after[index],
            });
        }
    }
    arrayEquals(left, right) {
        if (left.length !== right.length)
            return false;
        for (let index = 0; index < left.length; index++) {
            if (!Object.is(left[index], right[index]))
                return false;
        }
        return true;
    }
    commonPrefix(left, right) {
        const max = Math.min(left.length, right.length);
        let index = 0;
        while (index < max && Object.is(left[index], right[index]))
            index++;
        return index;
    }
    commonSuffix(left, right, prefix) {
        const max = Math.min(left.length, right.length) - prefix;
        let count = 0;
        while (count < max &&
            Object.is(left[left.length - 1 - count], right[right.length - 1 - count])) {
            count++;
        }
        return count;
    }
    setRole(actorId, role) {
        this.assertNotReset();
        const stamp = this.clock.next();
        const signerRole = this.roleAt(this.actorId, stamp);
        if (!this.canWriteAclTarget(signerRole, role, actorId, stamp))
            throw new Error(`Dacument: role '${signerRole}' cannot grant '${role}'`);
        const assignmentId = uuidv7();
        this.queueLocalOp({
            iss: this.actorId,
            sub: this.docId,
            iat: nowSeconds(),
            stamp,
            kind: "acl.set",
            schema: this.schemaId,
            patch: {
                id: assignmentId,
                target: actorId,
                role,
            },
        }, signerRole);
    }
    recordValue(record) {
        const output = {};
        for (const key of Object.keys(record))
            output[key] = record[key];
        return output;
    }
    mapValue(map) {
        const output = [];
        for (const [key, value] of map.entries()) {
            if (!isJsValue(key))
                throw new Error("Dacument: map key must be JSON-compatible");
            output.push([key, value]);
        }
        return output;
    }
    fieldValue(field) {
        const state = this.fields.get(field);
        if (!state)
            return undefined;
        const crdt = this.readCrdt(field, state);
        switch (state.schema.crdt) {
            case "register":
                return crdt.get();
            case "text":
                return crdt.toString();
            case "array":
                return [...crdt];
            case "set":
                return [...crdt.values()];
            case "map":
                return this.mapValue(crdt);
            case "record":
                return this.recordValue(crdt);
        }
    }
    materializeSchema() {
        const output = {};
        for (const [field, schema] of Object.entries(this.schema)) {
            const current = this.fieldValue(field);
            if (schema.crdt === "register") {
                const next = { ...schema };
                if (isValueOfType(current, schema.jsType)) {
                    if (schema.regex &&
                        typeof current === "string" &&
                        !schema.regex.test(current))
                        throw new Error(`Dacument.accessReset: '${field}' failed regex`);
                    next.initial = current;
                }
                else {
                    delete next.initial;
                }
                output[field] = next;
                continue;
            }
            if (schema.crdt === "text") {
                output[field] = {
                    ...schema,
                    initial: typeof current === "string" ? current : "",
                };
                continue;
            }
            if (schema.crdt === "array") {
                output[field] = {
                    ...schema,
                    initial: Array.isArray(current) ? current : [],
                };
                continue;
            }
            if (schema.crdt === "set") {
                output[field] = {
                    ...schema,
                    initial: Array.isArray(current) ? current : [],
                };
                continue;
            }
            if (schema.crdt === "map") {
                output[field] = {
                    ...schema,
                    initial: Array.isArray(current) ? current : [],
                };
                continue;
            }
            if (schema.crdt === "record") {
                output[field] =
                    current && isObject(current) && !Array.isArray(current)
                        ? { ...schema, initial: current }
                        : { ...schema, initial: {} };
            }
        }
        return output;
    }
    emitEvent(type, event) {
        const listeners = this.eventListeners.get(type);
        if (!listeners)
            return;
        for (const listener of listeners)
            listener(event);
    }
    emitMerge(actor, target, method, data) {
        if (this.suppressMerge)
            return;
        if (this.isRevoked())
            return;
        this.emitEvent("merge", { type: "merge", actor, target, method, data });
    }
    emitRevoked(previous, by, stamp) {
        this.emitEvent("revoked", {
            type: "revoked",
            actorId: this.actorId,
            previous,
            by,
            stamp,
        });
    }
    emitReset(payload) {
        this.emitEvent("reset", {
            type: "reset",
            oldDocId: this.docId,
            newDocId: payload.newDocId,
            ts: payload.ts,
            by: payload.by,
            reason: payload.reason,
        });
    }
    emitError(error) {
        this.emitEvent("error", { type: "error", error });
    }
    canWriteField(role) {
        return role === "owner" || role === "manager" || role === "editor";
    }
    canWriteAcl(role, targetRole) {
        if (role === "owner")
            return true;
        if (role === "manager")
            return targetRole === "editor" || targetRole === "viewer" || targetRole === "revoked";
        return false;
    }
    canWriteAclTarget(role, targetRole, targetActorId, stamp) {
        if (!this.canWriteAcl(role, targetRole))
            return false;
        if (role === "manager") {
            const targetRoleAt = this.roleAt(targetActorId, stamp);
            if (targetRoleAt === "owner")
                return false;
        }
        return true;
    }
    assertWritable(field, role) {
        this.assertNotReset();
        if (!this.canWriteField(role))
            throw new Error(`Dacument: role '${role}' cannot write '${field}'`);
    }
    assertValueType(field, value) {
        const state = this.fields.get(field);
        if (!state)
            throw new Error(`Dacument: unknown field '${field}'`);
        if (!isValueOfType(value, state.schema.jsType))
            throw new Error(`Dacument: invalid value for '${field}'`);
        const regex = state.schema.crdt === "register" ? state.schema.regex : undefined;
        if (regex && typeof value === "string" && !regex.test(value))
            throw new Error(`Dacument: '${field}' failed regex`);
    }
    assertValueArray(field, values) {
        for (const value of values)
            this.assertValueType(field, value);
    }
    assertMapKey(field, key) {
        if (!isJsValue(key))
            throw new Error(`Dacument: map key for '${field}' must be JSON-compatible`);
    }
    isValidPayload(payload) {
        if (!isObject(payload))
            return false;
        if (typeof payload.iss !== "string" || typeof payload.sub !== "string")
            return false;
        if (typeof payload.iat !== "number")
            return false;
        if (!payload.stamp)
            return false;
        const stamp = payload.stamp;
        if (typeof stamp.wallTimeMs !== "number" ||
            typeof stamp.logical !== "number" ||
            typeof stamp.clockId !== "string")
            return false;
        if (typeof payload.kind !== "string")
            return false;
        if (typeof payload.schema !== "string")
            return false;
        return true;
    }
    assertSchemaKeys() {
        const reserved = new Set([
            ...Object.getOwnPropertyNames(this),
            ...Object.getOwnPropertyNames(Object.getPrototypeOf(this)),
            "acl",
        ]);
        for (const key of Object.keys(this.schema)) {
            if (reserved.has(key))
                throw new Error(`Dacument: schema key '${key}' is reserved`);
        }
    }
}
