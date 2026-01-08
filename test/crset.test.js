import assert from "node:assert/strict";
import test from "node:test";
import { CRSet } from "../dist/CRSet/class.js";

function cloneSnapshot(snapshot) {
  return structuredClone(snapshot);
}

test("add/has support undefined values", () => {
  const set = new CRSet();
  set.add(undefined);

  assert.equal(set.has(undefined), true);
  assert.equal(set.size, 1);

  const values = [...set.values()];
  assert.equal(values.length, 1);
  assert.equal(values[0], undefined);
});

test("symbol values are distinct", () => {
  const set = new CRSet();
  const a = Symbol("k");
  const b = Symbol("k");

  set.add(a);
  set.add(b);

  assert.equal(set.size, 2);
  assert.equal(set.has(a), true);
  assert.equal(set.has(b), true);
});

test("onChange reports local mutations", () => {
  const set = new CRSet();
  const events = [];
  const stop = set.onChange((patches) => {
    events.push(patches.map((patch) => patch.op));
  });

  set.add("x");
  set.delete("x");
  stop();

  assert.deepEqual(events, [["add"], ["rem"]]);
});

test("merge accepts a single patch node", () => {
  const alice = new CRSet();
  const bob = new CRSet();

  bob.add("x");
  const [patch] = bob.snapshot();

  alice.merge(patch);
  assert.equal(alice.has("x"), true);
});

test("add after delete survives merge", () => {
  const alice = new CRSet();
  const bob = new CRSet();

  alice.add("x");
  bob.merge(cloneSnapshot(alice.snapshot()));

  alice.delete("x");
  bob.add("x");

  alice.merge(cloneSnapshot(bob.snapshot()));
  bob.merge(cloneSnapshot(alice.snapshot()));

  assert.equal(alice.has("x"), true);
  assert.equal(bob.has("x"), true);
});

test("concurrent adds converge deterministically", () => {
  const key = (value) => `id:${value.id}`;
  const alice = new CRSet({ key });
  const bob = new CRSet({ key });

  const addA = { op: "add", id: "a", value: { id: 1, label: "A" }, key: "id:1" };
  const addB = { op: "add", id: "b", value: { id: 1, label: "B" }, key: "id:1" };

  alice.merge([addA, addB]);
  bob.merge([addB, addA]);

  const [valueA] = [...alice.values()];
  const [valueB] = [...bob.values()];

  assert.equal(valueA.label, "B");
  assert.equal(valueB.label, "B");
});
