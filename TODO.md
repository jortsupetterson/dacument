# TODO

1. Fully replace, "change" event name to "delta", everywhere and in each reference "change" event MUST be changed to "delta";

2. This document is for maintainers of the `dacument` library. It outlines the required internal type changes to make sure users get **fully inferred**, **safe**, and **write-enabled** access to schema fields — without any type hacks, assertions, or workarounds.

---

## 🎯 Goal

When a user does:

```ts
const doc = await Dacument.load({ schema, snapshot, roleKey });
doc.flag = true; // ✅ register field — writable
doc.title = "..."; // ❌ text field — readonly, must use .insertAt etc.
```

…TypeScript must enforce that only `register` fields are writable. All schema fields must be type-inferred automatically from the given `schema`.

---

## 🔧 Step-by-Step: Internal Changes Required

### 1. **Update `DocFieldAccess` in `types.ts`**

#### Replace this:

```ts
export type DocFieldAccess<S extends SchemaDefinition> = {
  [K in keyof S]: FieldValue<S[K]>;
};
```

#### With this:

```ts
export type DocFieldAccess<S extends SchemaDefinition> =
  // Writable: all register fields
  {
    [K in keyof S as S[K]["crdt"] extends "register" ? K : never]: FieldValue<
      S[K]
    >;
  } & { // Readonly: all other CRDT field views
    readonly [K in keyof S as S[K]["crdt"] extends "register"
      ? never
      : K]: FieldValue<S[K]>;
  };
```

This makes only `"register"` fields writable at type level. Others remain accessible but readonly.

---

### 2. **Ensure `FieldValue` (in `types.ts`) Resolves JS Types Correctly**

```ts
export type FieldValue<F extends FieldSchema> = F["crdt"] extends "register"
  ? JsTypeValue<F["jsType"]>
  : F["crdt"] extends "text"
  ? TextView
  : F["crdt"] extends "array"
  ? ArrayView<JsTypeValue<F["jsType"]>>
  : F["crdt"] extends "set"
  ? SetView<JsTypeValue<F["jsType"]>>
  : F["crdt"] extends "map"
  ? MapView<JsTypeValue<F["jsType"]>>
  : F["crdt"] extends "record"
  ? Record<string, JsTypeValue<F["jsType"]>>
  : never;
```

> This mapping is already correct in most versions. Verify no fallback to `any`.

---

### 3. **No Changes Needed to Proxy Runtime**

The runtime `Proxy` logic already handles:

- `set` for register fields → valid
- `set` for anything else → throws at runtime
- ACL enforcement via `setRegisterValue()`

So this type fix only brings the type system in line with how the runtime behaves.

---

### 4. **Optional: Add Type Tests**

Create a `types.test-d.ts` file or similar and assert that:

```ts
doc.flag = true; // ✅ OK (register)
doc.notes = "something"; // ❌ TS error (text)
doc.notes.insertAt(0, "x"); // ✅ OK
doc.tags.add("tag"); // ✅ OK (set)
doc.tags = new Set(); // ❌ TS error
```

---

## ✅ Result

After this internal change:

- No more `as any`, no `Writable<T>`, no TS-ignore needed
- Editor shows correct types and methods
- Runtime behavior and ACL stays intact

This makes `dacument` type-safe _by design_ — no more compromises.;
