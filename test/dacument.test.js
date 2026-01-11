import assert from "node:assert/strict";
import test from "node:test";
import { Bytes, generateNonce } from "bytecodec";
import { generateSignPair } from "zeyra";
import { Dacument } from "../dist/index.js";
import {
  decodeToken,
  encodeToken,
  signDetached,
  signToken,
} from "../dist/Dacument/crypto.js";

const ACTOR_ID = generateNonce();
const actorKeys = await generateSignPair();
await Dacument.setActorInfo({
  id: ACTOR_ID,
  privateKeyJwk: actorKeys.signingJwk,
  publicKeyJwk: actorKeys.verificationJwk,
});

const schema = Dacument.schema({
  title: Dacument.register({ jsType: "string", regex: /^[a-z ]+$/ }),
  body: Dacument.text(),
  items: Dacument.array({ jsType: "string" }),
  tags: Dacument.set({ jsType: "string" }),
  meta: Dacument.record({ jsType: "string" }),
});

function makeStamp(clockId, wallTimeMs) {
  return { wallTimeMs, logical: 0, clockId };
}

async function signRegisterOp({
  roleKey,
  signerRole,
  iss,
  docId,
  schemaId,
  field,
  value,
  stamp,
}) {
  const payload = {
    iss,
    sub: docId,
    iat: Math.floor(Date.now() / 1000),
    stamp,
    kind: "register.set",
    schema: schemaId,
    field,
    patch: { value },
  };
  return signToken(
    roleKey,
    { alg: "ES256", typ: "DACOP", kid: `${iss}:${signerRole}` },
    payload
  );
}

async function signAclOp({
  roleKey,
  signerRole,
  iss,
  docId,
  schemaId,
  target,
  role,
  stamp,
  publicKeyJwk,
}) {
  const patch = {
    id: generateNonce(),
    target,
    role,
  };
  if (publicKeyJwk) patch.publicKeyJwk = publicKeyJwk;
  const payload = {
    iss,
    sub: docId,
    iat: Math.floor(Date.now() / 1000),
    stamp,
    kind: "acl.set",
    schema: schemaId,
    patch,
  };
  return signToken(
    roleKey,
    { alg: "ES256", typ: "DACOP", kid: `${iss}:${signerRole}` },
    payload
  );
}

async function signResetOp({
  roleKey,
  iss,
  docId,
  schemaId,
  stamp,
  newDocId,
  reason,
}) {
  const payload = {
    iss,
    sub: docId,
    iat: Math.floor(Date.now() / 1000),
    stamp,
    kind: "reset",
    schema: schemaId,
    patch: { newDocId, reason },
  };
  return signToken(
    roleKey,
    { alg: "ES256", typ: "DACOP", kid: `${iss}:owner` },
    payload
  );
}

async function createOwnerDoc() {
  const { snapshot, roleKeys } = await Dacument.create({ schema });
  const doc = await Dacument.load({
    schema,
    roleKey: roleKeys.owner.privateKey,
    snapshot,
  });
  return { doc, snapshot, roleKeys, ownerId: ACTOR_ID };
}

test("create enforces schema and register behavior", async () => {
  const { doc } = await createOwnerDoc();
  const ops = [];
  doc.addEventListener("change", (event) => ops.push(...event.ops));

  doc.title = "hello";
  await doc.flush();
  await doc.merge(ops);
  ops.length = 0;
  assert.equal(doc.title, "hello");

  assert.throws(() => {
    doc.title = "Hello";
  }, /regex/i);

  assert.throws(() => {
    doc.items = ["x"];
  }, /read-only/i);

  assert.throws(() => {
    doc.unknown = "x";
  }, /unknown field/i);
});

