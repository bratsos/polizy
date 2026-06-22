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

---

## Benchmarks at scale

The repo ships an interactive **[scale benchmark](https://github.com/bratsos/polizy/tree/main/examples/scale-benchmark)** — it generates tens of thousands of tuples (a docs / folders / teams graph with nested groups and deep hierarchy) into a real Postgres in the browser, then times every read path. Run it locally:

```bash
pnpm --filter example-scale-benchmark dev    # or: ... bench  (headless)
```

What it shows (numbers are machine-dependent — what matters is how they *scale*):

What it shows (numbers are machine-dependent — what matters is how they *scale*):

*   **`check` and `explain` are roughly constant-time** in the table size — about **1 ms** at ~7k, ~35k, and ~83k tuples. A check touches only the query's subgraph (a handful of broadened range reads), not the whole table. This is the core ReBAC scaling property.
*   **`checkMany` is ~3× faster than N separate `check` calls**, because it shares one reader across the batch.
*   **`listSubjects` / `listAccessibleObjects` are now near-linear and sub-second** at scale. At 83k tuples, `listSubjects` is ~566 ms (was ~43 s — ~76×) and `listAccessibleObjects` ~799 ms (was ~18 s — ~23×). Two things got them there:
    *   **Index both read paths.** The original cost was object-anchored gather reads running as full table scans. The bundled Prisma adapter indexes `(objectType, objectId, relation)`; a custom adapter **must** too (see [Custom adapters](../storage/custom-adapter.md)).
    *   **Reverse expansion / single-pass derivation** (both depth modes): `listSubjects` expands backward from the grant instead of running a forward `check` per candidate, and `listAccessibleObjects` derives each object's action set in one sweep instead of a per-(object × action) re-check. `deny` mode bounds at the cap; `throw` mode raises `MaxDepthExceededError` if the query's relevant subgraph is deeper than the cap. (Schemas with field-level objects use the gather-then-verify path, which is still fast with the index.)
*   **`preload` for remote / very large stores.** `withReadScope({ preload: true })` — or `preload: true` on `listSubjects` / `listAccessibleObjects` / `checkMany` — fetches the whole set once and resolves in memory, useful when storage round-trips dominate. With a properly indexed local store the direct path is already sub-second.
*   **`someoneCan` / `countSubjects` / `countAccessibleObjects`** answer existence and count questions; `someoneCan` short-circuits at the first authorized subject.

```ts
// Existence check — short-circuits, no full enumeration.
if (await authz.someoneCan({ canThey: "view", onWhat: doc })) { /* ... */ }

// Heavy list query over a remote store? Fetch once, resolve in memory.
const { accessible } = await authz.listAccessibleObjects({
  who, ofType: "document", preload: true,
});
```

:::tip[Rule of thumb]

Gate actions with `check` / `checkMany` (cheap, constant-time). `listSubjects` /
`listAccessibleObjects` are near-linear and output-linear in both depth modes
with a properly indexed store; reach for `preload` when storage round-trips
(remote DB) dominate.

:::
