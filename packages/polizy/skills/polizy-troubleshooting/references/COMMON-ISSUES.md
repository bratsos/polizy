# Common Issues and Solutions

Detailed solutions for frequently encountered problems (polizy 0.3.0).

> **Fastest first step for any unexpected allow/deny:** call `explain()`. It
> returns `{ allowed, via }` where `via` is the exact granting path (or `null`).
> Most of the diagnosis below is only needed when `explain()` confirms the path
> you expected doesn't exist.

## Issue 1: check() Returns False When It Should Be True

### Symptom

Permission was granted but check fails:

```typescript
await authz.allow({ who: alice, toBe: "editor", onWhat: doc });
await authz.check({ who: alice, canThey: "view", onWhat: doc }); // false??
```

### Diagnosis Steps

1. **Ask the engine first:**
   ```typescript
   console.dir(await authz.explain({ who: alice, canThey: "view", onWhat: doc }),
     { depth: null });
   // allowed:false, via:null → no path. The steps below find the missing edge.
   ```

2. **Check action mapping:**
   ```typescript
   console.log(schema.actionToRelations.view);
   // Does it include "editor"?
   ```

3. **Verify tuple exists:**
   ```typescript
   const tuples = await authz.listTuples({ subject: alice, object: doc });
   console.log(tuples);
   ```

4. **Check for conditions:**
   ```typescript
   for (const tuple of tuples) {
     if (tuple.condition) {
       console.log("Condition:", tuple.condition);
       console.log("Now:", new Date());
     }
   }
   ```

### Solutions

**Missing relation in actionToRelations:**
```typescript
// Before
actionToRelations: { view: ["viewer"] }

// After
actionToRelations: { view: ["viewer", "editor"] }
```

**Condition not yet valid:**
```typescript
// Check if validSince is in the future
if (tuple.condition?.validSince && new Date(tuple.condition.validSince) > new Date()) {
  console.log("Permission not yet active");
}
```

**Condition expired:**
```typescript
// validUntil is exclusive: now >= validUntil means expired
if (tuple.condition?.validUntil && new Date(tuple.condition.validUntil) <= new Date()) {
  console.log("Permission expired");
}
```

**ABAC predicate, no matching context:** if the grant has `when.attributes`, you
must pass a `context` to `check()` that satisfies every predicate. A missing key
or type mismatch fails closed — see Issue 11.

---

## Issue 2: Group Membership Not Working

### Symptom

User is in group, group has permission, but user can't access:

```typescript
await authz.addMember({ member: alice, group: team });
await authz.allow({ who: team, toBe: "editor", onWhat: doc });
await authz.check({ who: alice, canThey: "edit", onWhat: doc }); // false??
```

### Diagnosis Steps

1. **Verify group relation exists:**
   ```typescript
   console.log(schema.relations.member);
   // Should be: { type: "group" }
   ```

2. **Verify membership tuple:**
   ```typescript
   const memberships = await authz.listTuples({
     subject: alice,
     relation: "member"
   });
   console.log("Alice is member of:", memberships);
   ```

3. **Verify group's permission:**
   ```typescript
   const groupPerms = await authz.listTuples({
     subject: team,
     object: doc
   });
   console.log("Team permissions:", groupPerms);
   ```

### Solutions

**Missing group relation in schema:**
```typescript
relations: {
  member: { type: "group" },  // Add this
  editor: { type: "direct" },
}
```

**Group relation not mapped to the action:** group membership only grants access
if the group's *granted relation* is in `actionToRelations[action]`. Confirm the
relation you granted the group (e.g. `editor`) covers the action you're checking.

**Multiple group relations, `as` omitted on write:** if the schema has more than
one group relation, `addMember` throws `SchemaError: Schema declares multiple
'group' relations (...); specify which via 'as'.` Pass `as`:
```typescript
await authz.addMember({ member: alice, group: team, as: "member" });
```

**Membership not created:**
```typescript
// Verify with listTuples, then add if missing
await authz.addMember({ member: alice, group: team });
```

**Wrong group type used:**
```typescript
// Wrong - using different type than what was granted
await authz.addMember({ member: alice, group: { type: "group", id: "team1" } });
await authz.allow({ who: { type: "team", id: "team1" }, ... }); // Different type!

// Correct - consistent types
await authz.addMember({ member: alice, group: { type: "team", id: "team1" } });
await authz.allow({ who: { type: "team", id: "team1" }, ... });
```