test("merge accepts editor register ops", async () => {
  const { doc, roleKeys } = await createOwnerDoc();
  const ops = [];
  doc.addEventListener("change", (event) => ops.push(...event.ops));

  const editorId = generateNonce();
  doc.acl.setRole(editorId, "editor");
  await doc.flush();
  await doc.merge(ops);
  ops.length = 0;

  const stamp = makeStamp(editorId, Date.now() + 10);
  const token = await signRegisterOp({
    roleKey: roleKeys.editor.privateKey,
    signerRole: "editor",
    iss: editorId,
    docId: doc.docId,
    schemaId: doc.schemaId,
    field: "title",
    value: "alpha",
    stamp,
  });

  const result = await doc.merge([{ token }]);
  assert.equal(result.rejected, 0);
  assert.equal(doc.title, "alpha");
});

test("viewer acks are unsigned", async () => {
  const { doc } = await createOwnerDoc();
  const ownerOps = [];
  doc.addEventListener("change", (event) => ownerOps.push(...event.ops));

  const viewerId = generateNonce();
  doc.acl.setRole(viewerId, "viewer");
  await doc.flush();
  await doc.merge(ownerOps);
  ownerOps.length = 0;

  const seen = makeStamp(viewerId, Date.now());
  const token = encodeToken(
    { alg: "none", typ: "DACOP" },
    {
      iss: viewerId,
      sub: doc.docId,
      iat: Math.floor(Date.now() / 1000),
      stamp: seen,
      kind: "ack",
      schema: doc.schemaId,
      patch: { seen },
    }
  );

  const result = await doc.merge([{ token }]);
  assert.equal(result.rejected, 0);
});

test("writer acks are unsigned", async () => {
  const { doc } = await createOwnerDoc();
  const ops = [];
  doc.addEventListener("change", (event) => ops.push(...event.ops));

  doc.title = "alpha";
  await doc.flush();
  const changeOps = ops.slice();
  ops.length = 0;

  await doc.merge(changeOps);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.ok(ops.length > 0);
  const [headerB64, payloadB64] = ops[0].token.split(".");
  const headerJson = Bytes.toString(Bytes.fromBase64UrlString(headerB64));
  const header = JSON.parse(headerJson);
  const payloadJson = Bytes.toString(Bytes.fromBase64UrlString(payloadB64));
  const payload = JSON.parse(payloadJson);
  assert.equal(header.alg, "none");
  assert.equal(payload.kind, "ack");
});

test("signed acks are rejected", async () => {
  const { doc, roleKeys, ownerId } = await createOwnerDoc();
  const stamp = { wallTimeMs: Date.now(), logical: 0, clockId: ownerId };
  const payload = {
    iss: ownerId,
    sub: doc.docId,
    iat: Math.floor(Date.now() / 1000),
    stamp,
    kind: "ack",
    schema: doc.schemaId,
    patch: { seen: stamp },
  };
  const token = await signToken(roleKeys.owner.privateKey, {
    alg: "ES256",
    typ: "DACOP",
    kid: `${ownerId}:owner`,
  }, payload);

  const result = await doc.merge([{ token }]);
  assert.equal(result.accepted.length, 0);
  assert.equal(result.rejected, 1);
});

test("acl roles gate writes by stamp", async () => {
  const { doc, roleKeys } = await createOwnerDoc();
  const ownerOps = [];
  doc.addEventListener("change", (event) => ownerOps.push(...event.ops));

  const bobId = generateNonce();
  doc.acl.setRole(bobId, "editor");
  await doc.flush();
  await doc.merge(ownerOps);
  ownerOps.length = 0;

  const baseTime = Date.now() + 1000;
  const firstStamp = makeStamp(bobId, baseTime);
  const firstToken = await signRegisterOp({
    roleKey: roleKeys.editor.privateKey,
    signerRole: "editor",
    iss: bobId,
    docId: doc.docId,
    schemaId: doc.schemaId,
    field: "title",
    value: "bob",
    stamp: firstStamp,
  });

  const acceptedFirst = await doc.merge([{ token: firstToken }]);
  assert.equal(acceptedFirst.accepted.length, 1);
  assert.equal(doc.title, "bob");

  await new Promise((resolve) => setTimeout(resolve, 5));
  doc.acl.setRole(bobId, "revoked");
  await doc.flush();
  await doc.merge(ownerOps);
  ownerOps.length = 0;

  const secondStamp = makeStamp(bobId, baseTime + 10);
  const secondToken = await signRegisterOp({
    roleKey: roleKeys.editor.privateKey,
    signerRole: "editor",
    iss: bobId,
    docId: doc.docId,
    schemaId: doc.schemaId,
    field: "title",
    value: "bob again",
    stamp: secondStamp,
  });

  const acceptedSecond = await doc.merge([{ token: secondToken }]);
  assert.equal(acceptedSecond.accepted.length, 0);
  assert.equal(doc.title, "bob");
});

