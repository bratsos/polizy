# polizy

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
