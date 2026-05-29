# Migrating from 0.2 to 0.3

## Summary

`0.3.0` is a hardening + capability release. It fixes correctness bugs (most of
them in the Prisma adapter, where they shipped silently in `0.2.x`), closes two
authorization-soundness gaps, removes a performance cliff, and adds the ReBAC
APIs that were missing (batch check, reverse expansion, explainability,
attribute conditions, wildcards). The library is still **grants-only** and the
core `check()` answer is unchanged for correct `0.2.x` usage — but a few defaults
changed to be safe-by-default, so some call sites need attention.

Most projects need to do four things: **(1)** move the Prisma adapter import to
the `polizy/prisma-storage` subpath, **(2)** add the `@@unique` constraint to the
`PolizyTuple` model, **(3)** replace the `throwOnMaxDepth` option with
`maxDepthBehavior`, and **(4)** declare `fieldLevelObjects` if they relied on `#`
field ids. Everything else is opt-in.

## Required actions

### 1. Prisma adapter moved to the `polizy/prisma-storage` subpath

In `0.2.x` the Prisma adapter (`PrismaAdapter`) was exported from the **main**
`polizy` entry. In `0.3.0` it is exported **only** from the `polizy/prisma-storage`
subpath (so the core entry's types never pull in `@prisma/client`, an optional
peer). It's still a **factory function** — call it, no `new`.

```ts
// ❌ 0.2.x
import { PrismaAdapter } from "polizy";
const storage = PrismaAdapter(prisma);

// ✅ 0.3.0  (PrismaStorageAdapter is an alias of PrismaAdapter)
import { PrismaStorageAdapter } from "polizy/prisma-storage";
const storage = PrismaStorageAdapter(prisma);
```

`InMemoryStorageAdapter`, `AuthSystem`, `defineSchema`, and the type exports stay
on the main `polizy` entry.

### 2. Add the unique constraint to `PolizyTuple`

`0.3.0` makes writes **idempotent** via an upsert on the tuple key, which requires
a unique constraint:

```prisma
model PolizyTuple {
  id          String  @id @default(cuid())
  subjectType String
  subjectId   String
  relation    String
  objectType  String
  objectId    String
  condition   Json?

  @@unique([subjectType, subjectId, relation, objectType, objectId]) // ← add this
  @@index([subjectType, subjectId, relation])
  @@index([objectType, objectId, relation])
}
```

```bash
npx prisma generate
npx prisma migrate dev --name polizy_tuple_unique   # or: npx prisma db push
```

> `0.2.x` allowed **duplicate tuples**. If you have any, the unique migration
> fails until you dedupe. Remove duplicates first, e.g.
> `DELETE FROM "PolizyTuple" a USING "PolizyTuple" b WHERE a.id > b.id AND a."subjectType"=b."subjectType" AND a."subjectId"=b."subjectId" AND a.relation=b.relation AND a."objectType"=b."objectType" AND a."objectId"=b."objectId";`

### 3. `throwOnMaxDepth` → `maxDepthBehavior`

`0.2.x` had a `throwOnMaxDepth?: boolean` constructor option. `0.3.0` replaces it
with `maxDepthBehavior: "throw" | "deny"` and **defaults to `"throw"`** (a check
that exceeds `defaultCheckDepth` throws `MaxDepthExceededError` instead of
silently returning `false`). The default depth also rose from **10 → 20**.

```ts
// 0.2.x
new AuthSystem({ storage, schema, throwOnMaxDepth: false });

// 0.3.0
new AuthSystem({ storage, schema, maxDepthBehavior: "deny" });  // old silent-false behavior
// (omit it to get the new default: "throw")
```

### 4. Field-level ids are now opt-in

In `0.2.x`, **any** object id containing the separator (`#`) inherited access
from its prefix. In `0.3.0`, field-level identifiers only apply to object types
you list in `fieldLevelObjects` — secure by default.

```ts
const schema = defineSchema({
  objectTypes: ["document", "folder"],
  relations: { /* ... */ },
  actionToRelations: { /* ... */ },
  fieldLevelObjects: ["document"], // ← required if you use "document:doc1#field"
  // fieldSeparator: "#"  (default; still settable on the schema or the constructor)
});
```

