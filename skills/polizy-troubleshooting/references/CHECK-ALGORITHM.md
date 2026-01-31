# The Check Algorithm

Understanding how `authz.check()` evaluates permissions.

## Overview

When you call:

```typescript
await authz.check({
  who: { type: "user", id: "alice" },
  canThey: "edit",
  onWhat: { type: "document", id: "doc1" }
});
```

Polizy performs a multi-step evaluation:

1. **Resolve action to relations**
2. **Direct check** - Does subject have required relation on object?
3. **Field fallback** - If object has field, check base object
4. **Group expansion** - Check through group memberships
5. **Hierarchy traversal** - Check through parent resources

## Step 1: Resolve Action to Relations

First, polizy looks up which relations can perform the action:

```typescript
// From schema
actionToRelations: {
  edit: ["owner", "editor"],
}

// For "edit" action, check relations: ["owner", "editor"]
```

**If action not found:** Returns `false` immediately.

## Step 2: Direct Check

Check if the subject has any required relation directly on the object:

```sql
-- Pseudo-query
SELECT * FROM tuples
WHERE subject_type = 'user'
  AND subject_id = 'alice'
  AND relation IN ('owner', 'editor')
  AND object_type = 'document'
  AND object_id = 'doc1';
```

**If found:** Evaluate condition (time-based), return `true` if valid.

**If not found:** Continue to next step.

## Step 3: Field Fallback

If the object ID contains a field separator (default `#`):

```typescript
// Object: { type: "document", id: "doc1#salary" }
// Also check: { type: "document", id: "doc1" }
```

This allows base object permissions to apply to fields.

**Example:**

```typescript
// Alice is owner of doc1
await authz.allow({ who: alice, toBe: "owner", onWhat: doc1 });

// Check access to doc1#salary
await authz.check({ who: alice, canThey: "edit", onWhat: { type: "document", id: "doc1#salary" } });
// Checks: doc1#salary (not found)
// Then checks: doc1 (found - alice is owner)
// Returns: true
```

## Step 4: Group Expansion

If no direct permission, check group memberships:

```
1. Find all groups the subject is a member of
2. For each group, recursively check if group has permission
3. If any group has permission, return true
```

**Pseudocode:**

```typescript
async function checkViaGroups(subject, requiredRelations, object, depth, visited) {
  // Find groups subject is member of
  const groups = await storage.findObjects(subject, "member");

  for (const group of groups) {
    // Avoid infinite loops
    const groupKey = `${group.type}:${group.id}`;
    if (visited.has(groupKey)) continue;
    visited.add(groupKey);

    // Check if group has direct permission
    if (await hasDirectPermission(group, requiredRelations, object)) {
      return true;
    }

    // Recursively check group's groups (nested groups)
    if (depth < maxDepth) {
      if (await checkViaGroups(group, requiredRelations, object, depth + 1, visited)) {
        return true;
      }
    }
  }

  return false;
}
```

**Example traversal:**

```
alice → member → team:frontend → member → dept:engineering → editor → project:proj1

1. Check alice directly on proj1 → Not found
2. Find alice's groups → [team:frontend]
3. Check team:frontend on proj1 → Not found
4. Find team:frontend's groups → [dept:engineering]
5. Check dept:engineering on proj1 → Found "editor"!
6. Return true
```

## Step 5: Hierarchy Traversal

If object has a parent, check permissions on parent:

```
1. Find object's parent
2. Check hierarchyPropagation for the action
3. If action propagates, check permission on parent
4. Recursively check parent's parent
```

**Pseudocode:**

```typescript
async function checkViaHierarchy(subject, action, object, depth, visited) {
  // Find parent
  const parents = await storage.findObjects(object, "parent");

  for (const parent of parents) {
    // Check propagation rules
    const propagatingActions = schema.hierarchyPropagation[action];
    if (!propagatingActions) continue;

    // For each action that could grant this action on child
    for (const parentAction of propagatingActions) {
      // Check if subject can perform parentAction on parent
      if (await check(subject, parentAction, parent, depth + 1, visited)) {
        return true;
      }
    }
  }

  return false;
}
```

