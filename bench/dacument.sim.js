import assert from "node:assert/strict";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { generateNonce } from "bytecodec";
import { generateSignPair } from "zeyra";
import { Dacument } from "../dist/index.js";
import { encodeToken, signToken } from "../dist/Dacument/crypto.js";

function buildSchema() {
  return Dacument.schema({
    title: Dacument.register({ jsType: "string", regex: /^[a-z0-9 .-]+$/i }),
    body: Dacument.text(),
    items: Dacument.array({ jsType: "string" }),
    tags: Dacument.set({ jsType: "string" }),
    meta: Dacument.record({ jsType: "string" }),
  });
}

const STEPS = 120;
const DELAY_MIN = 5;
const DELAY_MAX = 50;
const EXTRA_DELAY = 120;
const DUP_RATE = 0.2;
const SLOW_RATE = 0.2;
const REVOKE_DELAY_MS = 200;
const SETTLE_MS = 500;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomDelay() {
  return DELAY_MIN + Math.floor(Math.random() * (DELAY_MAX - DELAY_MIN));
}

function recordSnapshot(record) {
  const output = {};
  for (const key of Object.keys(record)) output[key] = record[key];
  return output;
}

function normalizeRecord(record) {
  const output = {};
  const keys = Object.keys(record).sort();
  for (const key of keys) output[key] = record[key];
  return output;
}