test("revoked reads return initial values", async () => {
  const { doc } = await createOwnerDoc();
  const ownerOps = [];
  doc.addEventListener("change", (event) => ownerOps.push(...event.ops));

  doc.title = "alpha";
  doc.body.insertAt(0, "h");
  doc.items.push("milk");
  doc.tags.add("x");
  doc.meta.note = "ok";
  await doc.flush();

  const changeOps = ownerOps.slice();
  ownerOps.length = 0;
  await doc.merge(changeOps);

  assert.equal(doc.title, "alpha");
  assert.equal(doc.body.toString(), "h");

  doc.acl.setRole(ACTOR_ID, "revoked");
  await doc.flush();

  const revokeOps = ownerOps.slice();
  ownerOps.length = 0;
  await doc.merge(revokeOps);

  assert.equal(doc.title, null);
  assert.equal(doc.body.toString(), "");
  assert.deepEqual([...doc.items], []);
  assert.equal(doc.tags.has("x"), false);
  assert.equal(doc.meta.note, undefined);
  assert.throws(() => {
    doc.snapshot();
  }, /revoked/i);
});

test("managers cannot grant manager role", async () => {
  const { doc, roleKeys } = await createOwnerDoc();
  const ownerOps = [];
  doc.addEventListener("change", (event) => ownerOps.push(...event.ops));

  const managerId = generateNonce();
  doc.acl.setRole(managerId, "manager");
  await doc.flush();
  await doc.merge(ownerOps);
  ownerOps.length = 0;

  const targetId = generateNonce();
  const stamp = makeStamp(managerId, Date.now());
  const token = await signAclOp({
    roleKey: roleKeys.manager.privateKey,
    signerRole: "manager",
    iss: managerId,
    docId: doc.docId,
    schemaId: doc.schemaId,
    target: targetId,
    role: "manager",
    stamp,
  });

  const result = await doc.merge([{ token }]);
  assert.equal(result.accepted.length, 0);
  assert.equal(doc.acl.getRole(targetId), "revoked");
});

test("managers cannot revoke owner", async () => {
  const { doc, roleKeys } = await createOwnerDoc();
  const ownerOps = [];
  doc.addEventListener("change", (event) => ownerOps.push(...event.ops));

  const managerId = generateNonce();
  doc.acl.setRole(managerId, "manager");
  await doc.flush();
  await doc.merge(ownerOps);
  ownerOps.length = 0;

  const stamp = makeStamp(managerId, Date.now());
  const token = await signAclOp({
    roleKey: roleKeys.manager.privateKey,
    signerRole: "manager",
    iss: managerId,
    docId: doc.docId,
    schemaId: doc.schemaId,
    target: ACTOR_ID,
    role: "revoked",
    stamp,
  });

  const result = await doc.merge([{ token }]);
  assert.equal(result.accepted.length, 0);
  assert.equal(doc.acl.getRole(ACTOR_ID), "owner");
});

test("invalid signature is rejected", async () => {
  const { doc, snapshot } = await createOwnerDoc();
  const ops = [];
  doc.addEventListener("change", (event) => ops.push(...event.ops));
  doc.title = "alpha";
  await doc.flush();

  const [header, payload, signature] = ops[0].token.split(".");
  const tamperedPayload =
    payload.slice(0, -1) + (payload.slice(-1) === "a" ? "b" : "a");
  const tampered = { token: [header, tamperedPayload, signature].join(".") };
  const peer = await Dacument.load({
    schema,
    snapshot,
  });

  const result = await peer.merge([tampered]);
  assert.equal(result.accepted.length, 0);
  assert.equal(result.rejected, 1);
});

