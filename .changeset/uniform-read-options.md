---
"polizy": minor
---

- Standardized read options across all public and read-scope authorization APIs via a unified `ReadOptions` type (supporting `contextualTuples`, `consistency`, and `preload`). Per-request contextual tuples are intentionally not supported on `checkMany` (one reader/batch).
- Added `someoneCan`, `countSubjects`, and `countAccessibleObjects` to the `ReadScope` interface.
- Added pagination (`limit` and `offset`) parameters to `listSubjects`, applied after sorting.
- Enabled `checkOrThrow` to correctly accept and forward all `ReadOptions`.
