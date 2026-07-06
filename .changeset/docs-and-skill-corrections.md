---
"polizy": patch
---

Docs, shipped-skill corrections, and hygiene fixes.

- Corrected troubleshooting documentation snippets (updated `addMember` to object-form, moved `fieldLevelObjects` to `defineSchema`, and renamed database model to `PolizyTuple`).
- Corrected the stale `O(candidates × check)` performance claim for list operations in the troubleshooting skill.
- Added the missing `0.3 → 0.4` migration guide.
- Fixed the `@@unique` constraint attribution in the migration router documentation.
- Documented three missing `AuthSystem` constructor options (`defaultGroupRelation`, `defaultHierarchyRelation`, and `nonSubjectTypes`) in the schema reference table.
- Removed the `console.warn` call in the in-memory storage adapter's delete operation to respect the silent-by-default logger contract.