---

## Issue 3: Hierarchy Not Propagating

### Symptom

Parent has permission but child check fails:

```typescript
await authz.setParent({ child: doc, parent: folder });
await authz.allow({ who: alice, toBe: "viewer", onWhat: folder });
await authz.check({ who: alice, canThey: "view", onWhat: doc }); // false??
```

### Diagnosis Steps

1. **Check hierarchy relation exists:**
   ```typescript
   console.log(schema.relations.parent);
   // Should be: { type: "hierarchy" }
   ```

2. **Check hierarchyPropagation:**
   ```typescript
   console.log(schema.hierarchyPropagation);
   // Should include: { view: ["view"] }
   ```

3. **Verify parent relationship:**
   ```typescript
   const parents = await authz.listTuples({
     subject: doc,
     relation: "parent"
   });
   console.log("Doc's parents:", parents);
   ```

### Solutions

**Missing hierarchyPropagation:**
```typescript
// Add to schema
hierarchyPropagation: {
  view: ["view"],  // view on parent grants view on child
  edit: ["edit"],
}
```

**Parent relationship not set:**
```typescript
await authz.setParent({ child: doc, parent: folder });
```

**Wrong propagation rule:**
```typescript
// This won't work:
hierarchyPropagation: {
  read: ["view"],  // Action is "view", not "read"
}

// Correct:
hierarchyPropagation: {
  view: ["view"],
}
```

---

## Issue 4: MaxDepthExceededError

### Symptom

A deep group or hierarchy chain **throws** (this is the 0.3.0 default):

```typescript
await authz.check({ ... });
// Throws: PolizyError::MaxDepthExceededError
//   "Authorization check exceeded maximum depth (20)."
```

In 0.2.x and earlier this was a silent `false` at depth 10. In 0.3.0 `defaultCheckDepth` is
**20** and `maxDepthBehavior` defaults to **`"throw"`**.

### Diagnosis

```typescript
import { MaxDepthExceededError } from "polizy";

try {
  await authz.check({ who: alice, canThey: "view", onWhat: doc });
} catch (error) {
  if (error instanceof MaxDepthExceededError) {
    console.log("Depth:", error.depth);
    console.log("Subject:", error.subject);
    console.log("Action:", error.action);
    console.log("Object:", error.object);
  }
}
```

A throw at depth 20+ almost always means **bad data** (an accidentally long chain
or a cycle), not a config that needs loosening. Inspect the chain before raising
the limit.

### Solutions

**Reduce nesting (best):**
```typescript
// Instead of: user → team → dept → division → company
// Use: user → team → company (skip intermediate levels)
```

**Raise the limit (if the chain is genuinely long):**
```typescript
const authz = new AuthSystem({ storage, schema, defaultCheckDepth: 40 });
```

**Restore the old silent-deny behavior:**
```typescript
const authz = new AuthSystem({ storage, schema, maxDepthBehavior: "deny" });
// returns false instead of throwing; pass a logger to see the warning
```

### `explain()` behavior past the depth cap (0.6.0)

Unlike `check()`, `explain()` **never** throws `MaxDepthExceededError`. Past the depth cap, it returns `{ allowed: false, via: null }` even when `maxDepthBehavior` is set to `"throw"`.

**Grant direct permissions for hot paths:**
```typescript
// If alice frequently accesses doc through a deep chain,
// a direct grant short-circuits the traversal (Step 3) and avoids the depth cost.
await authz.allow({ who: alice, toBe: "viewer", onWhat: doc });
```

---

## Issue 5: SchemaError: Relation Not Defined

### Symptom

```typescript
await authz.allow({ who: alice, toBe: "admin", onWhat: doc });
// SchemaError: Relation "admin" is not defined in schema
```

### Solution

Add the relation to your schema:

```typescript
relations: {
  owner: { type: "direct" },
  admin: { type: "direct" },  // Add this
  editor: { type: "direct" },
}
```

---

## Issue 6: Field Doesn't Inherit From Base / `doc1#field` Denied

### Symptom

A grant on the **base** object doesn't reach a field id, or a `doc1#field` check
denies where you expected base inheritance:

