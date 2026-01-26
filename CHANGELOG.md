# Change Log

## 2.0.0

- Rename the sync event from `change` to `delta` and update event payload types.
- Make non-register fields readonly at the type level while keeping register fields writable.
- Add Playwright browser coverage plus TypeScript inference checks.

## 1.2.2

- Make `computeSchemaId` private to keep the public API surface tighter.
- Add `noImplicitReturns` to strengthen TypeScript checking.
- Align record mutation helper returns with other CRDT helpers.
- Document which type-safety refactors were deferred and why.

## 1.2.1

- Speed up CRArray/CRText indexing, writes, and slices by reducing allocations and sort overhead.
- Clarify actor-signed acks, ACL-pinned actor keys, and map key constraints in docs.
- Align CRDT README benchmark commands with `npm run bench` and direct bench scripts.

## 1.2.0

- Add access reset flow with signed reset ops and reset events.
- Block post-reset writes, preserve snapshots, and expose reset status.
- Add access-reset benchmarks and end-to-end reset tests.

## 1.1.0

- Add `setActorInfo` with per-actor ES256 keys and validation.
- Auto-attach actor public keys to ACL entries and support self-revocation.
- Add cold-path actor integrity verification (`verifyActorIntegrity`).
- Extend tests, simulation, and benchmarks for actor identity coverage.

## 1.0.1

- Prevent managers from changing owner roles in ACL updates.
- Document threat model guidance (key compromise, shared keys, DoS, withholding).
- Add regression coverage for manager/owner ACL protection.
