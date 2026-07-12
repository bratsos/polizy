---
title: Listing & Debugging
sidebar_position: 10
---

# Listing & Debugging

Building a secure application requires more than just checking permissions at runtime. You also need to:
1. **List resources**: Render grids or pages containing only the objects a user can view or edit.
2. **Audit permissions**: Determine which users have access to a specific object.
3. **Debug issues**: Diagnose exactly why a check passed or failed (e.g. tracing which group membership or parent folder inherited the permission).
4. **Inspect tuples**: Retrieve the raw facts stored in your database.

polizy provides first-class inspection APIs to answer these questions without requiring full-table scans or complex custom queries.

:::note[How Checks Resolve]

To understand how polizy searches relationship paths to compute these results, read **[How Checks Resolve](../core-concepts/how-checks-resolve.md)**.

:::

## 1. Listing Accessible Objects (`listAccessibleObjects`)

To show a user a list of resources they have permission to interact with, use `listAccessibleObjects`. This scales efficiently with the subject's reachable set and does not perform a full-table scan.

```ts
const { accessible } = await authz.listAccessibleObjects({
  who: { type: "user", id: "alice" },
  ofType: "document",
  
  // Optional filters & pagination
  canThey: "view", // Filter by a specific action (e.g. view or edit)
  limit: 20,
  offset: 0,
});

console.log(accessible);
/*
Output:
[
  { 
    object: { type: "document", id: "doc1" }, 
    actions: ["view", "edit"], 
    parent: { type: "folder", id: "fA" } 
  },
  ...
]
*/
```

---

## 2. Listing Authorized Subjects (`listSubjects`)

If you need to know who has access to a particular resource (for example, to display a list of members with access to a document), use `listSubjects`. This performs a "reverse expansion" of permissions.

Like `listAccessibleObjects`, `listSubjects` supports stable pagination via `limit` and `offset` parameters, which are applied after a stable, deterministic sort of the matched subjects.

```ts
const subjects = await authz.listSubjects({
  canThey: "view",
  onWhat: { type: "document", id: "doc1" },
  ofType: "user", // Optional: filter subjects to a specific type
  
  // Optional pagination
  limit: 20,
  offset: 0,
});

console.log(subjects);
// Output: [ { type: "user", id: "alice" }, { type: "user", id: "bob" } ]
```

---

## 3. Existence & Counts (`someoneCan`, `countSubjects`, `countAccessibleObjects`)

Often you don't need the full list — just a yes/no or a number. `someoneCan` returns a boolean and **short-circuits** at the first qualifying subject; `countSubjects` / `countAccessibleObjects` return the size of the same sets `listSubjects` / `listAccessibleObjects` would return. A wildcard grant (`everyone(type)`) counts as a single entry.

:::note[Counts are Unpaginated]

The count APIs (`countSubjects` and `countAccessibleObjects`) always count the complete **unpaginated** matching set, ignoring any `limit` and `offset` settings.

:::

```ts
// Is this document shared with anyone? (stops at the first match)
const isShared = await authz.someoneCan({
  canThey: "view",
  onWhat: { type: "document", id: "doc1" },
  ofType: "user", // optional — same filters as listSubjects
});

// How many users can view it?
const viewerCount = await authz.countSubjects({
  canThey: "view",
  onWhat: { type: "document", id: "doc1" },
});

// How many documents can Alice open?
const docCount = await authz.countAccessibleObjects({
  who: { type: "user", id: "alice" },
  ofType: "document",
});
```

:::tip[Large or remote stores & Read Scopes]

`listSubjects`, `listAccessibleObjects`, `someoneCan`, the counts, and `checkMany` all accept `preload: true`, which fetches the tuple set in one read and resolves in memory. 

When executing queries inside a `withReadScope` block, the scope provides access to the following operations: `check`, `checkMany`, `explain`, `listAccessibleObjects`, `listSubjects` (with pagination), `someoneCan`, `countSubjects`, and `countAccessibleObjects`. Raw storage actions like `listTuples` are not part of read scopes. See **[Read Scopes](../performance/read-scopes.md)**.

:::

---

## 4. Explaining Permission Decisions (`explain`)

When a user complains that they can't access a resource, or you need to verify why a check succeeded, use `explain()`. It returns a detailed graph trace showing the path of the authorized permission.

:::note[Fail-Soft on Max Depth]

Unlike runtime validation checks (like `check()` or `checkOrThrow()`) which throw a `MaxDepthExceededError` when exceeding search depth limits under `maxDepthBehavior: "throw"`, the `explain()` API is diagnostic and **fails soft**. Past the depth cap, it will simply return `{ allowed: false, via: null }` rather than throwing.

:::

```ts
const explanation = await authz.explain({
  who: { type: "user", id: "carol" },
  canThey: "view",
  onWhat: { type: "document", id: "doc1" },
  
  // Optional: pass attributes if checking conditional grants
  context: {
    user: { tier: "premium" }
  }
});

console.log(explanation);
/*
Output:
{ 
  allowed: true, 
  via: { 
    kind: "group", 
    relation: "member", 
    through: { type: "team", id: "alpha" }, 
    via: { 
      kind: "direct", 
      relation: "viewer" 
    } 
  } 
}
*/
```

---

## 5. Retrieving Raw Tuples (`listTuples`)

If you want to view, export, or audit raw unexpanded relations exactly as they are stored in the database, use `listTuples`. You can filter by subject, relation, or object, and paginate the results.

```ts
const tuples = await authz.listTuples(
  // Filter criteria
  { 
    subject: { type: "user", id: "alice" } 
  },
  // Pagination options
  { 
    limit: 50, 
    offset: 0 
  }
);

console.log(tuples);
/*
Output:
[
  { 
    subject: { type: "user", id: "alice" }, 
    relation: "viewer", 
    object: { type: "document", id: "doc1" } 
  },
  ...
]
*/
```
