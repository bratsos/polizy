# Revocation Patterns

Remove permissions from users, groups, and resources.

## When to Use

- User leaves organization
- Access should be removed
- Resource is being deleted
- Permission was granted in error
- Downgrading user role

## Core Methods

### disallowAllMatching

Removes tuples matching the filter criteria:

```typescript
await authz.disallowAllMatching({
  who?: Subject,     // Filter by subject
  was?: string,      // Filter by relation
  onWhat?: Object    // Filter by object
});
```

### removeMember

Removes group membership:

```typescript
await authz.removeMember({
  member: Subject,
  group: Object
});
```

### removeParent

Removes hierarchy relationship:

```typescript
await authz.removeParent({
  child: Object,
  parent: Object
});
```

## Revocation Patterns

### 1. Remove Specific Permission

```typescript
// Remove bob's editor role on doc1
await authz.disallowAllMatching({
  who: { type: "user", id: "bob" },
  was: "editor",
  onWhat: { type: "document", id: "doc1" }
});
```

### 2. Remove All User Permissions on Resource

```typescript
// Remove ALL of bob's permissions on doc1
await authz.disallowAllMatching({
  who: { type: "user", id: "bob" },
  onWhat: { type: "document", id: "doc1" }
});
```

### 3. Remove User from Everywhere

```typescript
// Remove ALL of bob's permissions on everything
await authz.disallowAllMatching({
  who: { type: "user", id: "bob" }
});
```

### 4. Remove All Permissions on Resource

```typescript
// Remove ALL permissions on doc1 (when deleting it)
await authz.disallowAllMatching({
  onWhat: { type: "document", id: "doc1" }
});
```

### 5. Remove Specific Role Everywhere

```typescript
// Remove all "owner" permissions on doc1
await authz.disallowAllMatching({
  was: "owner",
  onWhat: { type: "document", id: "doc1" }
});
```

### 6. Remove from Group

```typescript
// Remove alice from engineering team
await authz.removeMember({
  member: { type: "user", id: "alice" },
  group: { type: "team", id: "engineering" }
});

// Alice immediately loses inherited permissions
```

### 7. Remove from Hierarchy

```typescript
// Remove doc1 from folder1
await authz.removeParent({
  child: { type: "document", id: "doc1" },
  parent: { type: "folder", id: "folder1" }
});

// doc1 no longer inherits folder1's permissions
```

## Common Scenarios

### User Offboarding

```typescript
async function offboardUser(userId: string) {
  const user = { type: "user", id: userId };

  // 1. Remove from all groups
  const groupMemberships = await authz.listTuples({
    subject: user,
    relation: "member"
  });

  for (const tuple of groupMemberships) {
    await authz.removeMember({
      member: user,
      group: tuple.object
    });
  }

  // 2. Remove all direct permissions
  await authz.disallowAllMatching({ who: user });

  console.log(`Offboarded user ${userId}`);
}
```

### Resource Deletion

```typescript
async function deleteDocument(docId: string) {
  const doc = { type: "document", id: docId };

  // 1. Remove from parent (if any)
  const parentTuples = await authz.listTuples({
    subject: doc,
    relation: "parent"
  });

  for (const tuple of parentTuples) {
    await authz.removeParent({
      child: doc,
      parent: tuple.object
    });
  }

  // 2. Remove all permissions on the document
  await authz.disallowAllMatching({ onWhat: doc });

  // 3. Delete from database
  await db.documents.delete({ where: { id: docId } });
}
```

### Folder Deletion (Recursive)

```typescript
async function deleteFolder(folderId: string) {
  const folder = { type: "folder", id: folderId };

  // 1. Find all children
  const children = await authz.listTuples({
    object: folder,
    relation: "parent"
  });

  // 2. Recursively delete children
  for (const child of children) {
    if (child.subject.type === "folder") {
      await deleteFolder(child.subject.id);
    } else {
      await deleteDocument(child.subject.id);
    }
  }

  // 3. Remove folder from its parent
  const parentTuples = await authz.listTuples({
    subject: folder,
    relation: "parent"
  });

  for (const tuple of parentTuples) {
    await authz.removeParent({
      child: folder,
      parent: tuple.object
    });
  }

  // 4. Remove all permissions on folder
  await authz.disallowAllMatching({ onWhat: folder });

  // 5. Delete from database
  await db.folders.delete({ where: { id: folderId } });
}
```

### Role Downgrade

```typescript
async function downgradeUserRole(
  userId: string,
  resourceId: string,
  fromRole: string,
  toRole: string
) {
  const user = { type: "user", id: userId };
  const resource = { type: "document", id: resourceId };

  // Remove old role
  await authz.disallowAllMatching({
    who: user,
    was: fromRole,
    onWhat: resource
  });

  // Grant new (lower) role
  await authz.allow({
    who: user,
    toBe: toRole,
    onWhat: resource
  });
}

// Downgrade from editor to viewer
await downgradeUserRole("alice", "doc1", "editor", "viewer");
```