**Example traversal:**

```
document:doc1 --parent--> folder:folder1
alice --viewer--> folder:folder1
hierarchyPropagation: { view: ["view"] }

1. Check alice directly on doc1 → Not found
2. Check alice's groups on doc1 → Not found
3. Find doc1's parent → folder:folder1
4. Check if "view" propagates → Yes, from "view"
5. Check if alice can "view" folder1 → Yes (direct viewer)
6. Return true
```

## Combined Example

```
User: alice
Action: edit
Object: document:doc1

Setup:
- alice is member of team:frontend
- team:frontend is member of dept:engineering
- dept:engineering is editor on folder:root
- document:doc1's parent is folder:sub
- folder:sub's parent is folder:root
- hierarchyPropagation: { edit: ["edit"] }

Evaluation:
1. Direct: alice --editor--> doc1? No
2. Groups:
   - alice member of frontend
   - frontend --editor--> doc1? No
   - frontend member of engineering
   - engineering --editor--> doc1? No
3. Hierarchy:
   - doc1 --parent--> folder:sub
   - Can alice edit folder:sub?
     - Direct: No
     - Groups:
       - engineering --editor--> folder:sub? No
     - Hierarchy:
       - folder:sub --parent--> folder:root
       - Can alice edit folder:root?
         - Direct: No
         - Groups:
           - engineering --editor--> folder:root? YES!
         - Return true
       - Return true
     - Return true
   - Return true

Final result: true
```

## Depth Limiting

To prevent infinite loops (circular group memberships):

```typescript
// Default configuration
defaultCheckDepth: 10

// Each recursive step increments depth
// When depth >= maxDepth:
//   - If throwOnMaxDepth: throw MaxDepthExceededError
//   - Else: log warning, return false
```

### Visited Tracking

Within a single check, polizy tracks visited paths:

```typescript
const visited = new Set<string>();

// Before checking a group/hierarchy:
const key = `${type}:${id}`;
if (visited.has(key)) {
  return false;  // Already checked this path
}
visited.add(key);
```

This prevents:
- Circular group memberships from looping
- Redundant checks of the same path

## Condition Evaluation

When a tuple is found, conditions are evaluated:

```typescript
function isConditionValid(condition: Condition | undefined): boolean {
  if (!condition) return true;

  const now = new Date();

  if (condition.validSince && now < condition.validSince) {
    return false;  // Not yet valid
  }

  if (condition.validUntil && now > condition.validUntil) {
    return false;  // Expired
  }

  return true;
}
```

## Early Termination

The algorithm returns `true` as soon as any valid path is found:

- First direct permission → return `true`
- First group with permission → return `true`
- First hierarchy path with permission → return `true`

This is an optimization - no need to check all paths if one succeeds.

## Performance Implications

| Factor | Impact | Mitigation |
|--------|--------|------------|
| Group depth | Each level = more queries | Keep nesting shallow |
| Hierarchy depth | Each level = more queries | Limit with `defaultCheckDepth` |
| Number of groups | More groups = more checks | Use targeted grants |
| Tuple count | Larger index scans | Good database indexes |

## Debugging the Algorithm

Enable detailed logging:

```typescript
const authz = new AuthSystem({
  storage,
  schema,
  throwOnMaxDepth: true,  // Surface depth issues
  logger: {
    warn: (msg) => console.log("[Debug]", msg)
  }
});
```

Trace manually:

```typescript
// 1. Check direct
const directTuples = await authz.listTuples({
  subject: alice,
  object: doc
});
console.log("Direct:", directTuples);

// 2. Check groups
const groups = await authz.listTuples({
  subject: alice,
  relation: "member"
});
console.log("Groups:", groups);

// 3. Check hierarchy
const parents = await authz.listTuples({
  subject: doc,
  relation: "parent"
});
console.log("Parents:", parents);
```
