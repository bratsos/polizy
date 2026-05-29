# The Check Algorithm

Understanding how `authz.check()` evaluates permissions in polizy 0.3.0. This
mirrors `resolveAccess` in the engine, so debugging matches the real behavior.

## Overview

When you call:

```typescript
await authz.check({
  who: { type: "user", id: "alice" },
  canThey: "edit",
  onWhat: { type: "document", id: "doc1" },
  context: { department: "engineering" }, // optional, for ABAC conditions
});
```

polizy resolves a single recursive question — "does `who` hold a relation that
satisfies `canThey` on `onWhat` (or anything `onWhat` inherits from)?" — across
three kinds of edges, with cycle-aware memoization:

1. **Resolve the action to its required relations.**
2. **Direct grants** (including wildcard `*` subjects) on the target — and, for
   field-enabled types, on the base object too.
3. **Group memberships** — recurse through **every** group relation.
4. **Hierarchy propagation** — recurse through **every** hierarchy relation, per
   the action's `hierarchyPropagation` mapping.

Every tuple's `condition` is evaluated against `context`. The first valid path
wins (`true`); if no path is found, the result is `false`.

The model is **grants-only**: there are no deny tuples. A `false` means "no
granting path was found," never "an explicit deny matched."

## Step 1: Resolve Action to Relations

```typescript
// From schema
actionToRelations: {
  edit: ["owner", "editor"],
}
// For "edit", the required relations are ["owner", "editor"].
```

**If the action isn't in `actionToRelations` (or maps to an empty array):**
returns `false` immediately (a stable, memoizable `false`).

## Step 2: Build the Target Set

Before searching, the engine computes the **targets** to look at:

- `onWhat` itself, always.
- **Plus its base object** — *only if `onWhat.type` is listed in the schema's
  `fieldLevelObjects`* and the id contains the field separator (default `#`)
  with a non-empty base.

```typescript
// schema.fieldLevelObjects = ["document"], separator "#"
onWhat = { type: "document", id: "doc1#salary" }
// targets = [ {type:"document", id:"doc1#salary"}, {type:"document", id:"doc1"} ]

// Type NOT in fieldLevelObjects:
onWhat = { type: "note", id: "n1#x" }
// targets = [ {type:"note", id:"n1#x"} ]   ← no split, no base fallback
```

> **0.3.0 change:** field ids are **opt-in**. In 0.2.x and earlier *any* id containing `#`
> inherited from its prefix. If a `doc1#field` check now denies where it used to
> allow, the type is missing from `fieldLevelObjects`. See COMMON-ISSUES Issue 6.

## Step 3: Direct Grants (and Wildcards)

For each `target` and each required `relation`, look for a tuple
`(who, relation, target)`:

```sql
-- Pseudo-query, run per target × relation
SELECT * FROM tuples
WHERE subject_type = 'user' AND subject_id = 'alice'
  AND relation = 'owner'        -- then 'editor'
  AND object_type = 'document'
  AND object_id = 'doc1#salary' -- then 'doc1' (base)
```

Each match's `condition` is evaluated against `context`. The **first valid match
returns `true`.**

Then — unless `who` is itself the public subject — the engine also looks for a
**wildcard** grant `({ type: who.type, id: "*" }, relation, target)`:

```typescript
import { everyone } from "polizy";
await authz.allow({ who: everyone("user"), toBe: "viewer", onWhat: doc });
// Now ANY user passes `view` on doc via the "*" subject grant.
```

A wildcard grant is stored under the subject id `*` (`PUBLIC_ID`). `explain()`
reports it as `{ kind: "wildcard", relation }`.

## Step 4: Group Expansion (all group relations)

If no direct/wildcard grant matched, recurse through group memberships:

```
For each group relation declared in the schema:
  Find every (who, groupRelation, <group>) tuple whose condition is valid
  For each such group:
    recurse: resolveAccess(group, action, onWhat, context, depth+1)
    if it returns true → true
```

Two important details:

- **Every** group relation is traversed (0.3.0 supports multiple, e.g. `member`
  and `orgMember`).