```typescript
await authz.allow({ who: alice, toBe: "owner", onWhat: { type: "document", id: "doc1" } });
await authz.check({ who: alice, canThey: "edit",
  onWhat: { type: "document", id: "doc1#salary" } }); // false??
```

### Most Common Cause (0.3.0): the type isn't field-enabled

**Field ids are opt-in in 0.3.0.** A `#` in an id only splits into `base#field`
when the object **type** is listed in the schema's `fieldLevelObjects`. If it
isn't, `doc1#salary` is treated as one opaque id with no base fallback — so a
grant on `doc1` never reaches it.

```typescript
const schema = defineSchema({
  objectTypes: ["document", "folder"],
  relations: { /* ... */ },
  actionToRelations: { /* ... */ },
  fieldLevelObjects: ["document"], // ← REQUIRED for "document:doc1#salary" to inherit
  // fieldSeparator: "#"  (default)
});
```

> In 0.2.x and earlier *any* id containing `#` inherited from its prefix — a privilege-bleed
> risk for ids that naturally contain `#`. 0.3.0 makes it opt-in and safe by
> default. If you relied on `#` inheritance, add the type to `fieldLevelObjects`.

### Other Causes

1. **Wrong field separator.** The schema default is `#`; override it on the
   schema (`fieldSeparator`) or the `AuthSystem` constructor (which wins). Both
   the granted and checked ids must use the same separator.

2. **Invalid field id on write.** A field-enabled type rejects ids with an empty
   base or empty field:
   ```typescript
   await authz.allow({ who: alice, toBe: "viewer",
     onWhat: { type: "document", id: "#salary" } });
   // SchemaError: Invalid field id '#salary': the base and field ... must both be non-empty.
   ```

3. **Typo in the field name** — `doc1#salary` granted, `doc1#salery` checked → no
   match.

### Note: base → field, not field → base

Inheritance flows **down**: a grant on the base authorizes its fields (via
direct, group, **and** hierarchy paths in 0.3.0). A grant on a *specific field*
stays scoped to that field and does **not** grant the base or sibling fields.

---

## Issue 7: Prisma Adapter Errors

### Wrong import / `new PrismaStorageAdapter(...)` fails

In 0.3.0 the adapter lives on a subpath and is a **factory function** (no `new`):

```typescript
// ❌ never existed as 0.2.x and earlier docs implied
import { PrismaStorageAdapter } from "polizy";
const storage = new PrismaStorageAdapter(prisma);

// ✅ 0.3.0
import { PrismaStorageAdapter } from "polizy/prisma-storage";
const storage = PrismaStorageAdapter(prisma); // call it, no `new`
```

### Migration fails on the `@@unique` constraint

0.3.0 **requires** `@@unique([subjectType, subjectId, relation, objectType,
objectId])` on `PolizyTuple` (it powers idempotent upserts). If 0.2.x and earlier left
duplicate rows, the migration fails until you dedupe them first. See the
migration guide for the dedupe SQL.

### "Table doesn't exist"

```bash
npx prisma migrate deploy
# or
npx prisma db push
```

### "Cannot find module '@prisma/client'"

```bash
npm install @prisma/client
npx prisma generate
```

### Re-granting just updates the condition (this is correct)

`allow`/`addMember`/`setParent` are **idempotent** on `(subject, relation,
object)` — re-running updates the condition in place instead of duplicating. You
don't need to delete first to change a condition:

```typescript
await authz.allow({ who: alice, toBe: "editor", onWhat: doc,
  when: { validUntil: newDate } }); // overwrites the prior condition on this triple
```

Consequence: a temporary and a standing grant that differ **only** by condition
can't coexist on the same triple — use distinct relations (see Issue 12).

---

## Issue 7b: Time-Based Grants Throw / Never Expire on Prisma

### Symptom (0.2.x and earlier)

A grant with `validSince`/`validUntil` stored via the Prisma adapter made
`check()` **throw**, or the window never applied.

### Cause

0.2.x and earlier stored the condition `Date` in the JSON column and read it back as a
**string**, breaking comparison.

### Fix

