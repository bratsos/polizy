# Migrating from 0.4 to 0.5

## Summary

`0.5.0` is a purely **additive** release. It adds **runtime custom roles**: named
bundles of your *existing*, type-safe actions that end users (or admins) can
create, edit, assign, and delete at runtime — the classic "permissions matrix"
(new roles/columns, fixed permissions/rows). The headline pieces are
`withRoleScaffold` (merges a generic role scaffold into a schema while preserving
its literal types), `RoleRegistry` (ergonomic, typed sugar over the existing
write APIs), and an optional role **catalog** (`RoleCatalogStore` +
`InMemoryRoleCatalog` from `polizy`, plus `PrismaRoleCatalog` from
`polizy/prisma-storage`) so permission-less roles stay listable. The engine is
**unchanged**: a custom role resolves as ordinary tuples
(`user --assignee--> role --cap_<action>--> resource`) through the normal
`check()` — no new verb, no new storage tables for the roles themselves.

There are **no breaking API changes**. Existing code keeps working untouched. The
only steps below apply *if you choose to adopt* the role scaffold.

## Required actions

**None for existing code** — `0.5.0` is backward compatible. Upgrade and your
schema, checks, and writes behave exactly as on `0.4.x`.

If you **adopt the role scaffold** (`withRoleScaffold`), two things deserve
attention:

### 1. Set `defaultGroupRelation` if you used implicit group inference

The scaffold adds a reserved `assignee` **group** relation (this is the
`user --assignee--> role` membership edge). If your schema already had exactly
one group relation, `addMember`/`removeMember` were inferring it implicitly.
After scaffolding there are now **two** group relations, so to keep inference
working the scaffold's `assignee` relation is **auto-excluded** from group
inference — your original single group relation keeps being inferred (this is why
the scaffold is non-breaking).

If your schema had **more than one** group relation already, or you want to be
explicit, pass `defaultGroupRelation` on the `AuthSystem` so bare
`addMember`/`removeMember` calls know which relation to use:

```ts
const schema = withRoleScaffold(baseSchema, {
  grantable: ["view", "edit", "delete"],
});

const authz = new AuthSystem({
  storage,
  schema,
  defaultGroupRelation: "member",       // your app's group relation, not "assignee"
  // defaultHierarchyRelation: "parent" // same idea if you have >1 hierarchy relation
});
```

> Passing a `defaultGroupRelation`/`defaultHierarchyRelation` that isn't a
> relation of that kind throws `SchemaError` at construction.

`RoleRegistry` always assigns members **as** the scaffold's `assignee` relation
internally, so its `assignRole`/`unassignRole` are unaffected by your default.

### 2. Add the `PolizyRole` Prisma model if you use `PrismaRoleCatalog`

The catalog is **optional** and is metadata only (it tracks role existence +
labels so permission-less roles stay listable — **the engine never reads the
catalog**). If you want a durable catalog on Prisma, add the new optional model
and migrate:

```prisma
model PolizyRole {
  id      String  @id @default(cuid())
  tenant  String
  key     String
  label   String?
  actions Json

  @@unique([tenant, key])
  @@index([tenant])
}
```

```bash
npx prisma generate
npx prisma migrate dev --name polizy_role_catalog   # or: npx prisma db push
```

```ts
import { PrismaRoleCatalog } from "polizy/prisma-storage";
// PrismaRoleCatalog is a FACTORY — call it, don't `new` it.
const catalog = PrismaRoleCatalog(prisma);
const roles = new RoleRegistry(authz, schema, { catalog });
```

If you don't need a durable catalog, use `InMemoryRoleCatalog` (from `polizy`)
or omit the catalog entirely — capabilities and assignments always live as tuples
in your `StorageAdapter` regardless.

## New features

The entire **runtime custom roles** API, all exported from `polizy` (except
`PrismaRoleCatalog`, on `polizy/prisma-storage`):

- **`withRoleScaffold(schema, { grantable, roleType?, assigneeRelation?, capPrefix? })`**
  — merges a role scaffold into a schema, *preserving literal types*. Adds, once:
  a `role` object type, a reserved `assignee` group relation, and one
  `cap_<action>` direct relation per `grantable` action. Defaults: `roleType`
  `"role"`, `assigneeRelation` `"assignee"`, `capPrefix` `"cap_"`. Throws
  `SchemaError` if the assignee name collides, a `cap_<action>` collides, or a
  grantable action isn't in `actionToRelations`.
- **`GrantableAction<S>`** — the compile-time literal union of scaffolded actions.
  `defineRole({ can })`, `grantToRole(role, action)`, and `check({ canThey })`
  reject typos at **compile time**; only the role *name* is a runtime string.
