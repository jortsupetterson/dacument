import assert from "node:assert/strict";
import test from "node:test";
import { CRRecord } from "../dist/CRRecord/class.js";

test("proxy exposes methods and record access", () => {
  const record = new CRRecord();

  assert.equal(typeof record.onChange, "function");

  record.title = "Hello";
  assert.equal(record.title, "Hello");

  const snapshot = record.snapshot();
  assert.equal(snapshot.length, 1);
  assert.equal(snapshot[0].op, "set");
});

test("onChange reports local mutations", () => {
  const record = new CRRecord();
  const events = [];
  const stop = record.onChange((patches) => {
    events.push(patches.map((patch) => patch.op));
  });

  record.status = "open";
  delete record.status;
  stop();

  assert.deepEqual(events, [["set"], ["del"]]);
});

test("merge accepts a single patch node", () => {
  const alice = new CRRecord();
  const bob = new CRRecord();

  bob.name = "Bob";
  const [patch] = bob.snapshot();

  alice.merge(patch);
  assert.equal(alice.name, "Bob");
});

test("deterministic winner by tag id", () => {
  const alice = new CRRecord();
  const bob = new CRRecord();

  const setA = { op: "set", id: "a", prop: "title", value: "A" };
  const setB = { op: "set", id: "b", prop: "title", value: "B" };

  alice.merge([setA, setB]);
  bob.merge([setB, setA]);

  assert.equal(alice.title, "B");
  assert.equal(bob.title, "B");
});

test("delete recomputes to previous tag", () => {
  const record = new CRRecord();

  record.merge([
    { op: "set", id: "a", prop: "x", value: 1 },
    { op: "set", id: "b", prop: "x", value: 2 },
  ]);

  record.merge({ op: "del", id: "c", prop: "x", targets: ["b"] });
  assert.equal(record.x, 1);
});
