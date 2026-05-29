# Anti-Patterns: What NOT to Do

Avoid these common mistakes when designing authorization systems with Polizy.

## Data Model Anti-Patterns

### Anti-Pattern: Duplicating Permissions Across Users

**Don't do this:**
```typescript
// When a new document is created, grant access to every team member
await authz.allow({ who: alice, toBe: "editor", onWhat: newDoc });
await authz.allow({ who: bob, toBe: "editor", onWhat: newDoc });
await authz.allow({ who: charlie, toBe: "editor", onWhat: newDoc });
await authz.allow({ who: diana, toBe: "editor", onWhat: newDoc });
// ... 50 more users
```

**Do this instead:**
```typescript
// Grant access to the team once
await authz.allow({ who: engineeringTeam, toBe: "editor", onWhat: newDoc });

// Users are members of the team
await authz.addMember({ member: alice, group: engineeringTeam });
// etc.
```

**Why it's bad:**
- Creates N tuples instead of 1
- Hard to audit ("who has access?" requires scanning all users)
- When someone joins the team, you must remember to add all existing permissions
- When someone leaves, you must find and remove all their permissions

### Anti-Pattern: Deep Group Hierarchies

**Don't do this:**
```typescript
// 10+ levels of nesting
user → team → department → division → region → country → continent → global
```

**Keep it shallow:**
```typescript
// 2-3 levels is usually enough
user → team → organization
```

**Why it's bad:**
- Each level requires additional database queries
- Increases check latency significantly
- Hard to reason about "why does this user have access?"
- Risk of hitting depth limits

### Anti-Pattern: Using Generic Relation Names

**Don't do this:**
```typescript
relations: {
  access: { type: "direct" },
  member: { type: "group" }
}

actionToRelations: {
  read: ["access"],
  write: ["access"],
  delete: ["access"]
}
```

**Do this instead:**
```typescript
relations: {
  viewer: { type: "direct" },
  editor: { type: "direct" },
  owner: { type: "direct" },
  member: { type: "group" }
}

actionToRelations: {
  view: ["viewer", "editor", "owner"],
  edit: ["editor", "owner"],
  delete: ["owner"]
}
```

**Why it's bad:**
- Can't distinguish between read-only and read-write users
- Violates principle of least privilege
- Makes it hard to grant partial access
- "access" means nothing specific

### Anti-Pattern: Storing Business Logic in Authorization

**Don't do this:**
```typescript
// Embedding workflow state in authorization
relations: {
  canSubmit: { type: "direct" },
  canApprove: { type: "direct" },
  canPublish: { type: "direct" },
  inDraftState: { type: "direct" },    // This is workflow state!
  inReviewState: { type: "direct" },   // This is workflow state!
  inPublishedState: { type: "direct" } // This is workflow state!
}
```

**Do this instead:**
```typescript
// Authorization: WHO can do WHAT
relations: {
  author: { type: "direct" },
  reviewer: { type: "direct" },
  publisher: { type: "direct" }
}

actionToRelations: {
  submit: ["author"],
  review: ["reviewer"],
  publish: ["publisher"]
}

// Business logic: WHEN they can do it (in your application code)
if (document.state === "draft" && await authz.check({ who: user, canThey: "submit", onWhat: doc })) {
  // Allow submission
}
```

**Why it's bad:**
- Mixes two concerns (who vs when)
- Authorization system becomes a state machine
- State transitions require authorization updates
- Hard to query current state

## Check Pattern Anti-Patterns

### Anti-Pattern: Checking Multiple Actions in a Loop

**Don't do this:**
```typescript
const actions = ["view", "edit", "delete", "share", "comment"];
const permissions: Record<string, boolean> = {};

for (const action of actions) {
  permissions[action] = await authz.check({
    who: user,
    canThey: action,
    onWhat: document
  });
}
```

**Do this instead:**
```typescript
// For a single resource, use listAccessibleObjects or batch checks
const result = await authz.listAccessibleObjects({
  who: user,
  ofType: "document"
});

const docAccess = result.accessible.find(a => a.object.id === document.id);
const permissions = docAccess?.actions ?? [];
```

**Why it's bad:**
- N sequential database round trips
- Latency adds up quickly
- Redundant work (group expansion done N times)

### Anti-Pattern: Checking Permission After the Fact

