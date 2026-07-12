---
title: Runtime Custom Roles
sidebar_position: 3
---

# Runtime Custom Roles

Sometimes you want your **end users** to define their own roles — a settings page
where each workspace builds a "Billing Manager" or "Guide" from a set of
permissions, like this:

> **Permissions matrix** — _What each role can do across the workspace · click a cell to toggle_
>
> |                 | Admin | Ops | Finance | Guide | Support |
> |-----------------|:-----:|:---:|:-------:|:-----:|:-------:|
> | View bookings   |   ✓   |  ✓  |    ✓    |   ✓   |    ✓    |
> | Edit bookings   |   ✓   |  ✓  |    —    |   —   |    ✓    |
> | Issue refunds   |   ✓   |  —  |    ✓    |   —   |    —    |
> | Manage settings |   ✓   |  —  |    —    |   —   |    —    |

polizy supports this with **no schema change and no redeploy**. Roles become pure
data (the canonical Zanzibar "roles as data" pattern), resolved by the existing
group + hierarchy traversal — and the permission vocabulary stays compile-time
type-safe.

:::tip[The key distinction]

Adding a **role** (a bundle of *existing* permissions) is pure data. Adding a new
**permission verb** with new semantics is a schema change — in polizy and in every
ReBAC system. This guide covers runtime *roles* built from your known action
vocabulary, which is the common case (and exactly what a permissions matrix needs:
new columns, fixed rows).

:::

## 1. Add the role scaffold

`withRoleScaffold` merges a generic role scaffold into your schema while keeping
its literal types. You pass `grantable` — the actions custom roles may grant
(your fixed permission rows):

```ts
import { defineSchema, withRoleScaffold } from "polizy";

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
    manage_settings: ["owner"],
  },
  // Workspace-scoped capabilities flow down to the workspace's bookings.
  hierarchyPropagation: {
    view_bookings: ["view_bookings"],
    edit_bookings: ["edit_bookings"],
    issue_refunds: ["issue_refunds"],
    manage_settings: ["manage_settings"],
  },
});

export const schema = withRoleScaffold(base, {
  grantable: ["view_bookings", "edit_bookings", "issue_refunds", "manage_settings"],
});
```

This adds, once:

- a `role` object type,
- a reserved `assignee` **group** relation (`user --assignee--> role`), and
- one `cap_<action>` **direct** relation per grantable action
  (`role --cap_<action>--> resource`), appended to that action's
  `actionToRelations`.

A custom role then resolves on the **unchanged engine**:
`user --assignee--> role --cap_<action>--> workspace`, with hierarchy propagation
carrying a workspace-scoped capability down to its bookings.

## 2. Create the AuthSystem

```ts
import { AuthSystem, InMemoryStorageAdapter } from "polizy";

const authz = new AuthSystem({
  storage: new InMemoryStorageAdapter(),
  schema,
  // The scaffold adds a second group relation (`assignee`). Set the app's own
  // group relation as the default so existing addMember() calls keep working.
  defaultGroupRelation: "member",
});
```

:::note[Why `defaultGroupRelation`?]

When a schema has more than one `group` relation, `addMember`/`removeMember`
normally require an explicit `as`. The scaffold's `assignee` relation is excluded
from inference automatically, so a single pre-existing group relation still
infers — but setting `defaultGroupRelation` makes it explicit and future-proof.

:::

## 3. Define and assign roles with `RoleRegistry`

`RoleRegistry` is ergonomic, typed sugar over the existing write APIs. The set of
actions a role may grant stays the compile-time-checked `GrantableAction` union;
only the role **name** is a runtime string.

```ts
import { RoleRegistry, InMemoryRoleCatalog } from "polizy";

const roles = new RoleRegistry(authz, schema, {
  catalog: new InMemoryRoleCatalog(),
});

// Create a role at runtime — pure tuples, no schema change.
const billing = await roles.defineRole({
  tenant: { type: "workspace", id: "acme" },
  name: "billing_manager",
  label: "Billing Manager",
  can: ["view_bookings", "issue_refunds"], // 'isue_refunds' → compile error
});

// Assign a user to it.
await roles.assignRole({ type: "user", id: "alice" }, billing);
```

