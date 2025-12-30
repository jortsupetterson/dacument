# A UX-First LATEST-INTENTION-WINS (LIW) Register

_For Offline-Capable Distributed User Interfaces_

## Abstract

This document defines a **LATEST-INTENTION-WINS (LIW)** conflict resolution model for **single-value primitive registers** in offline-capable **distributed user interfaces**.

LIW is a **UI-level intent preservation model**, not a general distributed systems consistency model.  
It prioritizes **user intent, UX clarity, and explicit decision-making** over formal correctness, global ordering, or silent conflict resolution.

This specification matches the `LIWRegister` implementation exactly.

---

## What This Model Is (and Is Not)

### This model **is** for:

- Offline-first UIs and PWAs
- Local-first applications
- Realtime forms, settings, and toggles
- Profile fields and preferences
- Human-authored intent synchronized across devices

### This model **is not** for:

- Database replication
- Backend-to-backend synchronization
- Financial or ledger systems
- Distributed consensus
- CRDT correctness guarantees

LIW assumes **humans**, **UIs**, and **imperfect clocks**.

---

## Scope and Assumptions

- **Layer:** UI / application state
- **Data type:** single-value register
- **Supported value types:** `string | number | boolean`
- **System:** multi-device, offline-capable UI
- No centralized sequencer
- No total order requirement
- Offline writes may synchronize arbitrarily late
- Merge semantics are **application-defined**

All unsupported value types are rejected at runtime.

---

## Environment Requirements

`LIWRegister` **requires a UI runtime** that provides:

- `navigator.onLine: boolean`

This signal indicates whether network connectivity was available **at the moment the value was written**.  
It is treated as a **UX-level causal hint**, not a correctness guarantee.

Construction **must fail** if this signal is unavailable.  
LIW is not defined for headless or backend-only runtimes.

---

## Available Signals

Each competing value carries exactly:

- `storedTimestamp`
- `receivedTimestamp`
- `receivedWasOnlineAtWrite` (`navigator.onLine` at creation time)

No logical clocks, counters, thresholds, or coordination metadata are assumed.

---

## Core Philosophy

**Assume the received value represents newer user intent by default.**  
Override this assumption **only when available signals make it unsafe**.

The system must be optimistic, but never destructive.

---

## Decision Model (Exact Semantics)

# Online + non-newer timestamp → uncertainty

if receivedWasOnlineAtWrite == true
and receivedTs <= storedTs:
invoke explicit conflict handler
return merged result

# Offline + non-newer timestamp → clearly stale

if receivedWasOnlineAtWrite == false
and receivedTs <= storedTs:
ignore and keep stored
return stored

# Default: accept received as newest intent

return received

---

## Immutability and API Semantics

`LIWRegister` exposes an **immutable-style API**.

- `resolveIntent()` **never mutates** the existing instance
- It returns either:

  - the same instance (`this`), or
  - a **new `LIWRegister` instance** representing the resolved intent

### Correct Usage

```js
register = await register.resolveIntent(received);
```

Ignoring the return value **does not update state**.

This design:

- prevents accidental side effects
- forces explicit state updates
- aligns with predictable UI state management

---

## Conflict Handling

- Conflict handling is **mandatory**
- Silent fallback is forbidden
- `onconflict` **must exist**
- `onconflict` **must return a new `LIWRegister`**
- Invalid returns are runtime errors

LIW does not guess merge semantics.
The UI/application owns reconciliation logic.

---

## Rationale

### Online + Older or Equal Timestamp

This represents **irreducible uncertainty**:

- equal timestamps cannot be ordered
- older timestamps may result from clock skew or reordering
- the user was online, so concurrent intent is plausible

Automatic overwrite or ignore would silently destroy intent.
The UI must surface this via an explicit conflict handler.

---

### Offline + Older or Equal Timestamp

This is treated as **clearly stale intent**.

The correct UX action is to keep the stored value and later push it back to the offline device.

No merge is attempted.

---

### Default Accept

If neither uncertainty nor staleness applies, the received value is accepted as the best available estimate of newer user intent.

This matches user expectation:

> “What I just changed should win.”

---

## Properties

This LIW model:

- operates strictly at the UI state layer
- uses wall-clock timestamps as heuristics
- uses online/offline state as a UX signal
- rejects global time correctness
- forbids silent intent loss
- scales to long offline periods
- preserves user trust

---

## Limitations

- No correctness guarantees
- No total ordering
- Not safe for backend replication
- Ambiguity requires UI-level resolution

These limitations are **intentional and explicit**.

---

## Conclusion

`LIWRegister` defines a **distributed UI intent model**, not a distributed systems consistency model.

It exists to answer one question only:

**“What is the least harmful thing to do for the user right now?”**

Anything stronger requires different tools.
Anything simpler hides failure.
