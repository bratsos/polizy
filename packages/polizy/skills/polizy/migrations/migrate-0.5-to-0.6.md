# Migrating from 0.5 to 0.6

## Summary

`0.6.0` is an additive minor release that introduces standardized read options, pagination for subject listings, a published storage-adapter contract test suite, and improved schema type inference under strict TypeScript. There are **no schema or storage migrations** required.

However, this release includes **two behavior-affecting bug fixes** and **two type-level tightenings** that you should review before upgrading.

## Required actions

### 1. Review UIs using `listSubjects` / `someoneCan` / `countSubjects` (Field-Level Schemas)

On schemas utilizing `fieldLevelObjects`, these lists now correctly surface concrete subjects reachable through `everyone(type)` wildcard grants or memberships to group-acting types. The engine's `check()` function already allowed these subjects, but the listings previously omitted them.

* **Impact:** Your listing results may **grow** after upgrading to reflect these newly-visible subjects. Review any UIs that display these lists to ensure this is acceptable.

### 2. Fix invalid array predicates (Compile Errors)

`AttributePredicate` is now structured as a discriminated union based on the comparison operator. This enforces that `eq`/`ne` operators accept only a scalar, `in`/`nin` accept only an array, and inequality operators (`gt`/`gte`/`lt`/`lte`) accept only a number.

Previously-compiling invalid predicates (such as using `eq` with an array, which always evaluated to `false` at runtime) are now **compile errors**.

* **Action:** Fix any invalid predicates to use the correct operator (e.g. swap `eq` with an array to `in`), rather than casting or bypassing type checks.

### 3. Avoid slashes in tenant ids for Runtime Roles

`RoleRegistry`'s `roleRef` and `defineRole` functions now throw a `SchemaError` if `tenant.id` contains a `/` character. This prevents cross-tenant `permissionMatrix` contamination from incorrect prefix parsing of composite IDs.

* **Action:** Audit and ensure your tenant IDs avoid containing `/` before upgrading.

### 4. Monitor malformed stored conditions

Condition validation (`isConditionValid`) has been hardened. Stored conditions that are malformed will now **fail closed (deny access)** rather than crashing the permission check with a `TypeError` mid-check.

* **Action:** If you have monitoring or alerting that watches for check-time `TypeErrors` to detect corrupt database entries, update them to monitor for access denials instead.

### 5. Remove unsupported deep imports and check direct-adapter filters

* **Deep imports removed:** The `dist/types` folder is no longer published. Deep imports from `polizy/dist/types/*` were never officially supported and will now break. Only use official public exports from `polizy` or subpaths like `polizy/prisma-storage` and `polizy/storage-tests`.
* **Prisma adapter condition filter:** The Prisma adapter's `findTuples({ condition: undefined })` method with the key present no longer filters by `condition IS NULL` (which was unreachable through the engine). It now imposes no condition constraint, aligning with the in-memory adapter. Direct storage adapter consumers should audit their filter queries.

## New features

- **Standardized Read Options (`ReadOptions`):** All public and read-scope authorization APIs (`check`, `checkMany`, `checkOrThrow`, `explain`, `listSubjects`, `listAccessibleObjects`, `someoneCan`, `countSubjects`, `countAccessibleObjects`, and `withReadScope`) accept uniform read options (`consistency`, `preload`, and `contextualTuples`). Note that `checkMany` options are shared batch-wide (per-request `contextualTuples` is not supported), and `withReadScope` operations accept no per-operation read options.
- **`explain()` optional second argument:** `explain` now supports an optional second `options` argument for `ReadOptions`. It is also guaranteed to never throw `MaxDepthExceededError` (returns `{ allowed: false, via: null }` past the depth cap).
- **Pagination for `listSubjects`:** `listSubjects` now supports `{ limit, offset }` pagination, applied after a deterministic sort of the results. Corresponding count APIs are always unpaginated.
- **Published storage-adapter contract tests:** The shared storage adapter validation suite is now published as the **`polizy/storage-tests`** subpath. Custom adapters can run these tests to verify compliance with the engine's contract:
  ```typescript
  import { defineStorageAdapterTestSuite } from "polizy/storage-tests";
  ```
- **Simplified TypeScript generics for adapters:** Bare instantiations like `new InMemoryStorageAdapter()` or `PrismaAdapter(client)` now compose directly with literal-typed schemas under strict TypeScript, eliminating variance generic artifacts.
- **Partial hierarchy propagation maps:** You can now define partial `hierarchyPropagation` maps in schema definitions without padding unpropagated actions with empty arrays. Typo'd keys and values continue to fail at compile-time.
- **InMemoryRoleCatalog key escape:** The catalog's internal composite-key separator has been changed from a raw NUL byte to the `\u0000` unicode escape sequence in source, preventing git from classifying it as a binary file. The runtime key separator remains identical.
- **Prisma adapter transaction options:** `PrismaAdapter` now accepts a `transactionOptions` setting to raise timeout and maxWait times for interactive transactions under strong-consistency reads.
- **New exported types:** `CheckRequest` and `ReadOptions` are now public exports.

## Quick checklist

- [ ] Upgrade `polizy` — existing code remains backward-compatible except for behavior patches.
- [ ] (Field-Level Schemas) Review application UIs to ensure that newly-surfaced subjects from `everyone(type)` grants in listings are handled correctly.
- [ ] Fix any compile-time errors in `AttributePredicate` shapes (e.g., matching `eq` with array values).
- [ ] Ensure no tenant IDs contain `/` before using `RoleRegistry`.
- [ ] Remove any deep imports targeting `polizy/dist/types/*`.
- [ ] (Optional) Configure `transactionOptions` on `PrismaAdapter` if running long strong-consistency operations.
- [ ] (Optional) Integrate `defineStorageAdapterTestSuite` from `polizy/storage-tests` to test custom adapters.