## 4. Toggle permissions (the matrix)

Each cell in a permissions matrix is one idempotent grant/revoke:

```ts
await roles.grantToRole(billing, "edit_bookings");   // tick the cell
await roles.revokeFromRole(billing, "edit_bookings"); // untick it
```

`permissionMatrix(tenant)` builds the whole grid (rows × columns) in a single
read — the natural backing for the UI:

```ts
const matrix = await roles.permissionMatrix({ type: "workspace", id: "acme" });
// matrix.permissions → the fixed action rows
// matrix.roles       → [{ name, label, can: Set<action> }, ...] columns
```

Note that `permissionMatrix` retrieves **tenant-scoped** capabilities only (i.e. permissions granted on that specific tenant object, such as the workspace). In contrast, the `getRolePermissions(role)` method is broader, reporting capabilities across **all** objects that the role has been granted access on throughout the system.

Other registry methods: `unassignRole`, `deleteRole` (cascades capabilities and
memberships), `listRoles`, `listRoleMembers`, and `roleRef(tenant, name)`.

## 5. Check permissions

Checking is the ordinary `check()` — there is **no new verb**:

```ts
await authz.check({
  who: { type: "user", id: "alice" },
  canThey: "issue_refunds",
  onWhat: { type: "booking", id: "bk-101" }, // booking parented to workspace:acme
}); // → true
```

For per-resource checks to resolve, the resource must belong to the tenant via the
hierarchy (`setParent({ child: booking, parent: workspace })`) and the action must
be in `hierarchyPropagation`. For coarse, workspace-wide permissions you can also
check directly against the workspace object.

## Type safety

- The **`grantable` actions stay literal-typed** — `defineRole({ can })`,
  `grantToRole(role, action)`, and `check({ canThey })` all autocomplete and reject
  typos at compile time. Custom roles are *dynamic compositions of statically-known
  actions*.
- The role **identity** is a branded `RoleRef`, so a role can't be confused with an
  ordinary resource.
- Only the runtime-born role **name** is a string; a typo'd name fails closed (the
  role simply has no capabilities), and `assignRole` throws for an unknown role when
  a catalog is configured.

## Multi-tenancy

Role ids are tenant-namespaced (`role:acme/billing_manager` vs
`role:globex/billing_manager`), so two workspaces can define identically-named
roles with completely different permissions, on one shared `AuthSystem`.

:::important[Tenant ID Restrictions]

The tenant ID (`id`) must not contain the forward slash (`/`) character. To prevent cross-tenant permission matrix contamination via prefix parsing, `defineRole` and `roleRef` will throw a `SchemaError` if the tenant ID contains a `/`.

:::

## Wildcard roles

Grant a role to **every** user with a wildcard assignment:

```ts
import { everyone } from "polizy";

await roles.assignRole(everyone("user"), guideRole); // everyone is a Guide
```

## Persisting the catalog

The catalog tracks role existence and labels so permission-less roles stay
listable (the engine never reads it — capabilities and assignments live in your
storage adapter as tuples). Use `InMemoryRoleCatalog`, or `PrismaRoleCatalog` from
`polizy/prisma-storage`:

```ts
import { PrismaRoleCatalog } from "polizy/prisma-storage";

const roles = new RoleRegistry(authz, schema, {
  catalog: PrismaRoleCatalog(prisma), // add the PolizyRole model to schema.prisma
});
```

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

## Try it

A full runnable demo — a click-to-toggle permissions matrix with add/delete role,
member assignment, per-tenant divergence, and a live check + explain — lives in
[`examples/permissions-matrix`](https://github.com/bratsos/polizy/tree/main/examples/permissions-matrix),
running a real Postgres in the browser via PGlite.

```bash
pnpm --filter example-permissions-matrix dev
```
