# Anti-Patterns: What NOT to Do

Common mistakes that lead to problems (polizy 0.2.0). Avoid these patterns.

---

## Anti-Pattern 1: Duplicating Permissions Across Users

### The Problem

```typescript
// When a new document is created, grant access to every team member
await authz.allow({ who: alice, toBe: "editor", onWhat: newDoc });
await authz.allow({ who: bob, toBe: "editor", onWhat: newDoc });
await authz.allow({ who: charlie, toBe: "editor", onWhat: newDoc });
await authz.allow({ who: diana, toBe: "editor", onWhat: newDoc });
// ... 50 more users
```

### Why It's Bad

- Creates N tuples instead of 1
- Hard to audit ("who has access?" requires scanning all users)
- When someone joins the team, you must add all existing permissions
- When someone leaves, you must find and remove all their permissions
- Doesn't scale

### The Solution

```typescript
// Create a team once
await authz.addMember({ member: alice, group: engineering });
await authz.addMember({ member: bob, group: engineering });
// etc.

// Grant team access to document (1 tuple)
await authz.allow({ who: engineering, toBe: "editor", onWhat: newDoc });

// New member? Just add to team
await authz.addMember({ member: newHire, group: engineering });
// They automatically get all team permissions
```

---

## Anti-Pattern 2: Deep Group Nesting

### The Problem

```typescript
// 10+ levels of nesting
user → team → department → division → region → country → continent → global → universe
```

### Why It's Bad

- Each level requires additional database queries
- Increases check latency significantly (10+ queries per check)
- Hard to reason about "why does this user have access?"
- Risk of hitting depth limits
- Debugging becomes nightmare

### The Solution

```typescript
// 2-3 levels is usually enough
user → team → organization

// If you need more granularity, use direct permissions for specific cases
await authz.allow({ who: specificUser, toBe: "viewer", onWhat: specificResource });
```

---

## Anti-Pattern 3: Generic Relation Names

### The Problem

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

### Why It's Bad

- Can't distinguish between read-only and read-write users
- Violates principle of least privilege
- Makes it impossible to grant partial access
- "access" means nothing specific - unclear what it grants
- Future changes require data migration

### The Solution

```typescript
relations: {
  owner: { type: "direct" },   // Full control
  editor: { type: "direct" },  // Can modify
  viewer: { type: "direct" },  // Read-only
  member: { type: "group" }
}

actionToRelations: {
  delete: ["owner"],
  edit: ["owner", "editor"],
  view: ["owner", "editor", "viewer"]
}

// Now you can grant exactly the access needed
await authz.allow({ who: bob, toBe: "viewer", onWhat: doc });  // Read-only
await authz.allow({ who: alice, toBe: "editor", onWhat: doc }); // Can edit
```

---

## Anti-Pattern 4: Checking Permission After Action

### The Problem

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
  // Too late! The document is already gone!
  console.log("Oops, they weren't allowed to do that");
}
```

### Why It's Bad

- Damage is already done
- Can't undo the action
- Security vulnerability
- Audit trail is corrupted
- User experience is broken (action succeeded but shouldn't have)

### The Solution

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

---

## Anti-Pattern 5: Silent Authorization Failures

### The Problem

```typescript
const canEdit = await authz.check({ who: user, canThey: "edit", onWhat: doc });
if (canEdit) {
  showEditButton();
}
// If not allowed, just... nothing happens?
// User confused why they can't see the button
```

### Why It's Bad

- User doesn't understand why feature is missing
- Support tickets increase
- Appears like a bug, not a permission issue
- No feedback loop for users to request access

### The Solution

```typescript
const canEdit = await authz.check({ who: user, canThey: "edit", onWhat: doc });

if (canEdit) {
  showEditButton();
} else {
  showDisabledEditButton();
  showTooltip("You don't have permission to edit. Contact the document owner for access.");
}
```

---

## Anti-Pattern 6: Storing Business Logic in Authorization

### The Problem

```typescript
relations: {
  canSubmit: { type: "direct" },
  canApprove: { type: "direct" },
  canPublish: { type: "direct" },
  inDraftState: { type: "direct" },    // This is workflow state!
  inReviewState: { type: "direct" },   // This is workflow state!
  inPublishedState: { type: "direct" } // This is workflow state!
}
```

### Why It's Bad

- Mixes two concerns (who vs when)
- Authorization system becomes a state machine
- State transitions require authorization updates
- Hard to query current state
- Double the complexity

### The Solution

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
async function submitDocument(userId, docId) {
  const doc = await getDocument(docId);

  // Check state (business logic)
  if (doc.state !== "draft") {
    throw new Error("Can only submit documents in draft state");
  }

  // Check permission (authorization)
  const canSubmit = await authz.check({
    who: { type: "user", id: userId },
    canThey: "submit",
    onWhat: { type: "document", id: docId }
  });

  if (!canSubmit) {
    throw new ForbiddenError("You cannot submit this document");
  }

  // Proceed with submission
  await updateDocumentState(docId, "submitted");
}
```

