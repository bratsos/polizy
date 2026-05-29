# Prisma Setup for Polizy

The Prisma adapter is the production storage backend. It is exported from the
`polizy/prisma-storage` subpath so the core `polizy` entry never imports
`@prisma/client` (kept as an optional peer dependency).

## Prerequisites

```bash
npm install @prisma/client
npm install -D prisma
```

## Prisma Model

Add this model to your `prisma/schema.prisma`. The compound `@@unique`
constraint is **required** in 0.2.0 — the adapter upserts on this key to make
grants idempotent. Without it, `allow`/`addMember`/`setParent` cannot dedupe and
the upsert has no key to target.

```prisma
model PolizyTuple {
  id          String  @id @default(cuid())
  subjectType String  // e.g. 'user', 'team'
  subjectId   String  // e.g. 'alice', 'team-alpha'
  relation    String  // e.g. 'owner', 'member', 'parent'
  objectType  String  // e.g. 'document', 'folder'
  objectId    String  // e.g. 'doc1', 'folder-a'
  condition   Json?   // optional: time window and/or attribute predicates

  // REQUIRED: each relationship is unique; enables idempotent upserts.
  @@unique([subjectType, subjectId, relation, objectType, objectId])

  // Lookups: "what does this subject have?" and "who has this object?"
  @@index([subjectType, subjectId, relation])
  @@index([objectType, objectId, relation])
}
```

> The field set and column names are fixed — the adapter reads/writes
> `subjectType`, `subjectId`, `relation`, `objectType`, `objectId`, and
> `condition` on a model literally named `PolizyTuple`. Do not rename them.

## Generate and Migrate

After adding (or changing) the model, regenerate the client **and** apply the
schema to the database. The generated client must know about the compound unique
key, so always run `prisma generate`:

```bash
# Generate the client (picks up the @@unique compound key the adapter targets)
npx prisma generate

# Apply to the database — pick ONE:
npx prisma migrate dev --name polizy_tuple_unique   # tracked migration (recommended)
# or, for quick local/dev iteration without a migration history:
npx prisma db push
```

In production/CI, apply committed migrations with:

```bash
npx prisma migrate deploy
```

### Upgrading from 0.1.x: dedupe before migrating

0.1.x allowed duplicate tuples. If your existing table has duplicates, adding the
`@@unique` constraint will fail until you remove them. Delete duplicates first
(Postgres example), then run the migration:

```sql
DELETE FROM "PolizyTuple" a
USING "PolizyTuple" b
WHERE a.id > b.id
  AND a."subjectType" = b."subjectType"
  AND a."subjectId"   = b."subjectId"
  AND a.relation      = b.relation
  AND a."objectType"  = b."objectType"
  AND a."objectId"    = b."objectId";
```

See [migrate-0.1-to-0.2.md](../../polizy/migrations/migrate-0.1-to-0.2.md) for the
full upgrade checklist.

## Using the Adapter

`PrismaStorageAdapter` is a **factory function**, not a class — call it, do not
`new` it. (`PrismaAdapter` is the same function under its original name.)

```typescript
import { AuthSystem } from "polizy";
import { PrismaStorageAdapter } from "polizy/prisma-storage"; // alias of PrismaAdapter
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const storage = PrismaStorageAdapter(prisma); // no `new`

const authz = new AuthSystem({ storage, schema });
```

The adapter also accepts an extended client (`prisma.$extends(...)`), so Prisma
extensions and Accelerate work without changes.

## Multiple Databases

For multi-tenant setups with separate databases, build one adapter per
`PrismaClient`:

```typescript
function getAuthzForTenant(tenantId: string) {
  const prisma = new PrismaClient({
    datasources: {
      db: { url: getTenantDbUrl(tenantId) },
    },
  });

  return new AuthSystem({
    storage: PrismaStorageAdapter(prisma),
    schema,
  });
}
```

Each tenant database needs the `PolizyTuple` model (with the `@@unique`
constraint) and its own migration applied.

## Index Recommendations

The two indexes above cover the adapter's core lookups. For high-volume
applications, profile first, then consider additional indexes:

```prisma
model PolizyTuple {
  // ... fields and the required @@unique ...

  // For object-centric scans (e.g. listSubjects on a busy object type)
  @@index([objectType, relation])

  // For group membership lookups
  @@index([relation, objectType, objectId])
}
```

For deeper performance guidance, see
**[polizy-storage](../../polizy-storage/SKILL.md)**.

## Troubleshooting

### "PrismaStorageAdapter is not a constructor" / "is not a function"

It is a factory, not a class. Use `PrismaStorageAdapter(prisma)`, not
`new PrismaStorageAdapter(prisma)`. Also confirm you imported it from
`"polizy/prisma-storage"` (the core `"polizy"` entry does not export it).

### Unique constraint migration fails

You have duplicate tuples from 0.1.x. Dedupe them (see "Upgrading from 0.1.x"
above), then re-run the migration.

### "Table 'PolizyTuple' doesn't exist"

The model was never applied to the database:

```bash
npx prisma db push
# or
npx prisma migrate deploy
```

### "Cannot find module '@prisma/client'"

```bash
npm install @prisma/client
npx prisma generate
```

### Time-based or attribute conditions behave oddly

In 0.1.x, `validSince`/`validUntil` round-tripped through the JSON column as
strings and could make `check()` throw. 0.2.0 revives them to `Date`, so
conditions work on Prisma. If you avoided conditions on Prisma before, they are
safe to use now.

### Slow queries

1. Verify indexes exist with `npx prisma migrate status`.
2. Run `EXPLAIN ANALYZE` on slow queries.
3. See [polizy-storage](../../polizy-storage/SKILL.md) for tuning.
