# Prisma Adapter Setup

Complete guide for setting up the Prisma storage adapter (`polizy 0.3.0`).

The adapter is exported from the **`polizy/prisma-storage`** subpath (so the core
entry never pulls in `@prisma/client`) and is a **factory function**, not a
class. `PrismaStorageAdapter` and `PrismaAdapter` are the same function under two
names.

```ts
// ✅ 0.3.0
import { PrismaStorageAdapter } from "polizy/prisma-storage"; // alias of PrismaAdapter
const storage = PrismaStorageAdapter(new PrismaClient());     // call it — no `new`

// ❌ never existed — do not do this
import { PrismaStorageAdapter } from "polizy";
const storage = new PrismaStorageAdapter(prisma);
```

## Prerequisites

```bash
npm install @prisma/client
npm install -D prisma

# Initialize Prisma if not already
npx prisma init
```

## Step 1: Add Prisma Model

Add to your `prisma/schema.prisma`:

```prisma
model PolizyTuple {
  id String @id @default(cuid())

  // Subject (who)
  subjectType String  // e.g., 'user', 'team'
  subjectId   String  // e.g., 'alice', 'team-alpha'

  // Relation (what relationship)
  relation String     // e.g., 'owner', 'member', 'parent'

  // Object (what)
  objectType String   // e.g., 'document', 'folder'
  objectId   String   // e.g., 'doc1', 'folder-a'

  // Optional conditions: { validSince?, validUntil?, attributes? }
  condition Json?

  // REQUIRED in 0.3.0 — the adapter upserts on this key for idempotent writes.
  @@unique([subjectType, subjectId, relation, objectType, objectId])

  // Hot-path indexes: "what does this subject have?" / "who has this object?"
  @@index([subjectType, subjectId, relation])
  @@index([objectType, objectId, relation])
}
```

> The `@@unique([subjectType, subjectId, relation, objectType, objectId])`
> constraint is **required** in 0.3.0. Writes are implemented as an
> upsert-in-transaction keyed on it; without the constraint the upsert has no
> target and idempotent grants cannot work. If you are upgrading from 0.2.x and earlier and
> have duplicate rows, dedupe before migrating or the constraint will fail to
> apply (see the migration guide).

## Step 2: Run Migration

```bash
# Development
npx prisma migrate dev --name add_polizy_tuples

# Generate client
npx prisma generate
```

For production:

```bash
npx prisma migrate deploy
```

## Step 3: Use the Adapter

```typescript
import { AuthSystem } from "polizy";
import { PrismaAdapter } from "polizy/prisma-storage";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const storage = PrismaAdapter(prisma);

const authz = new AuthSystem({
  storage,
  schema,
});
```

## Model Name

The adapter reads and writes the `PolizyTuple` model (`prisma.polizyTuple`).
There is no option to point it at a differently named model — the factory takes
only a `PrismaClient` (or an extended client). Keep the model named
`PolizyTuple`.

## Adapter Behavior (0.3.0)

The Prisma adapter is held to the same shared contract as the in-memory adapter:

- **Idempotent writes.** `write()` upserts each tuple on the
  `(subject, relation, object)` unique key inside a single `$transaction`, so
  re-granting the same triple updates its condition instead of inserting a
  duplicate. Stored tuples are returned in input order. A condition is only
  written when provided — re-granting without `when` leaves any existing
  condition untouched; revoke to clear it.
- **Conditions survive the round trip.** `condition` is a JSON column, and JSON
  has no `Date`. On read, the adapter revives `validSince`/`validUntil` from ISO
  strings back to `Date` so the engine's condition logic gets the type it
  expects. (In 0.2.x and earlier these stayed strings and `check()` threw on time-based
  grants — that is fixed.)
- **`delete()` does not over-delete.** The filter means
  `(who? subject==who) AND (was? relation==was) AND (onWhat? object==onWhat OR subject==onWhat)`.
  An explicit `who` is AND-ed and never dropped, so single-tuple revocations
  (`removeParent`, `removeMember`) no longer remove unrelated rows the way the
  0.2.x and earlier adapter's `who`-dropping `OR` did.
- **Pagination.** `findTuples(filter, { limit, offset })` maps to Prisma
  `take`/`skip` with a stable `orderBy: { id: "asc" }`, so paging `listTuples`
  is deterministic.

## Index Recommendations

### Basic Indexes (Required)

```prisma
@@unique([subjectType, subjectId, relation, objectType, objectId])
@@index([subjectType, subjectId, relation])
@@index([objectType, objectId, relation])
```

### Additional Indexes (High Volume)

```prisma
// For listAccessibleObjects queries
@@index([objectType, relation])

// For finding all tuples by object
@@index([objectType, objectId])

// For finding all tuples by subject
@@index([subjectType, subjectId])

// For group membership lookups
@@index([relation, objectType, objectId])
```

## Schema Variations

### PostgreSQL with UUID

```prisma
model PolizyTuple {
  id String @id @default(uuid()) @db.Uuid

  subjectType String @db.VarChar(255)
  subjectId   String @db.VarChar(255)
  relation    String @db.VarChar(255)
  objectType  String @db.VarChar(255)
  objectId    String @db.VarChar(512)  // Longer for field-level IDs
  condition   Json?  @db.JsonB

  createdAt DateTime @default(now()) @db.Timestamptz

  @@unique([subjectType, subjectId, relation, objectType, objectId])
  @@index([subjectType, subjectId, relation])
  @@index([objectType, objectId, relation])
}
```

