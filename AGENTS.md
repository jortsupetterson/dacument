# AGENTS.md — Coding Agent Instructions for this Repository

This repository is optimized for **AI coding agents (e.g. Codex)** working on a **performance-critical, security-sensitive TypeScript CRDT library**.  
Agents are expected to behave like senior maintainers, not code generators.

---

## 1. Environment & Language Constraints

- **Node.js ≥ 18, ESM only** (`"type": "module"`).
- **TypeScript-first**, no legacy JS patterns.
- Assume **browser + worker compatibility** where applicable.
- Do not introduce transpilation assumptions or polyfills.

**Rationale:** The code relies on modern Web APIs (WebCrypto, structured clone, workers). Downgrades break guarantees.

---

## 2. Dependency Policy (Very Strict)

- **Do not add dependencies** unless absolutely unavoidable.
- Reuse existing utilities (`bytecodec`, `zeyra`, internal helpers).
- Prefer standard library and handwritten utilities.

**Rationale:** Minimal surface area = better security, auditability, and performance.

---

## 3. Architectural Rules (Non-Negotiable)

- This is a **CRDT system**: operations must be **commutative, mergeable, deterministic**.
- **Never bypass merge logic, tombstone handling, or signature verification.**
- Public API stability is critical — **no breaking changes** without explicit intent.
- Large classes (e.g. core document types) are intentionally centralized — **do not refactor structurally** without necessity.

**Rationale:** Small deviations silently corrupt distributed state.

---

## 4. Security & Trust Model

- All writes are **signed and verified**. Never weaken this.
- Role / ACL enforcement must remain strict.
- Assume **untrusted input at all boundaries** (network, merge, snapshot).
- Cryptography is intentional — do not “simplify” it.

**Rationale:** Security is a core feature, not an add-on.

---

## 5. Performance Expectations

- Treat hot paths as **real-time code**.
- Avoid unnecessary allocations, closures, proxies, or abstractions.
- If modifying CRDT internals, **benchmark before and after**.
- Regressions are unacceptable unless explicitly justified.

**Rationale:** CRDT overhead compounds quickly at scale.

---

## 6. Coding Style & Conventions

- Match existing formatting and naming exactly.
- Use **explicit, descriptive errors** prefixed with context.
- Avoid JavaScript private fields (`#field`) where proxies are involved.
- No speculative abstractions. No cleverness without payoff.

**Rationale:** Consistency prevents subtle runtime failures.

---

## 7. Testing & Verification

Before considering work “done”, ensure:

- `npm run verify` passes.
- Relevant tests are added or updated.
- Edge cases (merge conflicts, deletes, replays) are covered.

**Rationale:** Tests are part of the contract.

---

## 8. Documentation & Changelog

- Update documentation when behavior changes.
- Add entries to `CHANNELLOG.md` for meaningful changes.
- Follow semantic versioning expectations.

**Rationale:** Users rely on documented guarantees.

---

## 9. Agent Mindset

You are expected to:

- Think in **distributed systems invariants**
- Optimize for **correctness > performance > elegance**
- Assume future merges, forks, and adversarial input
- Act like a long-term maintainer

If unsure, **do nothing rather than guess**.

---

**This repository rewards restraint, precision, and respect for invariants.**
