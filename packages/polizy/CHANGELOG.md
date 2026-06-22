# polizy

## 0.5.0

### Minor Changes

- 951dca6: Performance: make list operations fast at scale, plus two correctness fixes.

  - **Preloaded reads are now indexed by subject and object** (not only by relation). A point query off a `withReadScope({ preload: true })` set is now `O(deg)` instead of scanning a whole relation bucket. This turns `preload` from a pessimization at scale into the recommended mode for list operations: measured at ~35k tuples, `listSubjects` runs ~30× faster (≈9.7s → ≈0.3s) and `listAccessibleObjects` ~15× faster (≈4.0s → ≈0.3s) when wrapped in a preloaded read scope.
  - **Shared positive memo for list operations** (`listSubjects` / `listAccessibleObjects`, deny mode): the upward grant path shared across candidates/objects is memoized within an operation instead of re-walked per candidate. Decision-neutral (gated to `maxDepthBehavior: "deny"`, verified against the forward-`check()` ground truth).
  - **`listAccessibleObjects` builds its parent map from the reachable set** instead of a full per-hierarchy-relation table scan — a fixed startup-cost reduction.

  Correctness fixes (both verified by a forward-`check()` differential):

  - **`listAccessibleObjects` now honors attribute (ABAC) conditions on group memberships.** Previously the group-gather dropped the check context, so an object reachable only through an attribute-conditioned membership could be omitted even when `check()` allowed it.
  - **`listAccessibleObjects` now includes objects reachable via wildcard (`everyone(type)`) direct grants.** Previously a public grant was honored by `check()` but missing from the list.

  No public API changes; `check()`/`explain()` behavior and performance are unchanged.

- 951dca6: Make list operations scale near-linearly and add existence/count + preload query options.

  `listSubjects` and `listAccessibleObjects` were super-linear in the tuple count; they are now near-linear and sub-second at scale (measured ~76× and ~23× faster at 83k tuples). All changes are decision-neutral, verified by a randomized forward-`check()` differential.

  - **Reverse expansion for `listSubjects`** and **single-pass derivation for `listAccessibleObjects`** (both depth modes): the answer is computed directly from the granting structure instead of running a forward `check()` per candidate / per (object × action). `deny` mode bounds at the depth cap; `throw` mode raises `MaxDepthExceededError` when the query's relevant subgraph is deeper than the cap (a cleaner, deterministic signal than the previous per-candidate behavior — for any graph within the cap, which is the norm, behavior is unchanged). Schemas with field-level objects keep using the gather-then-verify path.
  - **`preload?: boolean`** option on `listSubjects`, `listAccessibleObjects`, and `checkMany` — fetches the working set once and resolves in memory (equivalent to `withReadScope({ preload: true })`), for remote/slow stores.
  - **New query variants:** `someoneCan(...)` (existence; short-circuits), `countSubjects(...)`, and `countAccessibleObjects(...)`.

  Correctness fixes (caught by the differential, affect both old and new paths):

  - `listAccessibleObjects` now honors objects reachable via a **wildcard grant to a group-acting type** (e.g. `everyone("team")` is a viewer → members of any team can view), and `listSubjects` likewise surfaces those subjects. Previously `check()` allowed it but the lists omitted it.

  Custom storage adapters should index **both** read paths — `(subjectType, subjectId, relation)` and `(objectType, objectId, relation)`. Relying on a single `@@unique` covers only subject-anchored reads; object-anchored reads (the list gather) otherwise fall back to full table scans. The bundled Prisma adapter already ships both indexes; the example PGlite adapters now do too.