- The recursion passes the **original `onWhat`**, not the group — so the group's
  own field-base and hierarchy resolution apply. A group can reach a document
  through *its own* folder ancestry, not just direct grants.

**Example traversal:**

```
alice --member--> team:frontend --member--> dept:engineering --editor--> proj1

1. alice direct/wildcard on proj1 → none
2. alice's groups → [team:frontend]
3. resolve team:frontend on proj1
     direct/wildcard → none
     frontend's groups → [dept:engineering]
       resolve dept:engineering on proj1
         direct → "editor" matches → true
```

## Step 5: Hierarchy Propagation (all hierarchy relations)

Run only if the schema declares at least one hierarchy relation **and**
`hierarchyPropagation[action]` is non-empty.

```
parentActions = hierarchyPropagation[action]      // e.g. edit: ["edit"]
For each target (onWhat and, if applicable, its base):
  For each hierarchy relation:
    Find every (target, hierRelation, <parent>) tuple with a valid condition
    For each parent:
      For each parentAction in parentActions:
        recurse: resolveAccess(who, parentAction, parent, context, depth+1)
        if true → true
```

Key points:

- **Every** hierarchy relation is traversed (0.3.0 supports multiple).
- The action can **change** as it climbs: `hierarchyPropagation: { comment:
  ["edit"] }` means "if you can `edit` the parent, you can `comment` on the
  child." The recursion asks the *parent action* on the parent.
- An action with an empty array (`delete: []`) never propagates upward.

**Example traversal:**

```
document:doc1 --parent--> folder:f1 ;  alice --viewer--> folder:f1
hierarchyPropagation: { view: ["view"] }

1. alice direct/wildcard on doc1 → none
2. alice's groups on doc1 → none
3. hierarchy: doc1 --parent--> f1
     parentActions for "view" = ["view"]
     resolve alice "view" on f1 → direct "viewer" → true
```

## Combined Example

```
who: alice ; action: edit ; onWhat: document:doc1

Setup:
- alice --member--> team:frontend
- team:frontend --member--> dept:engineering
- dept:engineering --editor--> folder:root
- doc1 --parent--> folder:sub ; folder:sub --parent--> folder:root
- hierarchyPropagation: { edit: ["edit"] }

Evaluation:
1. Direct/wildcard: alice --editor/owner--> doc1? No
2. Groups:
   - frontend on doc1?  direct No ; frontend's groups → engineering
     - engineering on doc1? direct No
3. Hierarchy: doc1 --parent--> folder:sub
   - Can alice edit folder:sub?
     - direct/groups: engineering --editor--> sub? No
     - hierarchy: sub --parent--> folder:root
       - Can alice edit folder:root?
         - groups: engineering --editor--> root? YES → true
       → true  → true  → true

Final result: true
```

## Memoization & Cycle Safety (0.3.0)

This is the biggest internal change from 0.2.x and earlier. A single `check()` carries one
traversal state:

```typescript
type ResolveState = {
  depth: number;
  visited: Set<string>;          // keys currently ON the recursion stack (cycle guard)
  resolved: Map<string, boolean>; // memo of fully-resolved, cycle-independent results
};
```

Each `(subject, relation→action, object)` resolves to a **cache key**.

- **`resolved` (memo).** Once a key is resolved without being influenced by a
  cycle or depth cutoff, its result is cached. Re-encountering it anywhere in the
  same check returns instantly. This makes wide/deep group and folder graphs
  resolve in roughly **linear** time instead of re-traversing shared subgraphs
  (no more exponential blow-up).

- **`visited` (cycle guard).** If a key is already on the current stack,
  re-entering it is a cycle; that branch yields `false` **without** poisoning the
  memo. A `false` produced by cutting a cycle short is marked *unstable* and is
  **never** cached, so a different (valid) path to the same node can still
  succeed. Only a genuinely path-independent `false` gets memoized.

The practical upshot: circular memberships (teamA ⇄ teamB) terminate safely and
correctly, and you never get a wrong `false` cached from a cycle.

## Depth Limiting

```typescript
const authz = new AuthSystem({
  storage,
  schema,
  defaultCheckDepth: 20,        // default 20 (was 10 in 0.2.x and earlier)
  maxDepthBehavior: "throw",    // default "throw" (0.2.x and earlier was a silent false)
});
```

