---
name: polizy-schema
description: Schema design guide for polizy authorization. Use when defining relations, actions, action mappings, hierarchy propagation, or modifying authorization models. Covers direct, group, and hierarchy relation types.
license: MIT
metadata:
  author: bratsos
  version: "0.3.0"
  repository: https://github.com/bratsos/polizy
---

# Polizy Schema Design

The schema is the heart of polizy. It defines your authorization model: what relationships exist and what actions they enable.

## When to Apply

- User says "design permissions schema" or "define authorization model"
- User asks "what relations do I need for X"
- User says "add new relation" or "add new action"
- User is confused about relation types (direct vs group vs hierarchy)
- User wants to modify their existing schema
- User asks about `defineSchema` or `actionToRelations`

## Priority Table

| Priority | Decision | Impact |
|----------|----------|--------|
| Critical | Choose correct relation types | Wrong type = broken inheritance |
| Critical | Map all actions to defined relations | Dangling reference = `defineSchema` throws `SchemaError` at startup |
| Critical | Declare `fieldLevelObjects` if you use `#` field ids | Omitted = `doc1#field` checks return false (secure default) |
| Important | Configure hierarchyPropagation | Without it, no parent→child inheritance |
| Important | Name multiple group/hierarchy relations clearly | Write APIs need `as` to disambiguate |
| Important | Use semantic names | Clarity for future maintainers |
| Optional | Keep schema minimal | Start simple, expand as needed |

## Schema Structure

```typescript
import { defineSchema } from "polizy";

const schema = defineSchema({
  // 0. Optional: declare the universe of types (powers stronger inference)
  subjectTypes: ["user", "team"],
  objectTypes: ["document", "folder", "team"],

  // 1. Define relationship types
  relations: {
    owner: { type: "direct" },     // Direct permission
    editor: { type: "direct" },
    viewer: { type: "direct" },
    member: { type: "group" },     // Group membership
    parent: { type: "hierarchy" }, // Parent-child resources
  },

  // 2. Map actions to relations that grant them
  actionToRelations: {
    delete: ["owner"],
    edit: ["owner", "editor"],
    view: ["owner", "editor", "viewer"],
  },

  // 3. Optional: Define hierarchy propagation
  hierarchyPropagation: {
    view: ["view"],   // view on parent → view on child
    edit: ["edit"],   // edit on parent → edit on child
  },

  // 4. Optional: opt in to field-level ids ("document:doc1#summary").
  //    ONLY listed types split on the separator — secure by default.
  fieldLevelObjects: ["document"],
  // fieldSeparator defaults to "#"
});
```

> **0.3.0 — `defineSchema` throws.** If an action maps to an undefined relation,
> or `hierarchyPropagation` references an undefined action, `defineSchema` throws
> a `SchemaError` at definition time (it no longer `console.warn`s and continues).
> This catches dangling references the moment your app boots.

## Relation Types Quick Reference

| Type | Purpose | Example | Use When |
|------|---------|---------|----------|
| `direct` | User → Resource | alice is owner of doc1 | Specific user needs specific resource access |
| `group` | User → Group membership | alice is member of engineering | Team-based access, organizational structure |
| `hierarchy` | Resource → Parent resource | doc1's parent is folder1 | Folder/file, project/task, inherited permissions |

See [RELATION-TYPES.md](references/RELATION-TYPES.md) for detailed explanations.

## Common Schema Patterns

### Basic Document Access
```typescript
const schema = defineSchema({
  relations: {
    owner: { type: "direct" },
    editor: { type: "direct" },
    viewer: { type: "direct" },
  },
  actionToRelations: {
    delete: ["owner"],
    edit: ["owner", "editor"],
    view: ["owner", "editor", "viewer"],
  },
});
```

### Team-Based Access
```typescript
const schema = defineSchema({
  relations: {
    owner: { type: "direct" },
    editor: { type: "direct" },
    viewer: { type: "direct" },
    member: { type: "group" },  // Required for addMember()
  },
  actionToRelations: {
    manage: ["owner"],
    edit: ["owner", "editor"],
    view: ["owner", "editor", "viewer"],
  },
});
```

### Hierarchical Resources (Folders/Files)
```typescript
const schema = defineSchema({
  relations: {
    owner: { type: "direct" },
    editor: { type: "direct" },
    viewer: { type: "direct" },
    parent: { type: "hierarchy" },  // Required for setParent()
  },
  actionToRelations: {
    delete: ["owner"],
    edit: ["owner", "editor"],
    view: ["owner", "editor", "viewer"],
  },
  hierarchyPropagation: {
    view: ["view"],  // CRITICAL: Without this, no inheritance
    edit: ["edit"],
  },
});
```