test("corrupt snapshot ops are ignored", async () => {
  const { doc, roleKeys, ownerId } = await createOwnerDoc();
  const ops = [];
  doc.addEventListener("change", (event) => ops.push(...event.ops));
  doc.title = "alpha";
  await doc.flush();
  await doc.merge(ops);

  const snapshot = doc.snapshot();
  const corrupt = {
    token:
      snapshot.ops[0].token.slice(0, -1) +
      (snapshot.ops[0].token.slice(-1) === "a" ? "b" : "a"),
  };

  const loaded = await Dacument.load({
    schema,
    roleKey: roleKeys.owner.privateKey,
    snapshot: { ...snapshot, ops: [...snapshot.ops, corrupt] },
  });

  assert.equal(loaded.title, "alpha");
});

test("revocations invalidate out-of-order ops", async () => {
  const { doc, roleKeys } = await createOwnerDoc();

  const bobId = generateNonce();
  const baseTime = Date.now() + 1000;

  const grantToken = await signAclOp({
    roleKey: roleKeys.owner.privateKey,
    signerRole: "owner",
    iss: ACTOR_ID,
    docId: doc.docId,
    schemaId: doc.schemaId,
    target: bobId,
    role: "editor",
    stamp: makeStamp(ACTOR_ID, baseTime),
  });

  const bobToken = await signRegisterOp({
    roleKey: roleKeys.editor.privateKey,
    signerRole: "editor",
    iss: bobId,
    docId: doc.docId,
    schemaId: doc.schemaId,
    field: "title",
    value: "rogue",
    stamp: makeStamp(bobId, baseTime + 20),
  });

  const revokeToken = await signAclOp({
    roleKey: roleKeys.owner.privateKey,
    signerRole: "owner",
    iss: ACTOR_ID,
    docId: doc.docId,
    schemaId: doc.schemaId,
    target: bobId,
    role: "revoked",
    stamp: makeStamp(ACTOR_ID, baseTime + 10),
  });

  const acceptedFirst = await doc.merge([{ token: grantToken }, { token: bobToken }]);
  assert.equal(acceptedFirst.accepted.length, 2);
  assert.equal(doc.title, "rogue");

  await doc.merge([{ token: revokeToken }]);
  assert.equal(doc.title, null);
});

test("auto-attaches actor public key once", async () => {
  const { docId, schemaId, roleKeys } = await Dacument.create({ schema });
  const stamp = makeStamp(ACTOR_ID, Date.now());
  const token = await signAclOp({
    roleKey: roleKeys.owner.privateKey,
    signerRole: "owner",
    iss: ACTOR_ID,
    docId,
    schemaId,
    target: ACTOR_ID,
    role: "owner",
    stamp,
  });

  const snapshot = {
    docId,
    roleKeys: {
      owner: roleKeys.owner.publicKey,
      manager: roleKeys.manager.publicKey,
      editor: roleKeys.editor.publicKey,
    },
    ops: [{ token }],
  };

  const doc = new Dacument({
    schema,
    schemaId,
    docId,
    roleKey: roleKeys.owner.privateKey,
    roleKeys: snapshot.roleKeys,
  });
  const ops = [];
  doc.addEventListener("change", (event) => ops.push(...event.ops));
  await doc.merge(snapshot.ops);
  await doc.flush();

  const keyOps = ops.filter((op) => {
    const decoded = decodeToken(op.token);
    return (
      decoded?.payload?.kind === "acl.set" &&
      decoded?.payload?.patch?.publicKeyJwk
    );
  });
  assert.equal(keyOps.length, 1);

  await doc.merge(ops);
  ops.length = 0;
  await doc.flush();

  const keyOpsAfter = ops.filter((op) => {
    const decoded = decodeToken(op.token);
    return (
      decoded?.payload?.kind === "acl.set" &&
      decoded?.payload?.patch?.publicKeyJwk
    );
  });
  assert.equal(keyOpsAfter.length, 0);
});

