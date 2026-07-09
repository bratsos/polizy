---
"polizy": minor
---

- Bare `new InMemoryStorageAdapter()` / `PrismaAdapter(client)` now compose with literal-typed schemas under strict TypeScript (previously required explicit or any generics due to a variance artifact; `AuthSystem` now also accepts the wide string-typed adapter instantiation, which is semantically safe).
- JSDoc clarifications: contextual tuples carry constraints in the stored `condition:` field (grant verbs use `when:`), and `explain` never throws on depth.
