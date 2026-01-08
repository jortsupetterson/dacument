# CRSet

CRSet is an observed-remove set (OR-Set) that converges across replicas. Each
`add` creates a unique tag, and `delete` tombstones the tags it observed.

## API

- `onChange(listener): () => void` receives an array of accepted nodes.
- `snapshot(): CRSetNode<T>[]` returns a copy of all nodes.
- `merge(snapshotOrNode): CRSetNode<T>[]` accepts a snapshot array or single
  node patch and returns the accepted nodes.
- Set methods: `add`, `has`, `delete`, `clear`, `size`, iterators, and
  `forEach`.

## How it works

- `add(value)` emits an `add` node tagged with a unique id.
- `delete(value)` emits a `rem` node that tombstones the currently observed tags.
- `merge(snapshotOrNode)` unions nodes by id, so concurrent writes converge.
- If multiple adds share the same key, the highest tag id wins the returned
  value.

## Value identity

By default, primitives get stable string ids. Objects and symbols use
replica-local identity, so for distributed use you should provide `key` in the
constructor to map values to a stable string.

## Compared to native Set

- Deletes are observed-remove (tombstone tags) rather than immediate erase.
- Concurrent writes converge deterministically without coordination.
  Update order is based on tag ids.

## Complexity notes

- `add` / `delete` are O(k) where k is the number of tags for a key.
- `has` is O(1).
- `merge` is O(n) over incoming nodes.

## Distributed example

```js
import { CRSet } from "./class.js";

const alice = new CRSet();
const bob = new CRSet();

alice.add("x");
bob.add("y");

const aliceToBob = structuredClone(alice.snapshot());
const bobToAlice = structuredClone(bob.snapshot());

alice.merge(bobToAlice);
bob.merge(aliceToBob);

console.log([...alice]); // same elements as bob
```

## Tests

`npm test` runs the node:test suite in `test/crset.test.js`.

## Benchmarks

`npm run bench:crset` runs `bench/crset.bench.js`.

You can tune the run with environment variables:

- `SIZE=20000` (entries per run)
- `READS=5000` (reads/deletes per run)
- `MERGE_SIZE=5000` (entries per side for merge runs)
- `RUNS=3` (number of samples)

Sample output (RUNS=3, SIZE=20000, READS=5000, MERGE_SIZE=5000):

```
CRSet bench (runs=3, size=20000, reads=5000, mergeSize=5000)
CRSet add: avg 55.55 ms (min 49.38, max 66.21)
Set add: avg 2.83 ms (min 2.64, max 3.12)
CRSet has: avg 1.56 ms (min 0.83, max 2.59)
Set has: avg 1.02 ms (min 0.67, max 1.24)
CRSet delete: avg 35.53 ms (min 23.98, max 55.45)
Set delete: avg 1.35 ms (min 0.96, max 1.61)
CRSet merge: avg 5.91 ms (min 3.74, max 10.10)
```
