---
name: polizy
description: Router for the polizy authorization library. Use when the user mentions authorization, permissions, access control, RBAC, ReBAC, Zanzibar, or asks "who can do what" questions. Routes to specialized skills. For upgrading polizy between versions, route through `migrations/README.md`.
license: MIT
metadata:
  author: bratsos
  version: "0.6.0"
  repository: https://github.com/bratsos/polizy
---

# Polizy Authorization

Polizy is a Zanzibar-inspired, embeddable ReBAC authorization library for
TypeScript/Node.js. Permissions are stored as relationship tuples
`(subject, relation, object[, condition])` and resolved through direct grants,
group membership (nested), hierarchy propagation, and wildcards.

## When to Apply

Activate this skill when:
- User mentions "polizy", "authorization", "permissions", "access control"
- User asks "who can do what", "can user X do Y"
- User wants RBAC, ReBAC, or Zanzibar-style authorization
- User needs to check, grant, or revoke permissions
- User is implementing team/group-based access
- User is implementing folder/file permission inheritance
- User wants **end users to define their own roles at runtime** or a
  **permissions matrix** (click-to-toggle roles × permissions)
- User wants to **upgrade polizy** to a newer version

## Upgrading between versions

When the user wants to upgrade `polizy` in their project (e.g. "upgrade my
project to the latest polizy version", "I just bumped polizy, walk me through the
migration", "get me from 0.1 to the newest version"), route to
[`migrations/README.md`](./migrations/README.md) — the upgrade router. It detects
the installed and previous versions, finds the relevant migration guides, and
applies them **in order, step by step** (e.g. `0.2→0.3→0.4→…`) up to the newest
version available. Each published release bundles the full `migrations/` history,
so multi-version jumps work.

## Quick Concepts

| Concept | Description |
|---------|-------------|
| **Tuple** | `(subject, relation, object)` — stored permission fact |
| **Subject** | Who: `{ type: "user", id: "alice" }` (a group can also be a subject) |
| **Object** | What: `{ type: "document", id: "doc1" }` |
| **Relation** | Role typed `direct` \| `group` \| `hierarchy` (`owner`, `member`, `parent`, …) |
| **Action** | Intent: `view`, `edit`, `delete` — mapped to relations |
| **Condition** | Optional time window (`validSince`/`validUntil`) and/or attribute predicates (ABAC) |

## Capabilities (0.6.x)

- **Checks & queries:** `check`, `checkMany` (batch), `checkOrThrow`, `explain`
  (why allowed/denied; now accepts an optional 2nd arg and never throws `MaxDepthExceededError`),
  `listAccessibleObjects` (paginated), `listSubjects` (paginated via `limit`/`offset` after deterministic sort),
  `someoneCan` (existence; short-circuits), `countSubjects` / `countAccessibleObjects` (always unpaginated),
  `listTuples` (paginated). All public and `ReadScope` queries accept uniform `ReadOptions`
  (`consistency`, `preload`, and `contextualTuples`). Note that `checkMany` shares contextual tuples batch-wide (per-request not supported),
  and `withReadScope` operations accept no per-operation read options.
- **Contract Test Suite:** Validate custom adapters using the published `polizy/storage-tests` suite.
- **Writes (idempotent):** `allow`, `allowMany`, `disallowAllMatching`,
  `addMember`/`removeMember`, `setParent`/`removeParent`. Use `as` to pick a
  relation when the schema declares more than one group/hierarchy relation.
- **Runtime custom roles:** `withRoleScaffold(schema, …)` merges a generic role
  scaffold into a schema (type-preserving) and `RoleRegistry` gives typed sugar —
  `defineRole`, `grantToRole`/`revokeFromRole`, `assignRole`/`unassignRole`,
  `deleteRole`, `listRoles`, `permissionMatrix` (one read backing a
  click-to-toggle roles × permissions UI). Roles are **pure tuples**: a custom
  role built from existing actions needs no schema change. An optional
  `RoleCatalogStore` (InMemory or Prisma) tracks role existence + labels only —
  the engine never reads it.
- **Conditions:** time-boxed grants + attribute predicates (`eq ne in nin gt gte
  lt lte`, dot-paths) evaluated against a per-check `context`.
- **Wildcards:** `everyone("user")` grants to every subject of a type — and
  (0.5.0) wildcard membership now **propagates through group recursion**, so
  `assignRole(everyone("user"), role)` grants every subject of that type.
- **Field-level ids:** opt-in per object type via `fieldLevelObjects`.
- **Config:** `defaultCheckDepth`, `maxDepthBehavior` (`"throw"` | `"deny"`),
  `logger`, `fieldSeparator`, and (0.5.0) `defaultGroupRelation` /
  `defaultHierarchyRelation` (which relation `addMember`/`setParent` use when the
  schema has more than one) plus `nonSubjectTypes` (object types kept out of
  `listSubjects` unless requested via `ofType`).

## Route to Specialized Skill

| Task | Skill |
|---|---|
| Install / first-time setup | `polizy-setup` |
| Define or change the model (relations, actions, fields, hierarchy) | `polizy-schema` |
| Implement a scenario (team access, inheritance, temp access, revocation, fields) | `polizy-patterns` |
| End-user / runtime custom roles, permissions matrix (`RoleRegistry`) | `polizy-patterns` (schema setup via `withRoleScaffold` in `polizy-schema`) |
| Storage adapters (InMemory, Prisma, custom), `polizy/storage-tests`, performance, production | `polizy-storage` |
| Debug unexpected allow/deny, errors | `polizy-troubleshooting` |
| **Upgrade polizy between versions** | [`migrations/README.md`](./migrations/README.md) |

## Minimal Example

```typescript
import { defineSchema, AuthSystem, InMemoryStorageAdapter } from "polizy";

// 1. Define schema
const schema = defineSchema({
  relations: {
    owner: { type: "direct" },
    viewer: { type: "direct" },
  },
  actionToRelations: {
    edit: ["owner"],
    view: ["owner", "viewer"],
  },
});

// 2. Create AuthSystem
const authz = new AuthSystem({
  storage: new InMemoryStorageAdapter(),
  schema,
});

// 3. Grant permission (idempotent)
await authz.allow({
  who: { type: "user", id: "alice" },
  toBe: "owner",
  onWhat: { type: "document", id: "doc1" },
});

// 4. Check permission
const canEdit = await authz.check({
  who: { type: "user", id: "alice" },
  canThey: "edit",
  onWhat: { type: "document", id: "doc1" },
});
// => true
```

## Related Skills

- [polizy-setup](../polizy-setup/SKILL.md) — Installation and configuration
- [polizy-schema](../polizy-schema/SKILL.md) — Schema design
- [polizy-patterns](../polizy-patterns/SKILL.md) — Implementation patterns
- [polizy-storage](../polizy-storage/SKILL.md) — Storage adapters
- [polizy-troubleshooting](../polizy-troubleshooting/SKILL.md) — Debugging
- [migrations/README.md](./migrations/README.md) — Version upgrade router
