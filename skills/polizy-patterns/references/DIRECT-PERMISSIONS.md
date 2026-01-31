# Direct Permissions Pattern

The simplest pattern: grant specific users access to specific resources.

## When to Use

- User owns a resource they created
- Sharing a document with a specific person
- Assigning a reviewer to a document
- Any case where permission is explicit, not inherited

## Schema Setup

```typescript
import { defineSchema, AuthSystem, InMemoryStorageAdapter } from "polizy";

const schema = defineSchema({
  relations: {
    owner: { type: "direct" },
    editor: { type: "direct" },
    viewer: { type: "direct" },
  },
  actionToRelations: {
    delete: ["owner"],
    edit: ["owner", "editor"],
    view: ["owner", "editor", "viewer"],
  },
});

const authz = new AuthSystem({
  storage: new InMemoryStorageAdapter(),
  schema,
});
```

## Granting Permissions

### Basic Grant

```typescript
await authz.allow({
  who: { type: "user", id: "alice" },
  toBe: "owner",
  onWhat: { type: "document", id: "doc1" }
});
```

### Grant Multiple Roles

```typescript
const alice = { type: "user", id: "alice" };
const bob = { type: "user", id: "bob" };
const charlie = { type: "user", id: "charlie" };
const doc = { type: "document", id: "doc1" };

// Alice is owner
await authz.allow({ who: alice, toBe: "owner", onWhat: doc });

// Bob is editor
await authz.allow({ who: bob, toBe: "editor", onWhat: doc });

// Charlie is viewer
await authz.allow({ who: charlie, toBe: "viewer", onWhat: doc });
```

### Grant on Document Creation

```typescript
async function createDocument(userId: string, content: string) {
  // Create document in database
  const doc = await db.documents.create({
    data: { content, createdBy: userId }
  });

  // Grant owner permission
  await authz.allow({
    who: { type: "user", id: userId },
    toBe: "owner",
    onWhat: { type: "document", id: doc.id }
  });

  return doc;
}
```

## Checking Permissions

### Basic Check

```typescript
const canEdit = await authz.check({
  who: { type: "user", id: "alice" },
  canThey: "edit",
  onWhat: { type: "document", id: "doc1" }
});

if (canEdit) {
  // Allow the edit
} else {
  // Deny access
}
```

### In API Handler

```typescript
app.put("/documents/:id", async (req, res) => {
  const userId = req.user.id;
  const docId = req.params.id;

  const allowed = await authz.check({
    who: { type: "user", id: userId },
    canThey: "edit",
    onWhat: { type: "document", id: docId }
  });

  if (!allowed) {
    return res.status(403).json({ error: "Forbidden" });
  }

  // Proceed with update
  const doc = await updateDocument(docId, req.body);
  res.json(doc);
});
```

### Check Multiple Actions

```typescript
async function getDocumentPermissions(userId: string, docId: string) {
  const user = { type: "user", id: userId };
  const doc = { type: "document", id: docId };

  const [canView, canEdit, canDelete] = await Promise.all([
    authz.check({ who: user, canThey: "view", onWhat: doc }),
    authz.check({ who: user, canThey: "edit", onWhat: doc }),
    authz.check({ who: user, canThey: "delete", onWhat: doc }),
  ]);

  return { canView, canEdit, canDelete };
}
```

### Using listAccessibleObjects

More efficient for getting all permissions at once:

```typescript
const result = await authz.listAccessibleObjects({
  who: { type: "user", id: "alice" },
  ofType: "document"
});

// Find specific document's permissions
const docPermissions = result.accessible.find(
  a => a.object.id === "doc1"
);

if (docPermissions) {
  const canEdit = docPermissions.actions.includes("edit");
  const canDelete = docPermissions.actions.includes("delete");
}
```

## Common Scenarios

### Sharing a Document

```typescript
async function shareDocument(
  ownerId: string,
  docId: string,
  recipientId: string,
  permission: "viewer" | "editor"
) {
  // Verify owner has permission to share
  const canShare = await authz.check({
    who: { type: "user", id: ownerId },
    canThey: "share",  // Add this action to schema if needed
    onWhat: { type: "document", id: docId }
  });

  if (!canShare) {
    throw new Error("You cannot share this document");
  }

  // Grant permission to recipient
  await authz.allow({
    who: { type: "user", id: recipientId },
    toBe: permission,
    onWhat: { type: "document", id: docId }
  });
}
```

### Transferring Ownership

```typescript
async function transferOwnership(
  currentOwnerId: string,
  docId: string,
  newOwnerId: string
) {
  const doc = { type: "document", id: docId };

  // Verify current owner
  const isOwner = await authz.check({
    who: { type: "user", id: currentOwnerId },
    canThey: "delete",  // Only owners can delete = proxy for ownership
    onWhat: doc
  });

  if (!isOwner) {
    throw new Error("Only the owner can transfer ownership");
  }

  // Remove current owner
  await authz.disallowAllMatching({
    who: { type: "user", id: currentOwnerId },
    was: "owner",
    onWhat: doc
  });

  // Add new owner
  await authz.allow({
    who: { type: "user", id: newOwnerId },
    toBe: "owner",
    onWhat: doc
  });

  // Optionally keep old owner as editor
  await authz.allow({
    who: { type: "user", id: currentOwnerId },
    toBe: "editor",
    onWhat: doc
  });
}
```

### Listing Who Has Access

```typescript
async function getDocumentAccessList(docId: string) {
  const tuples = await authz.listTuples({
    object: { type: "document", id: docId }
  });

  return tuples.map(tuple => ({
    user: tuple.subject,
    role: tuple.relation
  }));
}

// Result:
// [
//   { user: { type: "user", id: "alice" }, role: "owner" },
//   { user: { type: "user", id: "bob" }, role: "editor" },
//   { user: { type: "user", id: "charlie" }, role: "viewer" }
// ]
```

## Best Practices

1. **Grant on creation** - Always set owner when creating resources
2. **Check before action** - Verify permission before performing action
3. **Use semantic roles** - "owner", "editor", "viewer" not "role1", "role2"
4. **Handle missing permission gracefully** - Return 403, not 500
5. **Audit access changes** - Log who granted/revoked what

## Anti-Patterns

### Don't: Check multiple times

```typescript
// ❌ Bad - multiple round trips
if (await authz.check({ who, canThey: "view", onWhat: doc })) {
  if (await authz.check({ who, canThey: "edit", onWhat: doc })) {
    showEditButton();
  }
}

// ✅ Good - single query
const result = await authz.listAccessibleObjects({ who, ofType: "document" });
const docActions = result.accessible.find(a => a.object.id === docId)?.actions ?? [];
```

### Don't: Grant "admin" for everything

```typescript
// ❌ Bad - violates least privilege
await authz.allow({ who: user, toBe: "owner", onWhat: doc });

// ✅ Good - grant minimum needed
await authz.allow({ who: user, toBe: "viewer", onWhat: doc });
```

### Don't: Check after action

```typescript
// ❌ Bad - damage already done
await deleteDocument(docId);
const canDelete = await authz.check({ who, canThey: "delete", onWhat: doc });
if (!canDelete) {
  // Too late!
}

// ✅ Good - check first
const canDelete = await authz.check({ who, canThey: "delete", onWhat: doc });
if (!canDelete) {
  throw new ForbiddenError();
}
await deleteDocument(docId);
```
