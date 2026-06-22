# Permissions matrix — polizy runtime roles demo

A self-contained demo of **end-user-defined custom roles** in [polizy](../../packages/polizy):
a click-to-toggle permissions matrix where each workspace defines its own roles at
runtime — no schema changes, no redeploy, and the permission vocabulary stays
compile-time type-safe.

Everything runs **client-side** against a real Postgres **in your browser** —
[PGlite](https://pglite.dev) (WASM) persisted per-visitor in IndexedDB — wired to
polizy through a plain-SQL `StorageAdapter` and `RoleCatalogStore`
(`withRoleScaffold` + `RoleRegistry`). There is no server; tinkering survives a
refresh, and **Reset** re-seeds.

## What it shows

- **Permissions matrix** — fixed permission rows × dynamic role columns. Click a cell
  to grant/revoke (`grantToRole` / `revokeFromRole`).
- **Add / delete roles at runtime** (`defineRole` / `deleteRole`) — pure tuple data.
- **Assign people to roles**, or grant a role to **everyone** via a wildcard
  assignment (`everyone("user")`).
- **Per-tenant divergence** — switch between *Acme Tours* and *Globex Travel*; each
  has a completely different role set, on the same engine.
- **Live access check + explain** — the real `authz.check(...)` decision plus the
  granting path, including per-booking checks that resolve through hierarchy.
- **Stored tuples** — see that every role, capability, and assignment is just data.

## Run it

```bash
pnpm install
pnpm --filter example-permissions-matrix dev      # http://localhost:3002
```

Or run the headless walkthrough (prints the matrix + checks to the terminal):

```bash
pnpm --filter example-permissions-matrix demo
```

## How it works (the whole authorization model)

```ts
// schema.ts — the permission ROWS are fixed, typed actions.
const base = defineSchema({ /* relations, actions, hierarchyPropagation */ });
export const schema = withRoleScaffold(base, {
  grantable: ["view_bookings", "edit_bookings", "issue_refunds",
              "view_finances", "manage_pricing", "manage_settings"],
});

// store.ts — roles are created/edited/assigned at runtime as data, persisted to
// PGlite (Postgres in the browser) via a plain-SQL adapter + catalog.
const db = new PGlite("idb://polizy-matrix-demo");
const authz = new AuthSystem({ storage: createPGliteAdapter(db), schema, defaultGroupRelation: "member" });
const roles = new RoleRegistry(authz, schema, { catalog: createPGliteRoleCatalog(db) });

const billing = await roles.defineRole({ tenant: ws("acme"), name: "billing", can: ["issue_refunds"] });
await roles.assignRole({ type: "user", id: "alice" }, billing);

// The check is the ordinary polizy check — no new verb.
await authz.check({ who: { type: "user", id: "alice" }, canThey: "issue_refunds", onWhat: { type: "booking", id: "bk-101" } });
```

The only runtime string is the role **name**; the `can` actions are
compile-time-checked (`grantToRole(role, "isue_refunds")` is a type error).