if (isMainThread) {
  const ownerId = generateNonce();
  const ownerKeys = await generateSignPair();
  await Dacument.setActorInfo({
    id: ownerId,
    privateKeyJwk: ownerKeys.signingJwk,
    publicKeyJwk: ownerKeys.verificationJwk,
  });
  const schema = buildSchema();
  const { snapshot: initialSnapshot, roleKeys } = await Dacument.create({ schema });
  const doc = await Dacument.load({
    schema,
    roleKey: roleKeys.owner.privateKey,
    snapshot: initialSnapshot,
  });
  const workers = new Map();
  const states = new Map();

  const actorSpecs = [
    { id: generateNonce(), role: "editor", mode: "good", bad: false },
    { id: generateNonce(), role: "editor", mode: "good", bad: false },
    { id: generateNonce(), role: "viewer", mode: "viewer", bad: false },
    { id: generateNonce(), role: "editor", mode: "tamper", bad: true },
    { id: generateNonce(), role: "editor", mode: "spoof", bad: true },
    { id: generateNonce(), role: "editor", mode: "flood", bad: true },
  ];
  const actors = [];
  for (const spec of actorSpecs) {
    const keys = await generateSignPair();
    actors.push({ ...spec, keys });
  }

  const ownerOps = [];
  let ownerDispatching = false;
  let lastOpAt = Date.now();
  const pendingMerges = new Set();

  const noteOp = () => {
    lastOpAt = Date.now();
  };

  const dispatchOwnerOps = async () => {
    if (ownerDispatching) return;
    ownerDispatching = true;
    try {
      while (ownerOps.length > 0) {
        const batch = ownerOps.splice(0, ownerOps.length);
        await doc.merge(batch);
        relay(ownerId, batch);
      }
    } finally {
      ownerDispatching = false;
    }
  };

  const drainOwnerOps = async () => {
    await doc.flush();
    while (ownerDispatching || ownerOps.length > 0) {
      await sleep(10);
    }
  };

  doc.addEventListener("delta", (event) => {
    noteOp();
    ownerOps.push(...event.ops);
    dispatchOwnerOps().catch((err) => console.error("owner dispatch", err));
  });

  for (const actor of actors) doc.acl.setRole(actor.id, actor.role);
  await drainOwnerOps();

  const revokeTarget =
    actors.find((actor) => actor.role === "editor" && !actor.bad)?.id ?? null;
  if (revokeTarget) {
    setTimeout(() => {
      doc.acl.setRole(revokeTarget, "revoked");
      doc.flush().catch((err) => console.error("revoke flush", err));
    }, REVOKE_DELAY_MS);
  }

  const snapshot = doc.snapshot();
  let doneCount = 0;
  let finalizeRequested = false;
  const revokedActors = new Set();

  function relay(_fromId, ops) {
    for (const worker of workers.values()) {
      const copies = Math.random() < DUP_RATE ? 2 : 1;
      for (let i = 0; i < copies; i++) {
        const extra = Math.random() < SLOW_RATE ? EXTRA_DELAY : 0;
        setTimeout(
          () => worker.postMessage({ type: "ops", ops }),
          randomDelay() + extra
        );
      }
    }
  }

  function onMessage(id, msg) {
    if (msg.type === "ops") {
      noteOp();
      const mergePromise = doc
        .merge(msg.ops)
        .then(() => relay(id, msg.ops))
        .catch((err) => console.error("merge error", err));
      pendingMerges.add(mergePromise);
      mergePromise.finally(() => pendingMerges.delete(mergePromise));
      return;
    }
    if (msg.type === "state") {
      states.set(id, msg.state);
      if (finalizeRequested && states.size === workers.size) finalize();
      return;
    }
    if (msg.type === "revoked") {
      revokedActors.add(id);
      return;
    }
    if (msg.type === "done") {
      doneCount += 1;
      if (doneCount === workers.size) requestFinalize();
    }
  }

  async function waitForQuiet() {
    while (Date.now() - lastOpAt < SETTLE_MS) {
      await sleep(SETTLE_MS / 2);
    }
  }

  async function requestFinalize() {
    if (finalizeRequested) return;
    finalizeRequested = true;
    await doc.flush();
    await waitForQuiet();
    while (pendingMerges.size > 0)
      await Promise.allSettled([...pendingMerges]);
    const snapshot = doc.snapshot();
    for (const worker of workers.values())
      worker.postMessage({ type: "finalize", snapshot });
  }

  function finalize() {
    for (const [id, state] of states.entries()) {
      if (state.bad || revokedActors.has(id)) continue;
      assert.equal(state.title, doc.title);
      assert.equal(state.body, doc.body.toString());
      assert.deepEqual(state.items, [...doc.items]);
      assert.deepEqual(state.tags.sort(), [...doc.tags].sort());
      assert.deepEqual(
        normalizeRecord(state.meta),
        normalizeRecord(recordSnapshot(doc.meta))
      );
    }
    console.log("dacument.sim: OK", {
      actors: actors.length,
      acceptedOps: doc.snapshot().ops.length,
    });
    for (const worker of workers.values()) worker.terminate();
    setTimeout(() => process.exit(0), 50);
  }

  const knownActors = [ownerId, ...actors.map((actor) => actor.id)];
  for (const actor of actors) {
    const worker = new Worker(new URL(import.meta.url), {
      type: "module",
      workerData: {
        snapshot,
        actorId: actor.id,
        roleKey: actor.role === "viewer" ? undefined : roleKeys.editor.privateKey,
        bad: actor.bad,
        mode: actor.mode,
        knownActors,
        actorInfo: {
          id: actor.id,
          privateKeyJwk: actor.keys.signingJwk,
          publicKeyJwk: actor.keys.verificationJwk,
        },
      },
    });
    workers.set(actor.id, worker);
    worker.on("message", (msg) => onMessage(actor.id, msg));
    worker.on("error", (err) => console.error("worker error", err));
  }
} else {
  const { snapshot, actorId, roleKey, bad, mode, knownActors, actorInfo } = workerData;
  await Dacument.setActorInfo(actorInfo);
  const schema = buildSchema();
  const doc = await Dacument.load({ schema, roleKey, snapshot });
  let revoked = false;
  const replayBuffer = [];
  const localDocId = doc.docId;
  const localSchemaId = doc.schemaId;

  function randomActor() {
    if (!Array.isArray(knownActors) || knownActors.length === 0) return actorId;
    return knownActors[Math.floor(Math.random() * knownActors.length)];
  }

  function sendOps(ops) {
    if (ops.length === 0) return;
    parentPort.postMessage({ type: "ops", ops });
  }

  function makeStamp(offsetMs = 0) {
    return { wallTimeMs: Date.now() + offsetMs, logical: 0, clockId: actorId };
  }

  function randomToken() {
    const body = Math.random().toString(36).slice(2);
    return `${body}.${body}.${body}`;
  }

  async function emitSpoofOps() {
    const iat = Math.floor(Date.now() / 1000);
    const stamp = makeStamp();
    const pastStamp = makeStamp(-3600 * 1000);
    const futureStamp = makeStamp(3600 * 1000);
    const ops = [
      { token: "not.a.jwt" },
      { token: randomToken() },
      { token: encodeToken({ alg: "none", typ: "DACOP" }, {
          iss: actorId,
          sub: localDocId,
          iat,
          stamp,
          kind: "register.set",
          schema: localSchemaId,
          field: "title",
          patch: { value: "evil" },
        }) },
      { token: encodeToken({ alg: "none", typ: "DACOP" }, {
          iss: actorId,
          sub: localDocId,
          iat,
          stamp,
          kind: "ack",
          schema: localSchemaId,
          patch: {},
        }) },
      { token: encodeToken({ alg: "none", typ: "DACOP" }, {
          iss: randomActor(),
          sub: localDocId,
          iat,
          stamp,
          kind: "ack",
          schema: localSchemaId,
          patch: { seen: stamp },
        }) },
      { token: encodeToken({ alg: "none", typ: "DACOP" }, {
          iss: actorId,
          sub: `wrong-${localDocId}`,
          iat,
          stamp,
          kind: "ack",
          schema: localSchemaId,
          patch: { seen: stamp },
        }) },
      { token: encodeToken({ alg: "none", typ: "DACOP" }, {
          iss: actorId,
          sub: localDocId,
          iat,
          stamp,
          kind: "ack",
          schema: `wrong-${localSchemaId}`,
          patch: { seen: stamp },
        }) },
    ];

    if (roleKey) {
      ops.push({ token: await signToken(roleKey, {
        alg: "ES256",
        typ: "DACOP",
        kid: `${actorId}:editor`,
      }, {
        iss: actorId,
        sub: localDocId,
        iat,
        stamp,
        kind: "ack",
        schema: localSchemaId,
        patch: { seen: stamp },
      }) });

      ops.push({ token: await signToken(roleKey, {
        alg: "ES256",
        typ: "DACOP",
        kid: `${actorId}:manager`,
      }, {
        iss: actorId,
        sub: localDocId,
        iat,
        stamp,
        kind: "register.set",
        schema: localSchemaId,
        field: "title",
        patch: { value: "spoof" },
      }) });

      ops.push({ token: await signToken(roleKey, {
        alg: "ES256",
        typ: "DACOP",
        kid: `${actorId}:editor`,
      }, {
        iss: actorId,
        sub: localDocId,
        iat,
        stamp,
        kind: "acl.set",
        schema: localSchemaId,
        patch: {
          id: generateNonce(),
          target: generateNonce(),
          role: "manager",
        },
      }) });

      ops.push({ token: await signToken(roleKey, {
        alg: "ES256",
        typ: "DACOP",
        kid: `${actorId}:editor`,
      }, {
        iss: actorId,
        sub: localDocId,
        iat,
        stamp,
        kind: "register.set",
        schema: localSchemaId,
        field: "missingField",
        patch: { value: "x" },
      }) });

      ops.push({ token: await signToken(roleKey, {
        alg: "ES256",
        typ: "DACOP",
        kid: `${actorId}:editor`,
      }, {
        iss: actorId,
        sub: localDocId,
        iat,
        stamp,
        kind: "text.patch",
        schema: localSchemaId,
        field: "body",
        patch: { nodes: [{ id: "bad-node" }] },
      }) });

      ops.push({ token: await signToken(roleKey, {
        alg: "ES256",
        typ: "DACOP",
        kid: `${actorId}:editor`,
      }, {
        iss: actorId,
        sub: localDocId,
        iat,
        stamp: pastStamp,
        kind: "register.set",
        schema: localSchemaId,
        field: "title",
        patch: { value: 42 },
      }) });

      ops.push({ token: await signToken(roleKey, {
        alg: "ES256",
        typ: "DACOP",
        kid: `${actorId}:editor`,
      }, {
        iss: actorId,
        sub: localDocId,
        iat,
        stamp: futureStamp,
        kind: "register.set",
        schema: localSchemaId,
        field: "title",
        patch: { value: "future" },
      }) });

      ops.push({ token: await signToken(roleKey, {
        alg: "ES256",
        typ: "NOTDACOP",
        kid: `${actorId}:editor`,
      }, {
        iss: actorId,
        sub: localDocId,
        iat,
        stamp,
        kind: "register.set",
        schema: localSchemaId,
        field: "title",
        patch: { value: "bad-typ" },
      }) });

      ops.push({ token: await signToken(roleKey, {
        alg: "ES256",
        typ: "DACOP",
        kid: `${randomActor()}:editor`,
      }, {
        iss: actorId,
        sub: localDocId,
        iat,
        stamp,
        kind: "register.set",
        schema: localSchemaId,
        field: "title",
        patch: { value: "kid-mismatch" },
      }) });

      ops.push({ token: await signToken(roleKey, {
        alg: "ES256",
        typ: "DACOP",
        kid: `${randomActor()}:editor`,
      }, {
        iss: randomActor(),
        sub: localDocId,
        iat,
        stamp,
        kind: "register.set",
        schema: localSchemaId,
        field: "title",
        patch: { value: "impersonate" },
      }) });

      ops.push({ token: await signToken(roleKey, {
        alg: "ES256",
        typ: "DACOP",
        kid: `${actorId}:editor`,
      }, {
        iss: actorId,
        sub: `wrong-${localDocId}`,
        iat,
        stamp,
        kind: "register.set",
        schema: localSchemaId,
        field: "title",
        patch: { value: "wrong-doc" },
      }) });

      ops.push({ token: await signToken(roleKey, {
        alg: "ES256",
        typ: "DACOP",
        kid: `${actorId}:editor`,
      }, {
        iss: actorId,
        sub: localDocId,
        iat,
        stamp,
        kind: "register.set",
        schema: `wrong-${localSchemaId}`,
        field: "title",
        patch: { value: "wrong-schema" },
      }) });
    }

    sendOps(ops);
  }

  doc.addEventListener("revoked", () => {
    revoked = true;
    parentPort.postMessage({ type: "revoked", actorId });
  });

  doc.addEventListener("delta", (event) => {
    const ops = event.ops;
    if (mode === "tamper" && Math.random() < 0.4) {
      const tampered = ops.map((op, index) => {
        if (index !== 0) return op;
        const token = op.token;
        const hacked =
          token.slice(0, -1) + (token.slice(-1) === "a" ? "b" : "a");
        return { token: hacked };
      });
      sendOps(tampered);
      return;
    }
    replayBuffer.push(...ops);
    sendOps(ops);
  });

  parentPort.on("message", async (msg) => {
    if (msg.type === "ops") {
      await doc.merge(msg.ops);
      return;
    }
    if (msg.type === "finalize") {
      if (msg.snapshot?.ops) await doc.merge(msg.snapshot.ops);
      await doc.flush();
      parentPort.postMessage({
        type: "state",
        state: {
          bad,
          title: doc.title,
          body: doc.body.toString(),
          items: [...doc.items],
          tags: [...doc.tags],
          meta: recordSnapshot(doc.meta),
        },
      });
    }
  });

  function randomWord() {
    return Math.random().toString(36).slice(2, 7);
  }

  async function run() {
    for (let i = 0; i < STEPS; i++) {
      if (revoked && !bad) break;
      if (mode === "viewer") {
        if (i % 15 === 0) {
          try {
            doc.title = `x${i}`;
          } catch {
            // ignore viewer writes
          }
        }
        await sleep(randomDelay());
        continue;
      }
      const choice = i % 5;
      if (choice === 0) doc.title = `note ${randomWord()}`;
      if (choice === 1) doc.body.insertAt(doc.body.length, ".");
      if (choice === 2) doc.items.push(randomWord());
      if (choice === 3) doc.tags.add(randomWord());
      if (choice === 4) doc.meta[`k${i}`] = randomWord();
      if (bad && i % 7 === 0) {
        try {
          doc.acl.setRole(generateNonce(), "manager");
        } catch {
          // ignore unauthorized attempts
        }
      }
      if (mode === "tamper" && replayBuffer.length > 0 && i % 10 === 0) {
        const replay = replayBuffer.slice(0, 2);
        sendOps(replay);
      }
      if (mode === "spoof" && i % 6 === 0) {
        await emitSpoofOps();
      }
      if (mode === "flood" && i % 4 === 0) {
        const ops = [];
        for (let j = 0; j < 12; j++) ops.push({ token: randomToken() });
        sendOps(ops);
        await emitSpoofOps();
      }
      await sleep(randomDelay());
    }
    await doc.flush();
    parentPort.postMessage({ type: "done" });
  }

  run().catch((err) => {
    parentPort.postMessage({ type: "done", error: err.message });
  });
}