test("selfRevoke works for viewer", async () => {
  const { doc } = await createOwnerDoc();
  const ops = [];
  doc.addEventListener("change", (event) => ops.push(...event.ops));

  doc.acl.setRole(ACTOR_ID, "viewer");
  await doc.flush();
  await doc.merge(ops);
  ops.length = 0;

  doc.selfRevoke();
  await doc.flush();

  const revokeOps = ops.filter((op) => {
    const decoded = decodeToken(op.token);
    return (
      decoded?.payload?.kind === "acl.set" &&
      decoded?.payload?.patch?.role === "revoked"
    );
  });
  assert.equal(revokeOps.length, 1);
  const decoded = decodeToken(revokeOps[0].token);
  assert.ok(decoded?.header?.kid?.endsWith(":actor"));

  await doc.merge(revokeOps);
  assert.equal(doc.acl.getRole(ACTOR_ID), "revoked");
});

test("actor-signed revoke is only for self", async () => {
  const { doc } = await createOwnerDoc();
  const targetId = generateNonce();
  const stamp = makeStamp(ACTOR_ID, Date.now());
  const payload = {
    iss: ACTOR_ID,
    sub: doc.docId,
    iat: Math.floor(Date.now() / 1000),
    stamp,
    kind: "acl.set",
    schema: doc.schemaId,
    patch: {
      id: generateNonce(),
      target: targetId,
      role: "revoked",
      publicKeyJwk: actorKeys.verificationJwk,
    },
  };
  const token = await signToken(actorKeys.signingJwk, {
    alg: "ES256",
    typ: "DACOP",
    kid: `${ACTOR_ID}:actor`,
  }, payload);

  const result = await doc.merge([{ token }]);
  assert.equal(result.accepted.length, 0);
});

test("verifyActorIntegrity detects impersonation", async () => {
  const { doc, roleKeys } = await createOwnerDoc();
  const bobId = generateNonce();
  const bobKeys = await generateSignPair();

  const grantToken = await signAclOp({
    roleKey: roleKeys.owner.privateKey,
    signerRole: "owner",
    iss: ACTOR_ID,
    docId: doc.docId,
    schemaId: doc.schemaId,
    target: bobId,
    role: "editor",
    stamp: makeStamp(ACTOR_ID, Date.now()),
    publicKeyJwk: bobKeys.verificationJwk,
  });
  await doc.merge([{ token: grantToken }]);

  const opToken = await signRegisterOp({
    roleKey: roleKeys.editor.privateKey,
    signerRole: "editor",
    iss: bobId,
    docId: doc.docId,
    schemaId: doc.schemaId,
    field: "title",
    value: "alpha",
    stamp: makeStamp(bobId, Date.now() + 5),
  });
  const wrongKeys = await generateSignPair();
  const actorSig = await signDetached(wrongKeys.signingJwk, opToken);

  const mergeResult = await doc.merge([{ token: opToken, actorSig }]);
  assert.equal(mergeResult.accepted.length, 1);

  const verification = await doc.verifyActorIntegrity({
    ops: [{ token: opToken, actorSig }],
  });
  assert.equal(verification.ok, false);
  assert.equal(verification.failed, 1);
});

test("accessReset materializes state and returns new keys", async () => {
  const { doc, roleKeys } = await createOwnerDoc();
  const ops = [];
  doc.addEventListener("change", (event) => ops.push(...event.ops));

  doc.title = "alpha";
  doc.body.insertAt(0, "h");
  doc.items.push("milk");
  doc.tags.add("x");
  doc.meta.note = "ok";
  await doc.flush();
  await doc.merge(ops);

  const result = await doc.accessReset({ reason: "compromise" });
  assert.notEqual(result.newDoc.docId, doc.docId);
  assert.equal(result.newDoc.title, "alpha");
  assert.equal(result.newDoc.body.toString(), "h");
  assert.deepEqual([...result.newDoc.items], ["milk"]);
  assert.equal(result.newDoc.tags.has("x"), true);
  assert.equal(result.newDoc.meta.note, "ok");
  assert.notDeepEqual(result.roleKeys.owner.publicKey, roleKeys.owner.publicKey);
});

