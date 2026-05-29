# Troubleshooting

Common issues and their solutions.

## Permission Check Returns `false` Unexpectedly

### 1. Missing Relation in Schema

**Symptom:** `check()` returns `false` even though you granted permission.

**Cause:** The relation you used in `allow()` isn't mapped to the action in `actionToRelations`.

```typescript
// Schema
const schema = defineSchema({
  relations: {
    viewer: { type: "direct" },
    editor: { type: "direct" },
  },
  actionToRelations: {
    view: ["viewer"],  // "editor" not listed!
    edit: ["editor"],
  },
});

// Grant editor role
await authz.allow({ who: alice, toBe: "editor", onWhat: doc });

// Fails! "editor" isn't in the "view" action's relations
await authz.check({ who: alice, canThey: "view", onWhat: doc }); // false
```

**Solution:** Update `actionToRelations` to include all relations that should grant the action:

```typescript
actionToRelations: {
  view: ["viewer", "editor"],  // editors can also view
  edit: ["editor"],
}
```

### 2. Max Depth Exceeded

**Symptom:** User has permission through deeply nested groups, but `check()` returns `false`.

**Cause:** Group chain exceeds `defaultCheckDepth` (default: 10).

```typescript
// User → Group1 → Group2 → ... → Group15 → has permission
// With default depth of 10, check stops before reaching Group15
```

**Solution:** Either increase the depth limit or restructure your groups:

```typescript
// Option 1: Increase depth
const authz = new AuthSystem({
  storage,
  schema,
  defaultCheckDepth: 20,  // Increase from 10
});

// Option 2: Enable throwOnMaxDepth to detect this issue
const authz = new AuthSystem({
  storage,
  schema,
  throwOnMaxDepth: true,  // Throws instead of silent false
});
```

### 3. Missing Group Membership

**Symptom:** Group has permission, but group member can't access.

**Cause:** User wasn't added to the group, or the group relation isn't configured.

```typescript
// Check if user is in the group
const memberships = await authz.listTuples({
  subject: { type: "user", id: "alice" },
  relation: "member",
});
console.log(memberships);
```

**Solution:** Ensure the user is added to the group and the schema has a `group` relation:

```typescript
// Schema must have a group relation
relations: {
  member: { type: "group" },  // Required!
  viewer: { type: "direct" },
}

// Add user to group
await authz.addMember({ member: alice, group: team });
```

### 4. Hierarchy Not Propagating

**Symptom:** Permission on parent doesn't grant access to child.

**Cause:** Missing `hierarchyPropagation` configuration.

```typescript
// Without hierarchyPropagation, parent permissions don't flow down
const schema = defineSchema({
  relations: {
    parent: { type: "hierarchy" },
    viewer: { type: "direct" },
  },
  actionToRelations: {
    view: ["viewer"],
  },
  // Missing! hierarchyPropagation
});
```

**Solution:** Add `hierarchyPropagation` to your schema:

```typescript
const schema = defineSchema({
  relations: {
    parent: { type: "hierarchy" },
    viewer: { type: "direct" },
  },
  actionToRelations: {
    view: ["viewer"],
  },
  hierarchyPropagation: {
    view: ["view"],  // "view" on parent grants "view" on child
  },
});
```

### 5. Time-Based Condition Not Yet Valid

**Symptom:** Permission was granted but `check()` returns `false`.

**Cause:** The permission has a `validSince` date in the future.

```typescript
await authz.allow({
  who: alice,
  toBe: "viewer",
  onWhat: doc,
  when: {
    validSince: new Date("2024-02-01"),  // Future date
  },
});

// Check on 2024-01-15 returns false
```

**Solution:** Verify the condition dates or wait until the valid period.

## SchemaError: "not defined in schema"

**Cause:** Using a relation that doesn't exist in the schema.

```typescript
// Schema only has "viewer"
const schema = defineSchema({
  relations: { viewer: { type: "direct" } },
  actionToRelations: { view: ["viewer"] },
});

// Trying to use "editor" which doesn't exist
await authz.allow({ who: alice, toBe: "editor", onWhat: doc });
// SchemaError: Relation "editor" is not defined in schema
```

**Solution:** Add the relation to your schema or use the correct relation name.

## SchemaError: "No group relation defined"

**Cause:** Calling `addMember()` or `removeMember()` when schema has no group relation.

```typescript
const schema = defineSchema({
  relations: {
    viewer: { type: "direct" },  // No "group" type relation
  },
  actionToRelations: { view: ["viewer"] },
});

await authz.addMember({ member: alice, group: team });
// SchemaError: No group relation defined in schema
```

