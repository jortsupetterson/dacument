# CRArray

CRArray is a conflict-aware array (RGA) that stores values as DAG nodes with
tombstones so replicas can merge without conflicts.

## API

- `onChange(listener): () => void` receives an array of changed DAG nodes.
- `snapshot(): DAGNode<T>[]` returns a copy of all nodes (including tombstones).
- `merge(snapshotOrNode): DAGNode<T>[]` accepts a snapshot array or single node
  patch and returns the accepted nodes.
- Array-like methods: `push`, `pop`, `unshift`, `shift`, `setAt`, `at`, `slice`,
  `map`, `filter`, `reduce`, `forEach`, `includes`, `indexOf`, iterator, and
  Proxy index access.

## How it works

- Inserts create nodes that point at their predecessor via `after`.
- `sort` orders by `after` then id, so concurrent inserts converge
  deterministically.
- `merge` unions nodes by id and propagates tombstones.

## Proxy array access

CRArray instances are wrapped in a Proxy so numeric access feels like a normal
array:

- `arr[0]` maps to `at(0)` and returns the live value.
- `arr[1] = value` maps to `setAt(1, value)` (tombstone + insert).
- `"0" in arr` and `Object.keys(arr)` use the current `length`.

Limitations:

- No sparse writes. Assigning beyond `length` throws.
- Negative indices are treated as normal object properties.
- `length` is derived from live nodes and is not writable.

## Compared to native Array

- Index writes are CRDT inserts rather than in-place mutation.
- Deletes keep history, so memory can grow until you compact.
- Many reads are O(n) because they rebuild the live view.

## Complexity notes

- `at` / index reads are O(n) because they rebuild the live view.
- `setAt` / index writes are O(n log n) because they insert and sort.
- `merge` is O(n log n) due to sorting after unioning snapshots.

## Distributed example

```js
import { CRArray } from "./class.js";

const alice = new CRArray();
const bob = new CRArray();

alice.push("a1", "a2");
bob.push("b1");

const aliceToBob = structuredClone(alice.snapshot());
const bobToAlice = structuredClone(bob.snapshot());

alice.merge(bobToAlice);
bob.merge(aliceToBob);

console.log([...alice]); // ["a1", "a2", "b1"] (order deterministic by id)
console.log([...bob]); // same order as alice
```

## Tests

`npm test` runs the node:test suite in `test/crarray.test.js`.

## Benchmarks

`npm run bench` runs `bench/crarray.bench.js`.

You can tune the run with environment variables:

- `SIZE=5000` (items per run)
- `RUNS=3` (number of samples)
- `READS=1000` (index reads per run)
- `WRITES=500` (index writes per run)
- `MERGE_SIZE=2000` (items per side for merge runs)

Sample output (RUNS=3, SIZE=5000, READS=1000, WRITES=500, MERGE_SIZE=2000):

```
CRArray bench (runs=3, size=5000, reads=1000, writes=500, mergeSize=2000)
CRArray push: avg 4375.58 ms (min 4317.00, max 4427.20)
Array push: avg 0.70 ms (min 0.34, max 1.15)
CRArray iterate: avg 3.19 ms (min 1.45, max 6.25)
Array iterate: avg 2.41 ms (min 0.05, max 6.34)
CRArray index read (proxy): avg 98.98 ms (min 81.73, max 109.10)
Array index read: avg 0.10 ms (min 0.10, max 0.11)
CRArray index write (proxy): avg 1042.63 ms (min 990.96, max 1083.57)
Array index write: avg 0.42 ms (min 0.09, max 1.03)
CRArray pop: avg 3173.61 ms (min 3058.66, max 3363.17)
Array pop: avg 1.21 ms (min 0.84, max 1.44)
CRArray merge: avg 42.27 ms (min 39.32, max 46.48)
```
