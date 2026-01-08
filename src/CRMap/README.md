# CRMap

CRMap is an observed-remove map (OR-Map) that converges across replicas. Each
`set` creates a unique tag, and deletes tombstone the tags they observed.

## API

- `onChange(listener): () => void` receives an array of accepted nodes.
- `snapshot(): CRMapNode<K, V>[]` returns a copy of all nodes.
- `merge(snapshotOrNode): CRMapNode<K, V>[]` accepts a snapshot array or single
  node patch and returns the accepted nodes.
- Map methods: `get`, `set`, `has`, `delete`, `clear`, `size`, iterators,
  and `forEach`.

## How it works

- `set(key, value)` emits a `set` node tagged with a unique id.
- `delete(key)` emits a `del` node that tombstones the currently observed tags.
- `merge(snapshotOrNode)` unions nodes by id, so concurrent writes converge.
- If multiple tags are alive for a key, the highest tag id wins the visible
  value.

## Key identity

By default, primitive keys get stable string ids. Objects and symbols use
replica-local identity, so for distributed use you should provide `key` in the
constructor to map keys to a stable string.

## Compared to native Map

- Deletes are observed-remove (tombstone tags) rather than immediate erase.
- Concurrent writes converge deterministically without coordination.
  Update order is based on tag ids.

## Complexity notes

- `set` / `delete` are O(k) where k is the number of tags for a key.
- `get` / `has` are O(1).
- `merge` is O(n) over incoming nodes.

## Distributed example

```js
import { CRMap } from "./class.js";

const alice = new CRMap();
const bob = new CRMap();

alice.set("k", "A");
bob.set("k", "B");

const aliceToBob = structuredClone(alice.snapshot());
const bobToAlice = structuredClone(bob.snapshot());

alice.merge(bobToAlice);
bob.merge(aliceToBob);

console.log(alice.get("k"), bob.get("k")); // same winner by tag id
```

## Tests

`npm test` runs the node:test suite in `test/crmap.test.js`.

## Benchmarks

`npm run bench:crmap` runs `bench/crmap.bench.js`.

You can tune the run with environment variables:

- `SIZE=20000` (entries per run)
- `READS=5000` (reads/deletes per run)
- `MERGE_SIZE=5000` (entries per side for merge runs)
- `RUNS=3` (number of samples)

Sample output (RUNS=3, SIZE=20000, READS=5000, MERGE_SIZE=5000):

```
CRMap bench (runs=3, size=20000, reads=5000, mergeSize=5000)
CRMap set: avg 68.05 ms (min 63.87, max 70.19)
Map set: avg 3.52 ms (min 2.95, max 4.02)
CRMap get: avg 1.14 ms (min 0.86, max 1.44)
Map get: avg 1.29 ms (min 1.18, max 1.50)
CRMap delete: avg 46.25 ms (min 36.02, max 57.75)
Map delete: avg 5.50 ms (min 2.93, max 9.97)
CRMap merge: avg 10.28 ms (min 6.68, max 15.52)
```