---

## Anti-Pattern 7: Checking Multiple Actions in a Loop

### The Problem

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

### Why It's Bad

- N sequential database round trips
- Latency adds up quickly (5 actions = 5x latency)
- Redundant work (group expansion done N times)
- Poor user experience (slow page loads)

### The Solution

```typescript
// Use listAccessibleObjects for a single resource type
const result = await authz.listAccessibleObjects({
  who: user,
  ofType: "document"
});

// Find permissions for specific document
const docPermissions = result.accessible.find(
  a => a.object.id === documentId
);

const permissions = {
  view: docPermissions?.actions.includes("view") ?? false,
  edit: docPermissions?.actions.includes("edit") ?? false,
  delete: docPermissions?.actions.includes("delete") ?? false,
  share: docPermissions?.actions.includes("share") ?? false,
  comment: docPermissions?.actions.includes("comment") ?? false,
};
```

---

## Anti-Pattern 8: One Giant Schema

### The Problem

```typescript
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
}
```

### Why It's Bad

- Hard to maintain
- Inconsistent naming
- Type-specific relations don't scale
- Confusing which relation applies where
- Bloated schema

### The Solution

```typescript
// Use consistent relation names that work across object types
relations: {
  owner: { type: "direct" },
  editor: { type: "direct" },
  viewer: { type: "direct" },
  admin: { type: "direct" },
  member: { type: "group" },
  parent: { type: "hierarchy" }
}

// Object types distinguish context:
// { type: "document", id: "doc1" }
// { type: "project", id: "proj1" }
// { type: "org", id: "org1" }

// Same relations, different contexts
await authz.allow({ who: alice, toBe: "owner", onWhat: { type: "document", id: "doc1" } });
await authz.allow({ who: alice, toBe: "admin", onWhat: { type: "org", id: "acme" } });
```

---

## Anti-Pattern 9: Ignoring Principle of Least Privilege

### The Problem

```typescript
// Give everyone "owner" access because it's easier
await authz.allow({ who: user, toBe: "owner", onWhat: resource });

// Or: "Just make them admin"
await authz.allow({ who: newHire, toBe: "admin", onWhat: everything });
```

### Why It's Bad

- Security risk (users can do more than intended)
- No granular control
- Audit nightmare ("why does this intern have delete access?")
- Violates security best practices
- Compliance issues (GDPR, SOC2, etc.)

### The Solution

```typescript
// Grant the minimum access needed
await authz.allow({ who: user, toBe: "viewer", onWhat: resource });

// Upgrade only when necessary and with justification
await authz.allow({ who: user, toBe: "editor", onWhat: resource });

// Reserve owner/admin for those who truly need it
// And document why
```

---

## Anti-Pattern 10: Not Cleaning Up Orphaned Permissions

### The Problem

```typescript
// Delete the document
await db.documents.delete({ where: { id: docId } });

// Forget to clean up permissions
// Now orphaned tuples exist forever
```

### Why It's Bad

- Tuple storage grows indefinitely
- Confusion about what permissions exist
- Security risk if ID is reused
- Audit trail is polluted
- Performance degradation over time

### The Solution

```typescript
async function deleteDocument(docId: string) {
  const doc = { type: "document", id: docId };

  // Clean up hierarchy
  await authz.removeParent({ child: doc, parent: ... });

  // Clean up permissions
  await authz.disallowAllMatching({ onWhat: doc });

  // Then delete from database
  await db.documents.delete({ where: { id: docId } });
}
```

---

## Anti-Pattern 11: Expecting Deny Tuples

### The Problem

```typescript
// Trying to "block" alice after granting the team access
await authz.allow({ who: engineering, toBe: "viewer", onWhat: doc });
await authz.disallow({ who: alice, ... });        // ✗ no such API
await authz.allow({ who: alice, toBe: "denied", onWhat: doc }); // ✗ denies don't exist
```

### Why It's Bad

polizy is **grants-only** — there are no deny/negative tuples, and no API adds
one. `check()` returns `false` only because *no granting path was found*, never
because something matched a deny. A "denied" relation is just an unused grant;
the team's `viewer` grant still wins for alice via her membership.

