# polizy

[![npm version](https://badge.fury.io/js/polizy.svg)](https://badge.fury.io/js/polizy)

`polizy` is a flexible, [Zanzibar](https://research.google/pubs/pub48190/)-inspired authorization library for Node.js and TypeScript. It lets you model fine-grained permissions as **relationships** between users, groups, and resources — directly in your application, with no separate authorization service to run.

```ts
import { AuthSystem, InMemoryStorageAdapter, defineSchema } from "polizy";

const schema = defineSchema({
  relations: { owner: { type: "direct" }, viewer: { type: "direct" } },
  actionToRelations: { edit: ["owner"], view: ["owner", "viewer"] },
});

const authz = new AuthSystem({ storage: new InMemoryStorageAdapter(), schema });

await authz.allow({ who: { type: "user", id: "alice" }, toBe: "owner", onWhat: { type: "doc", id: "1" } });
await authz.check({ who: { type: "user", id: "alice" }, canThey: "edit", onWhat: { type: "doc", id: "1" } }); // true
```

## Why polizy

* **Embeddable.** Unlike self-hosted services (OpenFGA, Ory Keto, SpiceDB), `polizy` runs in-process — no extra infrastructure.
* **Relationship-based (ReBAC).** Permissions follow relationships: *"alice can edit doc B because she's in team C, which owns folder D, which contains B."*
* **Type-safe schema.** `defineSchema` captures your relations and actions as literal types, so `check`/`allow` autocomplete and reject typos.
* **Groups & hierarchy.** First-class nested groups and parent/child propagation (folders → files), with support for **multiple** group and hierarchy relations.
* **Conditions (time + ABAC).** Grants can be time-boxed (`validUntil`) and/or gated on attribute predicates evaluated against a per-check `context`.
* **Pluggable storage.** Ships an in-memory adapter (tests/dev) and a Prisma adapter (production). Both honor an identical, contract-tested behavior.
* **Fail-closed.** Unknown actions, exceeded depth, and malformed conditions deny rather than leak.

## Installation

```bash
npm install polizy      # or: pnpm add polizy / yarn add polizy
```

The Prisma adapter requires `@prisma/client` (an optional peer dependency) — install it only if you use persistent storage.

## Core concepts

| Concept | Meaning |
|---|---|
| **Subject** | Who is acting — `{ type: "user", id: "alice" }`. A group can also act as a subject. |
| **Object** | What is acted on — `{ type: "doc", id: "1" }`. |
| **Relation** | A stored relationship name (`owner`, `viewer`, `member`, `parent`), typed `direct`, `group`, or `hierarchy`. |
| **Action** | An intent (`view`, `edit`, `delete`) mapped to the relations that grant it. |
| **Tuple** | A stored fact: `(subject, relation, object[, condition])`. |
| **Condition** | Optional constraints on a tuple: a time window and/or attribute predicates. |

`polizy` is **grants-only** (like Zanzibar): there are no "deny" tuples. Model exceptions with narrower relations/objects rather than negative rules (see [Limitations](#limitations)).

## 1. Define a schema

```ts
import { defineSchema } from "polizy";

const schema = defineSchema({
  subjectTypes: ["user", "team"],
  objectTypes: ["document", "folder", "team"],

  relations: {
    owner: { type: "direct" },
    editor: { type: "direct" },
    viewer: { type: "direct" },
    member: { type: "group" },      // links a subject to a group it belongs to
    parent: { type: "hierarchy" },  // links a child object to its parent
  },

  actionToRelations: {
    view: ["viewer", "editor", "owner", "member"],
    edit: ["editor", "owner"],
    delete: ["owner"],
  },

  // How permissions flow from a parent to its children.
  hierarchyPropagation: {
    view: ["view"], // if you can view the parent, you can view the child
    edit: ["edit"],
    delete: [],
  },

  // Opt in to field-level identifiers (see "Field-level permissions").
  fieldLevelObjects: ["document"],
  // fieldSeparator defaults to "#"
});
```

`defineSchema` **throws** a `SchemaError` if an action maps to an undefined relation or `hierarchyPropagation` references an undefined action — catching model mistakes at startup.

You can declare **multiple** `group` and `hierarchy` relations (e.g. `member` + `orgMember`, `folderParent` + `orgParent`). `check` traverses them all.

## 2. Choose a storage adapter

```ts
import { InMemoryStorageAdapter } from "polizy";
const storage = new InMemoryStorageAdapter(); // data lost on restart — great for tests
```

For persistence, use the Prisma adapter from the `polizy/prisma-storage` subpath (kept separate so the core import never pulls in `@prisma/client`):

```ts
import { PrismaStorageAdapter } from "polizy/prisma-storage"; // alias of PrismaAdapter
import { PrismaClient } from "@prisma/client";

const storage = PrismaStorageAdapter(new PrismaClient());
```

> `PrismaStorageAdapter` is a **factory function**, not a class — call it, don't `new` it. `PrismaAdapter` is the same function under its original name.

Add a model to your `schema.prisma`. The unique constraint is **required** — it makes grants idempotent:

```prisma
model PolizyTuple {
  id          String  @id @default(cuid())
  subjectType String
  subjectId   String
  relation    String
  objectType  String
  objectId    String
  condition   Json?

  @@unique([subjectType, subjectId, relation, objectType, objectId])
  @@index([subjectType, subjectId, relation])
  @@index([objectType, objectId, relation])
}
```

Run `prisma generate` (and `prisma migrate`/`db push`) so the client knows the compound unique key.

## 3. Create the AuthSystem

```ts
import { AuthSystem } from "polizy";

const authz = new AuthSystem({
  storage,
  schema,
  defaultCheckDepth: 20,        // max group/hierarchy hops (default 20)
  maxDepthBehavior: "throw",    // "throw" MaxDepthExceededError | "deny" (default "throw")
  logger: console,             // optional; defaults to a no-op (no console noise)
});
```

## 4. Grant & revoke (idempotent)

```ts
// Direct grant
await authz.allow({ who: { type: "user", id: "alice" }, toBe: "owner", onWhat: { type: "document", id: "doc1" } });

// Time-boxed grant
await authz.allow({
  who: { type: "user", id: "bob" },
  toBe: "viewer",
  onWhat: { type: "document", id: "doc1" },
  when: { validUntil: new Date(Date.now() + 3600_000) }, // 1 hour
});

// Bulk
await authz.allowMany([
  { who: { type: "user", id: "carol" }, toBe: "viewer", onWhat: { type: "document", id: "doc1" } },
  { who: { type: "user", id: "dave" },  toBe: "editor", onWhat: { type: "document", id: "doc1" } },
]);

// Groups (use `as` only when the schema has more than one group relation)
await authz.addMember({ member: { type: "user", id: "carol" }, group: { type: "team", id: "alpha" } });
await authz.removeMember({ member: { type: "user", id: "carol" }, group: { type: "team", id: "alpha" } });

// Hierarchy
await authz.setParent({ child: { type: "document", id: "doc2" }, parent: { type: "folder", id: "fA" } });
await authz.removeParent({ child: { type: "document", id: "doc2" }, parent: { type: "folder", id: "fA" } });

// Revoke
await authz.disallowAllMatching({ who: { type: "user", id: "alice" }, was: "owner", onWhat: { type: "document", id: "doc1" } }); // one tuple
await authz.disallowAllMatching({ onWhat: { type: "document", id: "doc1" } }); // everything touching doc1 (e.g. on delete)
await authz.disallowAllMatching({ who: { type: "user", id: "bob" } });          // everything for bob (e.g. on deactivate)
```

`allow`/`addMember`/`setParent` are **idempotent** on `(subject, relation, object)`: re-running a grant updates its condition instead of creating duplicates. Because of that, a temporary and a standing grant that differ only by condition can't coexist on the same triple — model "temporary + standing" with **distinct relations** (e.g. `viewer` standing, `temp_viewer` time-boxed).

## 5. Check permissions

```ts
await authz.check({ who: { type: "user", id: "alice" }, canThey: "edit", onWhat: { type: "document", id: "doc1" } });
// → boolean

// Throw instead of returning false
await authz.checkOrThrow({ who, canThey: "edit", onWhat }); // throws NotAuthorizedError

// Batch (e.g. filtering a fetched list)
const [canA, canB] = await authz.checkMany([
  { who, canThey: "view", onWhat: docA },
  { who, canThey: "view", onWhat: docB },
]);
```

Checks traverse direct grants, group memberships (nested), hierarchy propagation, and wildcard grants — with per-check memoization so even wide/deep org graphs resolve efficiently and cycles terminate safely.

### Attribute conditions (ABAC)

Pass a `context`; grants with attribute predicates are evaluated against it:

```ts
await authz.allow({
  who: { type: "user", id: "alice" },
  toBe: "viewer",
  onWhat: { type: "document", id: "doc1" },
  when: { attributes: [{ attribute: "department", operator: "eq", value: "engineering" }] },
});

await authz.check({ who: { type: "user", id: "alice" }, canThey: "view", onWhat: { type: "document", id: "doc1" },
  context: { department: "engineering" } }); // true
```

Operators: `eq`, `ne`, `in`, `nin`, `gt`, `gte`, `lt`, `lte`. `attribute` supports dot-paths (`"user.tier"`). A missing context value or type mismatch fails the predicate (fail-closed). Conditions can combine a time window and predicates (all must pass).

### Public / wildcard access

```ts
import { everyone } from "polizy";
await authz.allow({ who: everyone("user"), toBe: "viewer", onWhat: { type: "document", id: "public" } });
// now any user passes `view` on document:public
```

## 6. List & explain

```ts
// What can this subject access (and with which actions)?
const { accessible } = await authz.listAccessibleObjects({ who: { type: "user", id: "alice" }, ofType: "document" });
// [{ object: { type:"document", id:"doc1" }, actions: ["view","edit",...], parent? }, ...]
//  optional filters: canThey, limit, offset

// Who can perform an action on this object? (reverse expansion)
const subjects = await authz.listSubjects({ canThey: "view", onWhat: { type: "document", id: "doc1" } });

// Existence (short-circuits) and counts — same args as listSubjects/listAccessibleObjects.
// A wildcard grant (everyone(type)) counts as one entry, not a per-user expansion.
const isShared = await authz.someoneCan({ canThey: "view", onWhat: { type: "document", id: "doc1" } });
const viewerCount = await authz.countSubjects({ canThey: "view", onWhat: { type: "document", id: "doc1" } });
const docCount = await authz.countAccessibleObjects({ who: { type: "user", id: "alice" }, ofType: "document" });

// Why was a check allowed/denied?
const why = await authz.explain({ who: { type: "user", id: "carol" }, canThey: "view", onWhat: { type: "document", id: "doc1" } });
// { allowed: true, via: { kind: "group", relation: "member", through: {type:"team",id:"alpha"}, via: { kind:"direct", relation:"viewer" } } }

// Raw tuples (paginated)
await authz.listTuples({ subject: { type: "user", id: "alice" } }, { limit: 50, offset: 0 });
```

`listAccessibleObjects` scales with the subject's reachable set (no full-table scan).

## Consistency & read-after-write

Every operation reads through a per-operation layer that fetches broad range reads once and resolves in memory — so a check that revisits the same subject or object many times hits storage a handful of times, not once per edge. `checkMany` shares one reader across the whole batch.

**Rendering a page of many checks?** Wrap them in a read scope so they share a *single* read pass instead of one per operation:

```ts
const view = await authz.withReadScope(async (scope) => {
  const docs = await scope.listAccessibleObjects({ who, ofType: "document" });
  const grid = await scope.checkMany(rows);
  const why  = await scope.explain({ who, canThey: "edit", onWhat });
  return { docs, grid, why };
}, { preload: true });
```

Inside the scope, `check`/`checkMany`/`explain`/`listAccessibleObjects`/`listSubjects` all share one reader, so each subject/object/relation is fetched at most once for the whole scope. `{ preload: true }` fetches the entire tuple set in **one** read up front, so every check then resolves in memory — ideal when storage round-trips are expensive (an in-browser DB, a slow link) or the working set is small. Omit it for large stores, where the per-key range reads scale better.

By default reads are live (each broadened range read is internally consistent, but the operation isn't pinned to a single instant). For a coherent point-in-time view, pass `consistency: "strong"` — every read in the operation comes from one snapshot, **without blocking writers**:

```ts
await authz.check({ who, canThey: "edit", onWhat, consistency: "strong" });
await authz.checkMany(requests, { consistency: "strong" });
```

`"strong"` is served by the adapter's optional `withSnapshot`: the in-memory adapter copies the tuple set; the Prisma adapter runs the whole operation in one transaction — pass `PrismaAdapter(prisma, { snapshotIsolationLevel: "RepeatableRead" })` for Postgres MVCC (readers never block writers, writers never block readers). Adapters that don't implement it fall back to live reads.

**Read-your-writes without a round-trip:** pass freshly written (or not-yet-committed) facts as `contextualTuples`. They're evaluated as if stored, and never persisted:

```ts
await authz.check({
  who, canThey: "view", onWhat: doc,
  contextualTuples: [{ subject: who, relation: "viewer", object: doc }],
}); // true, even before the grant is committed
```

## Field-level permissions

For object types listed in `fieldLevelObjects`, an id may carry a field after the separator (default `#`): `document:doc1#summary`. A grant on the **base** object (`doc1`) authorizes its fields (`doc1#summary`) via direct, group, **and** hierarchy paths, while a grant on a specific field stays scoped to that field.

```ts
await authz.allow({ who: manager, toBe: "owner", onWhat: { type: "document", id: "cert1" } });
await authz.allow({ who: employee, toBe: "viewer", onWhat: { type: "document", id: "cert1#strengths" } });

await authz.check({ who: manager,  canThey: "view", onWhat: { type: "document", id: "cert1#strengths" } }); // true (base → field)
await authz.check({ who: employee, canThey: "view", onWhat: { type: "document", id: "cert1#weaknesses" } }); // false (other field)
```

Field ids are validated on write (empty base or empty field throws), and types **not** in `fieldLevelObjects` never split — so ids that naturally contain `#` can't accidentally leak access.

## Runtime custom roles

Some apps let their **end users** define roles in-app — a permissions matrix where
each workspace invents its own "Billing Manager" or "Guide" from a fixed set of
permissions. polizy supports this with **no schema change and no redeploy**: roles
are pure data (the canonical Zanzibar "roles as data" pattern), resolved by the
existing group + hierarchy + direct traversal.

Add the scaffold once (keeps your schema fully type-safe), then use `RoleRegistry`:

```ts
import {
  AuthSystem, InMemoryStorageAdapter, defineSchema,
  withRoleScaffold, RoleRegistry, InMemoryRoleCatalog,
} from "polizy";

const base = defineSchema({
  subjectTypes: ["user"],
  objectTypes: ["workspace", "booking"],
  relations: { owner: { type: "direct" }, member: { type: "group" }, parent: { type: "hierarchy" } },
  actionToRelations: { view_bookings: ["owner"], issue_refunds: ["owner"], manage_settings: ["owner"] },
  hierarchyPropagation: { view_bookings: ["view_bookings"], issue_refunds: ["issue_refunds"], manage_settings: ["manage_settings"] },
});

// `grantable` = the actions custom roles may grant. Stays compile-time literal-typed.
const schema = withRoleScaffold(base, { grantable: ["view_bookings", "issue_refunds"] });

const authz = new AuthSystem({ storage: new InMemoryStorageAdapter(), schema, defaultGroupRelation: "member" });
const roles = new RoleRegistry(authz, schema, { catalog: new InMemoryRoleCatalog() });

// Create a role at runtime (the name is a string; the actions are type-checked).
const billing = await roles.defineRole({
  tenant: { type: "workspace", id: "acme" },
  name: "billing_manager",
  can: ["view_bookings", "issue_refunds"], // 'isue_refunds' → compile error
});
await roles.assignRole({ type: "user", id: "alice" }, billing);

// Checking is the ordinary check() — no new verb.
await authz.check({ who: { type: "user", id: "alice" }, canThey: "issue_refunds", onWhat: { type: "booking", id: "bk1" } }); // true (booking belongs to workspace:acme)
```

The scaffold adds a `role` object type, a reserved `assignee` group relation
(`user --assignee--> role`), and one `cap_<action>` relation per grantable action
(`role --cap_<action>--> resource`). A workspace-scoped capability flows down to the
workspace's resources via `hierarchyPropagation` — so `setParent` each resource under
its workspace (or check coarse permissions against the workspace directly).

`RoleRegistry` methods: `defineRole`, `grantToRole` / `revokeFromRole` (toggle a
permission), `assignRole` / `unassignRole`, `deleteRole` (cascades caps + members),
`listRoles`, `getRolePermissions`, `listRoleMembers`, and `permissionMatrix(tenant)`
(rows × columns in one read — backs an "add role + click-to-toggle" UI).

* **Type-safety:** the `grantable` actions stay a compile-time `GrantableAction<S>`
  union; only the role *name* is a runtime string, and roles come back as a branded
  `RoleRef` so a role can't be confused with a resource.
* **Multi-tenancy:** role ids are tenant-namespaced (`role:acme/billing_manager`), so
  two workspaces can define identically-named roles with different permissions.
* **Wildcards:** `assignRole(everyone("user"), role)` grants a role to every user.
* **Persistence:** `InMemoryRoleCatalog`, or `PrismaRoleCatalog` from
  `polizy/prisma-storage` (add the `PolizyRole` model). The catalog tracks role
  existence + labels so empty roles stay listable; the engine never reads it.
* **Custom relations/verbs:** adding genuinely *new* permission verbs per tenant is a
  schema concern (as in every ReBAC system) — the scaffold covers runtime *roles*
  built from your known action vocabulary, which is the common case.

A runnable demo (permissions matrix UI + headless walkthrough) lives in
`examples/permissions-matrix`.

## Custom storage adapters

Implement the `StorageAdapter` interface (`write`, `delete`, `findTuples`, `findSubjects`, `findObjects`). `write` must be idempotent on `(subject, relation, object)`, and `delete` must match `who AND (object == onWhat OR subject == onWhat)`. The package ships a shared contract test suite you can run against your adapter. Optionally implement `withSnapshot` to enable `consistency: "strong"` (see [Consistency & read-after-write](#consistency--read-after-write)); without it, strong checks transparently fall back to live reads.

## Limitations

* **Grants-only.** No deny tuples; model exceptions with narrower relations/objects.
* **Conditions** cover time windows and attribute predicates — not a full policy language.
* **No consistency tokens (yet).** `consistency: "strong"` pins one operation to a point-in-time snapshot, and `contextualTuples` give read-your-writes — but there are no Zanzibar "zookies"/new-enemy protection *across* operations. That layer is deferred until `polizy` grows caching/replicas that make it meaningful; today reads reflect committed tuples.

## Migrating from 0.2.x → 0.3.0

0.3.0 fixes correctness bugs (especially in the Prisma adapter) and adds APIs. Breaking changes:

* **Prisma import moved.** The adapter is now exported **only** from `polizy/prisma-storage` (it was also on the main `polizy` entry in 0.2.x). Use `import { PrismaStorageAdapter } from "polizy/prisma-storage"` — still a factory (no `new`). Add the `@@unique` constraint shown above; without it, idempotent upserts can't work.
* **`throwOnMaxDepth` → `maxDepthBehavior`.** Replace the `throwOnMaxDepth` boolean with `maxDepthBehavior: "throw" | "deny"` (default `"throw"` — `check` throws `MaxDepthExceededError` past `defaultCheckDepth`, which also rose from 10 to 20). Use `"deny"` for the old silent-`false` behavior.
* **Field ids are opt-in.** Declare `fieldLevelObjects` for types that use `#`; previously *any* id containing `#` inherited from its prefix (a privilege-bleed risk). This is now off by default.
* **`defineSchema` throws** on dangling relation/action references (was a `console.warn`).
* **Multiple group/hierarchy relations** require `as` on `addMember`/`setParent`/`removeMember`/`removeParent` (inferred when there's exactly one).
* **No `console` output.** Provide a `logger` if you want warnings.
* Time-based conditions now round-trip correctly through the Prisma adapter (previously they threw), and revocation no longer over-deletes.

New: `checkMany`, `checkOrThrow`, `explain`, `listSubjects`, `allowMany`, wildcard `everyone()`, attribute-predicate conditions, paginated `listTuples`/`listAccessibleObjects`.

A bundled, version-aware upgrade router and per-step migration guides ship with the package under `skills/polizy/migrations/` (see `migrate-0.2-to-0.3.md`).

## Examples

See `packages/polizy/src/scenarios/*.test.ts` for runnable scenarios covering RBAC, ABAC, nested groups, hierarchy propagation, field-level permissions, and reorganizations.

## License

MIT
