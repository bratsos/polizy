---
"polizy": minor
---

- Add Prisma 7 (`@prisma/adapter-pg`) and Prisma 8 (`@prisma/orm-postgres`) support to `PrismaAdapter` and `PrismaRoleCatalog` alongside Prisma 6. Update optional `peerDependencies` to `"@prisma/client": "^6.0.0 || ^7.0.0"` (Prisma 8 requires no polizy peer dependency).
- Support passing interactive transaction clients (`tx`) from `prisma.$transaction` (Prisma 6/7) or `db.transaction` (Prisma 8) to `PrismaAdapter(tx)` and `PrismaRoleCatalog(tx)`. Reads and sequential writes run directly on `tx` without `withSnapshot`, fixing the Prisma 6 `$transaction is not a function` throw and the Prisma 7 escaped-writes bug on rollback. Transaction clients are recognised by the mark Prisma puts on them; root clients, `$extends` clients and wrappers that can open a transaction behave as before. **Breaking:** an object that is neither a transaction client nor able to open a transaction (for example `{ polizyTuple: prisma.polizyTuple }`) now throws when the adapter is created, because its writes could not be atomic.
- On Prisma 8 root clients, `withSnapshot` passes `transactionOptions.timeout` through (ignoring `maxWait`) and honors `snapshotIsolationLevel` from `@prisma/orm-postgres` `8.0.0-rc.25+` (earlier RCs read at `READ COMMITTED`).
- Add `tuple: StoredTuple` to `direct`, `wildcard`, `group`, and `hierarchy` `ExplainNode` variants (contextual tuples have ids `ctx:0`, `ctx:1`, …).
- Export `ReadOnlyStorage` and `Relation` types from `polizy`.
- Add 6 contract tests to `defineStorageAdapterTestSuite` (`polizy/storage-tests`) covering full condition round-trips, condition preservation on re-write, stable `limit`/`offset` pagination, `findTuples({})`, `findSubjects`/`findObjects` type filters, and `withSnapshot`.
- `InMemoryStorageAdapter`: re-writing a tuple with a new condition no longer changes tuple objects already returned (for example inside an earlier `explain()` result).
- Prisma 8 `delete({ who/was, onWhat })` runs as one statement.
