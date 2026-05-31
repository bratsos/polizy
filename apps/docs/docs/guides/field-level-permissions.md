---
title: Field-Level Permissions
sidebar_position: 7
---

# Field-Level Permissions

By default, permissions in polizy are granted on a whole object, such as a file, folder, or project. However, there are times when you need more granular access control, like allowing a manager to view a full medical record while only allowing an employee to view specific fields like their own strengths or performance summaries.

polizy makes this easy with **Field-Level Permissions**.

This guide shows you how to declare field-level objects in your schema, configure base-vs-field authorization, and protect against accidental leaks.

:::note Theory & Concepts
To learn more about standard permissions and mapping relations to actions, check out **[Relations and Actions](../core-concepts/relations-and-actions.md)**.
:::

## 1. Configure the Schema

To enable field-level permissions for an object type, declare it inside the `fieldLevelObjects` array in your schema configuration.

```ts
import { defineSchema } from "polizy";

const schema = defineSchema({
  subjectTypes: ["user"],
  objectTypes: ["document"],
  
  // Enable field-level permissions for "document"
  fieldLevelObjects: ["document"],

  relations: {
    owner: { type: "direct" },
    viewer: { type: "direct" },
  },

  actionToRelations: {
    view: ["owner", "viewer"],
  },
});
```

---

## 2. Base vs. Field Grants

Once an object type is listed in `fieldLevelObjects`, you can append a field to the object's ID using a `#` separator (e.g., `document:cert1#strengths`).

The system evaluates access using two rules:
1. **Base-to-Field Propagation**: A grant on the base object (e.g., `document:cert1`) authorizes access to all fields of that object.
2. **Field-Scoped Scoping**: A grant on a specific field (e.g., `document:cert1#strengths`) only authorizes access to that specific field and does not grant access to any other fields or the base object itself.

Here is how you grant and check this in code:

```ts
import { AuthSystem, InMemoryStorageAdapter } from "polizy";

const authz = new AuthSystem({
  storage: new InMemoryStorageAdapter(),
  schema,
});

const manager = { type: "user", id: "manager-bob" };
const employee = { type: "user", id: "employee-alice" };

// 1. Grant the manager owner access to the entire base object
await authz.allow({
  who: manager,
  toBe: "owner",
  onWhat: { type: "document", id: "cert1" },
});

// 2. Grant the employee viewer access to ONLY the "strengths" field
await authz.allow({
  who: employee,
  toBe: "viewer",
  onWhat: { type: "document", id: "cert1#strengths" },
});

// --- Checks ---

// Manager can view the specific field (authorized via base -> field propagation)
await authz.check({
  who: manager,
  canThey: "view",
  onWhat: { type: "document", id: "cert1#strengths" },
}); // => true

// Employee can view the specific field they were granted
await authz.check({
  who: employee,
  canThey: "view",
  onWhat: { type: "document", id: "cert1#strengths" },
}); // => true

// Employee CANNOT view a different field on the same object
await authz.check({
  who: employee,
  canThey: "view",
  onWhat: { type: "document", id: "cert1#weaknesses" },
}); // => false
```

---

## 3. Safety Features

polizy includes built-in safety features to prevent accidental security issues.

### Write Validation

Field identifiers are validated at the time you write them. If you try to write an invalid field identifier, polizy will throw an error immediately:

- **Empty Base Object ID**: Creating a tuple with `{ type: "document", id: "#field" }` will throw.
- **Empty Field ID**: Creating a tuple with `{ type: "document", id: "doc1#" }` will throw.

### No Accidental Splits

Only object types explicitly declared in `fieldLevelObjects` are split by the `#` separator. 

If an object type is **not** in `fieldLevelObjects`, its ID is treated as a literal string. For example, if `project` is not configured for field-level access, then `project:proj1#milestones` is treated as a single undivided ID. This ensures IDs that naturally contain `#` characters cannot accidentally leak access or bypass checks.
