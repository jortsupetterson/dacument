# Dacument

Dacument is a schema-driven, access-controlled CRDT document that signs every
operation and enforces ACL rules at merge time. It exposes a JS object-like API
for register fields and CRDT views for all other field types.

## Schema

```ts
import { generateNonce } from "bytecodec";
import { generateSignPair } from "zeyra";
import { Dacument } from "dacument";

const actorId = generateNonce(); // 256-bit base64url id
const actorKeys = await generateSignPair();
await Dacument.setActorInfo({
  id: actorId,
  privateKeyJwk: actorKeys.signingJwk,
  publicKeyJwk: actorKeys.verificationJwk,
});

const schema = Dacument.schema({
  title: Dacument.register({ jsType: "string", regex: /^[a-z ]+$/i }),
  body: Dacument.text(),
  items: Dacument.array({ jsType: "string" }),
  tags: Dacument.set({ jsType: "string" }),
  meta: Dacument.record({ jsType: "string" }),
});
```

## Create and load

```ts
const { docId, snapshot, roleKeys } = await Dacument.create({ schema });

const doc = await Dacument.load({
  schema,
  roleKey: roleKeys.owner.privateKey,
  snapshot,
});
```

`create()` generates a `docId` and role keys, and returns a snapshot. Load the
document with the highest role key you have (viewers load without a key).
Snapshots do not include the schema or schema ids; the caller must provide the schema.
Call `await Dacument.setActorInfo(...)` once per process before creating schemas
or loading. Actor ids must be 256-bit base64url strings and keys must be ES256
(P-256). Updating actor info requires providing the current keys. On first
merge, Dacument auto-attaches the actor's `publicKeyJwk` to its ACL entry (if
missing) and pins it for actor-signature verification. To rotate actor keys
in-process, call `Dacument.setActorInfo` again with the new keys plus
`currentPrivateKeyJwk`/`currentPublicKeyJwk`.

`roleKeys` includes owner/manager/editor key pairs; store and distribute them
as needed. Role keys are generated once at `create()`; role public keys are
embedded in the snapshot and never rotated.

## ACL

```ts
const bobId = generateNonce();
doc.acl.setRole(bobId, "editor");
doc.acl.setRole("user-viewer", "viewer");
await doc.flush();
```

Revoked actors read initial values instead of the live document state.
Revoked actors cannot call `snapshot()`.
Managers cannot change owner roles.
`merge` events report minimal operation params like `insertAt`, `deleteAt`,
`push`, `pop`, `set`, and `add`.

## Events

- `doc.addEventListener("delta", handler)` emits ops for network sync
  (writer ops are role-signed; acks are actor-signed by non-revoked actors and
  verified against ACL-pinned actor public keys).
- `doc.addEventListener("merge", handler)` emits `{ actor, target, method, data }`.
- `doc.addEventListener("error", handler)` emits signing/verification errors.
- `doc.addEventListener("revoked", handler)` fires when the current actor is revoked.
- `doc.addEventListener("reset", handler)` emits `{ oldDocId, newDocId, ts, by, reason }`.
- `doc.selfRevoke()` emits a signed ACL op that revokes the current actor.
- `await doc.accessReset({ reason })` creates a new Dacument with fresh keys and emits a reset op.
- `doc.getResetState()` returns reset metadata (or `null`).
- `doc.snapshot()` returns a loadable op log (`{ docId, roleKeys, ops }`).
- `await doc.verifyActorIntegrity(...)` verifies per-actor signatures on demand.

Map keys must be JSON-compatible values. For string-keyed data, prefer `record`.
For non-JSON or identity-based keys, use `CRMap` with a stable `key` function.

Snapshots may include ops that are rejected on load; invalid ops are ignored.
Tombstones are compacted once all non-revoked actors have acknowledged a given HLC
via `ack` ops (emitted automatically after merges). Acks are ES256 actor-signed
by non-revoked actors and verified against ACL-pinned actor public keys.

See `README.md` for full usage and guarantees.
