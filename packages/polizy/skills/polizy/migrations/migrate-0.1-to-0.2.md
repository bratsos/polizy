# Migrating from 0.1 to 0.2

## Summary

`0.2.0` is a hardening + capability release. It fixes correctness bugs (most of
them in the Prisma adapter, where they were silently shipping), closes two
authorization-soundness gaps, removes a performance cliff, and adds the ReBAC
APIs that were missing (batch check, reverse expansion, explainability,
attribute conditions, wildcards). The library is still **grants-only** and the
core `check()` semantics are unchanged for correct 0.1.x usage — but several
defaults changed to be safe-by-default, so a few call sites need attention.

Most projects need to do three things: **(1)** fix the Prisma adapter import +
add a unique constraint, **(2)** declare `fieldLevelObjects` if they used `#`
field ids, and **(3)** pass `as` to `addMember`/`setParent` if their schema has
more than one group/hierarchy relation. Everything else is opt-in.

## Required actions

### 1. Prisma adapter: import path, factory call, and unique constraint

The persistent adapter is exported from the `polizy/prisma-storage` subpath (so
the core entry never pulls in `@prisma/client`) and is a **factory function**,
not a class.

```ts
// ❌ 0.1.x (this never actually existed as documented)
import { PrismaStorageAdapter } from "polizy";
const storage = new PrismaStorageAdapter(prisma);

// ✅ 0.2.0
import { PrismaStorageAdapter } from "polizy/prisma-storage"; // alias of PrismaAdapter
const storage = PrismaStorageAdapter(prisma); // call it — no `new`
```

Add the **unique constraint** to your `PolizyTuple` model — it is now required
for idempotent writes (the adapter upserts on this key):

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

Then run a schema migration so the constraint exists in the database:

```bash
npx prisma generate
npx prisma migrate dev --name polizy_tuple_unique   # or: npx prisma db push
```

> If you have **duplicate tuples** from 0.1.x (which allowed them), the unique
> migration will fail until you dedupe. Delete duplicates first, e.g.
> `DELETE FROM "PolizyTuple" a USING "PolizyTuple" b WHERE a.id > b.id AND a."subjectType"=b."subjectType" AND a."subjectId"=b."subjectId" AND a.relation=b.relation AND a."objectType"=b."objectType" AND a."objectId"=b."objectId";`

### 2. Field-level ids are now opt-in

In 0.1.x, **any** object id containing the separator (`#`) inherited access from
its prefix — a privilege-bleed risk for ids that naturally contain `#`. In
0.2.0, field-level identifiers only apply to object types you list in
`fieldLevelObjects`.

```ts
const schema = defineSchema({
  objectTypes: ["document", "folder"],
  relations: { /* ... */ },
  actionToRelations: { /* ... */ },
  fieldLevelObjects: ["document"], // ← required if you use "document:doc1#field"
  // fieldSeparator: "#"  (default)
});
```

If you relied on `#` inheritance and don't add this, those checks now return
`false`. If you did **not** intend `#` to be special, you're now safe by default.

### 3. `as` for multiple group / hierarchy relations

0.2.0 supports **multiple** `group` and `hierarchy` relations. When a schema
declares more than one of a kind, the write APIs can no longer guess which to
use, so pass `as`:

```ts
// schema has two group relations: `member` and `orgMember`
await authz.addMember({ member: user, group: team, as: "member" });   // ← `as` required
await authz.setParent({ child: doc, parent: folder, as: "folderParent" });
```

With exactly one group/hierarchy relation (the common case), `as` is inferred —
no change needed. Omitting `as` when it's ambiguous throws a `SchemaError`.

### 4. Depth-exceeded now throws

`check()` past `defaultCheckDepth` (now defaults to **20**, was 10) throws
`MaxDepthExceededError` instead of silently returning `false`. To keep the old
silent-deny behavior:

```ts
const authz = new AuthSystem({ storage, schema, maxDepthBehavior: "deny" });
```

### 5. `defineSchema` throws on bad models

