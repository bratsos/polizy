---
title: Schema Reference
sidebar_position: 2
---

# Schema Reference

This page provides a reference for the `defineSchema` options, relation types, and `AuthSystem` configuration parameters.

For a task-oriented guide on how to configure your schema, see [Defining a Schema](./overview.md).

---

## `defineSchema` Options

| Option | Type | Required? | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `relations` | `Record<string, RelationDefinition>` | Yes | — | Maps relation names to their definition type (`direct`, `group`, or `hierarchy`). |
| `actionToRelations` | `Record<string, string[]>` | Yes | — | Maps action names to an array of relations that grant the action. |
| `subjectTypes` | `string[]` | No | `[]` | List of allowed subject types. Restricts subject types checked or granted at compile-time. |
| `objectTypes` | `string[]` | No | `[]` | List of allowed object types. Restricts object types checked or granted at compile-time. |
| `hierarchyPropagation` | `Record<string, string[]>` | No | `undefined` | Defines how actions flow down from parent objects to child objects. |
| `fieldLevelObjects` | `string[]` | No | `[]` | Object types that support field-level identifiers. |
| `fieldSeparator` | `string` | No | `"#"` | Character that separates an object ID from a field name. |

---

## Relation Types

| Type | Semantics | Example |
| :--- | :--- | :--- |
| `direct` | A direct link between a subject and an object. | A user is the owner of a document. |
| `group` | Links a subject to a grouping resource (allows nested check traversal). | A user is a member of a team. |
| `hierarchy` | Links a child object to a parent object to propagate permissions. | A document is inside a folder. |

---

## `AuthSystem` Constructor Options

| Option | Type | Required? | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `storage` | `StorageAdapter` | Yes | — | The storage adapter to persist and retrieve relationship tuples. |
| `schema` | `AuthSchema` | Yes | — | The schema returned by `defineSchema`. |
| `defaultCheckDepth` | `number` | No | `20` | Maximum number of recursive hops allowed during group or hierarchy checks. |
| `maxDepthBehavior` | `"throw" \| "deny"` | No | `"throw"` | Action when recursion exceeds maximum depth. `"throw"` raises a `MaxDepthExceededError`. `"deny"` returns `false`. |
| `logger` | `Logger` | No | No-op logger | Logger instance (e.g. `console`) used to write debug or execution details. |
| `fieldSeparator` | `string` | No | Schema's separator or `"#"` | Overrides the character used to separate object IDs from field names. |

---

## Additional Configuration Details

### `hierarchyPropagation` Shape

The `hierarchyPropagation` object maps a **child action** to an array of **parent actions** that satisfy it:

```ts
hierarchyPropagation: {
  [childActionName: string]: string[] // array of parent action names
}
```

When evaluating a permission check on a child object, if no direct grants are found, polizy traverses up the hierarchy using relations of type `hierarchy`. It then checks if the subject can perform any of the mapped parent actions on the parent object.

For details on implementing nesting, see the [Folder Inheritance Guide](../guides/folder-inheritance.md).

### `fieldLevelObjects` and `fieldSeparator`

When an object type is listed in `fieldLevelObjects`, you can check permissions on specific fields using the following separator syntax:

```ts
// subject: user:alice
// action: edit
// object: document:doc1#body
```

polizy automatically splits the object ID from the field identifier at the defined `fieldSeparator` (e.g. `"#"` or custom separator).

For details on implementing fine-grained field permissions, see the [Field-Level Permissions Guide](../guides/field-level-permissions.md).
