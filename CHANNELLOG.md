# Channel Log

## 1.1.0

- Add `setActorInfo` with per-actor ES256 keys and validation.
- Auto-attach actor public keys to ACL entries and support self-revocation.
- Add cold-path actor integrity verification (`verifyActorIntegrity`).
- Extend tests, simulation, and benchmarks for actor identity coverage.

## 1.0.1

- Prevent managers from changing owner roles in ACL updates.
- Document threat model guidance (key compromise, shared keys, DoS, withholding).
- Add regression coverage for manager/owner ACL protection.
