import assert from "node:assert/strict";
import test from "node:test";
import { CRArray } from "../dist/index.js";

function cloneSnapshot(snapshot) {
  // Simulate network transfer and avoid shared references between actors.
  return structuredClone(snapshot);
}

test("array-like operations keep order and length", () => {
  const cr = new CRArray();

  assert.equal(cr.length, 0);
  cr.push(1, 2);
  cr.unshift(0);

  assert.deepEqual([...cr], [0, 1, 2]);
  assert.equal(cr.pop(), 2);
  assert.equal(cr.shift(), 0);
  assert.equal(cr.length, 1);
  assert.deepEqual(cr.slice(), [1]);
});

test("array helpers operate on alive values", () => {
  const cr = new CRArray();
  cr.push(1, 2, 3);
  cr.pop();

  assert.deepEqual(cr.map((value) => value * 2), [2, 4]);
  assert.equal(
    cr.reduce((total, value) => total + value, 0),
    3
  );
  assert.equal(cr.findIndex((value) => value === 2), 1);
  assert.equal(cr.includes(3), false);
});

test("onChange reports inserts and deletes", () => {
  const cr = new CRArray();
  const events = [];
  const stop = cr.onChange((nodes) => {
    events.push(nodes.map((node) => ({ value: node.value, deleted: node.deleted })));
  });

  cr.push("a");
  cr.pop();
  stop();

  assert.deepEqual(events, [
    [{ value: "a", deleted: false }],
    [{ value: "a", deleted: true }],
  ]);
});

test("merge accepts a single DAGNode patch", () => {
  const alice = new CRArray();
  const bob = new CRArray();

  bob.push("x");
  alice.merge(bob.snapshot()[0]);

  assert.deepEqual([...alice], ["x"]);
});

test("proxy index access mirrors array behavior", () => {
  const cr = new CRArray();
  cr.push("a", "b", "c");

  assert.equal(cr[0], "a");
  assert.equal(cr[1], "b");
  assert.equal(cr.length, 3);

  cr[1] = "beta";
  assert.deepEqual([...cr], ["a", "beta", "c"]);

  assert.equal(0 in cr, true);
  assert.equal(2 in cr, true);
  assert.equal(3 in cr, false);

  const numericKeys = Object.keys(cr).filter((key) => /^\d+$/.test(key));
  assert.deepEqual(numericKeys, ["0", "1", "2"]);

  assert.throws(() => {
    cr[5] = "oops";
  }, /out of bounds/);
});

test("proxy has treats undefined values as present", () => {
  const cr = new CRArray();
  cr.push(undefined);
  assert.equal(0 in cr, true);
});

test("merge converges across actors and propagates deletions", () => {
  const alice = new CRArray();
  const bob = new CRArray();

  alice.push("a1", "a2");
  bob.push("b1");

  const aliceToBob = cloneSnapshot(alice.snapshot());
  const bobToAlice = cloneSnapshot(bob.snapshot());

  alice.merge(bobToAlice);
  bob.merge(aliceToBob);

  assert.deepEqual([...alice], [...bob]);

  bob.pop();
  const bobToAlice2 = cloneSnapshot(bob.snapshot());
  alice.merge(bobToAlice2);

  assert.deepEqual([...alice], [...bob]);
});

test("concurrent inserts converge deterministically", () => {
  const base = new CRArray();
  base.push("root");

  const alice = new CRArray(cloneSnapshot(base.snapshot()));
  const bob = new CRArray(cloneSnapshot(base.snapshot()));

  alice.push("alice");
  bob.push("bob");

  const mergedA = new CRArray(cloneSnapshot(base.snapshot()));
  mergedA.merge(cloneSnapshot(alice.snapshot()));
  mergedA.merge(cloneSnapshot(bob.snapshot()));

  const mergedB = new CRArray(cloneSnapshot(base.snapshot()));
  mergedB.merge(cloneSnapshot(bob.snapshot()));
  mergedB.merge(cloneSnapshot(alice.snapshot()));

  assert.deepEqual([...mergedA], [...mergedB]);
  assert.deepEqual(mergedA.slice(0, 1), ["root"]);
  assert.equal(mergedA.length, 3);
});