**Don't do this:**
```typescript
// Perform the action first
await database.deleteDocument(docId);

// Then check if it was allowed
const wasAllowed = await authz.check({
  who: user,
  canThey: "delete",
  onWhat: { type: "document", id: docId }
});

if (!wasAllowed) {
  // Try to undo... but the document is already gone!
  console.log("Oops, they weren't allowed to do that");
}
```

**Do this instead:**
```typescript
// Check BEFORE performing the action
const canDelete = await authz.check({
  who: user,
  canThey: "delete",
  onWhat: { type: "document", id: docId }
});

if (!canDelete) {
  throw new ForbiddenError("You cannot delete this document");
}

// Now safe to perform the action
await database.deleteDocument(docId);
```

### Anti-Pattern: Not Handling Authorization Errors

**Don't do this:**
```typescript
// Silent failure - user doesn't know why
const canEdit = await authz.check({ who: user, canThey: "edit", onWhat: doc });
if (canEdit) {
  showEditButton();
}
// If not allowed, just... nothing happens?
```

**Do this instead:**
```typescript
const canEdit = await authz.check({ who: user, canThey: "edit", onWhat: doc });
if (canEdit) {
  showEditButton();
} else {
  showDisabledEditButton();
  showTooltip("You don't have permission to edit this document");
}
```

## Schema Design Anti-Patterns

### Anti-Pattern: One Giant Schema

**Don't do this:**
```typescript
const schema = defineSchema({
  relations: {
    // Documents
    documentOwner: { type: "direct" },
    documentEditor: { type: "direct" },
    documentViewer: { type: "direct" },
    // Projects
    projectOwner: { type: "direct" },
    projectManager: { type: "direct" },
    projectMember: { type: "direct" },
    // Organizations
    orgAdmin: { type: "direct" },
    orgMember: { type: "direct" },
    // ... 50 more relations
  },
  actionToRelations: {
    // ... 100 actions
  }
});
```

**Do this instead:**
```typescript
// Use consistent relation names that work across object types
const schema = defineSchema({
  relations: {
    owner: { type: "direct" },
    editor: { type: "direct" },
    viewer: { type: "direct" },
    member: { type: "group" },
    parent: { type: "hierarchy" }
  },
  actionToRelations: {
    delete: ["owner"],
    edit: ["owner", "editor"],
    view: ["owner", "editor", "viewer"],
    manage: ["owner"]
  }
});

// Object types distinguish context:
// { type: "document", id: "doc1" }
// { type: "project", id: "proj1" }
// { type: "org", id: "org1" }
```

**Why it's bad:**
- Hard to maintain
- Inconsistent naming
- Type-specific relations don't scale

### Anti-Pattern: Ignoring the Principle of Least Privilege

**Don't do this:**
```typescript
// Give everyone "admin" access because it's easier
await authz.allow({ who: user, toBe: "admin", onWhat: resource });
```

**Do this instead:**
```typescript
// Grant the minimum access needed
await authz.allow({ who: user, toBe: "viewer", onWhat: resource });

// Upgrade only when necessary
await authz.allow({ who: user, toBe: "editor", onWhat: resource });
```

**Why it's bad:**
- Security risk (users can do more than intended)
- No granular control
- Audit nightmare ("why does this intern have delete access?")

## Performance Anti-Patterns

### Anti-Pattern: Creating Circular Group Memberships

**Don't do this:**
```typescript
await authz.addMember({ member: teamA, group: teamB });
await authz.addMember({ member: teamB, group: teamA }); // Circular!
```

**Why it's bad:**
- Creates infinite loops in permission checks
- Polizy handles this with visited tracking, but it's confusing
- Unclear which group is the "parent"

### Anti-Pattern: Not Using Pagination for Large Result Sets

**Don't do this:**
```typescript
// Load all tuples at once
const allTuples = await authz.listTuples({});
```

**Do this instead:**
```typescript
// Paginate through results
let offset = 0;
const limit = 100;

while (true) {
  const batch = await authz.listTuples({}, { limit, offset });
  if (batch.length === 0) break;

  processBatch(batch);
  offset += limit;
}
```

## Next Steps

- **[Advanced Usage](./advanced-usage.md)** - Field-level permissions, optimization
- **[Troubleshooting](./troubleshooting.md)** - Common issues and solutions