### Full-Featured Schema
```typescript
const schema = defineSchema({
  relations: {
    // Direct permissions
    owner: { type: "direct" },
    editor: { type: "direct" },
    viewer: { type: "direct" },
    commenter: { type: "direct" },

    // Group membership
    member: { type: "group" },

    // Hierarchy
    parent: { type: "hierarchy" },
  },
  actionToRelations: {
    // Destructive
    delete: ["owner"],
    transfer: ["owner"],

    // Modification
    edit: ["owner", "editor"],
    comment: ["owner", "editor", "commenter"],

    // Read
    view: ["owner", "editor", "viewer", "commenter"],
  },
  hierarchyPropagation: {
    view: ["view"],
    edit: ["edit"],
    comment: ["comment"],
  },
});
```

## Decision Guide: Which Relation Type?

```
Need to grant access to a specific user on a specific resource?
  → Use "direct" relation (owner, editor, viewer)

Need users to inherit access from a team/department?
  → Use "group" relation (member)
  → Add users to groups with addMember()
  → Grant group access with allow()

Need child resources to inherit parent permissions?
  → Use "hierarchy" relation (parent)
  → Set parent with setParent()
  → Configure hierarchyPropagation
```

## Multiple Group / Hierarchy Relations (0.3.0)

A schema can now declare **more than one** `group` relation and/or **more than
one** `hierarchy` relation. `check()` traverses all of them. This lets you model
distinct membership/containment axes — e.g. team membership *and* org
membership, or a document's folder parent *and* its owning org.

```typescript
const schema = defineSchema({
  relations: {
    owner: { type: "direct" },
    viewer: { type: "direct" },

    // Two group axes
    member: { type: "group" },       // user → team
    orgMember: { type: "group" },    // user → organization

    // Two hierarchy axes
    folderParent: { type: "hierarchy" },  // document → folder
    orgParent: { type: "hierarchy" },     // folder/document → org
  },
  actionToRelations: {
    view: ["owner", "viewer", "member", "orgMember"],
    edit: ["owner"],
  },
  hierarchyPropagation: {
    view: ["view"],
  },
});
```

**Disambiguating writes with `as`.** When the schema has more than one relation
of a kind, the write APIs can't guess which to use, so you pass `as`. With
exactly one (the common case) `as` is inferred. Omitting it when it's ambiguous
throws a `SchemaError`.

```typescript
// Ambiguous → must specify which group/hierarchy relation
await authz.addMember({ member: user, group: team, as: "member" });
await authz.addMember({ member: user, group: org,  as: "orgMember" });
await authz.setParent({ child: doc, parent: folder, as: "folderParent" });
await authz.setParent({ child: folder, parent: org, as: "orgParent" });

// removeMember / removeParent take `as` too
await authz.removeMember({ member: user, group: team, as: "member" });
```

`as` is type-checked against your declared relation names — passing a relation
that isn't of the right kind (or doesn't exist) is a compile-time error and, at
runtime, a `SchemaError`.

## Field-Level Objects (0.3.0)

Field-level identifiers let an object id carry a field after the separator
(default `#`): `document:doc1#summary`. A grant on the **base** object (`doc1`)
authorizes its fields (`doc1#summary`) — via direct, group, **and** hierarchy
paths — while a grant on a specific field stays scoped to that field.

In 0.3.0 this is **opt-in**: only types listed in `fieldLevelObjects` split on
the separator. Types not listed never split, so ids that naturally contain `#`
can't accidentally leak access (the secure default).

```typescript
const schema = defineSchema({
  objectTypes: ["document", "folder"],
  relations: {
    owner: { type: "direct" },
    viewer: { type: "direct" },
    parent: { type: "hierarchy" },
  },
  actionToRelations: {
    view: ["owner", "viewer"],
    edit: ["owner"],
  },
  hierarchyPropagation: { view: ["view"] },

  fieldLevelObjects: ["document"], // only "document" ids may carry "#field"
  fieldSeparator: "#",             // default; override if "#" is meaningful in your ids
});
```

- Omit `fieldLevelObjects` to disable field ids entirely.
- Field ids are validated on write — an empty base or empty field throws.
- See [polizy-patterns](../polizy-patterns/SKILL.md) for field-level recipes.

## Conditions: Time Windows + Attribute Predicates (ABAC)

Conditions are attached to tuples **at grant time** (not in the schema), but
schema authors should know the shape because conditions decide whether a
matching tuple actually grants access. A tuple grants access only while its
condition is valid: within the optional time window **AND** with every attribute
predicate satisfied by the per-check `context`. Evaluation is **fail-closed** (a
missing context value or type mismatch fails the predicate).

