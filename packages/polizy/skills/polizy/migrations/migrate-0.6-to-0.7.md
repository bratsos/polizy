# Migrating from 0.6 to 0.7

## Summary

`0.7.0` adds Prisma 7 and Prisma 8 support, interactive transaction-client binding for `PrismaAdapter` and `PrismaRoleCatalog`, a `tuple` field on non-field `ExplainNode`s, two new type exports (`ReadOnlyStorage`, `Relation`), and six additional contract tests in `polizy/storage-tests`. There are **no Prisma database schema migrations** required — existing `PolizyTuple` and `PolizyRole` tables work unchanged.

## Required actions

### 1. Update code or tests that deep-compare `explain()` output

`ExplainNode` now includes `tuple: StoredTuple` on the `direct`, `wildcard`, `group`, and `hierarchy` kinds (`field` has no `tuple`):

```typescript
type ExplainNode =
  | { kind: "direct"; relation: string; tuple: StoredTuple }
  | { kind: "wildcard"; relation: string; tuple: StoredTuple }
  | { kind: "field"; base: AnyObject; via: ExplainNode }
  | { kind: "group"; relation: string; through: AnyObject; tuple: StoredTuple; via: ExplainNode }
  | { kind: "hierarchy"; relation: string; parent: AnyObject; tuple: StoredTuple; via: ExplainNode };
```

`tuple.id` is the stored row id. A contextual tuple (passed via `contextualTuples`) has id `ctx:<i>`, its 0-based position in that array (`ctx:0`, `ctx:1`, …), and is not in storage.

* **Action:** Update any `deepStrictEqual` / `toEqual` assertions or snapshot checks on `explain()` output to include `tuple`.

### 2. Pass Prisma's own `tx`, not a wrapper around it

`PrismaAdapter` and `PrismaRoleCatalog` recognise a transaction client by the mark Prisma puts on it (Prisma 6/7: an internal `prisma.client.transaction.*` symbol; Prisma 8: the `invalidated` flag on `tx`). Every other client, including `$extends` clients and your own wrappers around a root client, behaves as in 0.6: atomic batch writes and `withSnapshot`.

A wrapper around a transaction client hides the mark, so it is treated as a root client; on Prisma 7 its batch `$transaction` would then commit outside your transaction. An object with neither the mark nor a `$transaction` / `transaction()` method (for example `{ polizyTuple: prisma.polizyTuple }`) now throws when the adapter is created, because its writes could not be atomic.

* **Action:** Pass the `tx` that Prisma gives you directly.

### 3. Re-run `polizy/storage-tests` against custom adapters

`defineStorageAdapterTestSuite` (from `polizy/storage-tests`) gained 6 contract tests:

1. Full condition round-trip (`validSince`, `validUntil`, and `attributes`).
2. A re-write without a condition keeps the existing condition.
3. Stable and complete `limit`/`offset` pagination.
4. `findTuples({})` returns every tuple.
5. `findSubjects` and `findObjects` with and without a type filter (`subjectType` / `objectType`).
6. `withSnapshot` (run only if implemented) sees written tuples.

A custom adapter that passed 0.6's suite can fail these if it omitted any of these behaviors.

* **Action:** Re-run `defineStorageAdapterTestSuite` against your custom `StorageAdapter` and fix any failing cases.

### 4. Verify Prisma 8 `@prisma/orm-postgres` version for `snapshotIsolationLevel`

On Prisma 8, `snapshotIsolationLevel` is honored starting in `@prisma/orm-postgres` `8.0.0-rc.25`. Earlier release candidates (such as `rc.21`) silently ignore the isolation level, so `withSnapshot` runs at `READ COMMITTED` there. Also note that Prisma 8 passes `transactionOptions.timeout` through and ignores `maxWait` (Prisma 8 has no `maxWait`).

* **Action:** If you use Prisma 8 with `snapshotIsolationLevel` (for example `"RepeatableRead"`), upgrade `@prisma/orm-postgres` to `8.0.0-rc.25` or newer.

## New features

- **Prisma 7 and Prisma 8 support:** `PrismaAdapter` and `PrismaRoleCatalog` (from `polizy/prisma-storage`) accept Prisma 6, Prisma 7 (`@prisma/adapter-pg`), and Prisma 8 (`@prisma/orm-postgres`) clients through one factory. `peerDependencies` now lists `"@prisma/client": "^6.0.0 || ^7.0.0"` (optional); Prisma 8 requires no polizy peer dependency.
- **Transaction-bound adapters (`PrismaAdapter(tx)` / `PrismaRoleCatalog(tx)`):** Pass `tx` from `prisma.$transaction(async (tx) => ...)` (Prisma 6/7) or `db.transaction(async (tx) => ...)` (Prisma 8). Every read and write runs on the caller's transaction (sharing its isolation level, uncommitted writes, and `SET LOCAL` / `set_config` RLS settings). The adapter omits `withSnapshot`, so `consistency: "strong"` runs on `tx` directly, and `write()` runs upserts sequentially on `tx` so they commit or roll back with it.
- **New type exports:** `ReadOnlyStorage` and `Relation` are now exported as types from `polizy`.

## Behavior / bug fixes

- **Fixed `PrismaAdapter(tx)` on Prisma 6 and Prisma 7:** In `0.6.x`, passing a `tx` client on Prisma 6 threw `p.$transaction is not a function` on `write()` and on `consistency: "strong"` reads; on Prisma 7, `write()` called `tx.$transaction([...])`, which Prisma 7 ran as its own separate transaction so writes survived a rollback of the caller's transaction. Both are fixed in `0.7.0`.

## Quick checklist

- [ ] Upgrade `polizy` to `0.7.0`.
- [ ] Update any deep equality checks on `explain()` results to include `tuple`.
- [ ] Pass Prisma's own `tx` to `PrismaAdapter` / `PrismaRoleCatalog`, not a wrapper around it.
- [ ] (Custom adapters) Re-run `defineStorageAdapterTestSuite` from `polizy/storage-tests` for the 6 new contract checks.
- [ ] (Prisma 8) Upgrade `@prisma/orm-postgres` to `8.0.0-rc.25+` if relying on `snapshotIsolationLevel`.
- [ ] (Optional) Replace workarounds with `PrismaAdapter(tx)` / `PrismaRoleCatalog(tx)` inside interactive transactions.
