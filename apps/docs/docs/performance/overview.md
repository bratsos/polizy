---
title: Performance
sidebar_position: 1
---

# Performance Overview

When you build deep relationship trees—like nested folder structures, organization hierarchies, and projects shared with multiple teams—authorization checks can quickly become a performance bottleneck. In naive implementations, answering a question like "Can Alice view this file?" might require querying the database repeatedly to walk the relationship graph, leading to the dreaded N+1 query problem.

**polizy** is designed from the ground up to prevent this. It features a smart reading layer that minimizes database round-trips, ensuring checks remain fast and lightweight even on wide or deep graphs.

---

## The Per-Operation Read Layer

Every authorization query in polizy executes through a specialized, per-operation read layer. This layer optimizes how facts (tuples) are fetched and evaluated in memory:

*   **Broad Range Reads**: Instead of querying the database for a single edge at a time, polizy requests broader ranges of related tuples once and resolves the rest of the path in memory.
*   **Per-Check Memoization**: Within a single query, polizy caches sub-graph traversal results. If a check traverses the same subject, object, or relation along different evaluation paths, it hits your storage database only a handful of times, rather than querying it once for every single edge.
*   **Shared Batch Reads**: When checking multiple permissions at once using `checkMany`, polizy shares a single reader instance across the entire batch, collapsing what would be dozens of separate database calls into a few optimized queries.

:::tip[Why wide and deep graphs stay cheap]

Because polizy resolves path expansions (like nested groups or folder inheritance) in memory after fetching range blocks, the complexity of walking deep trees scales with the size of the retrieved tuple set, not the number of database queries.

:::

---

## Expanding Your Performance Toolkit

While the per-operation read layer optimizes individual requests, polizy gives you additional tools to handle more complex scenarios:

*   **[Read Scopes & Batching](./read-scopes.md)**: Share a single read pass across completely different operations (such as listing items and checking actions) to render pages with zero extra database overhead.
*   **[Consistency & Snapshots](./consistency.md)**: Balance read speed and isolation levels, choosing between fast live reads, strong point-in-time snapshot consistency, or zero-round-trip local evaluations.
