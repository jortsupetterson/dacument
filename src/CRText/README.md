# CRText

CRText is a conflict-aware text sequence (RGA) that stores characters as DAG
nodes with tombstones so replicas can merge without conflicts.

## API

- `onChange(listener): () => void` receives an array of changed DAG nodes.
- `snapshot(): DAGNode<string>[]` returns a copy of all nodes (including
  tombstones).
- `merge(snapshotOrNode): DAGNode<string>[]` accepts a snapshot array or single
  node patch and returns the accepted nodes.
- Text methods: `insertAt`, `deleteAt`, `at`, `toString`, plus `length`.

## How it works

- `insertAt` finds the live predecessor and appends a node that references it.
- `deleteAt` tombstones the node at a live index.
- `sort` orders by `after` then id, so concurrent inserts converge.
- `merge` unions nodes by id and propagates tombstones.

## Compared to native string

- Strings are immutable; CRText keeps a history of edits.
- Deletes keep tombstones, so memory grows until you compact.
- Random access (`at`) rebuilds the live view, so repeated indexing is O(n).

## Complexity notes

- `insertAt` is O(n log n) because it inserts and re-sorts.
- `deleteAt` is O(n) to find the live index.
- `toString` is O(n) over live nodes.
- `merge` is O(n log n) due to sorting after unioning snapshots.

## Distributed example

```js
import { CRText } from "./class.js";

const alice = new CRText();
const bob = new CRText();

alice.insertAt(0, "H");
alice.insertAt(1, "i");
bob.insertAt(0, "!");

const aliceToBob = structuredClone(alice.snapshot());
const bobToAlice = structuredClone(bob.snapshot());

alice.merge(bobToAlice);
bob.merge(aliceToBob);

console.log(alice.toString()); // same as bob, deterministic order
```

## Tests

`npm test` runs the node:test suite in `test/crtext.test.js`.

## Benchmarks

`npm run bench:crtext` runs `bench/crtext.bench.js`.

You can tune the run with environment variables:

- `SIZE=2000` (initial text length)
- `RUNS=3` (number of samples)
- `MID_OPS=500` (middle inserts/deletes per run)
- `READS=1000` (reads per run)
- `MERGE_SIZE=1000` (items per side for merge runs)

Sample output (RUNS=3, SIZE=2000, MID_OPS=500, READS=1000, MERGE_SIZE=1000):

```
CRText bench (runs=3, size=2000, midOps=500, reads=1000, mergeSize=1000)
CRText insertAt append: avg 369.72 ms (min 346.65, max 414.72)
Array insert append: avg 0.16 ms (min 0.12, max 0.20)
CRText toString: avg 0.20 ms (min 0.15, max 0.25)
Array join: avg 0.05 ms (min 0.04, max 0.06)
CRText insertAt middle: avg 179.09 ms (min 176.85, max 181.63)
Array insert middle: avg 0.18 ms (min 0.17, max 0.19)
CRText deleteAt middle: avg 9.47 ms (min 8.71, max 10.07)
Array delete middle: avg 0.15 ms (min 0.14, max 0.15)
CRText index read: avg 27.92 ms (min 26.73, max 29.72)
Array index read: avg 0.06 ms (min 0.06, max 0.07)
CRText merge: avg 10.92 ms (min 9.62, max 11.81)
```