**Upgrade to 0.3.0 and re-check.** Dates are now revived on read (`toMillis`
accepts `Date`, ISO strings, and numbers), and `isConditionValid` is fail-closed
(an unparseable date denies rather than throws). No code change needed beyond
being on 0.3.0.

---

## Issue 8: Performance Problems

### Slow check() calls

**Diagnosis:**
```typescript
const start = Date.now();
await authz.check({ ... });
console.log("Check took:", Date.now() - start, "ms");
```

**Solutions:**
1. Add database indexes
2. Reduce group nesting
3. Add caching layer
4. Grant direct permissions for hot paths

### Memory growing with InMemoryAdapter

**Cause:** Expired tuples accumulating. (Expired conditions deny at check time,
but the tuples remain stored.)

**Solution:** Periodic cleanup:
```typescript
async function cleanup() {
  const tuples = await authz.listTuples({});
  const now = Date.now();

  for (const tuple of tuples) {
    const until = tuple.condition?.validUntil;
    if (until && new Date(until).getTime() <= now) {
      await authz.disallowAllMatching({
        who: tuple.subject,
        was: tuple.relation,
        onWhat: tuple.object,
      });
    }
  }
}
```

### Repeated multi-action checks

Don't loop `check()` per action. Use `listAccessibleObjects` (one resource type)
or `checkMany` (one round of `(who, action, object)` questions). Within a single
`check()`, the engine already memoizes shared subgraphs.

---

## Issue 9: disallowAllMatching Does Nothing

### Symptom

```typescript
await authz.disallowAllMatching({});  // Nothing happens
```

### Cause

Empty filter is blocked as a safety measure.

### Solution

Provide at least one filter:

```typescript
// Remove all permissions for user
await authz.disallowAllMatching({ who: alice });

// Remove all permissions on resource
await authz.disallowAllMatching({ onWhat: doc });

// Remove specific permission
await authz.disallowAllMatching({
  who: alice,
  was: "editor",
  onWhat: doc
});
```

---

## Issue 10: Circular Group References

### Symptom

Groups reference each other:

```typescript
await authz.addMember({ member: teamA, group: teamB });
await authz.addMember({ member: teamB, group: teamA });  // Circular!
```

### Impact

Polizy handles this safely. Within a single `check()`, a `visited` stack guard
detects re-entering a node and cuts that branch as an **unstable** `false` — one
that is never memoized, so a different valid path to the same node can still
succeed. The traversal is also bounded by `defaultCheckDepth`. So cycles
terminate correctly; they don't loop forever and don't produce wrong denials.

Still, cycles are confusing and waste traversal budget (you may approach the
depth limit). Restructure to a clear hierarchy.

### Solution

```typescript
// Instead of circular
// teamA ↔ teamB

// Use clear parent
// teamA → dept
// teamB → dept
await authz.addMember({ member: teamA, group: dept });
await authz.addMember({ member: teamB, group: dept });
```

---

## Issue 11: ABAC Predicate Denies Unexpectedly (Fail-Closed)

### Symptom

A grant with attribute predicates never authorizes:

```typescript
await authz.allow({ who: alice, toBe: "viewer", onWhat: doc,
  when: { attributes: [{ attribute: "department", operator: "eq", value: "engineering" }] } });

await authz.check({ who: alice, canThey: "view", onWhat: doc }); // false
```

### Cause

`isConditionValid` is **fail-closed**. Each predicate is evaluated against the
`context` you pass to `check()`. A predicate fails (denying) when:

