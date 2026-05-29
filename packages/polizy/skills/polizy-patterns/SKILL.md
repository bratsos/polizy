---
name: polizy-patterns
description: Implementation patterns for polizy authorization. Use when implementing team access, folder inheritance, field-level permissions, temporary access, revocation, or any specific authorization scenario.
license: MIT
metadata:
  author: bratsos
  version: "0.2.0"
  repository: https://github.com/bratsos/polizy
---

# Polizy Implementation Patterns

Copy-paste patterns for common authorization scenarios.

## When to Apply

- User says "how do I implement X"
- User says "give team access to project"
- User says "make files inherit folder permissions"
- User says "grant temporary access"
- User says "revoke all permissions"
- User wants to implement a specific authorization scenario

## Pattern Selection Guide

| Scenario | Pattern | Reference |
|----------|---------|-----------|
| Specific user → specific resource | Direct Permissions | [DIRECT-PERMISSIONS.md](references/DIRECT-PERMISSIONS.md) |
| Team/group access | Group Access | [GROUP-ACCESS.md](references/GROUP-ACCESS.md) |
| Folder/file inheritance | Hierarchy | [HIERARCHY.md](references/HIERARCHY.md) |
| Sensitive fields (salary, PII) | Field-Level | [FIELD-LEVEL.md](references/FIELD-LEVEL.md) |
| Contractor/expiring access | Time-Limited | [TIME-LIMITED.md](references/TIME-LIMITED.md) |
| Removing access | Revocation | [REVOCATION.md](references/REVOCATION.md) |
| Tenant isolation | Multi-Tenant | [MULTI-TENANT.md](references/MULTI-TENANT.md) |
| Public / "anyone with the link" | Wildcard | [Pattern 9](#pattern-9-public--wildcard-access) |
| Conditional / context-based (ABAC) | Attribute conditions | [Pattern 10](#pattern-10-attribute-conditions-abac) |
| Filtering a fetched list | Batch checks | [Pattern 11](#pattern-11-batch-checks-for-list-endpoints) |
| Share dialog / access audit | Reverse expansion | [Pattern 12](#pattern-12-who-can-access-this-listsubjects) |
| Debugging "why allowed/denied" | Explain | [Pattern 13](#pattern-13-debugging-with-explain) |

> **0.2.0 quick notes used throughout these patterns**
>
> - `allow()`, `addMember()`, and `setParent()` are **idempotent** on
>   `(subject, relation, object)`. Re-granting the same triple updates the
>   condition rather than adding a row — so you can't keep a standing grant and a
>   temporary grant that differ *only* by condition on the same triple. Use
>   **distinct relations** (e.g. `viewer` standing vs `temp_viewer` time-boxed).
> - Field-level ids are **opt-in**: declare `fieldLevelObjects: ["document", ...]`.
> - `addMember`/`setParent`/`removeMember`/`removeParent` take an optional
>   `as: "<relation>"`, **required** only when the schema declares more than one
>   group/hierarchy relation.

---

## Pattern 1: Direct Permissions

Grant specific user access to specific resource.

```typescript
// Grant permission
await authz.allow({
  who: { type: "user", id: "alice" },
  toBe: "owner",
  onWhat: { type: "document", id: "doc1" }
});

// Check permission
const canEdit = await authz.check({
  who: { type: "user", id: "alice" },
  canThey: "edit",
  onWhat: { type: "document", id: "doc1" }
});
```

---

## Pattern 2: Team-Based Access

Grant access through group membership.

```typescript
// 1. Add users to team
await authz.addMember({
  member: { type: "user", id: "alice" },
  group: { type: "team", id: "engineering" }
});

await authz.addMember({
  member: { type: "user", id: "bob" },
  group: { type: "team", id: "engineering" }
});

// 2. Grant team access to resource
await authz.allow({
  who: { type: "team", id: "engineering" },
  toBe: "editor",
  onWhat: { type: "project", id: "project1" }
});

// 3. Team members can now access
const canAliceEdit = await authz.check({
  who: { type: "user", id: "alice" },
  canThey: "edit",
  onWhat: { type: "project", id: "project1" }
}); // true
```

**Schema requirement:**
```typescript
relations: {
  member: { type: "group" },  // Required!
  editor: { type: "direct" },
}
```

> With exactly one group relation, `addMember`/`removeMember` infer it. If you
> declare more than one (e.g. `member` and `orgMember`), pass
> `as: "member"` on every member write/remove or it throws a `SchemaError`.

---

## Pattern 3: Folder/File Hierarchy

Inherit permissions from parent resources.

```typescript
// 1. Set up hierarchy
await authz.setParent({
  child: { type: "document", id: "doc1" },
  parent: { type: "folder", id: "folder1" }
});

// 2. Grant access at folder level
await authz.allow({
  who: { type: "user", id: "alice" },
  toBe: "viewer",
  onWhat: { type: "folder", id: "folder1" }
});

// 3. Document inherits folder permission
const canView = await authz.check({
  who: { type: "user", id: "alice" },
  canThey: "view",
  onWhat: { type: "document", id: "doc1" }
}); // true
```

**Schema requirement:**
```typescript
relations: {
  parent: { type: "hierarchy" },  // Required!
  viewer: { type: "direct" },
},
hierarchyPropagation: {
  view: ["view"],  // CRITICAL: Without this, no inheritance!
}
```

> With exactly one hierarchy relation, `setParent`/`removeParent` infer it. With
> more than one, pass `as: "parent"` (or the relevant relation name).

---

## Pattern 4: Field-Level Permissions

Grant access to specific fields within a record. **Field-level ids are opt-in in
0.2.0** — list the object types that use them in `fieldLevelObjects`:

```typescript
const schema = defineSchema({
  relations: { viewer: { type: "direct" } },
  actionToRelations: { view: ["viewer"] },
  fieldLevelObjects: ["profile"], // ← required to enable "profile:emp123#salary"
});
```

A grant on the **base** object (`emp123`) authorizes *all* of its fields
(`emp123#salary`, `emp123#ssn`, …). A grant on a specific field
(`emp123#salary`) stays scoped to that field. So the field-level pattern grants
narrow access *on top of* (not instead of) base access — give the base grant to
nobody, or only to roles that should see everything.

```typescript
// HR sees the whole profile (base grant → authorizes every field too)
await authz.allow({
  who: { type: "user", id: "hr_manager" },
  toBe: "viewer",
  onWhat: { type: "profile", id: "emp123" }
});

// Payroll sees ONLY the salary field (scoped field grant, no base grant)
await authz.allow({
  who: { type: "user", id: "payroll" },
  toBe: "viewer",
  onWhat: { type: "profile", id: "emp123#salary" }
});

// HR can read salary via its base grant
await authz.check({
  who: { type: "user", id: "hr_manager" },
  canThey: "view",
  onWhat: { type: "profile", id: "emp123#salary" }
}); // true (base → field)

// Payroll can read salary, but not the rest of the record
await authz.check({
  who: { type: "user", id: "payroll" },
  canThey: "view",
  onWhat: { type: "profile", id: "emp123#salary" }
}); // true

await authz.check({
  who: { type: "user", id: "payroll" },
  canThey: "view",
  onWhat: { type: "profile", id: "emp123" }
}); // false (no base grant)
```

> Base access flows to fields through **direct, group, and hierarchy** paths — a
> folder viewer reaches `doc#field` of documents in that folder. To keep a field
> private, don't grant the base object to that subject.

---

## Pattern 5: Temporary Access

Grant time-limited permissions with a `when` condition.

```typescript
// Access valid for 30 days
await authz.allow({
  who: { type: "user", id: "contractor" },
  toBe: "editor",
  onWhat: { type: "project", id: "project1" },
  when: {
    validSince: new Date(),
    validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
  }
});

// Scheduled future access
await authz.allow({
  who: { type: "user", id: "new_hire" },
  toBe: "viewer",
  onWhat: { type: "onboarding", id: "docs" },
  when: {
    validSince: new Date("2026-02-01")  // Starts Feb 1
  }
});
```

> **0.2.0 gotcha:** `allow()` is idempotent on `(subject, relation, object)`. You
> can NOT have a standing grant and a temporary grant on the **same triple** —
> the second call overwrites the first's condition. Model "standing + temporary"
> with **distinct relations**:
>
> ```typescript
> // Standing viewer (permanent)
> await authz.allow({ who: alice, toBe: "viewer", onWhat: project });
> // Temporary elevated editor — different relation, so both coexist
> await authz.allow({ who: alice, toBe: "temp_editor", onWhat: project,
>   when: { validUntil: new Date(Date.now() + 86_400_000) } });
> ```
>
> Map `temp_editor` in `actionToRelations` (e.g. `edit: ["editor", "temp_editor"]`).
> See [TIME-LIMITED.md](references/TIME-LIMITED.md).

---

## Pattern 6: Revocation

Remove permissions. In 0.2.0 these deletes are **precise** — a single-tuple
`disallowAllMatching({ who, was, onWhat })`, `removeMember`, and `removeParent`
no longer over-delete unrelated tuples on either adapter.

```typescript
// Remove specific permission
await authz.disallowAllMatching({
  who: { type: "user", id: "bob" },
  was: "editor",
  onWhat: { type: "document", id: "doc1" }
});

// Remove all user permissions on a resource
await authz.disallowAllMatching({
  who: { type: "user", id: "bob" },
  onWhat: { type: "document", id: "doc1" }
});

// Remove all permissions on a resource (when deleting it)
await authz.disallowAllMatching({
  onWhat: { type: "document", id: "doc1" }
});

// Remove user from group
await authz.removeMember({
  member: { type: "user", id: "alice" },
  group: { type: "team", id: "engineering" }
});

// If the schema declares MORE THAN ONE group/hierarchy relation, pass `as`:
await authz.removeMember({
  member: { type: "user", id: "alice" },
  group: { type: "org", id: "acme" },
  as: "orgMember"  // required when >1 group relation exists
});
```

---

## Pattern 7: Listing Accessible Objects

Find what a user can access.

```typescript
// List all documents alice can access
const result = await authz.listAccessibleObjects({
  who: { type: "user", id: "alice" },
  ofType: "document"
});

// Result:
// {
//   accessible: [
//     { object: { type: "document", id: "doc1" }, actions: ["edit", "view", "delete"] },
//     { object: { type: "document", id: "doc2" }, actions: ["view"] },
//   ]
// }

// Filter by action
const editableOnly = await authz.listAccessibleObjects({
  who: { type: "user", id: "alice" },
  ofType: "document",
  canThey: "edit"  // Only return editable documents
});
```

---

## Pattern 8: Combining Patterns

Real apps often combine multiple patterns:

```typescript
// Organizational structure (groups)
await authz.addMember({ member: alice, group: frontend });
await authz.addMember({ member: frontend, group: engineering });

// Resource hierarchy
await authz.setParent({ child: codeFile, parent: srcFolder });
await authz.setParent({ child: srcFolder, parent: projectRoot });

// Team access at project level
await authz.allow({ who: engineering, toBe: "editor", onWhat: projectRoot });

// Alice can now edit codeFile through:
// alice → member → frontend → member → engineering → editor → projectRoot ← parent ← srcFolder ← parent ← codeFile

await authz.check({ who: alice, canThey: "edit", onWhat: codeFile }); // true
```

---

## Pattern 9: Public / Wildcard Access

Grant an action to *every* subject of a type ("anyone with the link", public
docs). Import `everyone` and use it as the `who`.

```typescript
import { everyone } from "polizy";

// Any user can view this document
await authz.allow({
  who: everyone("user"),
  toBe: "viewer",
  onWhat: { type: "document", id: "public-readme" }
});

// A specific, un-granted user passes the check via the wildcard
await authz.check({
  who: { type: "user", id: "random-visitor" },
  canThey: "view",
  onWhat: { type: "document", id: "public-readme" }
}); // true
```

`everyone("user")` is sugar for the reserved subject `{ type: "user", id: "*" }`.
Wildcard grants honor conditions, so you can scope them by time or attributes
(e.g. public during a launch window). Revoke with
`disallowAllMatching({ who: everyone("user"), was: "viewer", onWhat })`.

---

## Pattern 10: Attribute Conditions (ABAC)

Gate a grant on request-time context. Predicates in `when.attributes` are
checked against the `context` you pass to `check()` (fail-closed: missing value
or type mismatch denies).

```typescript
// Only viewable by users whose context says department === "eng"
await authz.allow({
  who: { type: "user", id: "alice" },
  toBe: "viewer",
  onWhat: { type: "document", id: "eng-doc" },
  when: { attributes: [{ attribute: "department", operator: "eq", value: "eng" }] }
});

await authz.check({
  who: { type: "user", id: "alice" },
  canThey: "view",
  onWhat: { type: "document", id: "eng-doc" },
  context: { department: "eng" }
}); // true

await authz.check({
  who: { type: "user", id: "alice" },
  canThey: "view",
  onWhat: { type: "document", id: "eng-doc" },
  context: { department: "sales" }
}); // false
```

Operators: `eq`, `ne`, `in`, `nin`, `gt`, `gte`, `lt`, `lte`. `attribute`
supports dot-paths (`"user.tier"`). Combine with `validSince`/`validUntil` — all
predicates AND the time window must pass.

---

## Pattern 11: Batch Checks for List Endpoints

Avoid N+1 round trips when filtering a fetched list. `checkMany` answers many
questions in one call.

```typescript
const docs = await db.documents.findMany({ take: 50 });

const allowed = await authz.checkMany(
  docs.map((d) => ({
    who: { type: "user", id: userId },
    canThey: "view",
    onWhat: { type: "document", id: d.id }
  }))
);

const visible = docs.filter((_, i) => allowed[i]);
```

`checkOrThrow` is the throwing counterpart of `check` for single guards:

```typescript
await authz.checkOrThrow({ who: user, canThey: "edit", onWhat: doc });
// throws NotAuthorizedError instead of returning false
```

For "what can this user reach" (rather than checking a known list), prefer
`listAccessibleObjects` (Pattern 7).

---

## Pattern 12: Who Can Access This? (listSubjects)

Reverse expansion for share dialogs and audits — list the subjects that can
perform an action on an object, including those reachable via groups and
hierarchy.

```typescript
// Everyone who can view doc1 (direct, via team, via folder, via wildcard)
const subjects = await authz.listSubjects({
  canThey: "view",
  onWhat: { type: "document", id: "doc1" }
});
// [{ type: "user", id: "alice" }, { type: "user", id: "bob" }, ...]

// Narrow to a subject type
const users = await authz.listSubjects({
  canThey: "view",
  onWhat: { type: "document", id: "doc1" },
  ofType: "user"
});
```

Pass `context` if any relevant grants use attribute conditions.

---

## Pattern 13: Debugging with explain

`explain` returns `{ allowed, via }` where `via` is the path that produced the
decision (or `null` when denied) — the fastest way to answer "why?".

```typescript
const result = await authz.explain({
  who: { type: "user", id: "alice" },
  canThey: "edit",
  onWhat: { type: "document", id: "doc1" }
});

// result.allowed === true
// result.via === {
//   kind: "group", relation: "member", through: { type: "team", id: "eng" },
//   via: { kind: "direct", relation: "editor" }
// }
```

`via.kind` is one of `direct`, `wildcard`, `field`, `group`, or `hierarchy`;
nested `via` shows the full chain. See
[polizy-troubleshooting](../polizy-troubleshooting/SKILL.md) for using `explain`
to diagnose failing checks.

---

## Common Mistakes

| Mistake | Symptom | Fix |
|---------|---------|-----|
| Missing `member: { type: "group" }` | `addMember()` throws | Add group relation to schema |
| Missing `parent: { type: "hierarchy" }` | `setParent()` throws | Add hierarchy relation to schema |
| Missing `hierarchyPropagation` | Parent permissions don't flow | Add propagation config |
| Relation not in `actionToRelations` | `check()` returns false | Add relation to action's array |
| Checking wrong action | `check()` returns false | Verify action name matches schema |
| Field id used but type not in `fieldLevelObjects` | Field check returns false (id treated literally) | Add the type to `fieldLevelObjects` |
| Standing + temporary grant on same triple | Second `allow()` overwrites the first's condition | Use distinct relations (`viewer` vs `temp_viewer`) |
| Omitting `as` with >1 group/hierarchy relation | `SchemaError` on member/parent write | Pass `as: "<relation>"` |
| Empty base/field in field id (e.g. `#salary`) | `SchemaError` on write | Use non-empty base AND field |

---

## References

Each pattern has detailed documentation:

- [DIRECT-PERMISSIONS.md](references/DIRECT-PERMISSIONS.md) - Simple user-resource access
- [GROUP-ACCESS.md](references/GROUP-ACCESS.md) - Teams, departments, nested groups
- [HIERARCHY.md](references/HIERARCHY.md) - Folders, projects, inheritance
- [FIELD-LEVEL.md](references/FIELD-LEVEL.md) - PII, sensitive data protection
- [TIME-LIMITED.md](references/TIME-LIMITED.md) - Contractors, expiring access
- [REVOCATION.md](references/REVOCATION.md) - Removing access patterns
- [MULTI-TENANT.md](references/MULTI-TENANT.md) - Tenant isolation strategies

## Related Skills

- [polizy-schema](../polizy-schema/SKILL.md) - Schema design
- [polizy-troubleshooting](../polizy-troubleshooting/SKILL.md) - When things go wrong
