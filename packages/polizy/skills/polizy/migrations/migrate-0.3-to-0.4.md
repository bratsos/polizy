# Migrating from 0.3 to 0.4

## Summary

`0.4.0` is a performance-focused, purely **additive** release. It introduces per-operation read batching, read scopes with optional preloading, strong point-in-time consistency support, and contextual tuples for read-your-writes.

There are **no breaking API changes** or schema migrations. Existing code keeps working untouched.

## Required actions

**None for existing code** — `0.4.0` is completely backward compatible. Upgrade and your schema, checks, and writes behave exactly as on `0.3.x`.

## New features

- **Per-operation read batching**: The engine now caches and indexes reads per-operation automatically, collapsing multi-step recursions into single-digit storage queries. No API changes are required to benefit from this performance bump.
- **`withReadScope(fn, { consistency?, preload? })`**: An `AuthSystem` method that shares a single read pass/cache across multiple operations. Passing `preload: true` loads the tuple set in one read up front, so subsequent checks resolve in memory.
- **Strong consistency**: Operations (such as `check` or `checkMany`) now accept `consistency: "strong"`. Storage adapters can implement the optional `StorageAdapter.withSnapshot` method to support evaluating checks against a point-in-time snapshot. The bundled Prisma adapter supports snapshot isolation levels via `snapshotIsolationLevel`. Custom storage adapters may implement `withSnapshot` to enable strong consistency; without it, `"strong"` consistency falls back to live database reads.
- **Contextual tuples**: Pass `contextualTuples` on `check()` to evaluate permissions against temporary tuples that act as if stored, allowing "read-your-writes" checks before database persistence.

## Behavior / bug fixes

- **JSDoc correction (0.4.1)**: Fixes a JSDoc comment on `check`'s `consistency` option. It incorrectly claimed that `"strong"` and `"default"` behaved identically. `"strong"` maps to `withSnapshot` on supported storage adapters.

## Deprecations

None.

## Quick checklist

- [ ] Upgrade `polizy` — existing code needs **no changes** (`0.4.0` is additive).
- [ ] (Optional) Wrap multi-query batches in `withReadScope` with optional `preload` for performance.
- [ ] (Optional) Set `consistency: "strong"` on checks to leverage `withSnapshot` transaction snapshots.
- [ ] (Optional) Implement `withSnapshot` in custom storage adapters to support point-in-time snapshot consistency.
- [ ] (Optional) Use `contextualTuples` on `check` for read-your-writes functionality.
