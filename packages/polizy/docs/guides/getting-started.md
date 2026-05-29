# Getting Started with Polizy

## Installation

```bash
npm install polizy
# or
pnpm add polizy
# or
yarn add polizy
```

## Basic Setup

### 1. Define Your Schema

The schema is the heart of Polizy. It defines:
- **Relations**: The types of relationships between subjects and objects
- **Actions**: What users can do (view, edit, delete, etc.)
- **Action-to-Relation mapping**: Which relations grant which actions

```typescript
import { defineSchema, AuthSystem, InMemoryStorageAdapter } from "polizy";

const schema = defineSchema({
  // Define relationship types
  relations: {
    owner: { type: "direct" },    // Direct permission
    editor: { type: "direct" },
    viewer: { type: "direct" },
    member: { type: "group" },    // Group membership
    parent: { type: "hierarchy" } // Hierarchy (folder/file)
  },

  // Map actions to relations that grant them
  actionToRelations: {
    delete: ["owner"],                    // Only owners can delete
    edit: ["owner", "editor"],            // Owners and editors can edit
    view: ["owner", "editor", "viewer"]   // All three can view
  },

  // Optional: How permissions propagate through hierarchies
  hierarchyPropagation: {
    view: ["view"],  // view on parent grants view on children
    edit: ["edit"]   // edit on parent grants edit on children
  }
});
```

### 2. Create an AuthSystem Instance

```typescript
const storage = new InMemoryStorageAdapter();
const authz = new AuthSystem({ storage, schema });
```

### 3. Grant Permissions

```typescript
// Grant alice ownership of doc1
await authz.allow({
  who: { type: "user", id: "alice" },
  toBe: "owner",
  onWhat: { type: "document", id: "doc1" }
});

// Grant bob viewer access to doc1
await authz.allow({
  who: { type: "user", id: "bob" },
  toBe: "viewer",
  onWhat: { type: "document", id: "doc1" }
});
```

### 4. Check Permissions

```typescript
// Can alice edit doc1?
const canAliceEdit = await authz.check({
  who: { type: "user", id: "alice" },
  canThey: "edit",
  onWhat: { type: "document", id: "doc1" }
});
// => true (alice is owner, owners can edit)

// Can bob edit doc1?
const canBobEdit = await authz.check({
  who: { type: "user", id: "bob" },
  canThey: "edit",
  onWhat: { type: "document", id: "doc1" }
});
// => false (bob is viewer, viewers cannot edit)

// Can bob view doc1?
const canBobView = await authz.check({
  who: { type: "user", id: "bob" },
  canThey: "view",
  onWhat: { type: "document", id: "doc1" }
});
// => true (bob is viewer, viewers can view)
```

## Working with Groups

Groups let you manage permissions for many users at once.

```typescript
// Add users to a team
await authz.addMember({
  member: { type: "user", id: "alice" },
  group: { type: "team", id: "engineering" }
});

await authz.addMember({
  member: { type: "user", id: "bob" },
  group: { type: "team", id: "engineering" }
});

// Grant the team editor access to a project
await authz.allow({
  who: { type: "team", id: "engineering" },
  toBe: "editor",
  onWhat: { type: "project", id: "project1" }
});

// Now both alice and bob can edit project1
const canAliceEdit = await authz.check({
  who: { type: "user", id: "alice" },
  canThey: "edit",
  onWhat: { type: "project", id: "project1" }
});
// => true (alice is member of engineering, which is editor on project1)
```

## Working with Hierarchies

Hierarchies let permissions flow from parent to child objects (like folders and files).

```typescript
// Set up folder structure
await authz.setParent({
  child: { type: "document", id: "doc1" },
  parent: { type: "folder", id: "folder1" }
});

// Grant viewer on folder
await authz.allow({
  who: { type: "user", id: "charlie" },
  toBe: "viewer",
  onWhat: { type: "folder", id: "folder1" }
});

// Charlie can view the document (permission propagates from folder)
const canCharlieView = await authz.check({
  who: { type: "user", id: "charlie" },
  canThey: "view",
  onWhat: { type: "document", id: "doc1" }
});
// => true (viewer on folder1 grants view on doc1 via hierarchyPropagation)
```

## Revoking Permissions

```typescript
// Remove specific permission
await authz.disallowAllMatching({
  who: { type: "user", id: "bob" },
  was: "viewer",
  onWhat: { type: "document", id: "doc1" }
});

// Remove all permissions for a user on an object
await authz.disallowAllMatching({
  who: { type: "user", id: "bob" },
  onWhat: { type: "document", id: "doc1" }
});

// Remove user from a group
await authz.removeMember({
  member: { type: "user", id: "alice" },
  group: { type: "team", id: "engineering" }
});
```

## Using with Prisma (Production)

For production, use the Prisma adapter instead of in-memory:

```typescript
import { AuthSystem } from "polizy";
import { PrismaAdapter } from "polizy/prisma-storage";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const storage = PrismaAdapter(prisma);
const authz = new AuthSystem({ storage, schema });
```

See the Prisma schema in `prisma/schema.prisma` for the required database model.

## Next Steps

- **[Core Concepts](./core-concepts.md)** - Deep dive into relations, actions, and tuples
- **[Patterns](./patterns.md)** - Best practices for authorization design
- **[Advanced Usage](./advanced-usage.md)** - Field-level permissions, time-based access
