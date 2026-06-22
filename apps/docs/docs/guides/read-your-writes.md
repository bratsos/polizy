---
title: Read-Your-Writes
sidebar_position: 11
---

# Read-Your-Writes

When building collaborative applications, you often run into a consistency problem: a user performs an action (like sharing a document or adding a team member), and immediately navigates to a screen that checks that new permission. 

If your authorization storage uses asynchronous replication or has not yet committed the transaction, the subsequent `check()` call might fail because the new permission tuple hasn't reached the database.

polizy solves this with **Read-Your-Writes** validation using `contextualTuples`.

This guide shows you how to pass temporary, uncommitted facts directly to a permission check.

:::note[Performance & Consistency]

To learn about how polizy caches reads, wraps operations in scopes, and implements strong consistency levels, read **[Consistency & Caching](../performance/consistency.md)**.

:::

## The Solution: `contextualTuples`

Instead of waiting for database synchronization or blocking the thread, you can pass uncommitted relation tuples in the `contextualTuples` parameter of a `check()`, `checkMany()`, or `explain()` call.

polizy evaluates these contextual tuples in memory **as if they were already written to storage**. They are never saved to your persistent database.

### Example: Checking a Freshly-Written Grant

Imagine Alice just shared a document with Bob, and your app needs to verify access immediately before the database commit completes.

```ts
import { AuthSystem, InMemoryStorageAdapter } from "polizy";

// ... initialize authz ...

const bob = { type: "user", id: "bob" };
const doc = { type: "document", id: "confidential-plan" };

// Check if Bob can view the document, assuming the write completes successfully
const canBobView = await authz.check({
  who: bob,
  canThey: "view",
  onWhat: doc,
  
  // Pass uncommitted facts here
  contextualTuples: [
    {
      subject: bob,
      relation: "viewer",
      object: doc,
    },
  ],
});

console.log(canBobView); 
// => true (evaluated immediately in memory, even if the database is empty)
```

---

## When to Use Contextual Tuples

1. **Optimistic UI updates**: Checking permissions for a page transition immediately after a user requests access.
2. **Multi-step setup flows**: Verifying a complex hierarchy or setup before finalizing and committing the configuration to the database.
3. **Draft environments**: Simulating temporary access policies during previews without polluting production storage.