- 951dca6: Add runtime custom roles — let end users create and assign roles in-app, with no schema change or redeploy, while keeping the action vocabulary compile-time type-safe.

  New APIs:

  - `withRoleScaffold(schema, { grantable })` — merges a generic role scaffold (a `role` object type, a reserved `assignee` group relation, and one `cap_<action>` direct relation per grantable action) into a schema, preserving its literal types.
  - `RoleRegistry<S>` — ergonomic, typed sugar over the existing write APIs: `defineRole`, `grantToRole`, `revokeFromRole`, `assignRole`, `unassignRole`, `deleteRole`, `roleRef`, `getRolePermissions`, `listRoleMembers`, `listRoles`, and `permissionMatrix` (backs an "add role + click-to-toggle" UI in one read). Roles are pure tuples resolved by the existing group + hierarchy + direct traversal — no new engine concepts. The set of grantable actions stays a compile-time `GrantableAction<S>` union; only the role name is a runtime string, and roles are returned as a branded `RoleRef`.
  - `RoleCatalogStore` + `InMemoryRoleCatalog`, and `PrismaRoleCatalog` (from `polizy/prisma-storage`, backed by a new optional `PolizyRole` table) — track role existence and labels so permission-less roles remain listable. The engine never reads the catalog.

  Engine additions (all backward compatible):

  - `AuthSystem` now accepts `defaultGroupRelation` / `defaultHierarchyRelation`, and a schema's `assignee` scaffold relation is excluded from `addMember`/`setParent` inference — so opting into the role scaffold does not break existing single-group-relation `addMember` calls.
  - Wildcard memberships now propagate through group recursion: assigning `everyone(type)` to a group/role grants every subject of that type (previously silently ignored).
  - New `nonSubjectTypes` option (auto-populated with the scaffold's `role` type) keeps role objects from leaking into `listSubjects` results unless requested via `ofType`.

  Two new example apps (both run a real Postgres in the browser via PGlite): `examples/permissions-matrix` (runtime role CRUD, per-tenant divergence, wildcard roles, live check + explain) and `examples/scale-benchmark` (performance playground over tens of thousands of tuples, showing that `check`/`explain` stay ~constant-time while `listSubjects`/`listAccessibleObjects` scale with the reachable set).

### Patch Changes

- 951dca6: Docs, shipped-skill corrections, and hosted live demos.

  - **Hosted live demos**, embedded in the docs site under a new **Demos** section, each running a real Postgres in the browser via PGlite: the runtime-roles **permissions matrix** (`permissions.polizy.dev`) and the **scale benchmark** (`bench.polizy.dev`), alongside the existing full demo (`demo.polizy.dev`).
  - **Shipped-skill corrections** (the `skills/` directory is published to npm): the storage performance reference still described the pre-optimization list-operation algorithm (`~O(candidates × check)`, "`preload` is a pessimization at scale") — corrected to the current behavior (reverse expansion / single-pass derivation are output-linear in **both** depth modes; index both read paths; `preload` is for remote/slow stores). Documented the `someoneCan` / `countSubjects` / `countAccessibleObjects` queries and the `preload` option in the skills and the 0.4→0.5 migration guide.
  - **JSDoc corrections** for `someoneCan` and the internal list dispatch, which described the fast paths as deny-mode-only; they run in both modes (`throw` raises on depth-cap truncation).

  Documentation only — no engine or public API behavior changes.

## 0.4.1

### Patch Changes

- 59745f5: Fix the JSDoc on `check`'s `consistency` option. It previously claimed every
  check reads live and that `"default"` and `"strong"` behave identically — but
  `"strong"` already pins reads to a point-in-time snapshot when the storage
  adapter supports `withSnapshot`. The corrected comment ships in the emitted
  type declarations (and the generated API reference).

## 0.4.0

### Minor Changes

- 6f00ed3: Faster reads and new consistency primitives.

  **Read batching.** The engine used to ask storage one tiny question at a
  time — `findTuples({subject, relation, object})`, over and over, re-fetching
  invariants like a subject's group memberships on every step of recursion. A
  per-operation read layer now fetches the broadest covering query once
  (everything for that subject, object, or relation), indexes it by relation, and
  resolves in memory. On a measured workload this collapsed 177 storage reads to
  single digits with identical results.

  **`withReadScope(fn, { consistency?, preload? })`.** A new `AuthSystem` method
  that shares one read pass across many operations. Inside the scope,
  `check` / `checkMany` / `explain` / `listAccessibleObjects` / `listSubjects`
  read through a single cache, so each subject/object/relation is fetched at most
  once for the whole scope. `{ preload: true }` loads the tuple set in one read up
  front, so every check then resolves in memory — ideal when storage round-trips
  are expensive (an in-browser database) or the working set is small. A demo page
  that previously issued ~45 reads per render now issues 6–7.

  **Strong consistency.** Operations accept `consistency: "strong"`, and storage
  adapters can implement `withSnapshot` to evaluate a whole operation against a
  single point-in-time view. The built-in in-memory and Prisma adapters support
  it (Prisma via a configurable transaction isolation level).

  **Contextual tuples.** Reads accept `contextualTuples` — ephemeral tuples
  evaluated as if stored, for read-your-writes within a single check without
  persisting first.

  **Internals.** `explain` now memoizes negative resolutions, and the in-memory
  adapter indexes tuples by subject/object/relation. All changes are additive and
  backward compatible.

## 0.3.0

### Minor Changes

Hardening + capability release. Full upgrade guide:
`skills/polizy/migrations/migrate-0.2-to-0.3.md`.

**Breaking changes**

- The Prisma adapter is exported **only** from the `polizy/prisma-storage`
  subpath (was also on the main entry). Import `PrismaStorageAdapter` from there;
  it is a factory (no `new`). The `PolizyTuple` model now requires
  `@@unique([subjectType, subjectId, relation, objectType, objectId])`.
- `throwOnMaxDepth` is replaced by `maxDepthBehavior: "throw" | "deny"` (default
  `"throw"`); `defaultCheckDepth` default raised from 10 to 20.
- Field-level ids are opt-in via the schema's `fieldLevelObjects` (previously any
  id containing `#` inherited from its prefix).
