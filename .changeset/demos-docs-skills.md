---
"polizy": patch
---

Docs, shipped-skill corrections, and hosted live demos.

- **Hosted live demos**, embedded in the docs site under a new **Demos** section, each running a real Postgres in the browser via PGlite: the runtime-roles **permissions matrix** (`permissions.polizy.dev`) and the **scale benchmark** (`bench.polizy.dev`), alongside the existing full demo (`demo.polizy.dev`).
- **Shipped-skill corrections** (the `skills/` directory is published to npm): the storage performance reference still described the pre-optimization list-operation algorithm (`~O(candidates × check)`, "`preload` is a pessimization at scale") — corrected to the current behavior (reverse expansion / single-pass derivation are output-linear in **both** depth modes; index both read paths; `preload` is for remote/slow stores). Documented the `someoneCan` / `countSubjects` / `countAccessibleObjects` queries and the `preload` option in the skills and the 0.4→0.5 migration guide.
- **JSDoc corrections** for `someoneCan` and the internal list dispatch, which described the fast paths as deny-mode-only; they run in both modes (`throw` raises on depth-cap truncation).

Documentation only — no engine or public API behavior changes.
