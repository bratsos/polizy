---
"polizy": minor
---

Add runtime custom roles — let end users create and assign roles in-app, with no schema change or redeploy, while keeping the action vocabulary compile-time type-safe.

New APIs:

- `withRoleScaffold(schema, { grantable })` — merges a generic role scaffold (a `role` object type, a reserved `assignee` group relation, and one `cap_<action>` direct relation per grantable action) into a schema, preserving its literal types.
- `RoleRegistry<S>` — ergonomic, typed sugar over the existing write APIs: `defineRole`, `grantToRole`, `revokeFromRole`, `assignRole`, `unassignRole`, `deleteRole`, `roleRef`, `getRolePermissions`, `listRoleMembers`, `listRoles`, and `permissionMatrix` (backs an "add role + click-to-toggle" UI in one read). Roles are pure tuples resolved by the existing group + hierarchy + direct traversal — no new engine concepts. The set of grantable actions stays a compile-time `GrantableAction<S>` union; only the role name is a runtime string, and roles are returned as a branded `RoleRef`.
- `RoleCatalogStore` + `InMemoryRoleCatalog`, and `PrismaRoleCatalog` (from `polizy/prisma-storage`, backed by a new optional `PolizyRole` table) — track role existence and labels so permission-less roles remain listable. The engine never reads the catalog.

Engine additions (all backward compatible):

- `AuthSystem` now accepts `defaultGroupRelation` / `defaultHierarchyRelation`, and a schema's `assignee` scaffold relation is excluded from `addMember`/`setParent` inference — so opting into the role scaffold does not break existing single-group-relation `addMember` calls.
- Wildcard memberships now propagate through group recursion: assigning `everyone(type)` to a group/role grants every subject of that type (previously silently ignored).
- New `nonSubjectTypes` option (auto-populated with the scaffold's `role` type) keeps role objects from leaking into `listSubjects` results unless requested via `ofType`.

Two new example apps (both run a real Postgres in the browser via PGlite): `examples/permissions-matrix` (runtime role CRUD, per-tenant divergence, wildcard roles, live check + explain) and `examples/scale-benchmark` (performance playground over tens of thousands of tuples, showing that `check`/`explain` stay ~constant-time while `listSubjects`/`listAccessibleObjects` scale with the reachable set).
