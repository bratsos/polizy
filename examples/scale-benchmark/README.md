# Scale benchmark — how polizy performs with tens of thousands of tuples

A performance playground for [polizy](../../packages/polizy). It generates a large
docs / folders / teams graph (direct grants + nested groups + deep hierarchy) into
a real Postgres running **in your browser** ([PGlite](https://pglite.dev), WASM),
then benchmarks every read path so you can see where the engine bends.

Same in-browser-Postgres trick as the other examples — no server.

## Run it

```bash
pnpm install
pnpm --filter example-scale-benchmark dev      # http://localhost:3003
```

Pick a scale (Small ≈ 7k, Medium ≈ 35k, Large ≈ 80k tuples), **Generate dataset**,
then **Run benchmarks**. Tick *include broad-list* to run the bottleneck case.

Headless (prints a table; the suite used by the UI):

```bash
pnpm --filter example-scale-benchmark bench           # medium
pnpm --filter example-scale-benchmark bench small     # includes the broad-list bottleneck
pnpm --filter example-scale-benchmark bench large
```

## What the dataset looks like

- `folders` in a tree (branching 4); `folder-0` is the root of everything.
- `docs` spread across folders; 30% also get a direct `owner`.
- `users` each a `member` of a team; teams nest into 10 root teams; each team is a
  `viewer` of one folder.
- A bounded **department** subtree (its own team + members) for predictable
  list-operation targets, plus an `auditor` user whose reach is exactly the
  department.

## Representative results

Measured headless (Node + in-memory PGlite, warm; the fast paths run in both
depth modes, so `throw` and `deny` are equally fast here; absolute numbers are
machine-dependent — what matters is how they *scale*).
"before" is the original engine; "after" is with the shipped fixes (object index
+ reverse-expand `listSubjects` + single-pass `listAccessibleObjects`):

| Operation | before (35k) | after (35k) | before (83k) | after (83k) |
|---|---:|---:|---:|---:|
| `check` · allow | ~1.1 ms | ~1.1 ms | ~1.3 ms | ~1.1 ms |
| `explain` · allow | ~0.9 ms | ~0.9 ms | ~0.9 ms | ~1.2 ms |
| `checkMany` (batch) | ~140 ms | ~140 ms | ~220 ms | ~205 ms |
| **`listAccessibleObjects`** | ~4,300 ms | **~383 ms (~11×)** | ~18,300 ms | **~799 ms (~23×)** |
| **`listSubjects`** | ~10,665 ms | **~267 ms (~40×)** | ~43,300 ms | **~566 ms (~76×)** |

The two list operations went from **super-linear** (≈4–4.5× slower for ~2.4× more
data) to **near-linear** (≈2.1× for ~2.4× more data), and from seconds/tens of
seconds to sub-second.

## Findings

1. **`check()` and `explain()` are ~constant-time** in the table size — ~1 ms at
   7k, 35k, and 83k tuples. A check touches only the query's subgraph (the
   `ReadCache` broadens to a handful of per-subject/-object range reads), not the
   whole table. This is the core ReBAC scaling property.
2. **The object index was the dominant fix.** The original super-linearity was
   object-anchored gather reads (`findSubjects`, the reverse gather) running as
   **full table scans** — the persistent store only indexed the subject prefix.
   Adding `(object_type, object_id, relation)` alone took 83k `listSubjects` from
   ~43s to ~2.7s and restored near-linear scaling. **Always index both read
   paths** (the bundled Prisma adapter does; a hand-rolled adapter must too).
3. **Reverse expansion / single-pass derivation make the list ops output-linear.**
   `listSubjects` no longer runs a forward `check()` per candidate — it expands
   backward from the grant over membership edges (cost ∝ the answer, not
   candidates × check). `listAccessibleObjects` derives each object's action set
   in one forward sweep instead of a per-(object × action) re-check. (Deny mode;
   the forward gather+verify path remains the throw-mode / field-level fallback.)
4. **`checkMany()` ≈ 3× faster than N separate `check()` calls** — one shared
   reader across the batch.
5. **`preload` for very large / remote stores.** `withReadScope({ preload: true })`
   (or `preload: true` on the list ops) fetches the whole set once and resolves in
   memory off subject/object indexes — useful when storage round-trips dominate.
   With a properly indexed local store the direct path is already sub-second, so
   preload is now a tool for remote/slow stores rather than a necessity.
