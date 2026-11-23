# Prisma Setup for Polizy

The Prisma adapter is the production storage backend. It is exported from the
`polizy/prisma-storage` subpath so the core `polizy` entry never imports
Prisma (`@prisma/client` `^6.0.0 || ^7.0.0` is an optional peer dependency;
Prisma 8 via `@prisma/orm-postgres` needs no polizy peer dependency).

One factory (`PrismaAdapter` / `PrismaStorageAdapter`, and `PrismaRoleCatalog`)
supports Prisma 6, Prisma 7, and Prisma 8 — the client shape selects the backend.

## Prerequisites

**Prisma 6 or 7:**

```bash
npm install @prisma/client
npm install -D prisma
```

Prisma 7 requires Node 22.12+ or 24+, puts the datasource URL in `prisma.config.ts`,
and passes a driver adapter (such as `@prisma/adapter-pg`) to `PrismaClient`.

**Prisma 8** (`@prisma/orm-postgres`, TypeScript >= 5.9):

```bash
npm install @prisma/orm-postgres pg temporal-polyfill
npm install -D prisma @types/pg
```

## Prisma Model

Add this model to your `prisma/schema.prisma`. The compound `@@unique`
constraint is **required** in 0.3.0 — the adapter upserts on this key to make
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

### Upgrading from 0.2.x and earlier: dedupe before migrating

0.2.x and earlier allowed duplicate tuples. If your existing table has duplicates, adding the
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

See the [migration router](../../polizy/migrations/README.md) for the full
upgrade checklist (it applies the `@@unique`/Prisma migration guide for your
version delta).

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

### Prisma 7 Client

Prisma 7 uses the same `PolizyTuple` (and optional `PolizyRole`) schema as Prisma 6,
with the datasource URL in `prisma.config.ts` and a driver adapter on `PrismaClient`.
Both `prisma-client` and `prisma-client-js` generators work:

```typescript
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client"; // or "@prisma/client"
import { PrismaStorageAdapter } from "polizy/prisma-storage";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});
const storage = PrismaStorageAdapter(prisma);
```

`PrismaAdapter(prisma)` and `PrismaAdapter(tx)` type-check against generated
Prisma 7 types with no casts.

### Prisma 8 Setup (`@prisma/orm-postgres`)

Prisma 8 uses `contract.prisma` (the `// use prisma-8` first line is required;
use `Jsonb` for `condition` and `actions` because plain `Json` has no equality
filter and `Json(storage: jsonb)` fails on rc.21):

```prisma
// use prisma-8

model PolizyTuple {
  id          String @id @onCreate(cuid(2))
  subjectType String
  subjectId   String
  relation    String
  objectType  String
  objectId    String
  condition   Jsonb?

  @@unique([subjectType, subjectId, relation, objectType, objectId])
  @@index([subjectType, subjectId, relation])
  @@index([objectType, objectId, relation])
}

// Only for PrismaRoleCatalog
model PolizyRole {
  id      String  @id @onCreate(cuid(2))
  tenant  String
  key     String
  label   String?
  actions Jsonb

  @@unique([tenant, key])
  @@index([tenant])
}
```

Keep both models in the default `public` namespace (`db.orm.public.PolizyTuple`).
The table is `"PolizyTuple"` with camelCase columns, matching Prisma 6/7, so an
existing Prisma 6/7 table can be reused.

Configure `prisma.config.ts`:

```typescript
import { definePrismaConfig } from "@prisma/cli-engine";
import { defineConfig as ormConfig } from "@prisma/orm-postgres/config";

export default definePrismaConfig({
  orm: ormConfig({
    contract: "./src/prisma/contract.prisma",
    db: { connection: process.env.DATABASE_URL! },
  }),
});
```

Emit and push the schema, then instantiate the client:

```bash
npx prisma contract emit
npx prisma db update   # also creates the tables in an empty database
```

```typescript
import postgres from "@prisma/orm-postgres/runtime";
import { contractFromJson } from "@prisma/orm-postgres/static";
import { PrismaAdapter, PrismaRoleCatalog } from "polizy/prisma-storage";
import type { Contract } from "./prisma/contract.d.ts";
import contractJson from "./prisma/contract.json" with { type: "json" };

const db = postgres({
  contract: contractFromJson<Contract>(contractJson),
  url: process.env.DATABASE_URL,
});
const storage = PrismaAdapter(db, { snapshotIsolationLevel: "RepeatableRead" });
const catalog = PrismaRoleCatalog(db);
```

Prisma 8 passes `transactionOptions.timeout` through and ignores `maxWait`.
`snapshotIsolationLevel` is honored from `@prisma/orm-postgres` `8.0.0-rc.25`
(earlier RCs ignore it and run `withSnapshot` at `READ COMMITTED`).

## Choosing Root Client vs Transaction Client

Pass the **root client** (`PrismaAdapter(prisma)` / `PrismaAdapter(db)`) for
general requests:

- `write()` runs atomically (batch `$transaction` on Prisma 6/7; `db.transaction` on Prisma 8).
- `consistency: "strong"` runs in `withSnapshot`, opening a new interactive
  transaction on a separate connection using `snapshotIsolationLevel` and
  `transactionOptions`.

Pass a **transaction client** (`PrismaAdapter(tx)` / `PrismaRoleCatalog(tx)`)
inside an interactive transaction when authorization must share that
transaction's uncommitted writes, isolation level, or session-local RLS
settings (`SET LOCAL` / `set_config(..., true)`):

```typescript
// Prisma 6 / 7
await prisma.$transaction(async (tx) => {
  const authz = new AuthSystem({ storage: PrismaAdapter(tx), schema });
  if (!(await authz.check({ who, canThey: "edit", onWhat, consistency: "strong" }))) {
    throw new Error("forbidden");
  }
  await authz.allow({ who: otherUser, toBe: "viewer", onWhat });
});

// Prisma 8
await db.transaction(async (tx) => {
  const authz = new AuthSystem({ storage: PrismaAdapter(tx), schema });
  if (!(await authz.check({ who, canThey: "edit", onWhat }))) {
    throw new Error("forbidden");
  }
  // ... your writes on tx
}, { isolationLevel: "RepeatableRead" });
```

With a transaction client:

- Every read and write runs directly on `tx`.
- The adapter omits `withSnapshot`, so `consistency: "strong"` runs on `tx` (no separate connection).
- `write()` runs upserts sequentially on `tx`, rolling back atomically with it.
- Detection: Prisma marks its own transaction clients (Prisma 6/7: an internal transaction symbol; Prisma 8: the `invalidated` flag on `tx`), and polizy treats a client with that mark as a transaction client. Any other client (a root client, an `$extends` client, or your own wrapper) is a root client: writes run in one transaction through its `$transaction` / `transaction()`, and it gets `withSnapshot`. Pass Prisma's `tx` itself, not a wrapper around it. An object that is neither (no transaction mark and no `$transaction` / `transaction()` method) is rejected when the adapter is created, because its writes could not be atomic.

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

You have duplicate tuples from 0.2.x and earlier. Dedupe them (see "Upgrading from 0.2.x and earlier"
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

In 0.2.x and earlier, `validSince`/`validUntil` round-tripped through the JSON column as
strings and could make `check()` throw. 0.3.0 revives them to `Date`, so
conditions work on Prisma. If you avoided conditions on Prisma before, they are
safe to use now.

### Slow queries

1. Verify indexes exist with `npx prisma migrate status`.
2. Run `EXPLAIN ANALYZE` on slow queries.
3. See [polizy-storage](../../polizy-storage/SKILL.md) for tuning.
