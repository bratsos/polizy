---
name: polizy-troubleshooting
description: Debug and fix polizy authorization issues. Use when permission checks fail unexpectedly, errors occur, or authorization behavior is confusing. Covers check algorithm, common issues, and anti-patterns.
license: MIT
metadata:
  author: bratsos
  version: "0.3.0"
  repository: https://github.com/bratsos/polizy
---

# Polizy Troubleshooting

Debug authorization issues when things don't work as expected.

## When to Apply

- User says "permission check not working"
- User says "user can't access X but should"
- Error messages from polizy
- User confused about why authorization behaves a certain way
- `check()` returns `false` unexpectedly
- `check()` throws `MaxDepthExceededError`
- `addMember`/`setParent` throws "multiple group/hierarchy relations"
- A temporary grant seems to have replaced a standing one

## First Move: Use `explain()`

Before tracing tuples by hand, ask the engine. `explain()` returns the exact path
that produced (or failed to produce) the decision:

```typescript
const why = await authz.explain({ who: alice, canThey: "edit", onWhat: doc });
// { allowed: true, via: { kind: "group", relation: "member",
//     through: { type: "team", id: "alpha" }, via: { kind: "direct", relation: "editor" } } }

// Denied?
// { allowed: false, via: null }  → no granting path exists
```

`via` is a nested node whose `kind` is one of `direct`, `wildcard`, `group`,
`hierarchy`, or `field`. If `allowed` is `false`, no path exists — the rest of
this skill explains why a path you *expected* doesn't exist.

## Quick Diagnosis Flowchart

```
check() returns false unexpectedly
         │
         ▼
Is the relation in actionToRelations?
    │           │
   NO           YES
    │            │
    ▼            ▼
ADD IT      Is there a group relation?
             │           │
            NO           YES
             │            │
             ▼            ▼
    (Direct check)    Is user in group?
             │            │
             ▼           NO → Check addMember()
    Is tuple           YES
    present?            │
       │                ▼
      NO              Does group have permission?
       │                │
       ▼               NO → Check group's allow()
    Add with          YES
    allow()            │
                       ▼
              Hierarchy + condition?
                       │
                       ▼
       (depth exceeded → MaxDepthExceededError thrown,
        not a silent false — see Common Issue 5)
```

> Run `explain()` first — it pinpoints the missing edge faster than walking this
> tree by hand. The flowchart is the manual fallback.

## Common Issues

### 1. Relation Not Mapped to Action

**Symptom:** `check()` returns `false` even with permission granted.

```typescript
// Schema
actionToRelations: {
  view: ["viewer"],  // "editor" missing!
  edit: ["editor"],
}

// Grant
await authz.allow({ who: alice, toBe: "editor", onWhat: doc });

// Check
await authz.check({ who: alice, canThey: "view", onWhat: doc }); // false!
```

**Fix:** Add relation to action's array:

```typescript
actionToRelations: {
  view: ["viewer", "editor"],  // Now editors can view
  edit: ["editor"],
}
```

### 2. Missing Group Relation

**Symptom:** `addMember()` throws `SchemaError`.

```typescript
// Schema missing group type
relations: {
  viewer: { type: "direct" },
}

await authz.addMember({ member: alice, group: team });
// SchemaError: Schema does not define any relation with type 'group'.
```

**Fix:** Add group relation:

```typescript
relations: {
  viewer: { type: "direct" },
  member: { type: "group" },  // Add this
}
```

### 2b. Ambiguous Group / Hierarchy Relation

**Symptom:** `addMember()`/`setParent()` throws when the schema has **more than
one** group or hierarchy relation.

```typescript
relations: {
  member: { type: "group" },
  orgMember: { type: "group" },  // two group relations
}

await authz.addMember({ member: alice, group: team });
// SchemaError: Schema declares multiple 'group' relations (member, orgMember);
//              specify which via 'as'.
```

**Fix:** Pass `as` to disambiguate (required on `addMember`, `removeMember`,
`setParent`, `removeParent`). With exactly one relation of that kind, `as` is
inferred and can be omitted.

```typescript
await authz.addMember({ member: alice, group: team, as: "member" });
await authz.setParent({ child: doc, parent: folder, as: "folderParent" });
```

### 3. Missing Hierarchy Propagation

**Symptom:** Parent permission doesn't flow to children.

```typescript
// Schema
relations: {
  parent: { type: "hierarchy" },
  viewer: { type: "direct" },
},
// Missing hierarchyPropagation!

await authz.setParent({ child: doc, parent: folder });
await authz.allow({ who: alice, toBe: "viewer", onWhat: folder });
await authz.check({ who: alice, canThey: "view", onWhat: doc }); // false!
```

**Fix:** Add `hierarchyPropagation`:

```typescript
hierarchyPropagation: {
  view: ["view"],  // Now view propagates
}
```

