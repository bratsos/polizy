---
title: Relations and Actions
sidebar_position: 2
---

# Relations and Actions

Understanding the distinction between **relations** and **actions** is the key to designing an elegant authorization model in polizy. 

* **Relations** are the raw, stored facts about how entities connect.
* **Actions** are the intents or permissions you check at runtime.

By separating the two, your code doesn't need to know *why* a user is allowed to do something (e.g., whether they are the direct owner or part of a group). Your code simply checks if they can perform the **action**, and polizy determines which **relations** satisfy that action.

---

## The Three Relation Types

Every relation in polizy has a defined type that governs how it behaves during permission checks. polizy supports three core relation types:

### 1. Direct Relations (`direct`)
A **direct** relation is the simplest connection. It maps a subject (like a user or team) directly to an object.

* **Conceptual Example**: A user is assigned a specific role on a document.
* **Stored Fact**: `(user:alice, owner, document:doc1)`
* **Meaning**: Alice is directly the owner of `doc1`.

### 2. Group Relations (`group`)
A **group** relation links a subject to a group or container it belongs to. Group relationships can be nested (e.g., a team inside a department).

* **Conceptual Example**: A user is a member of a team.
* **Stored Fact**: `(user:alice, member, team:engineering)`
* **How it resolves**: If `team:engineering` is granted direct access to `document:doc1`, polizy automatically traverses the `member` relationship to determine that Alice also has access.

### 3. Hierarchy Relations (`hierarchy`)
A **hierarchy** relation links one object to another object representing its parent. This is commonly used for folders and files.

* **Conceptual Example**: A document is located inside a folder.
* **Stored Fact**: `(document:doc1, parent, folder:f1)`
* **Meaning**: `document:doc1` points to its parent `folder:f1`.
* **How it resolves**: Permissions flow down from the parent object to the child object based on your schema's propagation rules.

:::tip Multi-relation Support
polizy is not limited to a single group or hierarchy relation. You can declare multiple types (e.g., `member` and `orgMember` for groups, or `folderParent` and `orgParent` for hierarchies). polizy will traverse all defined relations during a check.
:::

---

## Mapping Actions to Relations

Your schema uses `actionToRelations` to define which relations satisfy a given action. 

For example, who should be allowed to perform the `edit` action on a document? Probably the `owner` and any `editor`. You express this in your schema mapping:

```typescript
actionToRelations: {
  view: ["viewer", "editor", "owner"],
  edit: ["editor", "owner"],
  delete: ["owner"],
}
```

When your application checks `authz.check({ who, canThey: "edit", onWhat })`, polizy looks at this mapping, sees that `edit` requires either `editor` or `owner`, and searches for those relationships between the subject and the object.

---

## Hierarchy Propagation

Hierarchies allow permissions to flow from parents to children, which is incredibly useful for nested resources. However, you don't always want every action to propagate. While viewing a folder should allow you to view the files inside it, being allowed to delete a folder might not mean you can delete all the files inside.

This is configured via `hierarchyPropagation`, which conceptually maps **child actions** to the **parent actions** that grant them.

For example:
```typescript
hierarchyPropagation: {
  view: ["view"],  // If you can view the parent folder, you can view the child document
  edit: ["edit"],  // If you can edit the parent folder, you can edit the child document
  delete: [],      // Deleting the parent folder does not grant deletion of the child document
}
```

When checking if a user can `view` a document, polizy:
1. Looks for direct grants on the document.
2. If none are found, it looks up the document's parent (e.g., a folder).
3. It checks if the user has `view` permission on the parent folder. Because the schema specifies that the parent's `view` action propagates to the child's `view` action, this satisfies the check!

To learn how to define and configure these relations and actions in your system's code, head over to the [Schema Reference](../schema/schema-reference.md).
