---
"polizy": minor
---

Make list operations scale near-linearly and add existence/count + preload query options.

`listSubjects` and `listAccessibleObjects` were super-linear in the tuple count; they are now near-linear and sub-second at scale (measured ~76× and ~23× faster at 83k tuples). All changes are decision-neutral, verified by a randomized forward-`check()` differential.

- **Reverse expansion for `listSubjects`** and **single-pass derivation for `listAccessibleObjects`** (both depth modes): the answer is computed directly from the granting structure instead of running a forward `check()` per candidate / per (object × action). `deny` mode bounds at the depth cap; `throw` mode raises `MaxDepthExceededError` when the query's relevant subgraph is deeper than the cap (a cleaner, deterministic signal than the previous per-candidate behavior — for any graph within the cap, which is the norm, behavior is unchanged). Schemas with field-level objects keep using the gather-then-verify path.
- **`preload?: boolean`** option on `listSubjects`, `listAccessibleObjects`, and `checkMany` — fetches the working set once and resolves in memory (equivalent to `withReadScope({ preload: true })`), for remote/slow stores.
- **New query variants:** `someoneCan(...)` (existence; short-circuits), `countSubjects(...)`, and `countAccessibleObjects(...)`.

Correctness fixes (caught by the differential, affect both old and new paths):

- `listAccessibleObjects` now honors objects reachable via a **wildcard grant to a group-acting type** (e.g. `everyone("team")` is a viewer → members of any team can view), and `listSubjects` likewise surfaces those subjects. Previously `check()` allowed it but the lists omitted it.

Custom storage adapters should index **both** read paths — `(subjectType, subjectId, relation)` and `(objectType, objectId, relation)`. Relying on a single `@@unique` covers only subject-anchored reads; object-anchored reads (the list gather) otherwise fall back to full table scans. The bundled Prisma adapter already ships both indexes; the example PGlite adapters now do too.