### 4. User Not in Group

**Symptom:** Group has permission but user can't access.

**Debug:**

```typescript
// Check group membership
const memberships = await authz.listTuples({
  subject: { type: "user", id: "alice" },
  relation: "member",
});
console.log("Alice's groups:", memberships);
```

**Fix:** Add user to group:

```typescript
await authz.addMember({ member: alice, group: team });
```

### 5. Max Depth Exceeded

**Symptom:** `check()` **throws** `MaxDepthExceededError` on a deep group or
hierarchy chain.

In 0.3.0 the default is `maxDepthBehavior: "throw"` and `defaultCheckDepth: 20`
(was a silent `false` at depth 10 in 0.2.x and earlier). Throwing is intentional — a chain
that long usually signals a data problem (e.g. an accidental cycle the cycle
guard didn't short-circuit into a clean result, or genuinely over-nested groups).

**Inspect the failure:**

```typescript
try {
  await authz.check({ who: alice, canThey: "view", onWhat: doc });
} catch (error) {
  if (error instanceof MaxDepthExceededError) {
    console.log("Depth:", error.depth);     // where it bailed
    console.log("Subject:", error.subject);
    console.log("Action:", error.action);
    console.log("Object:", error.object);
  }
}
```

**Fix (pick one):**

```typescript
// a) The chain is legitimately long — raise the limit.
const authz = new AuthSystem({ storage, schema, defaultCheckDepth: 40 });

// b) You want the old silent-deny behavior instead of a throw.
const authz = new AuthSystem({ storage, schema, maxDepthBehavior: "deny" });

// c) Best: flatten the data so chains stay short (2-3 hops).
```

### 6. Time-Based Condition Not Valid

**Symptom:** Permission granted with `when` but check fails.

**Debug:**

```typescript
const tuples = await authz.listTuples({
  subject: alice,
  object: doc,
});

for (const tuple of tuples) {
  console.log("Condition:", tuple.condition);
  if (tuple.condition?.validSince) {
    console.log("Starts:", tuple.condition.validSince);
  }
  if (tuple.condition?.validUntil) {
    console.log("Expires:", tuple.condition.validUntil);
  }
}
```

**Common causes:**
- `validSince` is in the future
- `validUntil` is in the past
- The grant carries `attributes` predicates but you didn't pass a matching
  `context` to `check()` — a missing/mismatched context value fails closed (denies).
  See COMMON-ISSUES Issue 11.

> On 0.2.x and earlier, time conditions stored via the Prisma adapter round-tripped as
> strings and made `check()` **throw**. That is fixed in 0.3.0 (dates are
> revived). If you previously avoided conditions on Prisma, re-check on 0.3.0.

### 7. Temporary Grant Replaced a Standing Grant

**Symptom:** You granted a permanent `viewer`, then later granted a time-boxed
`viewer` with `when`. When the time box expires, the user loses access entirely.

**Cause:** `allow()` is idempotent on `(subject, relation, object)` in 0.3.0.
Re-granting the *same* triple updates its condition instead of adding a second
tuple — the temporary `when` overwrote the standing grant.

**Fix:** Use **distinct relations** for temporary vs standing access.

```typescript
// Standing access (no condition)
await authz.allow({ who: alice, toBe: "viewer", onWhat: doc });

// Temporary access on a SEPARATE relation
await authz.allow({ who: alice, toBe: "temp_viewer", onWhat: doc,
  when: { validUntil: in1Hour } });

// Both map to the view action:
// actionToRelations: { view: ["viewer", "temp_viewer", "editor", "owner"] }
```

When `temp_viewer` expires, the standing `viewer` tuple is untouched.

## Debugging Techniques

### 1. List All Tuples for Subject

```typescript
const tuples = await authz.listTuples({
  subject: { type: "user", id: "alice" },
});

console.log("Alice's permissions:");
for (const tuple of tuples) {
  console.log(`  ${tuple.relation} on ${tuple.object.type}:${tuple.object.id}`);
}
```

### 2. List All Tuples for Object

```typescript
const tuples = await authz.listTuples({
  object: { type: "document", id: "doc1" },
});

console.log("Permissions on doc1:");
for (const tuple of tuples) {
  console.log(`  ${tuple.subject.type}:${tuple.subject.id} is ${tuple.relation}`);
}
```

### 3. Trace Group Membership

```typescript
async function traceGroupPath(userId: string) {
  const user = { type: "user", id: userId };
  const groups: string[] = [];

  const directMemberships = await authz.listTuples({
    subject: user,
    relation: "member",
  });

  for (const tuple of directMemberships) {
    groups.push(`${tuple.object.type}:${tuple.object.id}`);

    // Check nested groups
    const nestedMemberships = await authz.listTuples({
      subject: tuple.object,
      relation: "member",
    });

    for (const nested of nestedMemberships) {
      groups.push(`  → ${nested.object.type}:${nested.object.id}`);
    }
  }

  return groups;
}

console.log("Group path:", await traceGroupPath("alice"));
```

### 4. Trace Hierarchy Path

```typescript
async function traceHierarchyPath(objectType: string, objectId: string) {
  const path: string[] = [`${objectType}:${objectId}`];
  let current = { type: objectType, id: objectId };

  while (true) {
    const parentTuples = await authz.listTuples({
      subject: current,
      relation: "parent",
    });

    if (parentTuples.length === 0) break;

    const parent = parentTuples[0].object;
    path.push(`${parent.type}:${parent.id}`);
    current = parent;
  }

  return path;
}

console.log("Hierarchy:", await traceHierarchyPath("document", "doc1"));
// ["document:doc1", "folder:subfolder", "folder:root"]
```

### 5. Enable Logging

**0.3.0 writes nothing to `console` by default.** If your old debugging relied on
polizy printing depth/empty-filter warnings, those are gone — pass a `logger` to
surface them.

```typescript
const debugLog: string[] = [];

const authz = new AuthSystem({
  storage,
  schema,
  logger: {
    warn: (msg, meta) => {
      debugLog.push(msg);
      console.warn("[Polizy]", msg, meta);
    },
    error: (msg, meta) => console.error("[Polizy]", msg, meta),
  },
});

// The library logs (via logger.warn) when:
//  - a depth cutoff is hit with maxDepthBehavior: "deny"
//  - disallowAllMatching is called with an empty filter (deletes nothing)
```

### 6. Explain a Decision

Skip manual tracing — let the engine produce the path:

```typescript
console.dir(await authz.explain({ who: alice, canThey: "edit", onWhat: doc }),
  { depth: null });
```

See [CHECK-ALGORITHM.md](references/CHECK-ALGORITHM.md) for how to read the
`via` node kinds (`direct`, `wildcard`, `group`, `hierarchy`, `field`).

## Error Reference

All errors extend `PolizyError`; import the specific classes from `"polizy"`.

| Error | Cause | Fix |
|-------|-------|-----|
| `SchemaError: Relation 'X' is not defined in the schema.` | `allow`/`writeTuple` with an undefined relation | Add relation to `relations` |
| `SchemaError: Schema does not define any relation with type 'group'.` | `addMember` with no group relation | Add `member: { type: "group" }` |
| `SchemaError: Schema does not define any relation with type 'hierarchy'.` | `setParent` with no hierarchy relation | Add `parent: { type: "hierarchy" }` |
| `SchemaError: Schema declares multiple 'group'/'hierarchy' relations (...); specify which via 'as'.` | >1 group/hierarchy relation, `as` omitted | Pass `as: "<relation>"` |
| `SchemaError` from `defineSchema` | Action maps to an undefined relation, or `hierarchyPropagation` references an undefined action | Fix the dangling reference |
| `SchemaError: Invalid field id '...'` | Empty base or field around the separator on a field-enabled type | Use `base#field` with both non-empty |
| `MaxDepthExceededError` | Group/hierarchy chain exceeds `defaultCheckDepth` | Raise depth, fix data, or `maxDepthBehavior: "deny"` |
| `NotAuthorizedError` | `checkOrThrow` denied | Expected — catch it and return 403 |
| `ConfigurationError: Storage adapter is required.` | Missing `storage` | Provide storage in constructor |
| `ConfigurationError: Authorization schema is required.` | Missing `schema` | Provide schema in constructor |
| `StorageError` | Adapter operation failed (e.g. Prisma DB error) | Inspect `.cause`; check DB/migration |

## Anti-Patterns to Avoid

See [ANTI-PATTERNS.md](references/ANTI-PATTERNS.md) for detailed explanations:

1. **Duplicating permissions across users** - Use groups
2. **Deep group nesting** - Keep 2-3 levels
3. **Generic relation names** - Use semantic names
4. **Checking after action** - Check before
5. **Not handling authorization errors** - Show feedback
6. **Expecting deny tuples** - The model is grants-only; revoke or narrow scope
7. **`#` in ids without `fieldLevelObjects`** - Field ids are opt-in in 0.3.0
8. **One relation for temp + standing access** - `allow()` is idempotent; use distinct relations

## References

- [CHECK-ALGORITHM.md](references/CHECK-ALGORITHM.md) - How check() works internally
- [COMMON-ISSUES.md](references/COMMON-ISSUES.md) - Detailed issue solutions
- [ANTI-PATTERNS.md](references/ANTI-PATTERNS.md) - What NOT to do

## Related Skills

- [polizy-schema](../polizy-schema/SKILL.md) - Schema design
- [polizy-patterns](../polizy-patterns/SKILL.md) - Implementation patterns