- `defineSchema` throws on dangling relation/action references (was a warning).
- Multiple group/hierarchy relations require `as` on
  `addMember`/`setParent`/`removeMember`/`removeParent` (inferred when there is
  exactly one).
- The library no longer writes to `console`; pass a `logger`.

**New features**

- `checkMany`, `checkOrThrow`, `explain`, `listSubjects`, `allowMany`.
- Wildcard/public subjects via `everyone(type)`.
- Attribute-predicate (ABAC) conditions evaluated against `check()` context.
- Pagination for `listTuples` and `listAccessibleObjects`.

**Fixes**

- Prisma: time-based conditions round-trip correctly (previously threw); writes
  are idempotent (upsert); revocation no longer over-deletes.
- `check()` is memoized per call (no exponential blow-up on deep/wide graphs);
  `listAccessibleObjects` no longer does a full-table scan.
- Field access propagates through group and hierarchy relations, not only direct.

## 0.2.0

### Minor Changes

- 88f3456: Add comprehensive Agent Skills for polizy authorization library

  Create 6 specialized Agent Skills (24 markdown files, 8,765 lines) to help AI agents effectively use the polizy library:

  - **polizy**: Router skill for context-aware detection and routing
  - **polizy-setup**: Installation and initial configuration guides
  - **polizy-schema**: Schema design patterns with 10+ domain-specific examples
  - **polizy-patterns**: 7 implementation patterns (direct, groups, hierarchy, field-level, time-limited, revocation, multi-tenant)
  - **polizy-storage**: Database adapters (Prisma, custom) and performance optimization
  - **polizy-troubleshooting**: Debugging guide with check algorithm explanation and anti-patterns

  All skills follow the Agent Skills specification with progressive disclosure (SKILL.md under 500 lines, detailed content in references/).

## 0.1.1

### Patch Changes

- Fix CI build errors and improve Prisma adapter compatibility

  - Remove dependency on @prisma/client for type checking by using minimal PrismaClientLike interface
  - Fix rollup TypeScript config to handle allowImportingTsExtensions properly
  - Add npm OIDC trusted publishing with provenance
