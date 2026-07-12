---
"polizy": minor
---

- Allowed partial `hierarchyPropagation` maps in schema definitions so users do not need to pad with empty arrays for unpropagated actions. Invalid or typo'd keys and values continue to fail at compile-time.
- Refactored `AttributePredicate` to be a discriminated union based on the comparison operator, ensuring that operators like `eq`/`ne` enforce a scalar type, `in`/`nin` enforce an array type, and inequality operators (`gt`/`gte`/`lt`/`lte`) enforce a number type at compile time.
- Documented `maxDepth`'s group-membership expansion semantics in JSDoc, clarifying that it bounds group-membership expansion only and not hierarchy depth.