Each group/hierarchy hop increments `depth`. When `depth` exceeds
`defaultCheckDepth`:

- `maxDepthBehavior: "throw"` (default) → throws `MaxDepthExceededError`
  carrying `subject`, `action`, `object`, and `depth`.
- `maxDepthBehavior: "deny"` → logs via `logger.warn` (if a logger was provided)
  and returns an *unstable* `false` (not memoized) — the 0.2.x and earlier behavior.

> A depth cutoff yields an unstable `false` for the same reason a cycle does: it
> reflects the current stack, not a path-independent answer, so it is never
> cached.

## Condition Evaluation (time + ABAC)

When any tuple is found (direct, wildcard, group edge, or hierarchy edge), its
`condition` is checked with `isConditionValid(condition, context)`:

```typescript
// No condition → always valid.

// Time window (both optional): validSince <= now < validUntil
//   lower bound inclusive, upper bound exclusive
//   unparseable/invalid dates → deny (fail-closed)

// Attribute predicates (ABAC): EVERY predicate must pass.
//   value resolved from context via dot-path (e.g. "user.tier")
//   operators: eq ne in nin gt gte lt lte
//   missing context value OR type mismatch → that predicate fails → deny
```

`isConditionValid` **never throws** — a malformed condition fails closed (denies)
rather than aborting the surrounding check. So a grant whose predicate references
a context key you forgot to pass simply doesn't apply; the check continues down
other paths and may still end in `false`.

> **0.3.0 fix:** time conditions stored through the Prisma adapter previously
> round-tripped as strings and made `check()` throw. Dates are now revived;
> `toMillis` accepts `Date`, ISO strings, and numbers.

## Early Termination

The algorithm returns `true` as soon as **any** valid path is found — direct,
then wildcard, then groups, then hierarchy, depth-first within each. There's no
need to exhaust other paths once one succeeds.

## Performance Implications

| Factor | Impact | Mitigation |
|--------|--------|------------|
| Group/hierarchy depth | More recursive hops per check | Keep nesting shallow (2-3); memo absorbs *repeated* nodes, not longer chains |
| Number of group/hierarchy relations | Each is traversed | Only declare the relations you use |
| Shared subgraphs (diamonds) | Resolved once thanks to memo | Free in 0.3.0 |
| Cycles | Terminate via `visited`; cost bounded by `defaultCheckDepth` | Avoid circular groups anyway |
| Tuple count | Larger index scans per `findTuples` | Ensure DB indexes on `(subject..., relation)` and `(object..., relation)` |

## Debugging the Algorithm

**Best: ask the engine for the path.**

```typescript
console.dir(await authz.explain({ who: alice, canThey: "edit", onWhat: doc }),
  { depth: null });
// { allowed, via }   where via is null (denied) or a nested node:
//   { kind: "direct",    relation }
//   { kind: "wildcard",  relation }
//   { kind: "group",     relation, through, via }
//   { kind: "hierarchy", relation, parent, via }
//   { kind: "field",     base,     via }   ← wraps a node reached via the base object
```

`explain()` walks the same three edges but does **not** memoize (it needs the
actual path), so treat it as a debugging tool, not a hot path.

**Manual tracing of the three edges:**

```typescript
// 1. Direct grants (and check for a wildcard "*" subject)
console.log("direct:", await authz.listTuples({ subject: alice, object: doc }));
console.log("wildcard:", await authz.listTuples({
  subject: { type: "user", id: "*" }, object: doc,
}));

// 2. Group memberships
console.log("groups:", await authz.listTuples({ subject: alice, relation: "member" }));

// 3. Hierarchy parents of the object
console.log("parents:", await authz.listTuples({ subject: doc, relation: "parent" }));
```

**Surface depth/empty-filter warnings** — the library is silent unless you pass a
logger:

```typescript
const authz = new AuthSystem({
  storage,
  schema,
  maxDepthBehavior: "deny",
  logger: { warn: (m, meta) => console.warn("[Polizy]", m, meta), error: console.error },
});
```
