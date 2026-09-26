---
"polizy": patch
---

- `check`/`explain` no longer load a subject's entire tuple set. Direct-grant lookups are now keyed on the object (every relation and subject on that object, wildcard grants included) and membership lookups on the subject + group relation, as Zanzibar-style resolvers do. A check on a subject holding thousands of unrelated tuples now reads only the tuples on the checked object and its path. Storage reads in a batch scale with the distinct objects checked rather than with the subject's tuple count.
