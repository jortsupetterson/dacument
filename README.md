# simple-crdts

Lightweight, zero-dependency CRDT primitives you can drop into offline-first or multi-node apps. Ships with a Last-Writer-Wins register and a PN-Counter plus ready-to-use JSON serialization and TypeScript typings.

## Features

- Minimal API: `LWW` register and `PNCounter` with deterministic merges
- Offline-friendly: serialize to JSON, rehydrate with `fromJSON`
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

### Persist and rehydrate

```js
import { PNCounter, LWW } from "simple-crdts";

const counter = new PNCounter("cache-node").increment();
localStorage.setItem("counter", JSON.stringify(counter.toJSON()));

const restored = PNCounter.fromJSON(
  JSON.parse(localStorage.getItem("counter") || "{}")
);

const title = new LWW("Hello", "node-1", 4);
const payload = JSON.stringify(title.toJSON()); // send over the wire
const merged = LWW.fromJSON(JSON.parse(payload));
```

## API in 30 seconds

- `PNCounter(localNodeId, increments?, decrements?)` – create a replica.
- `increment()` / `decrement()` – mutate the local register.
- `merge(other)` – element-wise max merge; returns `this`.
- `getCount()` – returns sum(increments) - sum(decrements).
- `toJSON()` / `PNCounter.fromJSON(json)` – serialize/rehydrate.

- `LWW(value, nodeId?, counter?, timestamp?)` – create a register.
- `competition(other)` – merge winner into `this` using timestamp, then counter, then nodeId.
- `toJSON()` / `LWW.fromJSON(json)` – serialize/rehydrate.
- Constants: `LWW.STALE_THRESHOLD_MS` (30 min) and `LWW.COUNTER_WINDOW_MS` (30 s) tune the merge windows.

## Notes

- Published as an ES module; use dynamic `import()` for CommonJS if needed.
- Pure data classes; safe to store in IndexedDB, localStorage, or send over the network.
- Deterministic merges mean replicas converge as long as everyone exchanges state.

## License

MIT
