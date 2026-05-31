---
title: Read Scopes & Batching
sidebar_position: 2
---

# Read Scopes & Batching

When you build a dynamic user interface—such as a data grid or a dashboard—you often need to perform several authorization checks in a single page load. For example, you might need to list accessible documents, check if a user can edit a list of items, and explain the permission path for a specific resource. 

If these calls are made independently, they each spin up a new reader, leading to duplicate queries for the same parent groups or folder relationships. 

To solve this, polizy provides **Read Scopes** and **Batching** to coordinate reads and ensure you fetch each piece of data at most once.

---

## Combining Checks with `withReadScope`

The `withReadScope` method groups multiple authorization operations into a single logical execution block. Inside the scope, all operations share a **single read pass** and reuse the same database reader.

```ts
const view = await authz.withReadScope(async (scope) => {
  // 1. List all documents the user can see
  const docs = await scope.listAccessibleObjects({ 
    who: { type: "user", id: "alice" }, 
    ofType: "document" 
  });

  // 2. Perform a batch check for a grid of items
  const grid = await scope.checkMany(rows);

  // 3. Explain why the user has edit rights on a specific item
  const why = await scope.explain({ 
    who: { type: "user", id: "alice" }, 
    canThey: "edit", 
    onWhat: { type: "document", id: "doc1" } 
  });

  return { docs, grid, why };
}, { preload: true });
```

### Shared Reader Behavior

Inside the callback, the following scope methods share the same reader:
*   `scope.check`
*   `scope.checkMany`
*   `scope.explain`
*   `scope.listAccessibleObjects`
*   `scope.listSubjects`

Any subject, object, or relation tuple retrieved by one of these calls is cached in memory. Subsequent calls within the scope will resolve matching relations from this in-memory cache without hitting database storage again.

---

## Optimizing with Preloading

When initializing a read scope, you can pass the `preload` option to customize how tuples are fetched:

```ts
await authz.withReadScope(async (scope) => { ... }, { preload: true });
```

### When to use `{ preload: true }`
*   **Expensive Round-Trips**: When your storage is located across a slow network link or runs in-browser (e.g., SQLite in WebAssembly, IndexedDB, or local storage).
*   **Small Working Sets**: When the total number of relationship tuples in your database is relatively small (e.g., hundreds or a few thousand tuples).
*   **How it works**: polizy fetches the **entire** tuple set in one query up front. All subsequent checks in the scope resolve instantly in memory.

### When to omit `preload` (or set to `false`)
*   **Large Production Databases**: When you have tens of thousands of tuples or more. Fetching the whole database would consume too much memory and network bandwidth.
*   **How it works**: polizy falls back to on-demand, per-key range reads, which target only the relevant branches of your hierarchy. This approach scales efficiently with large database sizes.

---

## Batching with `checkMany`

Even outside of `withReadScope`, if you have a list of items to check, you should always prefer `checkMany` over looping `check`. 

`checkMany` automatically instantiates a single reader across the whole batch of requests, collapsing duplicate parent-child and group lookup queries into a single pass:

```ts
const checks = [
  { who: { type: "user", id: "alice" }, canThey: "view", onWhat: { type: "document", id: "doc1" } },
  { who: { type: "user", id: "alice" }, canThey: "edit", onWhat: { type: "document", id: "doc2" } },
  { who: { type: "user", id: "alice" }, canThey: "delete", onWhat: { type: "document", id: "doc3" } },
];

const results = await authz.checkMany(checks);
// returns an array of booleans: [true, false, true]
```
