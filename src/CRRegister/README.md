# CRRegister

CRRegister is a Last-Writer-Wins register using a hybrid logical clock (HLC).
Each write carries a stamp `{ wallTimeMs, logical, clockId }` so concurrent
updates converge deterministically.

## API

- `onChange(listener): () => void` receives the winning node when it changes.
- `snapshot(): CRRegisterNode<T>[]` returns `[]` or `[winner]`.
- `merge(snapshotOrNode): CRRegisterNode<T>[]` accepts a snapshot array or
  single node patch and returns accepted nodes.
- `set(value, stamp?)` stores a value with a local or remote stamp.
- `get()` returns the current winner or `null`.

## How it works

- `set(value, stamp?)` stores the value and stamp.
- If no stamp is provided, a local HLC stamp is generated.
- When a remote stamp is provided, the local HLC is advanced so time stays
  monotonic.
- Winners are chosen by HLC order: `wallTimeMs`, then `logical`, then `clockId`.

## Compared to native value

- Normal variables overwrite immediately. CRRegister keeps only the winning
  value, but uses stamps to resolve conflicts across replicas.
- Concurrent writes converge deterministically without coordination.

## Complexity notes

- `set` is O(1).
- `get` is O(1).

## Distributed example

```js
import { CRRegister } from "./class.js";

const a = new CRRegister();
const b = new CRRegister();

const stop = a.onChange((patches) => {
  b.merge(patches);
});

a.set(true);
console.log(a.get()); // true
console.log(b.get()); // true after merge
stop();
```

## Tests

`npm test` runs the node:test suite in `test/crregister.test.js`.

## Benchmarks

`npm run bench:crregister` runs `bench/crregister.bench.js`.

You can tune the run with environment variables:

- `SIZE=100000` (updates per run)
- `RUNS=3` (number of samples)

Sample output (RUNS=3, SIZE=100000):

```
CRRegister bench (runs=3, size=100000)
CRRegister set (local): avg 21.63 ms (min 21.19, max 21.89)
CRRegister set (remote stamp): avg 13.91 ms (min 13.20, max 14.85)
Plain assignment: avg 0.32 ms (min 0.17, max 0.59)
```
