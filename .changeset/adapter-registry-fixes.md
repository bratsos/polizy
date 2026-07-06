---
"polizy": minor
---

- Added transactionOptions passthrough for withSnapshot (Prisma interactive-tx defaults abort long strong-consistency list operations)
- Adjusted Prisma findTuples to no longer treat an explicitly-undefined condition filter as "condition IS NULL" (now matches the in-memory reference: no constraint), noting it was unreachable through the engine
- Updated RoleRegistry to reject "/" in tenant ids (prevents cross-tenant permissionMatrix contamination via prefix parsing)
- Documented the getRolePermissions/permissionMatrix on-scope difference and the in-memory adapter's live-reference semantics
- The InMemoryRoleCatalog source contained a raw NUL byte as its composite-key separator, making the file binary to git; it is now the \u0000 escape sequence (identical runtime separator, valid text source).