If you relied on `#` inheritance and don't add this, those checks now return
`false`. If you did not intend `#` to be special, you're now safe by default.

### 5. `as` for multiple group / hierarchy relations

`0.3.0` supports **multiple** `group` and `hierarchy` relations. When a schema
declares more than one of a kind, the write APIs require `as` to disambiguate:

```ts
await authz.addMember({ member: user, group: team, as: "member" });
await authz.setParent({ child: doc, parent: folder, as: "folderParent" });
```

With exactly one group/hierarchy relation (the common case), `as` is inferred.
Omitting it when ambiguous throws a `SchemaError`.

### 6. `defineSchema` throws on bad models

An action mapping to an undefined relation (or `hierarchyPropagation`
referencing an undefined action) now throws a `SchemaError` at definition time
instead of `console.warn`. Fix dangling references.

### 7. No more `console` output

The library no longer writes to `console`. To surface depth/empty-filter
warnings, pass a logger: `new AuthSystem({ storage, schema, logger: console })`.

## New features (opt-in)

- **`checkMany(requests[])`** — answer many `(who, action, object)` questions in
  one call (e.g. filtering a fetched list) without an N+1 loop.
- **`checkOrThrow(request)`** — throws `NotAuthorizedError` instead of returning
  `false`.
- **`explain(request)`** — returns `{ allowed, via }` where `via` is the
  relation/group/hierarchy/wildcard/field path that produced the decision.
- **`listSubjects({ canThey, onWhat, ofType? })`** — reverse expansion: who can
  perform an action on an object (share dialogs / audits).
- **`allowMany(grants[])`** — bulk idempotent grants.
- **Wildcard / public subjects** — `import { everyone } from "polizy"` then
  `allow({ who: everyone("user"), ... })` grants to every subject of that type.
- **Attribute conditions (ABAC)** — `when: { attributes: [{ attribute, operator,
  value }] }` evaluated against the `context` passed to `check()`. Operators:
  `eq ne in nin gt gte lt lte`; dot-path attributes; combine with
  `validSince`/`validUntil`.
- **Pagination** — `listTuples(filter, { limit, offset })` and
  `listAccessibleObjects({ ..., limit, offset })`.

## Behavior / bug fixes (verify these)

- **Time-based grants work on Prisma.** In `0.2.x`, `validSince`/`validUntil`
  round-tripped through the JSON column as strings and made `check()` **throw**.
  They are now revived to `Date` and condition evaluation is fail-closed.
- **Revocation no longer over-deletes on Prisma.** `removeParent`,
  `removeMember`, and single-tuple `disallowAllMatching({ who, was, onWhat })`
  previously deleted extra tuples (the adapter dropped the `who` constraint).
  Both adapters now behave identically.
- **`allow()` is idempotent.** Re-granting the same `(subject, relation, object)`
  updates the condition instead of duplicating. Consequence: a temporary and a
  standing grant that differ **only** by condition can't coexist on the same
  triple — model "temporary + standing" with **distinct relations** (e.g.
  `viewer` standing, `temp_viewer` time-boxed).
- **No exponential blow-up.** `check()` memoizes within a single call, so
  deep/wide group and folder graphs resolve in roughly linear time.
- **`listAccessibleObjects` no longer full-scans** the tuple table; cost scales
  with the subject's reachable set.
- **Field access propagates via group and hierarchy**, not just direct grants.

## Deprecations

None. The model is still grants-only (no deny tuples) — a documented limitation.

## Quick checklist

- [ ] Move the Prisma adapter import to `polizy/prisma-storage` (factory; no `new`).
- [ ] Add `@@unique` to `PolizyTuple`; dedupe existing rows; migrate the DB.
- [ ] Replace `throwOnMaxDepth` with `maxDepthBehavior` (`"deny"` for the old behavior).
- [ ] Add `fieldLevelObjects` for any type using `#` field ids.
- [ ] Add `as: "..."` to member/parent writes if you declare >1 group/hierarchy relation.
- [ ] Fix any dangling relation/action references your schema had.
- [ ] Pass `logger` if you want warnings; stop relying on console output.
- [ ] (Optional) Adopt `checkMany`/`explain`/`listSubjects`/wildcards/ABAC.