**Solution:** Add a relation with `type: "group"`:

```typescript
relations: {
  member: { type: "group" },  // Add this
  viewer: { type: "direct" },
}
```

## SchemaError: "No hierarchy relation defined"

**Cause:** Calling `setParent()` or `removeParent()` when schema has no hierarchy relation.

**Solution:** Add a relation with `type: "hierarchy"`:

```typescript
relations: {
  parent: { type: "hierarchy" },  // Add this
  viewer: { type: "direct" },
}
```

## Prisma Adapter Issues

### "Cannot find module './prisma/client-generated'"

**Cause:** Prisma client hasn't been generated.

**Solution:**

```bash
cd packages/polizy
pnpm prisma generate
```

### "Table 'polizy_tuple' doesn't exist"

**Cause:** Database schema hasn't been applied.

**Solution:**

```bash
# Development
pnpm prisma db push

# Production
pnpm prisma migrate deploy
```

## Performance Issues

### Slow `check()` Calls

**Possible causes:**

1. **Too many group levels** - Each level requires a database query
2. **No caching** - Same checks repeated without caching

**Solutions:**

```typescript
// 1. Reduce group nesting (aim for 2-3 levels max)

// 2. Add caching for read-heavy workloads
import { LRUCache } from "lru-cache";

const cache = new LRUCache<string, boolean>({ max: 10000, ttl: 60000 });

async function cachedCheck(who, action, onWhat) {
  const key = `${who.type}:${who.id}|${action}|${onWhat.type}:${onWhat.id}`;
  let result = cache.get(key);
  if (result !== undefined) return result;

  result = await authz.check({ who, canThey: action, onWhat });
  cache.set(key, result);
  return result;
}
```

### Slow `listAccessibleObjects()` Calls

**Cause:** This method is inherently expensive as it checks all possible objects.

**Solutions:**

1. Add an action filter to reduce checks
2. Set a reasonable `maxDepth`
3. Paginate results in your application layer

```typescript
// More efficient with action filter
const result = await authz.listAccessibleObjects({
  who: user,
  ofType: "document",
  canThey: "edit",  // Reduces objects to check
  maxDepth: 5,      // Limits recursion
});
```

## Warning Messages

### "Authorization check exceeded maximum depth"

**Meaning:** The group/hierarchy chain is deeper than `defaultCheckDepth`.

**Impact:** Permission check returned `false` even if permission exists.

**Solutions:**

1. Increase `defaultCheckDepth`
2. Restructure groups to reduce nesting
3. Enable `throwOnMaxDepth: true` to catch these early

### "disallowAllMatching called with an empty filter"

**Meaning:** You called `disallowAllMatching({})` which would delete all tuples.

**Impact:** No tuples were deleted (safety protection).

**Solution:** Provide at least one filter criterion:

```typescript
// Instead of this (does nothing):
await authz.disallowAllMatching({});

// Do this:
await authz.disallowAllMatching({ who: alice });
// or
await authz.disallowAllMatching({ onWhat: doc });
```

## Debugging Tips

### Enable Detailed Logging

```typescript
const debugLog: string[] = [];

const authz = new AuthSystem({
  storage,
  schema,
  logger: {
    warn: (msg) => {
      debugLog.push(msg);
      console.warn("[Polizy]", msg);
    },
  },
});

// After operations, check debugLog for warnings
```

### Inspect Stored Tuples

```typescript
// List all tuples for a subject
const aliceTuples = await authz.listTuples({
  subject: { type: "user", id: "alice" },
});
console.log("Alice's tuples:", aliceTuples);

// List all tuples for an object
const docTuples = await authz.listTuples({
  object: { type: "doc", id: "doc1" },
});
console.log("Doc tuples:", docTuples);
```

### Trace Group Membership

```typescript
// Find all groups a user belongs to
const memberships = await authz.listTuples({
  subject: { type: "user", id: "alice" },
  relation: "member",
});
console.log("Alice is member of:", memberships.map(t => t.object));

// Find all members of a group
const members = await authz.listTuples({
  object: { type: "group", id: "team1" },
  relation: "member",
});
console.log("Team1 members:", members.map(t => t.subject));
```

## Still Stuck?

1. **Check the examples** in `src/scenarios/` for working implementations
2. **Review the schema** - most issues come from misconfigured schemas
3. **Inspect the tuples** - verify the data matches your expectations
4. **Enable throwOnMaxDepth** - silent failures are hard to debug
