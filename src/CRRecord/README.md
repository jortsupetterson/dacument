# CRRecord

CRRecord is an observed-remove record (OR-Record) for string-keyed fields. Each
`set` adds a unique tag, deletes tombstone the tags they observed, and the
highest surviving tag id wins per field so replicas converge deterministically.

## API

- `onChange(listener): () => void` receives an array of accepted nodes.
- `snapshot(): CRRecordNode<V>[]` returns a copy of all nodes.
- `merge(snapshotOrNode): CRRecordNode<V>[]` accepts a snapshot array or single
  node patch and returns the accepted nodes.
- Record operations: `record[key] = value`, `delete record[key]`, `key in record`,
  and `Object.keys(record)` via Proxy.

## How it works

- `record[key] = value` emits a `set` node tagged with a unique id.
- `delete record[key]` emits a `del` node that tombstones observed tags.
- `merge(snapshotOrNode)` unions nodes by id and recomputes winners.

## Compared to native object

- Normal objects overwrite immediately. CRRecord replays tagged writes so
  concurrent updates converge across replicas.
- Deletes are safe to merge because they reference observed tags.

## Complexity notes

- `set` / `delete` are O(k) where k is the number of tags for a field.
- Property reads are O(1).
- `merge` is O(n) over incoming nodes.

## Distributed example

```js
import { CRRecord } from "./class.js";

const alice = new CRRecord();
const bob = new CRRecord();

alice.title = "Hello";
bob.title = "World";

const aliceToBob = structuredClone(alice.snapshot());
const bobToAlice = structuredClone(bob.snapshot());

alice.merge(bobToAlice);
bob.merge(aliceToBob);

console.log(alice.title, bob.title); // same winner by tag id
```

## Tests

`npm test` runs the node:test suite in `test/crrecord.test.js`.

## Benchmarks

`npm run bench:crrecord` runs `bench/crrecord.bench.js`.

You can tune the run with environment variables:

- `SIZE=20000` (entries per run)
- `READS=5000` (reads/deletes per run)
- `MERGE_SIZE=5000` (entries per side for merge runs)
- `RUNS=3` (number of samples)

Sample output (RUNS=3, SIZE=20000, READS=5000, MERGE_SIZE=5000):

```
CRRecord bench (runs=3, size=20000, reads=5000, mergeSize=5000)
CRRecord set: avg 83.10 ms (min 74.93, max 92.34)
Object set: avg 6.18 ms (min 4.39, max 7.69)
CRRecord get: avg 1.72 ms (min 1.20, max 2.20)
Object get: avg 1.41 ms (min 1.07, max 1.98)
CRRecord delete: avg 37.15 ms (min 35.74, max 38.05)
Object delete: avg 15.39 ms (min 13.37, max 18.07)
CRRecord merge: avg 16.85 ms (min 10.00, max 27.25)
```
