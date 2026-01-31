# Hierarchy Pattern

Inherit permissions from parent resources. Classic use case: folders and files.

## When to Use

- Folder/file structures
- Project/task hierarchies
- Category/item relationships
- Any nested resource where children should inherit parent permissions

## Schema Setup

```typescript
import { defineSchema, AuthSystem, InMemoryStorageAdapter } from "polizy";

const schema = defineSchema({
  relations: {
    owner: { type: "direct" },
    editor: { type: "direct" },
    viewer: { type: "direct" },
    parent: { type: "hierarchy" },  // Required for setParent()
  },
  actionToRelations: {
    delete: ["owner"],
    edit: ["owner", "editor"],
    view: ["owner", "editor", "viewer"],
  },
  // CRITICAL: Without this, parent permissions don't flow to children
  hierarchyPropagation: {
    view: ["view"],   // view on parent → view on child
    edit: ["edit"],   // edit on parent → edit on child
    // delete intentionally omitted - doesn't propagate
  },
});

const authz = new AuthSystem({
  storage: new InMemoryStorageAdapter(),
  schema,
});
```

## Basic Hierarchy Pattern

### 1. Set Up Parent-Child Relationship

```typescript
const folder = { type: "folder", id: "folder1" };
const doc = { type: "document", id: "doc1" };

await authz.setParent({
  child: doc,
  parent: folder
});
```

### 2. Grant Permission at Parent Level

```typescript
await authz.allow({
  who: { type: "user", id: "alice" },
  toBe: "viewer",
  onWhat: folder
});
```

### 3. Child Inherits Permission

```typescript
// Alice can view the document (inherited from folder)
const canView = await authz.check({
  who: { type: "user", id: "alice" },
  canThey: "view",
  onWhat: doc
}); // true
```

## Multi-Level Hierarchies

```typescript
const root = { type: "folder", id: "root" };
const projects = { type: "folder", id: "projects" };
const projectA = { type: "folder", id: "project-a" };
const readme = { type: "document", id: "readme" };

// Set up hierarchy: root → projects → project-a → readme
await authz.setParent({ child: projects, parent: root });
await authz.setParent({ child: projectA, parent: projects });
await authz.setParent({ child: readme, parent: projectA });

// Grant access at root
await authz.allow({
  who: { type: "user", id: "alice" },
  toBe: "viewer",
  onWhat: root
});

// Alice can view readme (propagates through all levels)
await authz.check({
  who: { type: "user", id: "alice" },
  canThey: "view",
  onWhat: readme
}); // true
```

## Hierarchy Propagation Configuration

### Basic Propagation

```typescript
hierarchyPropagation: {
  view: ["view"],  // view on parent grants view on child
  edit: ["edit"],  // edit on parent grants edit on child
}
```

### Cross-Action Propagation

More powerful permissions on parent can grant lesser permissions on children:

```typescript
hierarchyPropagation: {
  // If you can view OR edit the parent, you can view the child
  view: ["view", "edit"],

  // Only edit on parent grants edit on child
  edit: ["edit"],
}
```

### Non-Propagating Actions

Actions not listed don't propagate:

```typescript
hierarchyPropagation: {
  view: ["view"],
  edit: ["edit"],
  // delete is not listed - doesn't propagate
}

// Even if alice owns the parent folder:
await authz.allow({ who: alice, toBe: "owner", onWhat: folder });

// She can't delete individual files through hierarchy
await authz.check({ who: alice, canThey: "delete", onWhat: doc }); // false
// (Unless she has direct owner on the doc)
```

## Managing Hierarchies

### Setting Parent

```typescript
await authz.setParent({
  child: { type: "document", id: "doc1" },
  parent: { type: "folder", id: "folder1" }
});
```

### Changing Parent (Moving)

```typescript
// Remove from current parent
await authz.removeParent({
  child: { type: "document", id: "doc1" },
  parent: { type: "folder", id: "folder1" }
});

// Set new parent
await authz.setParent({
  child: { type: "document", id: "doc1" },
  parent: { type: "folder", id: "folder2" }
});
```

### Removing Parent

```typescript
await authz.removeParent({
  child: { type: "document", id: "doc1" },
  parent: { type: "folder", id: "folder1" }
});

// Document no longer inherits from folder
```

### Listing Children

```typescript
async function getChildren(parentType: string, parentId: string) {
  const tuples = await authz.listTuples({
    object: { type: parentType, id: parentId },
    relation: "parent"
  });

  return tuples.map(t => t.subject);  // Children are subjects in hierarchy tuples
}

// Get all items in folder
const children = await getChildren("folder", "folder1");
```

### Listing Parent

