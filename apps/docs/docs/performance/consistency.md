---
title: Consistency
sidebar_position: 3
---

# Consistency & Snapshots

When relationship facts (tuples) are updated in your application, subsequent authorization checks need to know how to read the data. Should they read the live, absolute latest commits, or should they pin their reads to a specific point-in-time snapshot to ensure a coherent view of the graph?

polizy supports two consistency modes, enabling you to choose between performance and strict snapshot isolation.

---

## Live vs. Strong Consistency

| Mode | Behavior | Best For |
| --- | --- | --- |
| **Live (Default)** | Each range read is internally consistent, but the overall operation is not pinned to a single instant. | Most standard authorization checks. Fast, low overhead. |
| **Strong** | Pins every read in the operation to a single point-in-time snapshot. | Complex checks walking deep relationship paths where concurrent database writes might cause inconsistency. |

---

## How to Use Strong Consistency

To enforce snapshot consistency for a query, pass the `consistency: "strong"` option. This ensures that every read performed during the evaluation comes from the exact same snapshot, **without blocking concurrent writers**.

The `consistency` option is supported uniformly across all query and read methods:
* **Inline on the request**: `check` and `checkOrThrow`.
* **In the options argument**: `checkMany` and `explain`.
* **In the arguments object**: `listSubjects`, `listAccessibleObjects`, `someoneCan`, `countSubjects`, and `countAccessibleObjects`.
* **In the options argument of scopes**: `withReadScope` (which configures a scope-wide consistency level for all its operations).

### In Single Checks & Queries

```ts
// Enforce strong consistency for a single check (inline)
await authz.check({ 
  who, 
  canThey: "edit", 
  onWhat, 
  consistency: "strong" 
});

// Enforce strong consistency for a batch of checks (options argument)
await authz.checkMany(requests, { 
  consistency: "strong" 
});

// Enforce strong consistency for a list query (arguments object)
await authz.listAccessibleObjects({
  who,
  ofType: "document",
  consistency: "strong"
});
```

### In Read Scopes

When wrapping multiple operations in a scope, you can pin the entire scope to a single snapshot by passing the consistency option to `withReadScope`:

```ts
const view = await authz.withReadScope(async (scope) => {
  const docs = await scope.listAccessibleObjects({ who, ofType: "document" });
  const grid = await scope.checkMany(rows);
  return { docs, grid };
}, { consistency: "strong" });
```

---

## How Snapshot Isolation is Served

Strong consistency is powered by the storage adapter's optional `withSnapshot` interface:

*   **In-Memory Adapter**: Copies the internal tuple set when a snapshot is initiated, ensuring later updates are isolated.
*   **Prisma Adapter**: Runs the entire check operation within a single database transaction. For PostgreSQL (which supports Multi-Version Concurrency Control, or MVCC), you should configure the adapter with `RepeatableRead` isolation to prevent writers from blocking readers and vice-versa. You can also customize transaction timing using `transactionOptions`:
    ```ts
    import { PrismaAdapter } from "polizy/prisma-storage";

    const storage = PrismaAdapter(prisma, { 
      snapshotIsolationLevel: "RepeatableRead",
      transactionOptions: {
        maxWait: 5000,
        timeout: 10000,
      }
    });
    ```
    For SQLite, this configuration can be omitted, as SQLite default read transactions behave as snapshots out of the box. For setup details and transaction timeout customization, see the **[Prisma Storage](../storage/prisma.md#customizing-transaction-timeouts)** guide.
*   **Fallback Behavior**: If a storage adapter does not implement `withSnapshot`, polizy will automatically and transparently fall back to live reads.

---

## Local Evaluations with Contextual Tuples

Sometimes, you need to check permissions immediately after a write action, but before the new facts are committed to your central database. Instead of waiting for replication or database transactions, you can pass temporary, uncommitted facts directly in your check call:

```ts
await authz.check({
  who, 
  canThey: "view", 
  onWhat: doc,
  contextualTuples: [
    { subject: who, relation: "viewer", object: doc }
  ],
});
```

These contextual tuples are evaluated in memory as if they were stored in the database. They bypass the storage round-trip entirely. To learn more, read the **[Read-Your-Writes Guide](../guides/read-your-writes.md)**.

---

## Limitations

### No Cross-Operation Consistency Tokens (Zookies)

While polizy provides point-in-time snapshot isolation *within* a single operation or read scope, it does not currently support cross-operation consistency tokens (comparable to Google Zanzibar's "zookies"). 

This means you cannot capture a consistency token from one check and pass it to another check in a subsequent API request to guarantee "new-enemy" protection across HTTP boundaries. That layer is deferred until polizy grows caching and replication architectures where it becomes necessary; today, all reads reflect committed tuples.
