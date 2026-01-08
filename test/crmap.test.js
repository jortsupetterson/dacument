import assert from "node:assert/strict";
import test from "node:test";
import { CRMap } from "../dist/CRMap/class.js";

function cloneSnapshot(snapshot) {
  return structuredClone(snapshot);
}

test("set/get/has support undefined key and value", () => {
  const map = new CRMap();

  map.set("a", undefined);
  assert.equal(map.has("a"), true);
  assert.equal(map.get("a"), undefined);
  assert.equal(map.size, 1);

  const entries = [...map.entries()];
  assert.equal(entries.length, 1);
  assert.equal(entries[0][0], "a");
  assert.equal(entries[0][1], undefined);

  map.set(undefined, "x");
  assert.equal(map.has(undefined), true);
  assert.equal(map.get(undefined), "x");

  const keys = [...map.keys()];
  assert.ok(keys.some((key) => key === undefined));

  const values = [...map.values()];
  assert.ok(values.some((value) => value === undefined));
  assert.ok(values.includes("x"));
});

test("symbol keys are distinct", () => {
  const map = new CRMap();
  const a = Symbol("k");
  const b = Symbol("k");

  map.set(a, 1);
  map.set(b, 2);

  assert.equal(map.size, 2);
  assert.equal(map.get(a), 1);
  assert.equal(map.get(b), 2);
});

test("onChange reports local mutations", () => {
  const map = new CRMap();
  const events = [];
  const stop = map.onChange((patches) => {
    events.push(patches.map((patch) => patch.op));
  });

  map.set("k", 1);
  map.delete("k");
  stop();

  assert.deepEqual(events, [["set"], ["del"]]);
});

test("merge accepts a single patch node", () => {
  const alice = new CRMap();
  const bob = new CRMap();

  bob.set("k", 1);
  const [patch] = bob.snapshot();

  alice.merge(patch);
  assert.equal(alice.get("k"), 1);
});

test("add after delete survives merge", () => {
  const alice = new CRMap();
  const bob = new CRMap();

  alice.set("k", 1);
  bob.merge(cloneSnapshot(alice.snapshot()));

  alice.delete("k");
  bob.set("k", 2);

  alice.merge(cloneSnapshot(bob.snapshot()));
  bob.merge(cloneSnapshot(alice.snapshot()));

  assert.equal(alice.get("k"), 2);
  assert.equal(bob.get("k"), 2);
});

test("concurrent sets converge deterministically", () => {
  const alice = new CRMap();
  const bob = new CRMap();

  const setA = { op: "set", id: "a", key: "k", keyId: "str:k", value: "A" };
  const setB = { op: "set", id: "b", key: "k", keyId: "str:k", value: "B" };

  alice.merge([setA, setB]);
  bob.merge([setB, setA]);

  assert.equal(alice.get("k"), "B");
  assert.equal(bob.get("k"), "B");
});