- you didn't pass a `context` at all, or it lacks the key,
- the resolved value's **type** doesn't match the comparison (e.g. `gt`/`lt` on a
  non-number, or `in`/`nin` when `value` isn't an array),
- the dot-path (`"user.tier"`) resolves to `undefined`.

### Fix

Pass a `context` that satisfies every predicate:

```typescript
await authz.check({ who: alice, canThey: "view", onWhat: doc,
  context: { department: "engineering" } }); // true
```

Operators: `eq ne in nin gt gte lt lte`. `attribute` supports dot-paths. All
predicates must pass, and they combine with any `validSince`/`validUntil` window
(every part must hold).

---

## Issue 12: Temporary Grant Replaced / Merged a Standing Grant

### Symptom

A standing `viewer` grant disappears after a later time-boxed grant on the same
relation expires:

```typescript
await authz.allow({ who: alice, toBe: "viewer", onWhat: doc });               // standing
await authz.allow({ who: alice, toBe: "viewer", onWhat: doc,
  when: { validUntil: in1Hour } });                                          // temp
// 1 hour later: alice can no longer view doc
```

### Cause

`allow()` is **idempotent** on `(subject, relation, object)`. The second call
updated the condition on the *same* tuple — the temporary `when` overwrote the
standing grant; they didn't coexist.

### Fix

Model temporary vs standing with **distinct relations**:

```typescript
// actionToRelations: { view: ["viewer", "temp_viewer", "editor", "owner"] }

await authz.allow({ who: alice, toBe: "viewer", onWhat: doc });               // standing
await authz.allow({ who: alice, toBe: "temp_viewer", onWhat: doc,
  when: { validUntil: in1Hour } });                                          // temp, separate tuple
```

When `temp_viewer` expires, the `viewer` tuple is untouched.

---

## Issue 13: Revocation Removed More Than Expected

### Symptom (0.2.x and earlier, Prisma)

`removeParent`, `removeMember`, or a single-tuple `disallowAllMatching({ who,
was, onWhat })` deleted extra tuples — e.g. removing a child's parent link also
dropped the parent's own parent link.

### Cause

The 0.2.x and earlier Prisma adapter dropped the `who` constraint on delete, so the filter
matched too broadly.

### Fix

**Upgrade to 0.3.0.** Both adapters now delete by `who AND (object == onWhat OR
subject == onWhat)` identically. Re-verify your revocation paths after upgrading.

---

## Issue 14: defineSchema Throws at Startup

### Symptom

```typescript
const schema = defineSchema({ ... });
// PolizyError::SchemaError
```

### Cause

0.3.0 validates the model at definition time (0.2.x and earlier only `console.warn`ed):

- an action in `actionToRelations` maps to a **relation that isn't defined** in
  `relations`, or
- `hierarchyPropagation` references an **action that doesn't exist** in
  `actionToRelations`.

### Fix

Fix the dangling reference so every relation/action name resolves:

```typescript
relations: { viewer: { type: "direct" }, editor: { type: "direct" } },
actionToRelations: {
  view: ["viewer", "editor"],   // both defined above ✓
  // edit: ["modifier"],        // ✗ "modifier" is not a defined relation
},
hierarchyPropagation: {
  view: ["view"],               // "view" exists as an action ✓
  // edit: ["modify"],          // ✗ "modify" is not an action
},
```

---

## Issue 15: No Console Warnings Anymore

### Symptom

You relied on polizy printing depth/empty-filter warnings to `console`; in 0.3.0
nothing appears.

### Cause

The library no longer writes to `console`. The default logger is a no-op.

### Fix

Pass a `logger` to surface warnings:

```typescript
const authz = new AuthSystem({
  storage,
  schema,
  logger: { warn: (m, meta) => console.warn("[Polizy]", m, meta), error: console.error },
});
```

The library currently logs (via `logger.warn`) on a depth cutoff with
`maxDepthBehavior: "deny"` and on an empty-filter `disallowAllMatching` call.

---

## Issue 16: SchemaError: Tenant id cannot contain "/"

### Symptom

When defining a role using `defineRole` or mapping via `roleRef`, a `SchemaError` is thrown:
`SchemaError: Tenant id cannot contain "/"`

### Cause

RoleRegistry now rejects tenant ids containing `/` to prevent cross-tenant permissionMatrix contamination via prefix parsing.

### Fix

Ensure all tenant ids avoid containing the `/` character. If your tenant ids currently contain `/`, you must sanitize or map them to a safe value before calling `defineRole` or `roleRef`.

---

## Issue 17: Stored Malformed Conditions Throwing TypeErrors

### Symptom

A check operation fails or throws `TypeError` mid-check when evaluating attributes or time windows.

### Cause

In version 0.5.0 and earlier, malformed condition structures inside the database could cause the check algorithm to crash with a `TypeError` when checking permissions.

### Fix

In version 0.6.0, condition shape validation is hardened (`isConditionValid`). Any malformed condition shape will now fail closed (evaluation returns `false`, denying access) instead of crashing mid-check. Ensure your conditions are clean and follow the correct `Condition` schema to avoid silent denials.
