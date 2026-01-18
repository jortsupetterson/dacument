You can add standardized framing around what already exists without touching merge behavior. The safest wins are documentation, cold‑path helpers, and optional metadata that does not affect acceptance of ops.

Low‑Risk Fits

Document op tokens as JWS Compact (RFC 7515) signed with ES256 over canonical JSON, and map the payload fields to JWT‑style semantics (iss, sub, iat) in README.md and README.md while keeping the implementation in crypto.ts and types.ts unchanged.
Add a RFC 7638 JWK thumbprint helper (no deps) and expose it for audits/logging; keep normalizeJwk/jwkEquals behavior unchanged in class.ts, but offer a standard keyId for external verification workflows.
Add JSON Schema for OpPayload, SignedOp, DocSnapshot, and AclAssignment in docs/ to standardize external validation without affecting runtime in types.ts.
Add optional Digest header helper for snapshots/ops (RFC 7165) as a utility for transports; no changes to merge logic in class.ts.
DID‑Focused Enhancements (No Behavior Change)

Add optional DID metadata fields (e.g., did, verificationMethod) to ACL entries as stored metadata only, not used for decisions, by extending AclAssignment in types.ts and carrying it through class.ts.
Add a cold‑path verifier hook for verifyActorIntegrity() that can resolve a DID and compare the resolved public key to the ACL‑pinned JWK; this keeps the hot path intact in class.ts.
VC‑Focused Enhancements (No Behavior Change)

Document a VC storage pattern (store VC JSON as record/map fields; verify outside merges) and provide a helper that verifies VC proofs only when the caller supplies canonicalized input. This avoids JSON‑LD dependencies while keeping the CRDT core unchanged in crypto.ts.
Optional: add detached JWS helper functions (RFC 7797) for verifying VC‑JWS‑2020 proofs if you already have canonicalized payloads; leave core signing/verification untouched in crypto.ts.
Things To Avoid If You Want Zero Behavior Change

Changing the kid semantics in tokens; it is currently used to encode signer role in class.ts and is part of signature validation.
Replacing stableStringify with JSON‑LD canonicalization or JCS for core ops; that changes token bytes and breaks historical signatures in crypto.ts.
If you want me to turn any of these into concrete changes, pick one:

Draft a “Standardized Tokens” doc section + JSON Schemas.
Add a JWK thumbprint helper and expose it for audits.
Add DID metadata fields and a cold‑path resolver hook for verifyActorIntegrity().
s