### The Solution

Model exceptions with **narrower scopes** instead of denials:

```typescript
// Don't grant the whole team — grant the subset that should have access.
await authz.allow({ who: alice,   toBe: "viewer", onWhat: doc });
await authz.allow({ who: bob,     toBe: "viewer", onWhat: doc });
// (omit the person who shouldn't have access)

// Or scope by field/sub-object so the sensitive part isn't covered:
await authz.allow({ who: engineering, toBe: "viewer",
  onWhat: { type: "document", id: "doc1" } });           // base
// salary field granted to a smaller set, NOT the whole team:
await authz.allow({ who: manager, toBe: "viewer",
  onWhat: { type: "document", id: "doc1#salary" } });
```

To remove access someone already has, **revoke the granting tuple** with
`disallowAllMatching` / `removeMember` — don't try to add a counter-grant.

---

## Anti-Pattern 12: Putting `#` in IDs Without Enabling Field Types

### The Problem

```typescript
// Object ids that naturally contain "#"
const issue = { type: "ticket", id: "PROJ#42" };

// Assuming a grant on a "#"-bearing id behaves like 0.1.x prefix inheritance,
// OR assuming "ticket" splits when it isn't in fieldLevelObjects
await authz.allow({ who: alice, toBe: "viewer", onWhat: { type: "ticket", id: "PROJ" } });
await authz.check({ who: alice, canThey: "view",
  onWhat: { type: "ticket", id: "PROJ#42" } }); // false — "ticket" isn't field-enabled
```

### Why It's Bad

In 0.2.0 the `#` separator only splits ids whose **type** is listed in
`fieldLevelObjects`. Two ways this bites:

- You *want* field inheritance but forgot to opt the type in → base grants don't
  reach `base#field`.
- Your ids *happen* to contain `#` (commit shas, composite keys, ticket codes)
  and you accidentally opt that type in → unintended privilege bleed (the exact
  0.1.x footgun this change closes).

### The Solution

Be deliberate. Only enable field types that genuinely use `base#field` semantics,
and keep `#` out of ordinary ids:

```typescript
const schema = defineSchema({
  objectTypes: ["document", "ticket"],
  relations: { /* ... */ },
  actionToRelations: { /* ... */ },
  fieldLevelObjects: ["document"], // documents split on "#"; tickets never do
});

// If a type's ids naturally contain "#", DON'T add it to fieldLevelObjects —
// its ids stay opaque and safe.
```

---

## Anti-Pattern 13: One Relation for Temporary and Standing Access

### The Problem

```typescript
await authz.allow({ who: alice, toBe: "viewer", onWhat: doc });               // standing
await authz.allow({ who: alice, toBe: "viewer", onWhat: doc,
  when: { validUntil: in1Hour } });                                          // "temporary"
// When the hour passes, alice loses ALL view access — the temp grant
// overwrote the standing one.
```

### Why It's Bad

`allow()` is idempotent on `(subject, relation, object)` — re-granting the same
triple **updates the condition in place** rather than adding a second tuple. A
temporary and a standing grant that differ only by their `when` cannot coexist on
the same triple, so the time box silently clobbered the permanent grant.

### The Solution

Use **distinct relations**, both mapped to the action:

```typescript
// actionToRelations: { view: ["viewer", "temp_viewer", "editor", "owner"] }

await authz.allow({ who: alice, toBe: "viewer", onWhat: doc });               // standing
await authz.allow({ who: alice, toBe: "temp_viewer", onWhat: doc,
  when: { validUntil: in1Hour } });                                          // temp, separate tuple
// temp_viewer expiring leaves viewer intact.
```

---

## Summary Checklist

Before deploying, verify you're not:

- [ ] Duplicating permissions across users (use groups)
- [ ] Nesting groups more than 2-3 levels
- [ ] Using generic relation names like "access"
- [ ] Checking permissions after performing actions
- [ ] Silently hiding features without feedback
- [ ] Storing workflow state in authorization
- [ ] Checking multiple actions in loops (use `listAccessibleObjects`/`checkMany`)
- [ ] Creating type-specific relations
- [ ] Granting admin/owner by default
- [ ] Leaving orphaned permissions on delete
- [ ] Expecting deny tuples (the model is grants-only)
- [ ] Putting `#` in ids without deliberately enabling the type via `fieldLevelObjects`
- [ ] Reusing one relation for temporary and standing access (use distinct relations)
