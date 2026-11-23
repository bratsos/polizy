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
*   **Prisma Adapter**: On a root client, `withSnapshot` runs the check operation inside a new interactive database transaction on a separate connection. For PostgreSQL (which supports Multi-Version Concurrency Control, or MVCC), configure the adapter with `RepeatableRead` isolation so readers never block writers and writers never block readers. You can also customize transaction timing using `transactionOptions`:
    ```ts
    import { PrismaAdapter } from "polizy/prisma-storage";

    const storage = PrismaAdapter(prisma, { 
      snapshotIsolationLevel: "RepeatableRead",
      transactionOptions: {
        maxWait: 5000, // Prisma 6/7 only; ignored on Prisma 8
        timeout: 10000,
      }
    });
    ```
    On Prisma 8, `snapshotIsolationLevel` requires `@prisma/orm-postgres` `8.0.0-rc.25` or later; earlier release candidates ignore it and run `withSnapshot` at `READ COMMITTED`. For SQLite, leave `snapshotIsolationLevel` unset because SQLite read transactions are already snapshots. For setup details, see **[Prisma Storage](../storage/prisma.md#customizing-transaction-timeouts)**.

    :::warning[Strong Consistency with RLS and Uncommitted Writes]

    Because `withSnapshot` on a root-client adapter opens a **separate transaction** on a different connection, it does not see your caller's uncommitted writes and does not inherit transaction-local RLS settings (`SET LOCAL` or `set_config(..., true)`).

    To run checks inside your own transaction, pass the transaction client directly: `PrismaAdapter(tx)`. The adapter then omits `withSnapshot`, so `consistency: "strong"` runs on your transaction. A `REPEATABLE READ` caller transaction gives one snapshot; a `READ COMMITTED` caller transaction sees the latest commits per statement (combine with `preload: true` if you need one read).

    :::

*   **Fallback Behavior**: If a storage adapter does not implement `withSnapshot`, polizy falls back to reads on the adapter directly when `consistency: "strong"` is requested.

---

## Single-Read Preloading (`preload: true`)

Passing `preload: true` fetches every tuple the adapter can see in a single `findTuples({})` call and resolves the check in memory. Because there is only one storage query, the entire operation sees one statement-level snapshot even under `READ COMMITTED`.

The tradeoff is memory and bandwidth: `preload: true` loads every visible tuple. It works well when row-level security (RLS) or a tenant-scoped store keeps the visible set small, and poorly on a large unpartitioned shared table.

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

These contextual tuples are merged with stored tuples for that one call and evaluated in memory as if they were stored in the database. They do **not** replace or bypass storage reads — a check with only contextual tuples still reads storage. To learn more, read the **[Read-Your-Writes Guide](../guides/read-your-writes.md)**.

---

## Limitations

### No Cross-Operation Consistency Tokens (Zookies)

While polizy provides point-in-time snapshot isolation *within* a single operation or read scope, it does not currently support cross-operation consistency tokens (comparable to Google Zanzibar's "zookies"). 

This means you cannot capture a consistency token from one check and pass it to another check in a subsequent API request to guarantee "new-enemy" protection across HTTP boundaries. That layer is deferred until polizy grows caching and replication architectures where it becomes necessary; today, all reads reflect committed tuples.
