# Runtime Custom Roles

Let end users define their own roles **in the app**, with no schema change and no
redeploy. The mental model is a permissions matrix: **dynamic role columns** that
admins add/remove at runtime, against a **fixed grid of permission rows** (your
app's known action vocabulary).

## When to Use

- A B2B app where each customer wants to name and shape their own roles
  ("Front Desk", "Accountant", "Manager") from a fixed set of permissions
- An admin settings screen with a click-to-toggle permissions matrix
- Per-tenant role divergence: same role name, different permissions per customer
- Any "roles are just named bundles of existing permissions" requirement

## The Key Idea: Roles as Data

This is the canonical Zanzibar "roles as data" pattern (one level of
indirection). A custom role is **pure tuples** on the unchanged engine:

```
user --assignee(group)--> role --cap_<action>(direct)--> resource
```

- `assignee` is a reserved **group** relation: assigning a user to a role is just
  group membership.
- `cap_<action>` is a **direct** relation per grantable action: a role grants an
  action by holding that capability on a resource.
- With `hierarchyPropagation`, a workspace-scoped capability flows down to the
  workspace's resources (so a role granted on the workspace reaches every booking
  in it).

Because roles are tuples, **no new storage tables are required for the roles
themselves**, and checking a custom role is the **ordinary `check()`** — there is
no new verb. (An optional `PolizyRole` catalog table is metadata only; see
[Persisting the catalog](#persisting-the-catalog).)

> **Roles vs. verbs.** Runtime roles are named bundles of *existing* actions —
> data, no schema change. A genuinely **new permission VERB** with new semantics
> is a schema change (true in polizy and every ReBAC system). See
> [When NOT to use it](#when-not-to-use-it).

## 1. Add the Role Scaffold

`withRoleScaffold(schema, opts)` merges a generic role scaffold into an existing
schema **while preserving its literal types**. It adds, once:

- a `role` object type,
- a reserved `assignee` **group** relation (`user --assignee--> role`), and
- one `cap_<action>` **direct** relation per grantable action, appended to that
  action's `actionToRelations`.

```typescript
import { defineSchema, withRoleScaffold } from "polizy";

// The permission ROWS of the matrix: the fixed, app-defined action vocabulary.
const GRANTABLE = [
  "view_bookings",
  "edit_bookings",
  "issue_refunds",
  "view_finances",
  "manage_pricing",
  "manage_settings",
] as const;

const base = defineSchema({
  subjectTypes: ["user"],
  objectTypes: ["workspace", "booking"],
  relations: {
    owner: { type: "direct" },
    member: { type: "group" },
    parent: { type: "hierarchy" },
  },
  actionToRelations: {
    view_bookings: ["owner"],
    edit_bookings: ["owner"],
    issue_refunds: ["owner"],
    view_finances: ["owner"],
    manage_pricing: ["owner"],
    manage_settings: ["owner"],
  },
  // CRITICAL: workspace-scoped capabilities flow down to the workspace's bookings.
  hierarchyPropagation: {
    view_bookings: ["view_bookings"],
    edit_bookings: ["edit_bookings"],
    issue_refunds: ["issue_refunds"],
    view_finances: ["view_finances"],
    manage_pricing: ["manage_pricing"],
    manage_settings: ["manage_settings"],
  },
});

// The schema with the runtime-roles scaffold merged in (still fully typed).
export const schema = withRoleScaffold(base, { grantable: GRANTABLE });
```

After the scaffold, `actionToRelations.view_bookings` becomes
`["owner", "cap_view_bookings"]`, and a new `cap_view_bookings: { type: "direct" }`
relation exists — so a role holding `cap_view_bookings` on a resource resolves
`view_bookings` through the normal engine.

**Options** (with defaults):

| Option | Default | Meaning |
|--------|---------|---------|
| `grantable` | — (required) | The actions custom roles may grant. Each must exist in `actionToRelations`. |
| `roleType` | `"role"` | Object type for role objects. |
| `assigneeRelation` | `"assignee"` | The reserved group relation for user → role. |
| `capPrefix` | `"cap_"` | Prefix for the per-action capability relations. |

`withRoleScaffold` throws a `SchemaError` if: the `assignee` relation name
collides with an existing relation, a `cap_<action>` relation collides, or a
`grantable` action is not present in `actionToRelations`.

## 2. Create the AuthSystem

The engine is unchanged — construct it as usual. The one thing to know: the
scaffold adds a **second** group relation (`assignee`), so if your app already had
exactly one group relation (`member` above), inference is now ambiguous **only**
if you don't account for it. The scaffold's `assignee` relation is
**auto-excluded from group inference**, so a schema that had exactly one group
relation keeps inferring it (this is why the scaffold is non-breaking).

If you still want to be explicit — or you had more than one group relation — set
`defaultGroupRelation` so `addMember`/`removeMember` know which relation to use
when no `as` is given:

```typescript
import { AuthSystem, InMemoryStorageAdapter } from "polizy";

const authz = new AuthSystem({
  storage: new InMemoryStorageAdapter(),
  schema,
  // Keep the app's own `member` relation inferred for addMember without `as`.
  // (The scaffold's `assignee` is auto-excluded from group inference.)
  defaultGroupRelation: "member",
});
```

`defaultHierarchyRelation` is the equivalent for `setParent`/`removeParent`.
Passing a default that isn't a relation of that kind throws a `SchemaError` at
construction. The scaffold's `role` type is automatically added to
`nonSubjectTypes`, so role objects never leak as subjects from `listSubjects`.

## 3. RoleRegistry: defineRole / assignRole

`RoleRegistry` is typed, ergonomic sugar over the existing write APIs — it adds
no new engine concepts.

```typescript
import { RoleRegistry } from "polizy";

const roles = new RoleRegistry(authz, schema);

const acme = { type: "workspace", id: "acme" } as const;

// Define a role. `can` is compile-time-checked against GRANTABLE.
// Caps are written on `on` (defaults to the tenant), so a workspace-scoped role
// grants its actions across the workspace (and its hierarchy descendants).
const frontDesk = await roles.defineRole({
  tenant: acme,
  name: "front-desk",
  label: "Front Desk",
  can: ["view_bookings", "edit_bookings"],
});

// Assign a user to the role (membership via the `assignee` relation).
await roles.assignRole({ type: "user", id: "alice" }, frontDesk);
```

`defineRole` writes all capabilities in a single atomic `allowMany`. `assignRole`
uses `addMember` under the hood with the reserved `assignee` relation, and accepts
an optional `when` condition for time-boxed/conditional membership. Remove a
member with `unassignRole(user, role)`.

## 4. Toggle Permissions + Build the Matrix

Add and remove capabilities at runtime — this is the "click a cell" operation:

```typescript
// Turn a matrix cell ON (idempotent). `on` defaults to role.tenant.
await roles.grantToRole(frontDesk, "issue_refunds");

// Turn a matrix cell OFF.
await roles.revokeFromRole(frontDesk, "issue_refunds");
```

`permissionMatrix(tenant)` backs the whole grid in **one read** — the fixed
permission rows plus every role column with the set of actions it grants:

```typescript
const matrix = await roles.permissionMatrix(acme);
// {
//   permissions: ["view_bookings", "edit_bookings", "issue_refunds", ...],
//   roles: [
//     { name: "front-desk", label: "Front Desk",
//       can: Set { "view_bookings", "edit_bookings" } },
//     ...
//   ],
// }

// Render: permissions = rows, roles = columns, can.has(perm) = checkbox state.
for (const perm of matrix.permissions) {
  for (const role of matrix.roles) {
    const checked = role.can.has(perm); // cell state
  }
}
```

## 5. Check

Checking a custom role is the **ordinary `check()`** — no new verb, no registry
call. The user resolves through `assignee` (group) → role → `cap_<action>` (direct).

For **per-resource** access, the resource must be parented under the tenant the
caps were granted on, and the action must propagate (set up in step 1):

```typescript
// Booking is parented under the workspace (caps granted on the workspace).
await authz.setParent({
  child: { type: "booking", id: "bk_1" },
  parent: acme,
});

// alice (front-desk) can edit the booking:
// alice --assignee--> role --cap_edit_bookings--> workspace ←parent← booking
await authz.check({
  who: { type: "user", id: "alice" },
  canThey: "edit_bookings",
  onWhat: { type: "booking", id: "bk_1" },
}); // true
```

For **coarse**, workspace-level permissions, check the workspace directly — no
hierarchy needed:

```typescript
await authz.check({
  who: { type: "user", id: "alice" },
  canThey: "view_bookings",
  onWhat: acme,
}); // true
```

`explain()` works too, and shows the full chain
(`group` via `assignee` → `direct` via the `cap_<action>` relation, plus any
`hierarchy` hop). See [Pattern 13](../SKILL.md#pattern-13-debugging-with-explain).

## Type Safety

The action vocabulary stays compile-time-checked; only the role **name** is a
runtime string.

- **`GrantableAction<S>`** is the literal union of the scaffolded actions.
  `defineRole({ can })`, `grantToRole(role, action)`, and a typed `check()` reject
  typos at **compile time**:

  ```typescript
  await roles.defineRole({
    tenant: acme,
    name: "manager",
    can: ["view_finances", "issue_refundz"], // ❌ compile error: typo
  });
  ```

- **`RoleRef<S>`** is a **branded** `{ type, id }` (it also carries `tenant`/`name`
  for convenience) so a role can't be confused with an ordinary resource. Build
  one deterministically with `roleRef(tenant, name)`; the id is
  `` `${tenant.type}:${tenant.id}/${name}` ``. The name must be non-empty and must
  not contain `"/"` (otherwise `SchemaError`).

  ```typescript
  const ref = roles.roleRef(acme, "front-desk");
  // ref.id === "workspace:acme/front-desk"
  ```

- A **typo'd role name fails closed**: a `RoleRef` for a name that was never
  defined simply has no tuples, so checks return `false`. When a **catalog** is
  configured, `assignRole` throws a `SchemaError` for an unknown role instead of
  silently creating a dangling membership.

## Multi-Tenancy

Role ids are **tenant-namespaced** (`workspace:acme/manager` vs
`workspace:globex/manager`), so the **same name can carry different permissions
per tenant** with zero collision:

```typescript
const globex = { type: "workspace", id: "globex" } as const;

// "manager" means different things in two tenants.
await roles.defineRole({ tenant: acme,   name: "manager",
  can: ["view_finances", "manage_pricing"] });
await roles.defineRole({ tenant: globex, name: "manager",
  can: ["view_bookings"] });
```

Each tenant's roles, caps, and members are isolated by id. `permissionMatrix` and
`listRoles` are always scoped to a single tenant.

## Wildcard Roles

Assign **everyone** of a subject type to a role to grant every such subject its
capabilities. Wildcard membership propagates through group recursion (honored in
`check`, `explain`, and `listAccessibleObjects`):

```typescript
import { everyone } from "polizy";

const baseAccess = await roles.defineRole({
  tenant: acme,
  name: "base-access",
  can: ["view_bookings"],
});

// Every user in the system gets this role's permissions.
await roles.assignRole(everyone("user"), baseAccess);

await authz.check({
  who: { type: "user", id: "anyone" },
  canThey: "view_bookings",
  onWhat: acme,
}); // true
```

## Deleting & Inspecting Roles

`deleteRole` cascades the role's **capabilities first, then its memberships**, and
reports the counts:

```typescript
const { caps, members } = await roles.deleteRole(frontDesk);
// { caps: 2, members: 1 }
```

Read APIs for building UIs:

```typescript
// What does this role grant? (derived from its capability tuples)
const perms = await roles.getRolePermissions(frontDesk);
// ["view_bookings", "edit_bookings"]

// Who is assigned to this role?
const members = await roles.listRoleMembers(frontDesk);
// [{ type: "user", id: "alice" }, ...]

// Every role in a tenant (with labels + granted actions).
const all = await roles.listRoles(acme);
// [{ name: "front-desk", label: "Front Desk", can: ["view_bookings", ...] }, ...]
```

> `getRolePermissions`, `listRoleMembers`, `listRoles`, and `permissionMatrix`
> derive their answers from tuples — the tuples are the source of truth. The
> catalog (below) only adds existence + labels for roles that have no tuples yet.

## Persisting the Catalog

A role with **no capabilities** has no tuples, so it is invisible to `listRoles`,
and `assignRole` can't verify it exists. An optional `RoleCatalogStore` tracks
role existence + labels so permission-less roles stay listable. **The engine
never reads the catalog** — capabilities and assignments live as tuples in the
`StorageAdapter`.

For tests, dev, and single-process apps, use `InMemoryRoleCatalog`:

```typescript
import { RoleRegistry, InMemoryRoleCatalog } from "polizy";

const roles = new RoleRegistry(authz, schema, {
  catalog: new InMemoryRoleCatalog(),
});
```

For production with Prisma, use `PrismaRoleCatalog` from `polizy/prisma-storage`,
backed by a new optional `PolizyRole` model:

```typescript
import { PrismaClient } from "@prisma/client";
import { RoleRegistry } from "polizy";
import { PrismaRoleCatalog } from "polizy/prisma-storage";

const prisma = new PrismaClient();

const roles = new RoleRegistry(authz, schema, {
  catalog: PrismaRoleCatalog(prisma),
});
```

Add the model to your `schema.prisma` (alongside `PolizyTuple`) and migrate:

```prisma
// Optional catalog for the runtime-roles feature (RoleRegistry + PrismaRoleCatalog).
// Tracks role existence + labels so empty roles are listable; the authorization
// engine never reads this table — capabilities/assignments live in PolizyTuple.
model PolizyRole {
  id      String  @id @default(cuid())
  tenant  String // tenant scope key, "${type}:${id}"
  key     String // role name (unique within a tenant)
  label   String?
  actions Json // string[] of granted action names (denormalized cache)

  @@unique([tenant, key])
  @@index([tenant])
}
```

You can also implement the `RoleCatalogStore` interface yourself (4 methods:
`upsert`, `remove`, `get`, `list`) over any store. Both `RoleCatalogStore` and
`InMemoryRoleCatalog` are exported from `polizy`.

## When NOT to Use It

The scaffold covers runtime roles built from the **known, type-safe action
vocabulary** — the common case (a permissions matrix: new columns/roles, fixed
rows/permissions).

It does **not** let end users invent a brand-new permission **verb** with new
semantics. Adding a `view_payroll` action that no existing action expresses is a
**schema change** (new entry in `actionToRelations`, possibly new relations and
propagation), not runtime data — true in polizy and in every ReBAC system. If you
find yourself wanting users to define new *permissions* (not new *bundles* of
existing permissions), that belongs in the schema, with a deploy. See
[polizy-schema](../../polizy-schema/SKILL.md).

## Best Practices

1. **Define the grantable vocabulary deliberately** — it's your app's permission
   contract and the matrix's fixed rows. Keep it small and meaningful.
2. **Grant caps at the tenant/workspace level** and rely on
   `hierarchyPropagation` to reach resources — don't grant per-resource caps per
   role.
3. **Configure a catalog in production** so empty roles are listable and unknown
   roles fail loudly on `assignRole`.
4. **Use `permissionMatrix` for the grid** — one read backs the whole UI.
5. **Set `defaultGroupRelation`** if you want explicit, future-proof inference of
   your own group relation alongside the scaffold's `assignee`.

## Anti-Patterns

### Don't: forget `hierarchyPropagation` for per-resource roles

```typescript
// ❌ Bad - caps granted on the workspace, but actions don't propagate
const schema = withRoleScaffold(
  defineSchema({
    relations: { owner: { type: "direct" }, parent: { type: "hierarchy" } },
    actionToRelations: { view_bookings: ["owner"] },
    // Missing hierarchyPropagation — workspace caps never reach bookings!
  }),
  { grantable: ["view_bookings"] },
);

// ✅ Good - propagate so workspace-scoped caps reach the workspace's resources
//   hierarchyPropagation: { view_bookings: ["view_bookings"] }
```

### Don't: treat a missing role as an error-free no-op without a catalog

```typescript
// ❌ Bad - no catalog: assigning a typo'd/undefined role silently creates a
//   dangling membership with no effect.
await roles.assignRole(user, roles.roleRef(acme, "frnt-desk"));

// ✅ Good - configure a catalog; assignRole throws SchemaError for unknown roles.
const roles = new RoleRegistry(authz, schema, { catalog: new InMemoryRoleCatalog() });
```

### Don't: reach for runtime roles to add new semantics

```typescript
// ❌ Bad - "view_payroll" isn't in GRANTABLE; you can't conjure it at runtime.
await roles.grantToRole(role, "view_payroll"); // compile error / not grantable

// ✅ Good - add the action to the schema and redeploy (it's a new verb).
```

## Try It

See **`examples/permissions-matrix`** — an end-user custom roles demo running a
real Postgres in the browser via PGlite: a click-to-toggle permissions matrix
with add/delete role, member assignment, per-tenant divergence, wildcard roles,
and a live `check` + `explain`.

## Related

- [GROUP-ACCESS.md](GROUP-ACCESS.md) — the membership mechanics `assignRole` builds on
- [HIERARCHY.md](HIERARCHY.md) — how workspace-scoped caps reach resources
- [MULTI-TENANT.md](MULTI-TENANT.md) — tenant isolation strategies
- [polizy-schema](../../polizy-schema/SKILL.md) — when you genuinely need a new verb
