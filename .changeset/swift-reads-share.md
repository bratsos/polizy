---
"polizy": minor
---

Faster reads and new consistency primitives.

**Read batching.** The engine used to ask storage one tiny question at a
time — `findTuples({subject, relation, object})`, over and over, re-fetching
invariants like a subject's group memberships on every step of recursion. A
per-operation read layer now fetches the broadest covering query once
(everything for that subject, object, or relation), indexes it by relation, and
resolves in memory. On a measured workload this collapsed 177 storage reads to
single digits with identical results.

**`withReadScope(fn, { consistency?, preload? })`.** A new `AuthSystem` method
that shares one read pass across many operations. Inside the scope,
`check` / `checkMany` / `explain` / `listAccessibleObjects` / `listSubjects`
read through a single cache, so each subject/object/relation is fetched at most
once for the whole scope. `{ preload: true }` loads the tuple set in one read up
front, so every check then resolves in memory — ideal when storage round-trips
are expensive (an in-browser database) or the working set is small. A demo page
that previously issued ~45 reads per render now issues 6–7.

**Strong consistency.** Operations accept `consistency: "strong"`, and storage
adapters can implement `withSnapshot` to evaluate a whole operation against a
single point-in-time view. The built-in in-memory and Prisma adapters support
it (Prisma via a configurable transaction isolation level).

**Contextual tuples.** Reads accept `contextualTuples` — ephemeral tuples
evaluated as if stored, for read-your-writes within a single check without
persisting first.

**Internals.** `explain` now memoizes negative resolutions, and the in-memory
adapter indexes tuples by subject/object/relation. All changes are additive and
backward compatible.
