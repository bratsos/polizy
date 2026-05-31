---
title: Defining a Schema
sidebar_position: 1
---

# Defining a Schema

To get started with polizy, you need to describe how your users, teams, documents, and other entities relate to one another. You do this by defining a **schema**.

A schema serves as the single source of truth for your authorization rules. By writing a schema, you gain:
* **Type safety:** polizy automatically generates strict TypeScript types from your schema, so your IDE will autocomplete relations and actions, and catch typos at compile time.
* **Fail-fast validation:** At runtime, polizy validates your model structure when starting up. If you make a typo in your definitions, it will immediately let you know.

In this guide, we will walk through how to construct a schema, look at the core building blocks, and set up an authorization system using your schema.

---

## A Complete Schema Example

Here is a complete schema configuration featuring subjects, objects, relations (direct, group, and hierarchy), action mappings, and hierarchy propagation rules. This example matches the standard layout for a typical application:

```ts
import { defineSchema } from "polizy";

const schema = defineSchema({
  subjectTypes: ["user", "team"],
  objectTypes: ["document", "folder", "team"],

  relations: {
    owner: { type: "direct" },
    editor: { type: "direct" },
    viewer: { type: "direct" },
    member: { type: "group" },      // links a subject to a group it belongs to
    parent: { type: "hierarchy" },  // links a child object to its parent
  },

  actionToRelations: {
    view: ["viewer", "editor", "owner", "member"],
    edit: ["editor", "owner"],
    delete: ["owner"],
  },

  // How permissions flow from a parent to its children.
  hierarchyPropagation: {
    view: ["view"], // if you can view the parent, you can view the child
    edit: ["edit"],
    delete: [],
  },

  // Opt in to field-level identifiers (see "Field-level permissions").
  fieldLevelObjects: ["document"],
  // fieldSeparator defaults to "#"
});
```

---

## Step-by-Step Breakdown

Let's break down each configuration option so you can build your own custom schema.

### 1. Subject and Object Types

You begin by specifying the resource types in your application:
* **`subjectTypes`**: The types of actors that can request access (for example, `"user"` or `"team"`).
* **`objectTypes`**: The types of resources being acted upon (such as `"document"`, `"folder"`, or even `"team"` if you check permissions on teams).

```ts
subjectTypes: ["user", "team"],
objectTypes: ["document", "folder", "team"],
```

### 2. Relations

Relations define the *types of connections* between subjects and objects. You can declare three distinct relation types:

* **Direct (`direct`):** A direct link between a subject and an object. For example, assigning a user as an `owner` of a file.
* **Group (`group`):** A link from a subject to a grouping entity like a team. This allows group-based access control (RBAC/teams).
* **Hierarchy (`hierarchy`):** A link between two objects (like child-to-parent) to enable nesting (for example, files inside folders).

```ts
relations: {
  owner: { type: "direct" },
  member: { type: "group" },
  parent: { type: "hierarchy" },
}
```

:::tip Multiple Group or Hierarchy Relations
You are not limited to just one relation of each type! You can declare multiple group relations (such as `member` and `orgMember`) or multiple hierarchy relations (such as `folderParent` and `orgParent`). polizy's engine will automatically traverse all of them when running a check.
:::

For a deeper dive into relations and how they compare to actions, check out [Relations and Actions](../core-concepts/relations-and-actions.md).

### 3. Mapping Actions to Relations

Actions are the permissions you check in your code (like `view`, `edit`, or `delete`). The `actionToRelations` block maps each action to the relations that grant it.

For example, to check who can `edit` a document:

```ts
actionToRelations: {
  view: ["viewer", "editor", "owner", "member"],
  edit: ["editor", "owner"],
  delete: ["owner"],
}
```

When you perform a check for the `edit` action, polizy searches the graph to see if the subject has either the `editor` or `owner` relation to the object.

### 4. Hierarchy Propagation

If you have nested resources (such as documents in a folder), permissions can flow from parents to children. The `hierarchyPropagation` option lets you configure how actions on a parent resource map to actions on a child resource.

```ts
hierarchyPropagation: {
  view: ["view"], // if you can view the parent folder, you can view the child document
  edit: ["edit"],
  delete: [],     // delete permission does not flow down
}
```

This specifies that a user who can `view` the parent folder is also allowed to `view` the child document. However, being able to `delete` a parent folder does not automatically grant deletion rights on the child document.

### 5. Field-Level Permissions

Sometimes you need to control access to specific fields on an object (for example, letting users edit a document's body but not its metadata).

* **`fieldLevelObjects`**: A list of object types that support field-level identifiers.
* **`fieldSeparator`**: The character used to split the object ID from the field name. This defaults to `"#"` if not specified.

```ts
fieldLevelObjects: ["document"],
// e.g. checking document:doc1#body
```

---

## Schema Safety: Fail-Fast Validation

To prevent configuration errors from causing silent auth bypasses or crashes in production, `defineSchema` validates your schema configuration when your application loads.

If you make a mistake, polizy will immediately throw a `SchemaError`. For example:
* Defining an action in `actionToRelations` that references a relation that is not defined in `relations`.
* Referencing an action in `hierarchyPropagation` that is not defined in `actionToRelations`.

This ensures your security model is always structurally sound.

---

## Next Steps

Once your schema is defined, you are ready to plug it into an `AuthSystem` instance and start storing relations and performing permission checks.

* To learn more about all the configuration options and types, read the [Schema Reference](./schema-reference.md).
* To see how to initialize the authorization engine with your schema, check out the [Quickstart](../getting-started/quickstart.md).