```typescript
async function getParent(childType: string, childId: string) {
  const tuples = await authz.listTuples({
    subject: { type: childType, id: childId },
    relation: "parent"
  });

  return tuples[0]?.object;  // First parent (usually only one)
}

// Get document's parent folder
const parent = await getParent("document", "doc1");
```

## Common Scenarios

### File System Structure

```typescript
async function createFolder(userId: string, name: string, parentId?: string) {
  const folder = await db.folders.create({ data: { name } });

  const folderObj = { type: "folder", id: folder.id };
  const user = { type: "user", id: userId };

  // Grant owner
  await authz.allow({ who: user, toBe: "owner", onWhat: folderObj });

  // Set parent if provided
  if (parentId) {
    await authz.setParent({
      child: folderObj,
      parent: { type: "folder", id: parentId }
    });
  }

  return folder;
}

async function uploadFile(userId: string, folderId: string, file: File) {
  const doc = await db.documents.create({ data: { folderId, ...file } });

  const docObj = { type: "document", id: doc.id };
  const user = { type: "user", id: userId };

  // Grant owner
  await authz.allow({ who: user, toBe: "owner", onWhat: docObj });

  // Set parent folder
  await authz.setParent({
    child: docObj,
    parent: { type: "folder", id: folderId }
  });

  return doc;
}
```

### Moving Files Between Folders

```typescript
async function moveFile(
  userId: string,
  docId: string,
  fromFolderId: string,
  toFolderId: string
) {
  const user = { type: "user", id: userId };
  const doc = { type: "document", id: docId };
  const toFolder = { type: "folder", id: toFolderId };

  // Check user can edit destination folder
  const canMove = await authz.check({
    who: user,
    canThey: "edit",
    onWhat: toFolder
  });

  if (!canMove) {
    throw new Error("Cannot move to this folder");
  }

  // Update hierarchy
  await authz.removeParent({
    child: doc,
    parent: { type: "folder", id: fromFolderId }
  });

  await authz.setParent({
    child: doc,
    parent: toFolder
  });

  // Update database
  await db.documents.update({
    where: { id: docId },
    data: { folderId: toFolderId }
  });
}
```

### Bulk Share Folder

```typescript
async function shareFolder(folderId: string, userId: string, role: string) {
  await authz.allow({
    who: { type: "user", id: userId },
    toBe: role,
    onWhat: { type: "folder", id: folderId }
  });

  // All files in folder automatically accessible via hierarchy
}
```

## Combining with Groups

Hierarchies and groups work together:

```typescript
// Team structure
await authz.addMember({ member: alice, group: engineering });

// Folder hierarchy
await authz.setParent({ child: doc, parent: folder });

// Grant team access at folder level
await authz.allow({
  who: engineering,
  toBe: "editor",
  onWhat: folder
});

// Alice can edit doc through: group membership + hierarchy
await authz.check({ who: alice, canThey: "edit", onWhat: doc }); // true
```

## Best Practices

1. **Configure hierarchyPropagation** - Without it, hierarchy has no effect
2. **Don't propagate destructive actions** - Delete on parent shouldn't delete children
3. **Grant at highest appropriate level** - Don't duplicate permissions down the tree
4. **Keep hierarchies reasonable depth** - 5-10 levels is practical
5. **Clean up when deleting parents** - Remove or re-parent orphaned children

## Anti-Patterns

### Don't: Forget hierarchyPropagation

```typescript
// ❌ Bad - hierarchy configured but no propagation
const schema = defineSchema({
  relations: {
    parent: { type: "hierarchy" },
    viewer: { type: "direct" },
  },
  actionToRelations: {
    view: ["viewer"],
  },
  // Missing hierarchyPropagation!
});

// ✅ Good - propagation configured
const schema = defineSchema({
  relations: {
    parent: { type: "hierarchy" },
    viewer: { type: "direct" },
  },
  actionToRelations: {
    view: ["viewer"],
  },
  hierarchyPropagation: {
    view: ["view"],
  },
});
```

### Don't: Create circular hierarchies

```typescript
// ❌ Bad - circular
await authz.setParent({ child: folderA, parent: folderB });
await authz.setParent({ child: folderB, parent: folderA });  // Creates cycle!

// Polizy handles this with visited tracking, but it's confusing
```

### Don't: Propagate delete

```typescript
// ❌ Dangerous - deleting folder deletes all contents without confirmation
hierarchyPropagation: {
  delete: ["delete"],  // Risky!
}

// ✅ Good - require explicit delete permission on each item
hierarchyPropagation: {
  view: ["view"],
  edit: ["edit"],
  // delete not propagated
}
```