test("reset emits event and blocks writes", async () => {
  const { doc } = await createOwnerDoc();
  const resetEvents = [];
  doc.addEventListener("reset", (event) => resetEvents.push(event));

  const result = await doc.accessReset({ reason: "compromised" });
  assert.equal(resetEvents.length, 1);
  assert.equal(resetEvents[0].newDocId, result.newDoc.docId);
  assert.equal(doc.acl.getRole(ACTOR_ID), "revoked");
  assert.throws(() => {
    doc.title = "nope";
  }, /reset\/deprecated/i);

  const snapshot = doc.snapshot();
  const resetOps = snapshot.ops
    .map((op) => decodeToken(op.token))
    .filter((decoded) => decoded?.payload?.kind === "reset");
  assert.equal(resetOps.length, 1);
  assert.equal(resetOps[0].payload.patch.newDocId, result.newDoc.docId);
});

test("accessReset requires owner role", async () => {
  const { doc } = await createOwnerDoc();
  const ops = [];
  doc.addEventListener("change", (event) => ops.push(...event.ops));

  doc.acl.setRole(ACTOR_ID, "viewer");
  await doc.flush();
  await doc.merge(ops);

  await assert.rejects(() => doc.accessReset(), /only owner/i);
});

test("reset determinism picks earliest reset", async () => {
  const { snapshot, roleKeys } = await Dacument.create({ schema });
  const docA = await Dacument.load({
    schema,
    roleKey: roleKeys.owner.privateKey,
    snapshot,
  });
  const docB = await Dacument.load({
    schema,
    roleKey: roleKeys.owner.privateKey,
    snapshot,
  });

  const baseTime = Date.now() + 1000;
  const newDocIdA = generateNonce();
  const newDocIdB = generateNonce();
  const resetEarly = await signResetOp({
    roleKey: roleKeys.owner.privateKey,
    iss: ACTOR_ID,
    docId: docA.docId,
    schemaId: docA.schemaId,
    stamp: makeStamp(ACTOR_ID, baseTime),
    newDocId: newDocIdA,
    reason: "early",
  });
  const resetLate = await signResetOp({
    roleKey: roleKeys.owner.privateKey,
    iss: ACTOR_ID,
    docId: docA.docId,
    schemaId: docA.schemaId,
    stamp: makeStamp(ACTOR_ID, baseTime + 10),
    newDocId: newDocIdB,
    reason: "late",
  });

  await docA.merge([{ token: resetLate }, { token: resetEarly }]);
  await docB.merge([{ token: resetEarly }, { token: resetLate }]);

  const stateA = docA.getResetState();
  const stateB = docB.getResetState();
  assert.equal(stateA?.newDocId, newDocIdA);
  assert.equal(stateB?.newDocId, newDocIdA);
});

test("ops after reset timestamp are rejected", async () => {
  const { doc, roleKeys } = await createOwnerDoc();
  const resetStamp = makeStamp(ACTOR_ID, Date.now() + 1000);
  const resetToken = await signResetOp({
    roleKey: roleKeys.owner.privateKey,
    iss: ACTOR_ID,
    docId: doc.docId,
    schemaId: doc.schemaId,
    stamp: resetStamp,
    newDocId: generateNonce(),
    reason: "reset",
  });
  await doc.merge([{ token: resetToken }]);

  const lateToken = await signRegisterOp({
    roleKey: roleKeys.owner.privateKey,
    signerRole: "owner",
    iss: ACTOR_ID,
    docId: doc.docId,
    schemaId: doc.schemaId,
    field: "title",
    value: "late",
    stamp: makeStamp(ACTOR_ID, resetStamp.wallTimeMs + 10),
  });
  const result = await doc.merge([{ token: lateToken }]);
  assert.equal(result.accepted.length, 0);
  assert.equal(doc.title, null);
});

test("docId generation is 256-bit base64url", async () => {
  const { docId } = await Dacument.create({ schema });
  assert.equal(typeof docId, "string");
  assert.equal(docId.length, 43);
  assert.equal(Bytes.fromBase64UrlString(docId).byteLength, 32);
});