```typescript
type Condition = {
  validSince?: Date;          // time window (inclusive lower bound)
  validUntil?: Date;          // time window (inclusive upper bound)
  attributes?: AttributePredicate[]; // ALL must pass (logical AND)
};

type AttributePredicate = {
  attribute: string;          // dot-path into the check context, e.g. "user.tier"
  operator: "eq" | "ne" | "in" | "nin" | "gt" | "gte" | "lt" | "lte";
  value: JsonScalar | JsonScalar[]; // string | number | boolean | null (or array)
};
```

```typescript
// Time-boxed grant
await authz.allow({
  who: user, toBe: "viewer", onWhat: doc,
  when: { validUntil: new Date(Date.now() + 3_600_000) },
});

// Attribute-gated grant (evaluated against the check-time context)
await authz.allow({
  who: user, toBe: "viewer", onWhat: doc,
  when: { attributes: [{ attribute: "department", operator: "eq", value: "engineering" }] },
});
await authz.check({ who: user, canThey: "view", onWhat: doc,
  context: { department: "engineering" } }); // true
```

**Schema-design implication:** `allow()` is idempotent on
`(subject, relation, object)`, so a re-grant updates the condition instead of
creating a second tuple. A temporary and a standing grant that differ **only** by
condition therefore can't coexist on the same triple — model "temporary +
standing" as **distinct relations** (e.g. `viewer` standing, `temp_viewer`
time-boxed). See [polizy-patterns](../polizy-patterns/SKILL.md) for the recipe.

## Common Mistakes

| Mistake | Symptom | Fix |
|---------|---------|-----|
| Action references undefined relation | `defineSchema` throws `SchemaError` at startup | Define the relation, or remove it from the action's array |
| `hierarchyPropagation` references undefined action | `defineSchema` throws `SchemaError` at startup | Use only actions that exist in `actionToRelations` |
| Action not listed in actionToRelations | `check()` returns false (unknown action denies) | Add the action and map it to relations |
| No `member: { type: "group" }` | `addMember()` throws `SchemaError` | Add a group relation to schema |
| No `parent: { type: "hierarchy" }` | `setParent()` throws `SchemaError` | Add a hierarchy relation to schema |
| >1 group/hierarchy relation, no `as` | `addMember()`/`setParent()` throws `SchemaError` | Pass `as: "..."` to disambiguate |
| Using `#` ids without `fieldLevelObjects` | `doc1#field` checks return false | Add the type to `fieldLevelObjects` |
| Missing hierarchyPropagation | Parent permissions don't flow to children | Add hierarchyPropagation config |
| Using generic names ("access") | Can't distinguish read/write | Use semantic names (viewer, editor) |

## Schema Evolution

When adding to an existing schema:

```typescript
// v1: Basic
const schemaV1 = defineSchema({
  relations: {
    owner: { type: "direct" },
    viewer: { type: "direct" },
  },
  actionToRelations: {
    edit: ["owner"],
    view: ["owner", "viewer"],
  },
});

// v2: Add editor role
const schemaV2 = defineSchema({
  relations: {
    owner: { type: "direct" },
    editor: { type: "direct" },  // NEW
    viewer: { type: "direct" },
  },
  actionToRelations: {
    edit: ["owner", "editor"],  // UPDATED
    view: ["owner", "editor", "viewer"],  // UPDATED
  },
});

// v3: Add groups
const schemaV3 = defineSchema({
  relations: {
    owner: { type: "direct" },
    editor: { type: "direct" },
    viewer: { type: "direct" },
    member: { type: "group" },  // NEW
  },
  actionToRelations: {
    edit: ["owner", "editor"],
    view: ["owner", "editor", "viewer"],
  },
});
```

**Important:** Existing tuples remain valid when you add new relations/actions. No migration needed.

## Related Skills

- [polizy-patterns](../polizy-patterns/SKILL.md) - Scenario recipes: team access, folder inheritance, field-level permissions, temporary/ABAC grants, revocation
- [polizy-troubleshooting](../polizy-troubleshooting/SKILL.md) - Schema debugging
- [polizy](../polizy/migrations/migrate-0.1-to-0.2.md) - 0.1 → 0.2 migration guide

## References

- [RELATION-TYPES.md](references/RELATION-TYPES.md) - Deep dive into each relation type
- [SCHEMA-EXAMPLES.md](references/SCHEMA-EXAMPLES.md) - 10+ domain-specific schema examples
- [TYPE-SAFETY.md](references/TYPE-SAFETY.md) - TypeScript generics and type inference
