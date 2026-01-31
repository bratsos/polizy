# Common Issues and Solutions

Detailed solutions for frequently encountered problems.

## Issue 1: check() Returns False When It Should Be True

### Symptom

Permission was granted but check fails:

```typescript
await authz.allow({ who: alice, toBe: "editor", onWhat: doc });
await authz.check({ who: alice, canThey: "view", onWhat: doc }); // false??
```

### Diagnosis Steps

1. **Check action mapping:**
   ```typescript
   console.log(schema.actionToRelations.view);
   // Does it include "editor"?
   ```

2. **Verify tuple exists:**
   ```typescript
   const tuples = await authz.listTuples({ subject: alice, object: doc });
   console.log(tuples);
   ```

3. **Check for conditions:**
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
if (tuple.condition?.validSince > new Date()) {
  console.log("Permission not yet active");
}
```

**Condition expired:**
```typescript
if (tuple.condition?.validUntil < new Date()) {
  console.log("Permission expired");
}
```

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

Deep group or hierarchy chain exceeds limit:

```typescript
// With throwOnMaxDepth: true
await authz.check({ ... });
// Throws: MaxDepthExceededError
```

### Diagnosis

```typescript
try {
  await authz.check({ who: alice, canThey: "view", onWhat: doc });
} catch (error) {
  if (error instanceof MaxDepthExceededError) {
    console.log("Depth:", error.depth);
    console.log("Subject:", error.subject);
    console.log("Object:", error.object);
  }
}
```

### Solutions

**Increase depth limit:**
```typescript
const authz = new AuthSystem({
  storage,
  schema,
  defaultCheckDepth: 20,  // Increase from 10
});
```

**Reduce nesting (better solution):**
```typescript
// Instead of: user → team → dept → division → company
// Use: user → team → company (skip intermediate levels)
```

**Grant direct permissions for hot paths:**
```typescript
// If alice frequently accesses doc through deep chain,
// grant direct permission for performance
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

## Issue 6: Field-Level Permission Not Working

### Symptom

```typescript
await authz.allow({ who: alice, toBe: "viewer", onWhat: { type: "doc", id: "doc1#salary" } });
await authz.check({ who: alice, canThey: "view", onWhat: { type: "doc", id: "doc1#salary" } }); // false??
```

### Diagnosis

1. **Check exact object ID:**
   ```typescript
   const tuples = await authz.listTuples({
     subject: alice,
     object: { type: "doc", id: "doc1#salary" }
   });
   console.log(tuples);
   ```

2. **Check field separator:**
   ```typescript
   console.log("Field separator:", authz.fieldSeparator);
   // Default is "#"
   ```

### Solutions

**Wrong field separator:**
```typescript
const authz = new AuthSystem({
  storage,
  schema,
  fieldSeparator: "::"  // If using :: instead of #
});
```

**Typo in field name:**
```typescript
// Granted on "doc1#salary"
// Checking "doc1#salery" (typo) → false
```

---

## Issue 7: Prisma Adapter Errors

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

### Unique constraint violation

This usually means the tuple already exists. It's idempotent - safe to ignore.

```typescript
// If you need to update, delete first:
await authz.disallowAllMatching({
  who: alice,
  was: "editor",
  onWhat: doc
});
await authz.allow({
  who: alice,
  toBe: "editor",
  onWhat: doc,
  when: { validUntil: newDate }
});
```

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

**Cause:** Expired tuples accumulating.

**Solution:** Periodic cleanup:
```typescript
async function cleanup() {
  const tuples = await authz.listTuples({});
  const now = new Date();

  for (const tuple of tuples) {
    if (tuple.condition?.validUntil < now) {
      await authz.disallowAllMatching({
        who: tuple.subject,
        was: tuple.relation,
        onWhat: tuple.object
      });
    }
  }
}
```

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

Polizy handles this with visited tracking - it won't loop infinitely. But it's confusing and can cause unexpected behavior.

### Solution

Restructure to have clear hierarchy:

```typescript
// Instead of circular
// teamA ↔ teamB

// Use clear parent
// teamA → dept
// teamB → dept
await authz.addMember({ member: teamA, group: dept });
await authz.addMember({ member: teamB, group: dept });
```
