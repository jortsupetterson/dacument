# Channel Log

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