An action mapping to an undefined relation (or `hierarchyPropagation`
referencing an undefined action) now throws a `SchemaError` at definition time
instead of `console.warn`. Fix dangling references in your schema.

### 6. No more `console` output

The library no longer writes to `console`. If you want the depth/empty-filter
warnings, pass a logger:

```ts
new AuthSystem({ storage, schema, logger: console });
```

## New features (opt-in)

- **`checkMany(requests[])`** — answer many `(who, action, object)` questions in
  one call (e.g. filtering a fetched list) without an N+1 loop.
- **`checkOrThrow(request)`** — throws `NotAuthorizedError` instead of returning
  `false`.
- **`explain(request)`** — returns `{ allowed, via }` where `via` is the
  relation/group/hierarchy/wildcard/field path that produced the decision.
- **`listSubjects({ canThey, onWhat, ofType? })`** — reverse expansion: who can
  perform an action on an object (for share dialogs / audits).
- **`allowMany(grants[])`** — bulk idempotent grants.
- **Wildcard / public subjects** — `import { everyone } from "polizy"` then
  `allow({ who: everyone("user"), ... })` grants to every subject of that type.
- **Attribute conditions (ABAC)** — `when: { attributes: [{ attribute, operator,
  value }] }` evaluated against the `context` passed to `check()`. Operators:
  `eq ne in nin gt gte lt lte`; `attribute` supports dot-paths. Combine with the
  existing `validSince`/`validUntil` time window.
- **Pagination** — `listTuples(filter, { limit, offset })` and
  `listAccessibleObjects({ ..., limit, offset })`.
- **Constructor options** — `defaultCheckDepth`, `maxDepthBehavior`, `logger`,
  `fieldSeparator` (overrides the schema's).

## Behavior / bug fixes (verify these)

- **Time-based grants work on Prisma.** In 0.1.x, `validSince`/`validUntil`
  round-tripped through the JSON column as strings and made `check()` **throw**.
  They are now revived to `Date` and `isConditionValid` is fail-closed. If you
  avoided conditions on Prisma because they crashed, they now work.
- **Revocation no longer over-deletes on Prisma.** `removeParent`,
  `removeMember`, and single-tuple `disallowAllMatching({ who, was, onWhat })`
  previously deleted extra tuples (e.g. a parent's own parent link) because the
  adapter dropped the `who` constraint. Both adapters now behave identically.
- **`allow()` is idempotent.** Re-granting the same `(subject, relation, object)`
  updates the condition instead of creating a duplicate. Consequence: a temporary
  and a standing grant that differ **only** by condition can't coexist on the same
  triple — model "temporary + standing" with **distinct relations** (e.g.
  `viewer` standing, `temp_viewer` time-boxed).
- **No exponential blow-up.** `check()` now memoizes within a single call, so
  deep/wide group and folder graphs resolve in roughly linear time instead of
  re-traversing shared subgraphs.
- **`listAccessibleObjects` no longer full-scans** the tuple table; cost scales
  with the subject's reachable set.
- **Field access propagates via group and hierarchy**, not just direct grants —
  a folder viewer can now reach `doc#field` of documents in that folder.

## Deprecations

None. The model is still grants-only (no deny tuples) — documented as a
limitation, not a deprecation.

## Quick checklist

- [ ] Update Prisma import to `polizy/prisma-storage`; call the factory (no `new`).
- [ ] Add `@@unique` to `PolizyTuple`; dedupe existing rows; migrate the DB.
- [ ] Add `fieldLevelObjects` for any type using `#` field ids.
- [ ] Add `as: "..."` to member/parent writes if you declare >1 group/hierarchy relation.
- [ ] Set `maxDepthBehavior: "deny"` if you relied on silent depth denial.
- [ ] Fix any dangling relation/action references your schema had.
- [ ] Pass `logger` if you want warnings; remove assumptions about console output.
- [ ] (Optional) Adopt `checkMany`/`explain`/`listSubjects`/wildcards/ABAC.
