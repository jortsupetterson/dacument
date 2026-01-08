import assert from "node:assert/strict";
import test from "node:test";
import { CRRegister } from "../dist/CRRegister/class.js";

function stamp(wallTimeMs, logical, clockId) {
  return { wallTimeMs, logical, clockId };
}

test("get returns null before any set", () => {
  const reg = new CRRegister();
  assert.equal(reg.get(), null);
});

test("set updates winner and onChange fires", () => {
  const reg = new CRRegister();
  const events = [];
  const stop = reg.onChange((patches) => {
    events.push(patches[0].value);
  });

  reg.set("a");
  reg.set("b");
  stop();

  assert.equal(reg.get(), "b");
  assert.deepEqual(events, ["a", "b"]);
});

test("older stamp does not override", () => {
  const reg = new CRRegister();
  reg.set("new", stamp(200, 0, "b"));
  reg.set("old", stamp(100, 0, "c"));

  assert.equal(reg.get(), "new");
});

test("newer stamp overrides", () => {
  const reg = new CRRegister();
  reg.set("old", stamp(100, 0, "a"));
  reg.set("new", stamp(101, 0, "a"));

  assert.equal(reg.get(), "new");
});

test("clockId tie-breaker is deterministic", () => {
  const reg = new CRRegister();
  reg.set("a", stamp(100, 5, "a"));
  reg.set("b", stamp(100, 5, "b"));

  assert.equal(reg.get(), "b");
});

test("onChange only fires when winner changes", () => {
  const reg = new CRRegister();
  const events = [];
  const stop = reg.onChange((patches) => {
    events.push(patches[0].value);
  });

  reg.set("new", stamp(200, 0, "b"));
  reg.set("old", stamp(100, 0, "c"));
  stop();

  assert.deepEqual(events, ["new"]);
});

test("merge accepts a single patch node", () => {
  const alice = new CRRegister();
  const bob = new CRRegister();

  bob.set("ready", stamp(100, 1, "b"));
  const [patch] = bob.snapshot();

  alice.merge(patch);
  assert.equal(alice.get(), "ready");
});
