---
title: The Mental Model
sidebar_position: 1
---

# The Mental Model

At its core, **polizy** shifts how you think about authorization. In traditional applications, permission logic is often scattered across codebases as conditional statements:

```typescript
if (user.role === "admin" || document.ownerId === user.id) {
  // Allow edit
}
```

As your application grows, these checks become complex, hard to audit, and difficult to adapt to new requirements (like team sharing, nested folders, or fine-grained field-level permissions).

polizy approaches this differently: **authorization is treated as data**. 

Instead of writing custom conditional code to traverse relationships, you store facts about your system, define a schema that governs how those facts relate to actions, and let polizy handle the traversal.

---

## Storing Facts: Tuples

The fundamental unit of authorization in polizy is a **tuple**. A tuple is a simple, stored fact that represents a relationship between a **subject** and an **object**. 

A tuple typically has four components:
1. **Subject**: Who is acting. This is usually a user, but it can also be a group (like a team) acting as a subject.
2. **Relation**: The name of the relationship linking the subject to the object.
3. **Object**: What is being acted upon.
4. **Condition** *(optional)*: Additional context-based constraints, such as a time window or attribute predicates.

When you store a tuple, it reads like a simple sentence:

```text
(subject)               (relation)     (object)
Subject: user:alice     editor         Object: document:doc1
```

> **"Alice is an editor of document doc1."**

Every permission check resolves to a simple question: *Based on the facts we have stored, is there a path of relationships that connects this subject to this object through a valid relation?*

---

## Defining the Rules: Schema

While **tuples** represent the raw facts, your **schema** defines what those facts actually mean. 

The schema acts as the blueprint for your authorization system. It dictates:
* **Subject Types & Object Types**: The types of entities allowed in your system (e.g. `user`, `team`, `document`, `folder`).
* **Relations**: The available relationship names and their structural types (e.g. `owner` as a direct relation, `member` as a group relation, or `parent` as a hierarchical relation).
* **Actions**: The intents you actually check in your application (e.g. `view`, `edit`, `delete`). The schema maps each action to one or more relations that satisfy it.

By separating **facts** (stored in your database as tuples) from **rules** (defined in your schema), you can change your business logic—like allowing editors to delete files—by modifying a single schema configuration, without changing how you save users or documents.

For a detailed walkthrough on setting up your system's rules, see [Defining a Schema](../schema/overview.md).

---

## How It Fits Together

When a user tries to edit a document, your application doesn't fetch the document, look up their role, and run complex `if` logic. Instead, it asks polizy a single question:

```typescript
await authz.check({
  who: { type: "user", id: "alice" },
  canThey: "edit",
  onWhat: { type: "document", id: "doc1" }
});
```

To answer this, polizy:
1. Looks up the action `edit` in your schema and finds that it requires the `owner` or `editor` relation.
2. Searches the stored tuples for facts showing that `user:alice` has the `owner` or `editor` relation on `document:doc1`.
3. Expands the search to see if Alice belongs to any teams (groups) that have those relations, or if the document is inside a folder (hierarchy) that passes down those permissions.

By modeling authorization as a graph of relationships, polizy provides a clean, predictable, and highly performant way to scale permissions as your product grows.

Ready to dive deeper into how relationships and actions connect? Read about [Relations and Actions](./relations-and-actions.md).