### Unshare Document

```typescript
async function unshareDocument(docId: string, userId: string) {
  await authz.disallowAllMatching({
    who: { type: "user", id: userId },
    onWhat: { type: "document", id: docId }
  });
}

// Or unshare from everyone
async function unshareFromAll(docId: string, keepOwnerId: string) {
  const doc = { type: "document", id: docId };

  // Get all permissions
  const tuples = await authz.listTuples({ object: doc });

  // Remove all except owner
  for (const tuple of tuples) {
    if (tuple.subject.id !== keepOwnerId) {
      await authz.disallowAllMatching({
        who: tuple.subject,
        was: tuple.relation,
        onWhat: doc
      });
    }
  }
}
```

### Team Disbanding

```typescript
async function disbandTeam(teamId: string) {
  const team = { type: "team", id: teamId };

  // 1. Remove all members from team
  const members = await authz.listTuples({
    object: team,
    relation: "member"
  });

  for (const tuple of members) {
    await authz.removeMember({
      member: tuple.subject,
      group: team
    });
  }

  // 2. Remove team from parent groups
  const parentGroups = await authz.listTuples({
    subject: team,
    relation: "member"
  });

  for (const tuple of parentGroups) {
    await authz.removeMember({
      member: team,
      group: tuple.object
    });
  }

  // 3. Remove all team permissions
  await authz.disallowAllMatching({ who: team });
}
```

### Transfer Ownership

```typescript
async function transferOwnership(
  resourceId: string,
  fromUserId: string,
  toUserId: string
) {
  const resource = { type: "document", id: resourceId };
  const fromUser = { type: "user", id: fromUserId };
  const toUser = { type: "user", id: toUserId };

  // Verify current ownership
  const isOwner = await authz.check({
    who: fromUser,
    canThey: "delete",  // Proxy for ownership check
    onWhat: resource
  });

  if (!isOwner) {
    throw new Error("Only owner can transfer ownership");
  }

  // Remove current owner
  await authz.disallowAllMatching({
    who: fromUser,
    was: "owner",
    onWhat: resource
  });

  // Grant to new owner
  await authz.allow({
    who: toUser,
    toBe: "owner",
    onWhat: resource
  });

  // Optionally: keep old owner as editor
  await authz.allow({
    who: fromUser,
    toBe: "editor",
    onWhat: resource
  });
}
```

## Safety Considerations

### Empty Filter Warning

Calling `disallowAllMatching({})` with no filters would delete ALL tuples. Polizy prevents this:

```typescript
// This logs a warning and does nothing
await authz.disallowAllMatching({});
// Warning: "disallowAllMatching called with an empty filter"
```

### Verification Before Revocation

```typescript
async function safeRevoke(userId: string, resourceId: string, role: string) {
  const user = { type: "user", id: userId };
  const resource = { type: "resource", id: resourceId };

  // Check permission exists before revoking
  const tuples = await authz.listTuples({
    subject: user,
    relation: role,
    object: resource
  });

  if (tuples.length === 0) {
    throw new Error(`User ${userId} doesn't have ${role} on ${resourceId}`);
  }

  await authz.disallowAllMatching({
    who: user,
    was: role,
    onWhat: resource
  });
}
```

### Audit Logging

```typescript
async function auditedRevoke(
  revokedBy: string,
  userId: string,
  resourceId: string,
  role: string
) {
  const user = { type: "user", id: userId };
  const resource = { type: "resource", id: resourceId };

  // Log before revocation
  await auditLog.create({
    action: "permission_revoked",
    revokedBy,
    affectedUser: userId,
    resource: resourceId,
    role,
    timestamp: new Date()
  });

  await authz.disallowAllMatching({
    who: user,
    was: role,
    onWhat: resource
  });
}
```

## Best Practices

1. **Clean up on delete** - Remove permissions when deleting resources
2. **Full offboarding** - Remove from groups AND direct permissions
3. **Audit revocations** - Log who revoked what and when
4. **Verify before revoking** - Ensure permission exists
5. **Handle cascading** - Recursively clean up children

## Anti-Patterns

### Don't: Forget group memberships

```typescript
// ❌ Bad - only removes direct permissions
await authz.disallowAllMatching({ who: user });
// User still in groups!

// ✅ Good - remove from groups too
await offboardUser(userId);  // Handles both
```

### Don't: Leave orphaned permissions

```typescript
// ❌ Bad - delete resource, forget permissions
await db.documents.delete({ where: { id: docId } });
// Permissions still exist!

// ✅ Good - clean up permissions first
await deleteDocument(docId);  // Removes permissions, then deletes
```

### Don't: Use empty filters

```typescript
// ❌ Dangerous - would delete everything (blocked by polizy)
await authz.disallowAllMatching({});

// ✅ Good - always specify at least one filter
await authz.disallowAllMatching({ who: user });
```
