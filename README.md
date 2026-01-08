# CRDT Building Blocks

This folder contains conflict-free data types with a consistent, minimal API
designed for easy syncing and patch forwarding.

## Common API

Every CR class exposes the same three CRDT methods:

- `onChange(listener): () => void` receives an array of accepted nodes.
- `snapshot(): Node[]` returns a copy of all nodes (or `[winner]` for registers).
- `merge(snapshotOrNode): Node[]` accepts a snapshot array or single node patch.

## Classes

- `CRArray` - array-like RGA with Proxy index access.
- `CRText` - text RGA built on DAG nodes.
- `CRMap` - observed-remove map (OR-Map).
- `CRSet` - observed-remove set (OR-Set).
- `CRRecord` - observed-remove record (Proxy object).
- `CRRegister` - last-writer-wins register with HLC stamps.

## Patch flow

Forward changes by relaying `onChange` patches, or ship full snapshots when a
replica joins:

```js
const stop = doc.onChange((patches) => {
  peer.merge(structuredClone(patches));
});

peer.merge(structuredClone(doc.snapshot()));
```

## Tests and benchmarks

- `npm test` runs the node:test suite.
- `npm run bench` and `npm run bench:*` run per-type benchmarks.
