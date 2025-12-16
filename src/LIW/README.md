# A UX-First LATEST-INTENTION-WINS (LIW) Model for Offline-Capable Distributed Registers

## Abstract

This document proposes a **best-effort LATEST-INTENTION-WINS (LIW)** conflict resolution model for simple single-value registers in distributed applications that support offline writes by default.

The model explicitly rejects global time correctness and instead incorporates **user experience (UX)** into logical decision-making. The objective is not formal correctness, but maximizing the probability that the user’s latest intent is preserved without silently destroying valid data.

This model is intentionally heuristic and production-oriented.

---

## Problem Statement

Many distributed systems rely on **Last-Write-Wins (LWW)** semantics for simple register values such as names, ages, statuses, or profile fields.

In offline-capable systems, timestamp-only LWW fails due to:

- clock skew and drift
- message reordering and retries
- delayed synchronization of offline writes
- lack of a global time source

At the same time, **pure logical clocks** (Lamport clocks, vector clocks) do not serve user intent in overwrite-style fields, because they encode causality rather than when the user intended the value to be current.

The goal is **not to guarantee correctness**, but to **maximize the probability of honoring the user’s latest intention**, while avoiding destructive overwrites.

---

## Scope and Assumptions

- **Data type:** single-value register
- **Conflict policy goal:** LATEST USER INTENT WINS
- **System:** distributed, multi-node, offline-capable
- Messages are normally received shortly after sending
- No centralized sequencer
- No requirement for total order
- Offline writes may be synchronized long after creation

---

## Available Signals

Each competing write carries exactly the following information:

- `registerCurrentValueTimestamp`
- `receivedCompetingValueTimestamp`
- `receivedWasOnlineAtWrite` (boolean)

No additional coordination, logical clocks, or thresholds are assumed.

---

## Key Observation

The **only abnormal situation** requiring reasoning is when:

`receivedCompetingValueTimestamp < registerCurrentValueTimestamp`

If the received timestamp is greater than or equal to the current value timestamp, the decision is trivial.

The entire problem reduces to classifying the _older timestamp_ case without pretending to know the truth.

---

## Proposed LIW Decision Model

### Core Algorithm

    if receivedTs > registerTs:
        overwrite
        return

    # receivedTs < registerTs → anomaly

    if receivedWasOnlineAtWrite == true:
        raise conflict or merge
        return

    # offline + older timestamp
    ignore and push newer value

---

## Rationale

### Case 1: Newer Timestamp

If `receivedTs > registerTs`, the write is assumed to be the latest user intent and **always overwrites** the existing value.

---

### Case 2: Online Write with Older Timestamp

If the write was created while online but carries an older timestamp, clock skew, retries, or reordering are plausible explanations.

Automatically ignoring such writes risks discarding the user’s actual latest intent.  
The correct UX action is to **surface a conflict, offer a merge, or request user confirmation**.

---

### Case 3: Offline Write with Older Timestamp

If the write was created offline and has an older timestamp, clock skew is not a credible explanation.  
The intent is genuinely older and should **not override newer state**.

The correct action is to ignore the write and **push the newer value back to the offline node**.

---

## Why No Time Thresholds Are Used

- Time ranges may span minutes or years
- Any fixed delta introduces arbitrary failure modes
- Thresholds confuse drift with intent
- Guessing “how much time is enough” is unreliable

This model reasons about **conditions**, not durations.

---

## UX as Part of Logical Reasoning

This model treats UX as a **first-class component of logic**:

- Automatic decisions are made only when confidence is high
- Uncertainty is surfaced rather than hidden
- The system does not claim to know the truth when it does not

UX becomes part of logic when uncertainty is acknowledged instead of concealed.

---

## Properties of the Model

This LIW model:

- Uses wall-clock timestamps
- Uses online/offline state as a causal signal
- Does not assume global time correctness
- Does not require coordination
- Does not silently overwrite user intent under uncertainty
- Scales to long offline periods
- Is safe for production use in simple register fields

---

## Limitations

- Does not guarantee correctness
- Does not provide total order
- Cannot resolve ambiguity without user involvement
- Requires additional signals (e.g., per-device sequence) for stronger guarantees

These limitations are explicit and intentional.

---

## Conclusion

For simple register values in offline-capable distributed applications, **pure LWW is insufficient and pure logical clocks are misaligned with user intent**.

This document defines a **logically optimal best-effort compromise**:

- overwrite when certainty exists
- surface conflict when uncertainty exists
- ignore when intent is clearly stale

Anything stronger requires more information.  
Anything simpler hides failure.

This is not a correctness model.  
It is a **user-intent-preserving model for reality**.