### MySQL

```prisma
model PolizyTuple {
  id String @id @default(uuid())

  subjectType String @db.VarChar(255)
  subjectId   String @db.VarChar(255)
  relation    String @db.VarChar(255)
  objectType  String @db.VarChar(255)
  objectId    String @db.VarChar(512)
  condition   Json?

  createdAt DateTime @default(now())

  @@unique([subjectType, subjectId, relation, objectType, objectId], map: "polizy_tuple_unique")
  @@index([subjectType, subjectId, relation], map: "polizy_tuple_subject_idx")
  @@index([objectType, objectId, relation], map: "polizy_tuple_object_idx")
}
```

### SQLite (Development)

```prisma
model PolizyTuple {
  id String @id @default(cuid())

  subjectType String
  subjectId   String
  relation    String
  objectType  String
  objectId    String
  condition   Json?  // Prisma maps Json to TEXT on SQLite

  @@unique([subjectType, subjectId, relation, objectType, objectId])
  @@index([subjectType, subjectId, relation])
  @@index([objectType, objectId, relation])
}
```

Keep the column as `Json?` (this is what the library's own schema uses with the
SQLite provider). The adapter serializes/parses the JSON for you and revives
`validSince`/`validUntil` to `Date` on read on every provider — do not store
`condition` as a hand-rolled `String`.

## Connection Management

### Single Connection

```typescript
// Singleton pattern
let prisma: PrismaClient;

export function getPrisma() {
  if (!prisma) {
    prisma = new PrismaClient();
  }
  return prisma;
}

export const authz = new AuthSystem({
  storage: PrismaAdapter(getPrisma()),
  schema,
});
```

### Connection Pooling

```typescript
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
  // Connection pool settings via DATABASE_URL
  // e.g., ?connection_limit=5&pool_timeout=10
});
```

### Graceful Shutdown

```typescript
async function shutdown() {
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
```

## Multi-Database Setup

### Per-Tenant Database

```typescript
const tenantConnections = new Map<string, PrismaClient>();

function getPrismaForTenant(tenantId: string) {
  if (!tenantConnections.has(tenantId)) {
    const client = new PrismaClient({
      datasources: {
        db: { url: getTenantDbUrl(tenantId) }
      }
    });
    tenantConnections.set(tenantId, client);
  }
  return tenantConnections.get(tenantId)!;
}

function getAuthzForTenant(tenantId: string) {
  return new AuthSystem({
    storage: PrismaAdapter(getPrismaForTenant(tenantId)),
    schema,
  });
}
```

## Transactions

The Prisma adapter supports transactions automatically:

```typescript
// Write operations are transactional
await authz.allow({
  who: user,
  toBe: "owner",
  onWhat: doc
});

// For multi-operation transactions, use Prisma's $transaction
await prisma.$transaction(async (tx) => {
  // Create document
  const doc = await tx.document.create({ data: { ... } });

  // Grant permission manually using tx. Upsert (not create) to stay idempotent
  // and avoid tripping the @@unique constraint on re-runs.
  const key = {
    subjectType: "user",
    subjectId: userId,
    relation: "owner",
    objectType: "document",
    objectId: doc.id,
  };
  await tx.polizyTuple.upsert({
    where: { subjectType_subjectId_relation_objectType_objectId: key },
    create: key,
    update: {},
  });
});
```

## Troubleshooting

### "Table 'PolizyTuple' doesn't exist"

```bash
# Check migration status
npx prisma migrate status

# Apply migrations
npx prisma migrate deploy
```

### "Cannot find module '@prisma/client'"

```bash
npm install @prisma/client
npx prisma generate
```

### Unique constraint violation on writes

You should not see one from `authz.allow()` / `storage.write()` — they upsert on
the `@@unique` key, so re-granting the same triple just updates its condition.
If you DO hit one:

- **Missing constraint.** The upsert needs
  `@@unique([subjectType, subjectId, relation, objectType, objectId])`. If you
  see "no target for upsert" or a duplicate-row error, the constraint isn't in
  the database — run `npx prisma migrate dev` (or `db push`).
- **Duplicate rows from 0.2.x and earlier.** The constraint migration fails until you dedupe
  pre-existing duplicates. Delete them first (see the migration guide), then
  migrate.
- **Hand-written `create`.** If your own code inserts tuples with `create`
  instead of `upsert`, switch to `upsert` (see the Transactions section).

To change a grant's condition, just re-`allow()` it — the update is idempotent,
no delete-first needed:

```typescript
await authz.allow({
  who: user,
  toBe: "editor",
  onWhat: doc,
  when: { validUntil: newDate }, // overwrites the existing condition in place
});
```

Remember: because the triple is the identity, a standing grant and a temporary
grant on the **same** `(subject, relation, object)` can't coexist — they collapse
into one. Model "standing + temporary" with **distinct relations** (e.g. `viewer`
standing, `temp_viewer` time-boxed).

### Slow queries

1. Check indexes exist:
   ```sql
   SHOW INDEXES FROM PolizyTuple;
   ```

2. Analyze query plan:
   ```sql
   EXPLAIN ANALYZE
   SELECT * FROM PolizyTuple
   WHERE subjectType = 'user'
   AND subjectId = 'alice'
   AND relation = 'member';
   ```

3. Add missing indexes based on query patterns
