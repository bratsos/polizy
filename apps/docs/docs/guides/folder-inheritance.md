---
title: Folder Inheritance
sidebar_position: 4
---

# Folder Inheritance

In many systems, resources exist inside other containers—like files inside folders, tasks inside projects, or channels inside workspaces. Instead of granting permissions on every individual child resource, you want permissions on the parent container to automatically flow down to its contents.

This guide explains how to define hierarchical relations, set up parent-child links, and propagate permissions.

:::note[Schema Reference]

For a complete overview of schema definition fields and properties, see the **[Schema Reference](../schema/schema-reference.md)**.

:::

## 1. Configure the schema

To support inheritance, your schema must include a relation with `type: "hierarchy"`, and configure the `hierarchyPropagation` mapping to define how actions flow down from parent to child.

```ts
import { defineSchema } from "polizy";

const schema = defineSchema({
  subjectTypes: ["user"],
  objectTypes: ["document", "folder"],

  relations: {
    // Declares that an object can have a hierarchical parent
    parent: { type: "hierarchy" },
    
    // Direct relations on files/folders
    viewer: { type: "direct" },
    editor: { type: "direct" },
  },

  actionToRelations: {
    view: ["viewer", "editor"],
    edit: ["editor"],
  },

  // Defines how parent permissions flow to children
  hierarchyPropagation: {
    // If a subject can "view" a parent object, they can "view" this child
    view: ["view"],
    // If a subject can "edit" a parent object, they can "edit" this child
    edit: ["edit"],
  },
});
```

## 2. Link a child to a parent folder

Use `setParent` to place a resource inside a parent container.

```ts
import { AuthSystem, InMemoryStorageAdapter } from "polizy";

const authz = new AuthSystem({
  storage: new InMemoryStorageAdapter(),
  schema,
});

// Put "annual-report.pdf" inside the "finance" folder
await authz.setParent({
  child: { type: "document", id: "annual-report.pdf" },
  parent: { type: "folder", id: "finance" },
});
```

## 3. Grant access to the parent folder

Grant permissions on the parent folder using `allow`:

```ts
// Let Alice view the finance folder
await authz.allow({
  who: { type: "user", id: "alice" },
  toBe: "viewer",
  onWhat: { type: "folder", id: "finance" },
});
```

## 4. Check inherited access

When checking permissions on the child resource, polizy automatically walks up the hierarchy and evaluates permissions based on your `hierarchyPropagation` rules:

```ts
const canView = await authz.check({
  who: { type: "user", id: "alice" },
  canThey: "view",
  onWhat: { type: "document", id: "annual-report.pdf" },
});

console.log(canView); // true (inherited from parent "finance" folder)
```

## 5. Remove or move child resources

To remove a child resource from its folder, use `removeParent`. They will immediately lose inherited permissions:

```ts
await authz.removeParent({
  child: { type: "document", id: "annual-report.pdf" },
  parent: { type: "folder", id: "finance" },
});

const canViewAfter = await authz.check({
  who: { type: "user", id: "alice" },
  canThey: "view",
  onWhat: { type: "document", id: "annual-report.pdf" },
});

console.log(canViewAfter); // false
```

:::tip[Moving Resources]

To move an object to a new parent, run `removeParent` for the old parent and `setParent` for the new parent. Because these operations are lightweight, hierarchy updates resolve instantly.

:::

---

## Advanced Scenarios

### Multiple hierarchy relations (using the `as` parameter)

If your schema defines more than one hierarchy relation (for example, `parent` for folders and `orgParent` for organizations), you must specify which relation to use with the `as` parameter:

```ts
// Schema with multiple hierarchy relations
const multiHierarchySchema = defineSchema({
  subjectTypes: ["user"],
  objectTypes: ["document", "folder", "org"],
  relations: {
    parent: { type: "hierarchy" },
    orgParent: { type: "hierarchy" },
    viewer: { type: "direct" },
  },
  actionToRelations: {
    view: ["viewer"],
  },
  hierarchyPropagation: {
    view: ["view"]
  }
});

// ... instantiate authz ...

// Specify "as" because the system cannot infer which relation to use
await authz.setParent({
  child: { type: "document", id: "annual-report.pdf" },
  parent: { type: "folder", id: "finance" },
  as: "parent",
});

// The same requirement applies when removing a parent
await authz.removeParent({
  child: { type: "document", id: "annual-report.pdf" },
  parent: { type: "folder", id: "finance" },
  as: "parent",
});
```

:::warning[Inference Behavior]

The `as` parameter is optional and inferred automatically **only** when there is exactly one `hierarchy` relation defined in your schema.

:::
