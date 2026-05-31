---
title: Quickstart
sidebar_position: 3
---

# Quickstart

Welcome! In this quickstart, you will build a complete, working permission system from scratch and run your first access check in under five minutes. 

We will model a simple document sharing system where users can view, edit, or delete documents depending on their relationships. And best of all: we will use an in-memory adapter, so you do not need to configure any databases to get started.

---

## The Complete Example

Here is the complete, runnable code we will build. Create a file named `quickstart.js` (or `quickstart.ts`) and copy-paste this code:

```typescript
import { defineSchema, AuthSystem, InMemoryStorageAdapter } from "polizy";

async function main() {
  // 1. Describe your permission model.
  const schema = defineSchema({
    subjectTypes: ["user"],
    objectTypes: ["document"],
    relations: {
      owner: { type: "direct" },
      editor: { type: "direct" },
      viewer: { type: "direct" },
    },
    actionToRelations: {
      view: ["viewer", "editor", "owner"],
      edit: ["editor", "owner"],
      delete: ["owner"],
    },
  });

  // 2. Create the AuthSystem with in-memory storage.
  const authz = new AuthSystem({ 
    storage: new InMemoryStorageAdapter(), 
    schema 
  });

  // 3. Grant some relationships.
  await authz.allow({ 
    who: { type: "user", id: "alice" }, 
    toBe: "owner", 
    onWhat: { type: "document", id: "readme" } 
  });

  await authz.allow({ 
    who: { type: "user", id: "bob" }, 
    toBe: "viewer", 
    onWhat: { type: "document", id: "readme" } 
  });

  // 4. Ask questions.
  const aliceCanEdit = await authz.check({ 
    who: { type: "user", id: "alice" }, 
    canThey: "edit", 
    onWhat: { type: "document", id: "readme" } 
  }); 
  console.log(`Can Alice edit? ${aliceCanEdit}`); // true — owners can edit

  const bobCanEdit = await authz.check({ 
    who: { type: "user", id: "bob" },   
    canThey: "edit", 
    onWhat: { type: "document", id: "readme" } 
  }); 
  console.log(`Can Bob edit? ${bobCanEdit}`); // false — viewers cannot

  const bobCanView = await authz.check({ 
    who: { type: "user", id: "bob" },   
    canThey: "view", 
    onWhat: { type: "document", id: "readme" } 
  }); 
  console.log(`Can Bob view? ${bobCanView}`); // true — viewers can view
}

main().catch(console.error);
```

Let's break down how this works step-by-step.

---

## Step 1: Describe your permission model

First, we define a **schema**. The schema represents the rules of your application's world: what kinds of things exist, how they relate to one another, and what actions those relationships allow.

```typescript
const schema = defineSchema({
  subjectTypes: ["user"],
  objectTypes: ["document"],
  relations: {
    owner: { type: "direct" },
    editor: { type: "direct" },
    viewer: { type: "direct" },
  },
  actionToRelations: {
    view: ["viewer", "editor", "owner"],
    edit: ["editor", "owner"],
    delete: ["owner"],
  },
});
```

- **`subjectTypes` & `objectTypes`**: We define our actors (`user`) and the resources they act upon (`document`).
- **`relations`**: These are the basic facts we can store. In this example, we define three direct relationships: `owner`, `editor`, and `viewer`.
- **`actionToRelations`**: This maps the actions you want to check (like `view`, `edit`, or `delete`) to the relations that grant them. For example, editing a document requires someone to be either its `editor` or `owner`.

:::tip Schema Safety
If you reference a relation in `actionToRelations` that is not defined in `relations`, `defineSchema` will immediately throw a `SchemaError` at startup. This prevents typos and keeps your authorization rules consistent!
:::

---

## Step 2: Create the AuthSystem

Once the schema is defined, we initialize the `AuthSystem`. The `AuthSystem` is the primary interface you will interact with in your codebase to grant permissions and check access.

```typescript
const authz = new AuthSystem({ storage: new InMemoryStorageAdapter(), schema });
```

Here, we pass in the schema we created in Step 1, along with the `InMemoryStorageAdapter` we selected during installation.

---

## Step 3: Grant relationships

With the authorization system initialized, we can start storing relationship facts. We do this using `authz.allow()`.

```typescript
await authz.allow({ 
  who: { type: "user", id: "alice" }, 
  toBe: "owner", 
  onWhat: { type: "document", id: "readme" } 
});

await authz.allow({ 
  who: { type: "user", id: "bob" }, 
  toBe: "viewer", 
  onWhat: { type: "document", id: "readme" } 
});
```

Notice how `allow` reads naturally like a sentence:
* "Allow **user alice** to be the **owner** on **document readme**."
* "Allow **user bob** to be the **viewer** on **document readme**."

Under the hood, these calls write relationship tuples to our storage adapter. These calls are also **idempotent**—calling them multiple times with the same inputs will not create duplicate entries.

---

## Step 4: Ask questions

Now for the magic! We check whether a subject has permission to perform an action on an object using `authz.check()`.

```typescript
// 1. Can Alice edit the readme document?
const aliceCanEdit = await authz.check({ 
  who: { type: "user", id: "alice" }, 
  canThey: "edit", 
  onWhat: { type: "document", id: "readme" } 
}); // Returns: true
```
**Why `true`?** Because Alice is the `owner` of the readme, and our schema states that the `edit` action is allowed for the `owner` relation.

```typescript
// 2. Can Bob edit the readme document?
const bobCanEdit = await authz.check({ 
  who: { type: "user", id: "bob" }, 
  canThey: "edit", 
  onWhat: { type: "document", id: "readme" } 
}); // Returns: false
```
**Why `false`?** Bob is a `viewer` of the readme. Our schema does not map the `edit` action to the `viewer` relation, so the check fails.

```typescript
// 3. Can Bob view the readme document?
const bobCanView = await authz.check({ 
  who: { type: "user", id: "bob" }, 
  canThey: "view", 
  onWhat: { type: "document", id: "readme" } 
}); // Returns: true
```
**Why `true`?** Because Bob is a `viewer` of the readme, and our schema maps the `view` action to the `viewer` relation.

:::note Raising Errors Instead
If you prefer throwing an error instead of returning a boolean when a check fails, you can use `await authz.checkOrThrow(...)` which will throw a `NotAuthorizedError`.
:::

---

## What You Learned

In this quickstart, you successfully:
* Defined a type-safe **Schema** mapping actions to relationships.
* Initialized an **AuthSystem** using an in-memory storage adapter.
* Created relationship facts with **`authz.allow`**.
* Checked permissions using **`authz.check`** and observed how rules mapped in the schema are enforced.

## Where to Next?

* **[Core Concepts](../core-concepts/overview.md)** — Dive deeper into subjects, objects, relations, and how polizy resolves checks.
* **[Guides Overview](../guides/overview.md)** — Learn how to model real-world patterns like nested folders, user groups, and temporary access.
