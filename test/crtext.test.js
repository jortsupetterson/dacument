import assert from "node:assert/strict";
import test from "node:test";
import { CRText } from "../dist/CRText/class.js";

function cloneSnapshot(snapshot) {
  return structuredClone(snapshot);
}

test("insertAt builds text and length", () => {
  const text = new CRText();
  text.insertAt(0, "h");
  text.insertAt(1, "i");
  text.insertAt(2, "!");

  assert.equal(text.length, 3);
  assert.equal(text.toString(), "hi!");
  assert.equal(text.at(1), "i");
});

test("onChange reports inserts and deletes", () => {
  const text = new CRText();
  const events = [];
  const stop = text.onChange((nodes) => {
    events.push(nodes.map((node) => ({ value: node.value, deleted: node.deleted })));
  });

  text.insertAt(0, "x");
  text.deleteAt(0);
  stop();

  assert.deepEqual(events, [
    [{ value: "x", deleted: false }],
    [{ value: "x", deleted: true }],
  ]);
});

test("merge accepts a single DAGNode patch", () => {
  const alice = new CRText();
  const bob = new CRText();

  bob.insertAt(0, "Z");
  alice.merge(bob.snapshot()[0]);

  assert.equal(alice.toString(), "Z");
});

test("insertAt orders siblings by id when sharing a predecessor", () => {
  const text = new CRText();
  text.insertAt(0, "a");
  text.insertAt(1, "c");
  text.insertAt(1, "b");

  assert.equal(text.toString(), "acb");
});

test("deleteAt removes a character and returns it", () => {
  const text = new CRText();
  text.insertAt(0, "x");
  text.insertAt(1, "y");

  const removed = text.deleteAt(0);
  assert.equal(removed, "x");
  assert.equal(text.toString(), "y");
  assert.equal(text.length, 1);
});

test("insertAt and deleteAt validate indices", () => {
  const text = new CRText();

  assert.throws(() => text.insertAt(1, "a"), /out of bounds/);
  assert.throws(() => text.insertAt(-1, "a"), /negative/);
  assert.throws(() => text.insertAt(1.2, "a"), /integer/);

  assert.throws(() => text.deleteAt(-1), /negative/);
  assert.throws(() => text.deleteAt(1.2), /integer/);
  assert.equal(text.deleteAt(0), undefined);
});

test("merge converges across actors and deletions propagate", () => {
  const alice = new CRText();
  const bob = new CRText();

  alice.insertAt(0, "A");
  alice.insertAt(1, "B");
  bob.insertAt(0, "X");

  alice.merge(cloneSnapshot(bob.snapshot()));
  bob.merge(cloneSnapshot(alice.snapshot()));

  assert.equal(alice.toString(), bob.toString());

  bob.deleteAt(1);
  alice.merge(cloneSnapshot(bob.snapshot()));

  assert.equal(alice.toString(), bob.toString());
});

test("concurrent inserts converge deterministically", () => {
  const base = new CRText();
  base.insertAt(0, "0");

  const alice = new CRText(cloneSnapshot(base.snapshot()));
  const bob = new CRText(cloneSnapshot(base.snapshot()));

  alice.insertAt(1, "A");
  bob.insertAt(1, "B");

  const mergedA = new CRText(cloneSnapshot(base.snapshot()));
  mergedA.merge(cloneSnapshot(alice.snapshot()));
  mergedA.merge(cloneSnapshot(bob.snapshot()));

  const mergedB = new CRText(cloneSnapshot(base.snapshot()));
  mergedB.merge(cloneSnapshot(bob.snapshot()));
  mergedB.merge(cloneSnapshot(alice.snapshot()));

  assert.equal(mergedA.toString(), mergedB.toString());
  assert.equal(mergedA.length, 3);
});
