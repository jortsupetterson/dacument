# simple-crdts

/// THESE ARE MEANT FOR VALUES/DOCUMENTS USERS CAN WRITE DIRECTLY OR AS A SIDE-EFFECT, THESE ARE MEANING THE MAIN GOAL IS TO SERVE INTENTION AS MUCH AS POSSIBLE.

/// THESE ARE NOT MEANT FOR SYSTEM ONLY CONFLICT RESOLVING THAT USERS ACTION DO NOT AFFECT IN ANY SHAPE OR FORM, IF THAT IS WHAT YOU NEED CHECK SOMETHING ELSE eg. <INSERT INDUSTRY STANDARD CRDT NPM PACKAGE URL HERE>

Lightweight, zero-dependency CRDT primitives you can drop into offline-first or multi-node apps. Ships with a Last-Writer-Wins register, a PN-Counter, and a Text RGA (text CRDT) plus ready-to-use JSON serialization and TypeScript typings.

## Features

- Minimal API: `LWW`, `PNCounter`, and `TextRGA` with deterministic merges
- Offline-friendly: serialize to JSON, rehydrate with `fromJSON`
- Text-aware: TextRGA supports insert/delete with stable callbacks
- ESM first: tree-shakeable and side-effect free
- Typed: bundled `.d.ts` for painless TS/JS IntelliSense

## Install

```sh
npm install simple-crdts
```

## Quick start

### PN-Counter

```js
import { PNCounter } from "simple-crdts";

const alice = new PNCounter("alice");
alice.increment().increment(); // +2 on alice

const bob = new PNCounter("bob");
bob.increment().decrement(); // +1 then -1 on bob

// Merge state from both replicas
const merged = PNCounter.fromJSON(alice.toJSON());
merged.merge(bob);

merged.getCount(); // -> 1
```

### Last-Writer-Wins register

```js
import { LWW } from "simple-crdts";

// value, nodeId, counter (for near-simultaneous writes)
const draft = new LWW("draft", "node-a", 1);
const published = new LWW("published", "node-b", 2);

// Resolves in place; timestamp, counter, then nodeId break ties
draft.competition(published);

draft.value; // -> "published"
```

### TextRGA (text CRDT)

```js
import { TextRGA } from "simple-crdts";

const a = new TextRGA("node-a");
a.insertAt(0, "H");
a.insertAt(1, "i");

// Another replica
const b = TextRGA.fromJSON(a.toJSON());
b.insertAt(2, "!");

// Merge and materialize
a.merge(b);
a.getText(); // -> "Hi!"

// Handle remote op streams
const idx = a.applyRemoteInsert({ id: "peer:42", char: "?" });
// Later...
a.applyRemoteDelete({ id: "peer:42" });
```

### Persist and rehydrate

```js
import { PNCounter, LWW, TextRGA } from "simple-crdts";

const counter = new PNCounter("cache-node").increment();
localStorage.setItem("counter", JSON.stringify(counter.toJSON()));

const restoredCounter = PNCounter.fromJSON(
  JSON.parse(localStorage.getItem("counter") || "{}")
);

const title = new LWW("Hello", "node-1", 4);
const payload = JSON.stringify(title.toJSON()); // send over the wire
const mergedTitle = LWW.fromJSON(JSON.parse(payload));

const doc = new TextRGA("writer");
doc.insertAt(0, "A");
localStorage.setItem("doc", JSON.stringify(doc.toJSON()));
const restoredDoc = TextRGA.fromJSON(
  JSON.parse(localStorage.getItem("doc") || "{}")
);
```

## API in 30 seconds

- `PNCounter(localNodeId, increments?, decrements?)` - create a replica.
- `increment()` / `decrement()` - mutate the local register.
- `merge(other)` - element-wise max merge; returns `this`.
- `getCount()` - returns sum(increments) - sum(decrements).
- `toJSON()` / `PNCounter.fromJSON(json)` - serialize/rehydrate.

- `LWW(value, nodeId?, counter?, timestamp?)` - create a register.
- `competition(other)` - merge winner into `this` using timestamp, then counter, then nodeId.
- `toJSON()` / `LWW.fromJSON(json)` - serialize/rehydrate.
- Constants: `LWW.STALE_THRESHOLD_MS` (30 min) and `LWW.COUNTER_WINDOW_MS` (30 s) tune the merge windows.

- `TextRGA(nodeId, localCounter?, entries?, order?, onInsert?, onDelete?)` - create a text replica; callbacks fire on local inserts/deletes.
- `insertAt(index, char)` / `deleteAt(index)` - mutate the visible text.
- `applyRemoteInsert({id, char})` / `applyRemoteDelete({id})` - apply explicit remote ops idempotently (useful when you stream operations instead of state).
- `merge(other)` - union entries and deterministic order; returns `this`.
- `getText()` - materialize current visible string.
- `toJSON()` / `TextRGA.fromJSON(json)` - serialize/rehydrate (callbacks are not serialized).

## Notes

- Published as an ES module; use dynamic `import()` for CommonJS if needed.
- Pure data classes; safe to store in IndexedDB, localStorage, or send over the network.
- Deterministic merges mean replicas converge as long as everyone exchanges state.

## License

MIT
