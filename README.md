# polizy

[![npm version](https://badge.fury.io/js/polizy.svg)](https://badge.fury.io/js/polizy)

`polizy` is a flexible, [Zanzibar](https://research.google/pubs/pub48190/)-inspired authorization library for Node.js and TypeScript applications. It allows you to define complex permission models based on relationships between users, groups, and resources directly within your application code.

## Problem Solved

Managing permissions in applications can quickly become complex. Traditional Role-Based Access Control (RBAC) often falls short when dealing with fine-grained permissions based on relationships (e.g., "user A can edit document B because they are in group C, which owns document B"). `polizy` provides a structured way to define and check these kinds of permissions.

## Key Features

*   **Embeddable Library:** Unlike self-hosted authorization services (e.g., OpenFGA, Cerbos, Ory Keto), `polizy` is integrated directly into your application, simplifying deployment and infrastructure.
*   **Type-Safe Schema:** Define your authorization model using TypeScript for compile-time checks and better developer experience.
*   **Relationship-Based Access:** Permissions are determined by relationships (tuples) stored between subjects and objects.
*   **Hierarchy Support:** Define parent-child relationships (e.g., folders and files) and automatically propagate permissions.
*   **Group Support:** Manage permissions through group memberships.
*   **Pluggable Storage:** Comes with an in-memory adapter for testing/development and a Prisma adapter for persistent storage. Easily extendable with custom adapters.

## Installation

```bash
# Using npm
npm install polizy

# Using yarn
yarn add polizy

# Using pnpm
pnpm add polizy
```

## Core Concepts

*   **Subject:** Who is performing an action (e.g., `user:alice`).
*   **Object:** What is the action being performed on (e.g., `document:xyz`, `folder:abc`). Can also represent groups or hierarchical parents.
*   **Relation:** The relationship between a Subject and an Object (e.g., `owner`, `editor`, `viewer`, `member`, `parent`).
*   **Action:** The specific operation a Subject wants to perform on an Object (e.g., `view`, `edit`, `delete`).
*   **Tuple:** A stored record representing a relationship (`Subject` has `Relation` to `Object`, optionally with `Condition`). E.g., `(user:alice, owner, document:xyz)`.
*   **Schema:** Defines the possible `SubjectTypes`, `ObjectTypes`, `Relations`, and how `Actions` map to `Relations`. Also defines relation types (`direct`, `group`, `hierarchy`).
*   **Storage Adapter:** Handles the persistence of tuples (e.g., `InMemoryStorageAdapter`, `PrismaStorageAdapter`).

## Setup

To start using `polizy`, you need to:

1.  **Define a Schema:** Create an authorization model using `defineSchema`. This specifies your object types, subject types, the relationships between them, and how actions map to these relationships.
2.  **Choose a Storage Adapter:** Select how relationship tuples will be stored. Use `InMemoryStorageAdapter` for quick starts or `PrismaStorageAdapter` (requires `@prisma/client`) for database persistence.
3.  **Instantiate AuthSystem:** Create an instance of `AuthSystem` with your schema and storage adapter.

## API Usage

### 1. Define Your Schema

Use `defineSchema` to create your authorization model.

```typescript
import { defineSchema } from 'polizy';

const mySchema = defineSchema({
  subjectTypes: ['user', 'service_account'],
  objectTypes: ['document', 'folder', 'team'], // Ensure 'team' is an object type if used in relations
  relations: {
    // Direct relations
    owner: { type: 'direct' },
    editor: { type: 'direct' },
    viewer: { type: 'direct' },
    // Group relation
    member: { type: 'group' }, // 'member' relation links subjects to 'team' objects
    // Hierarchy relation
    parent: { type: 'hierarchy' }, // 'parent' relation links 'document'/'folder' to 'folder' objects
  },
  actionToRelations: {
    // Define which relations grant which actions
    view: ['viewer', 'editor', 'owner', 'member'], // Direct viewers/editors/owners OR members of a team linked via 'viewer'/'editor'/'owner'
    edit: ['editor', 'owner'],
    delete: ['owner'],
    manage_members: ['owner'], // Only owners of a 'team' can manage members
    share: ['owner', 'editor'],
  },
  // Optional: Define how permissions propagate up hierarchies
  hierarchyPropagation: {
     // If a user can 'view' the parent 'folder', they can also 'view' the child 'document'/'folder'
    view: ['view'],
     // If a user can 'edit' the parent 'folder', they can also 'edit' the child 'document'/'folder'
    edit: ['edit'],
    // Actions without propagation rules can be omitted or explicitly empty
    delete: [],
    manage_members: [],
    share: [],
  }
});
```

### 2. Choose a Storage Adapter

Polizy provides adapters for persistence.

*   **`InMemoryStorageAdapter`:** Good for testing or simple use cases. Data is lost on restart.
*   **`PrismaStorageAdapter`:** Persists tuples in your database using Prisma.
    *   Requires `@prisma/client` to be installed.
    *   Requires a Prisma model (typically named `PolizyTuple` or similar) in your `schema.prisma` file to store the relationship tuples. The model should include the following fields:
        *   `subjectType`: String
        *   `subjectId`: String
        *   `relation`: String
        *   `objectType`: String
        *   `objectId`: String
        *   `condition`: Json? (Optional, for attribute-based access control)
    *   It's highly recommended to add a unique constraint and relevant indexes for performance.

    Example Prisma Model:
    ```prisma
    // filepath: prisma/schema.prisma
    model PolizyTuple {
      id String @id @default(uuid()) // Optional, but good practice

      subjectType String // e.g., 'user', 'team'
      subjectId   String // e.g., 'alice', 'team-alpha'
      relation    String // e.g., 'owner', 'member', 'parent'
      objectType  String // e.g., 'document', 'folder'
      objectId    String // e.g., 'doc1', 'folder-a'
      condition   Json?  // Optional ABAC conditions

      createdAt DateTime @default(now()) // Optional timestamp

      // Ensure each relationship is unique
      @@unique([subjectType, subjectId, relation, objectType, objectId])
      // Index for finding relationships FOR a subject
      @@index([subjectType, subjectId, relation])
      // Index for finding relationships ON an object
      @@index([objectType, objectId, relation])
    }
    ```
    *   Instantiate with `new PrismaStorageAdapter(prismaClientInstance)`.

```typescript
// filepath: /path/to/your/auth/setup.ts
import { InMemoryStorageAdapter } from 'polizy';
// OR
import { PrismaStorageAdapter } from 'polizy/prisma-storage';
import { PrismaClient } from '@prisma/client'; // Adjust import based on your generated client location

// const prisma = new PrismaClient();
const storage = new InMemoryStorageAdapter();
// const storage = new PrismaStorageAdapter(prisma); // Example using Prisma
```

### 3. Instantiate the AuthSystem

Combine the schema and storage adapter.

```typescript
import { AuthSystem } from 'polizy';

const authz = new AuthSystem({
  schema: mySchema,
  storage: storage,
});
```

### 4. Manage Permissions (Tuples)

Use `allow`, `disallowAllMatching`, `addMember`, `removeMember`, `setParent`, `removeParent`.

```typescript
// Grant direct permission
await authz.allow({
  who: { type: 'user', id: 'alice' },
  toBe: 'owner',
  onWhat: { type: 'document', id: 'doc1' },
});

// Grant conditional permission (e.g., time-based)
await authz.allow({
  who: { type: 'user', id: 'bob' },
  toBe: 'viewer',
  onWhat: { type: 'document', id: 'doc1' },
  when: { validUntil: new Date(Date.now() + 3600 * 1000) } // Valid for 1 hour
});

// Add user to a team
await authz.addMember({
  member: { type: 'user', id: 'carol' },
  group: { type: 'team', id: 'team-alpha' }, // 'team' must be an objectType
});

// Set a parent folder
await authz.setParent({
  child: { type: 'document', id: 'doc2' },
  parent: { type: 'folder', id: 'folder-a' },
});

// Revoke a specific permission (equivalent to old disallow)
await authz.disallowAllMatching({
  who: { type: 'user', id: 'alice' },
  was: 'owner',
  onWhat: { type: 'document', id: 'doc1' },
});

// Revoke all permissions for a specific user on a specific object
await authz.disallowAllMatching({
  who: { type: 'user', id: 'bob' },
  onWhat: { type: 'document', id: 'doc1' },
});

// Revoke all 'viewer' permissions on a specific object
await authz.disallowAllMatching({
  was: 'viewer',
  onWhat: { type: 'document', id: 'doc3' },
});

// Revoke ALL permissions associated with a specific object (e.g., when deleting the object)
await authz.disallowAllMatching({
  onWhat: { type: 'document', id: 'doc-to-delete' },
});

// Revoke ALL permissions granted to a specific user (e.g., when deactivating the user)
await authz.disallowAllMatching({
  who: { type: 'user', id: 'user-to-deactivate' },
});
```

### 5. Check Permissions

Use the `check` method.

```typescript
const canAliceView = await authz.check({
  who: { type: 'user', id: 'alice' },
  canThey: 'view',
  onWhat: { type: 'document', id: 'doc1' },
});
// Result: false (since we removed the 'owner' relation for alice above, and view requires owner/editor/viewer)

const canBobView = await authz.check({
  who: { type: 'user', id: 'bob' },
  canThey: 'view',
  onWhat: { type: 'document', id: 'doc1' },
});
// Result: true (if within the validUntil time)

// Check permission potentially inherited via hierarchy
const canAliceViewDoc2 = await authz.check({
  who: { type: 'user', id: 'alice' }, // Assuming alice has 'view' on 'folder-a'
  canThey: 'view',
  onWhat: { type: 'document', id: 'doc2' }, // doc2 is child of folder-a
});
// Result: true (if hierarchyPropagation is set and alice can view folder-a)

// Check permission potentially inherited via group membership
const canCarolViewDoc3 = await authz.check({
  who: { type: 'user', id: 'carol' }, // carol is member of team-alpha
  canThey: 'view',
  onWhat: { type: 'document', id: 'doc3' }, // Assuming team-alpha was granted 'viewer' on doc3
});
// Result: true
```

### 6. List Accessible Objects (and their permissions)

Use the `listAccessibleObjects` method to find all objects of a specific type a subject can interact with, along with the specific actions allowed for each object identifier (including field-level identifiers). This is useful for building UI elements that only show items a user can interact with.

```typescript
// Find all documents Alice can access and what she can do with each
const aliceDocs = await authz.listAccessibleObjects({
  who: { type: 'user', id: 'alice' },
  ofType: 'document',
});

/* Example Result for aliceDocs.accessible:
[
  {
    object: { type: 'document', id: 'doc1' }, // Alice is owner
    // Note: Actions depend on the specific schema. 'manage_members' might appear if 'owner' grants it.
    actions: [ 'delete', 'edit', 'manage_members', 'share', 'view' ]
  },
  {
    object: { type: 'document', id: 'doc2' }, // Alice has view via hierarchy from folder-a
    actions: [ 'view' ]
  },
  {
    object: { type: 'document', id: 'doc9#field' }, // Alice has direct view on field
    actions: [ 'view' ]
  }
  // Note: Base object 'doc9' would only appear if Alice had direct/group/hierarchy access to it specifically.
]
*/

// Find only documents that Carol (member of team-alpha) can 'edit'
const carolEditableDocs = await authz.listAccessibleObjects({
  who: { type: 'user', id: 'carol' },
  ofType: 'document',
  canThey: 'edit', // Optional filter
});

/* Example Result for carolEditableDocs.accessible:
[
  {
    object: { type: 'document', id: 'doc3' }, // team-alpha is editor
    actions: [ 'edit', 'share', 'view' ] // Returns all allowed actions for the object, even when filtering by one action
  }
  // Assuming doc5 was also editable via hierarchy in the full setup
  // { object: { type: 'document', id: 'doc5' }, actions: [ 'edit', 'share', 'view' ] }
]
*/
```

## Examples

See the test files in `src/scenarios/` (especially `polizy.listAccessibleObjects.test.ts`) for more detailed examples covering different authorization patterns like RBAC, ABAC (via conditions), hierarchy, and group-based access.

*(Example based on `polizy.example1.test.ts`)*

```typescript
// Schema for Performance Reviews
const reviewSchema = defineSchema({
  subjectTypes: ["user"],
  objectTypes: ["review"],
  relations: {
    owner: { type: "direct" },
    viewer: { type: "direct" },
    editor: { type: "direct" },
  },
  actionToRelations: {
    view: ["viewer", "editor", "owner"],
    edit: ["editor", "owner"],
    manage: ["owner"],
  },
});

const storage = new InMemoryStorageAdapter();
const authz = new AuthSystem({ storage, schema: reviewSchema });

// Manager owns the review
await authz.allow({
  who: { type: "user", id: "manager1" },
  toBe: "owner",
  onWhat: { type: "review", id: "cert1" },
});

// Employee can view a specific section initially
await authz.allow({
  who: { type: "user", id: "employee1" },
  toBe: "viewer",
  onWhat: { type: "review", id: "cert1#strengths" }, // Object with field-level granularity
});

// Check: Manager can manage
assert.ok(await authz.check({
  who: { type: "user", id: "manager1" },
  canThey: "manage",
  onWhat: { type: "review", id: "cert1" },
})); // true

// Check: Employee can view strengths
assert.ok(await authz.check({
  who: { type: "user", id: "employee1" },
  canThey: "view",
  onWhat: { type: "review", id: "cert1#strengths" },
})); // true

// Check: Employee cannot edit strengths initially
assert.strictEqual(await authz.check({
  who: { type: "user", id: "employee1" },
  canThey: "edit",
  onWhat: { type: "review", id: "cert1#strengths" },
}), false); // false

// Grant edit permission to employee
await authz.allow({
  who: { type: "user", id: "employee1" },
  toBe: "editor",
  onWhat: { type: "review", id: "cert1#strengths" },
});

// Check: Employee can now edit strengths
assert.ok(await authz.check({
  who: { type: "user", id: "employee1" },
  canThey: "edit",
  onWhat: { type: "review", id: "cert1#strengths" },
})); // true
```

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.
