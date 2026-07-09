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

Instead of waiting for database synchronization or blocking the thread, you can pass uncommitted relation tuples in the `contextualTuples` option of a read or query call.

The `contextualTuples` option is supported uniformly across all read and query methods:
* **Inline on the request**: `check` and `checkOrThrow` (inline on the request object).
* **In the options argument**: `checkMany` (as the second argument), `explain` (as the second argument), and `withReadScope` (as the options argument).
* **In the arguments object**: `listSubjects`, `listAccessibleObjects`, `someoneCan`, `countSubjects`, and `countAccessibleObjects` (inside the arguments bag).

:::important[Uniform Read Options]

Every read and query method accepts a uniform set of read options: `{ consistency?: "default" | "strong"; contextualTuples?: InputTuple[]; preload?: boolean }`. 

Note the following behaviors:
1. **Batching**: In `checkMany`, the `contextualTuples` are passed via the options argument and are shared by the entire batch (per-request contextual tuples are not supported because a single reader handles the batch).
2. **Read Scopes**: Inside a `withReadScope`, individual scope operations do not accept read options themselves. Instead, the scope's single shared reader carries the options (e.g. scope-wide `contextualTuples`), which must be passed to `withReadScope` itself.

:::

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

:::tip[Conditions in Contextual Tuples]

Because contextual tuples are raw `InputTuple` objects, any environment or attribute constraints must be specified using the `condition` field (e.g., `{ subject, relation, object, condition: { validUntil: date, attributes: [{ attribute: "dept", operator: "eq", value: "eng" }] } }`). This is different from authorization grant methods (like `allow`, `allowMany`, `addMember`, or `setParent`), which accept attributes under a `when` parameter.

:::

---

## When to Use Contextual Tuples

1. **Optimistic UI updates**: Checking permissions for a page transition immediately after a user requests access.
2. **Multi-step setup flows**: Verifying a complex hierarchy or setup before finalizing and committing the configuration to the database.
3. **Draft environments**: Simulating temporary access policies during previews without polluting production storage.