- **`RoleRef<S>` / `roleRef(tenant, name)`** — a branded `{ type, id }` (also
  carrying `tenant`/`name`) so a role can't be confused with an ordinary
  resource. `roleRef` builds the id deterministically as
  `${tenant.type}:${tenant.id}/${name}`; the name must be non-empty and must not
  contain `/`.
- **`new RoleRegistry(authz, schema, { catalog? })`** — typed sugar over the
  existing write APIs:
  - `defineRole({ tenant, name, can, label?, on?, when? })` — `on` defaults to
    `tenant`; writes caps via one atomic `allowMany`.
  - `grantToRole(role, action, on?, when?)` / `revokeFromRole(role, action, on?)`
    — toggle a capability; `on` defaults to `role.tenant`.
  - `assignRole(user, role, when?)` / `unassignRole(user, role)` — membership via
    `addMember` as the `assignee` relation; `assignRole` throws `SchemaError` for
    an unknown role when a catalog is configured.
  - `deleteRole(role)` — cascades caps then memberships, returns
    `{ caps, members }`.
  - `roleRef(tenant, name)`, `getRolePermissions(role)`, `listRoleMembers(role)`,
    `listRoles(tenant)`.
  - **`permissionMatrix(tenant)`** — one read returning
    `{ permissions, roles: [{ name, label?, can: Set<...> }] }`, backing an "add
    a role + click a cell to toggle" UI.
- **Catalog** — `RoleCatalogStore` interface + `InMemoryRoleCatalog` (from
  `polizy`), `PrismaRoleCatalog` (from `polizy/prisma-storage`). Metadata only;
  keeps permission-less roles listable.

New (backward-compatible) `AuthSystem` config:

- **`defaultGroupRelation?` / `defaultHierarchyRelation?`** — the relation
  `addMember`/`removeMember` and `setParent`/`removeParent` use when no `as` is
  given and the schema declares more than one relation of that kind. The
  scaffold's `assignee` relation is auto-excluded from group inference. Passing a
  value that isn't a relation of that kind throws `SchemaError` at construction.
- **`nonSubjectTypes?`** — object types that must not surface in `listSubjects`
  results unless explicitly requested via `ofType`. The scaffold's `role` type is
  added automatically, so role objects never leak as subjects.

New (backward-compatible) read queries:

- **`someoneCan({ canThey, onWhat, ofType?, context? })`** — existence check;
  short-circuits at the first qualifying subject (cheaper than `listSubjects`).
- **`countSubjects(...)` / `countAccessibleObjects(...)`** — counts; same args as
  `listSubjects` / `listAccessibleObjects`. A wildcard grant counts as one entry.
- **`preload?: boolean`** on `listSubjects`, `listAccessibleObjects`, `checkMany`,
  `someoneCan`, and the counts — fetches the tuple set in one read, then resolves
  in memory; for remote/slow stores where per-query round-trips dominate.

See **../polizy-patterns/references/RUNTIME-ROLES.md** for the end-to-end
pattern, and the new `examples/permissions-matrix` app for a working
click-to-toggle matrix with add/delete role, member assignment, per-tenant
divergence, wildcard roles, and live check + explain.

## Behavior / bug fixes (verify these)

- **Wildcard memberships now grant.** Assigning `everyone(type)` to a group/role
  (e.g. `assignRole(everyone("user"), role)`) now grants every subject of that
  type — wildcard membership propagates through group recursion. Previously this
  was **silently ignored**. The change is honored in `check()`, `explain()`, and
  `listAccessibleObjects`.

  > Verify you don't have stray `everyone(type)` membership tuples left over from
  > `0.4.x` that did nothing before and would now take effect (granting broader
  > access than intended). Audit with `listTuples` / `listSubjects` if in doubt.

## Deprecations

None.

## Quick checklist

- [ ] Upgrade `polizy` — existing code needs **no changes** (`0.5.0` is additive).
- [ ] Audit for stray `everyone(type)` membership tuples — they now grant where
      they were previously ignored.
- [ ] (Adopting roles) Wrap your schema with `withRoleScaffold({ grantable })`.
- [ ] (Adopting roles) Set `defaultGroupRelation` if you have >1 group relation
      or want explicit inference; same for `defaultHierarchyRelation`.
- [ ] (Adopting roles) Construct a `RoleRegistry`; optionally pass a catalog.
- [ ] (Optional) Add the `PolizyRole` Prisma model + migrate if you use
      `PrismaRoleCatalog`.
- [ ] (Optional) Build a permissions UI with `permissionMatrix(tenant)`.
- [ ] See ../polizy-patterns/references/RUNTIME-ROLES.md and
      `examples/permissions-matrix`.
