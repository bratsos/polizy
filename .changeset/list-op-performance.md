---
"polizy": minor
---

Performance: make list operations fast at scale, plus two correctness fixes.

- **Preloaded reads are now indexed by subject and object** (not only by relation). A point query off a `withReadScope({ preload: true })` set is now `O(deg)` instead of scanning a whole relation bucket. This turns `preload` from a pessimization at scale into the recommended mode for list operations: measured at ~35k tuples, `listSubjects` runs ~30× faster (≈9.7s → ≈0.3s) and `listAccessibleObjects` ~15× faster (≈4.0s → ≈0.3s) when wrapped in a preloaded read scope.
- **Shared positive memo for list operations** (`listSubjects` / `listAccessibleObjects`, deny mode): the upward grant path shared across candidates/objects is memoized within an operation instead of re-walked per candidate. Decision-neutral (gated to `maxDepthBehavior: "deny"`, verified against the forward-`check()` ground truth).
- **`listAccessibleObjects` builds its parent map from the reachable set** instead of a full per-hierarchy-relation table scan — a fixed startup-cost reduction.

Correctness fixes (both verified by a forward-`check()` differential):

- **`listAccessibleObjects` now honors attribute (ABAC) conditions on group memberships.** Previously the group-gather dropped the check context, so an object reachable only through an attribute-conditioned membership could be omitted even when `check()` allowed it.
- **`listAccessibleObjects` now includes objects reachable via wildcard (`everyone(type)`) direct grants.** Previously a public grant was honored by `check()` but missing from the list.

No public API changes; `check()`/`explain()` behavior and performance are unchanged.
