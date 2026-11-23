# Prisma Adapter Setup

Complete guide for setting up the Prisma storage adapter (`polizy 0.7.0`, supporting Prisma 6, 7, and 8).

The adapter is exported from the **`polizy/prisma-storage`** subpath (so the core
entry never pulls in `@prisma/client`) and is a **factory function**, not a
class. `PrismaStorageAdapter` and `PrismaAdapter` are the same function under two
names. One factory handles Prisma 6, Prisma 7, and Prisma 8 — the client's shape
selects the backend automatically (a Prisma 8 client has `.orm`). Both root
clients and interactive transaction clients (`tx`) are accepted.

```ts
// ✅ 0.3.0
import { PrismaStorageAdapter } from "polizy/prisma-storage"; // alias of PrismaAdapter
const storage = PrismaStorageAdapter(new PrismaClient());     // call it — no `new`

// ❌ never existed — do not do this
import { PrismaStorageAdapter } from "polizy";
const storage = new PrismaStorageAdapter(prisma);
```

## Prerequisites

**Prisma 6 or 7** (`@prisma/client` `^6.0.0 || ^7.0.0`, optional peer dependency):

```bash
npm install @prisma/client
npm install -D prisma

# Initialize Prisma if not already
npx prisma init
```

Prisma 7 requires Node 22.12+ or 24+, places the datasource URL in `prisma.config.ts`, and passes a driver adapter (such as `@prisma/adapter-pg`) to `new PrismaClient({ adapter })`. Both `prisma-client` and `prisma-client-js` generators work.

**Prisma 8** (`@prisma/orm-postgres`, no polizy peer dependency required):

```bash
npm install @prisma/orm-postgres pg temporal-polyfill
npm install -D prisma @types/pg
```

Requires TypeScript >= 5.9. For Prisma 8's `contract.prisma` and client setup, see [Prisma 8 Setup](#prisma-8-setup) below.

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
const storage = PrismaAdapter(prisma, {
  // Optional configuration (root clients only)
  snapshotIsolationLevel: "RepeatableRead", // isolation level for consistency: "strong"
  transactionOptions: {
    maxWait: 5000,    // maximum wait time (Prisma 6/7 default 2000ms; ignored on Prisma 8)
    timeout: 10000,   // timeout for the transaction (Prisma 6/7 default 5000ms)
  }, // raise these for strong-consistency list operations over large stores
});

const authz = new AuthSystem({
  storage,
  schema,
});
```

## Model Name

On Prisma 6 and 7, the adapter reads and writes the `PolizyTuple` model
(`prisma.polizyTuple`). On Prisma 8, it reads `db.orm.public.PolizyTuple` (and
`db.orm.public.PolizyRole` for `PrismaRoleCatalog`). Keep the models in the
default `public` namespace with these exact model and field names.

## Prisma 7 Setup Notes

Prisma 7 uses the same `PolizyTuple` and `PolizyRole` models as Prisma 6, with
the datasource URL configured in `prisma.config.ts` and a driver adapter passed
to `PrismaClient`:

```ts
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client"; // or "@prisma/client"
import { PrismaAdapter } from "polizy/prisma-storage";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});
const storage = PrismaAdapter(prisma);
```

Both `prisma-client` and `prisma-client-js` generators work, and `PrismaAdapter(prisma)` / `PrismaAdapter(tx)` type-check against generated Prisma 7 types with no casts.

## Prisma 8 Setup

Prisma 8 (`prisma` + `@prisma/orm-postgres`) uses a `contract.prisma` file instead of `schema.prisma`. The `// use prisma-8` first line is required, and `Jsonb` is required for `condition` and `actions` (plain `Json` maps to `json`, which has no equality filter; `Jsonb` works on rc.21+, whereas `Json(storage: jsonb)` fails on rc.21):

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

The generated table is `"PolizyTuple"` with camelCase columns — the same layout as Prisma 6/7, so an existing Prisma 6/7 table can be reused.

Configure `prisma.config.ts`:

```ts
import { definePrismaConfig } from "@prisma/cli-engine";
import { defineConfig as ormConfig } from "@prisma/orm-postgres/config";

export default definePrismaConfig({
  orm: ormConfig({
    contract: "./src/prisma/contract.prisma",
    db: { connection: process.env.DATABASE_URL! },
  }),
});
```

Emit the contract types/JSON and update the database:

```bash
npx prisma contract emit
npx prisma db update   # also creates the tables in an empty database
```

Instantiate the client and adapter:

```ts
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

- `transactionOptions.timeout` is passed through; Prisma 8 has no `maxWait` (ignored).
- `snapshotIsolationLevel` is honored from `@prisma/orm-postgres` `8.0.0-rc.25`. Earlier RCs (such as `rc.21`) silently ignore it, so `withSnapshot` runs at `READ COMMITTED` there.

## Optional: Role Catalog Table (0.5.0)

This table is **only** needed if you use `RoleRegistry` with a **persistent**
catalog. Skip it entirely otherwise — runtime roles are pure tuples and live in
`PolizyTuple` like everything else.

A role's capabilities (`cap_<action>`) and assignments (the `assignee` group
relation) are ordinary relationship tuples in `PolizyTuple`. The catalog stores
only **metadata**: a role's existence and its label, so a permission-less role
stays listable. **The engine never reads the catalog** — `check()`, `explain()`,
and the rest resolve roles purely from the tuples in your `StorageAdapter`.

Add the model to your `prisma/schema.prisma`:

```prisma
model PolizyRole {
  id      String  @id @default(cuid())
  tenant  String
  key     String
  label   String?
  actions Json

  @@unique([tenant, key])
  @@index([tenant])
}
```

Migrate as usual:

```bash
npx prisma migrate dev --name add_polizy_roles
npx prisma generate
```

Then wire `PrismaRoleCatalog(prisma)` into the `RoleRegistry`:

```typescript
import { AuthSystem, RoleRegistry } from "polizy";
import { PrismaAdapter, PrismaRoleCatalog } from "polizy/prisma-storage";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const authz = new AuthSystem({
  storage: PrismaAdapter(prisma),
  schema,
});

const roles = new RoleRegistry(authz, schema, {
  catalog: PrismaRoleCatalog(prisma),
});
```

Like the tuple adapter, `PrismaRoleCatalog` is a **factory function** exported
from `polizy/prisma-storage` — call it, no `new`. Omit `catalog` to use the
in-memory `InMemoryRoleCatalog` (or no catalog at all), in which case roles are
discoverable only through their tuples.

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
- **Condition filter behavior (0.6.0).** Passing `findTuples({ condition: undefined })` with the key present imposes no condition constraint on the query (previously PrismaAdapter filtered by `IS NULL`, which was unreachable through the engine). It now aligns with the in-memory adapter.

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

On a root client, `write()` is atomic (Prisma 6/7 batch `$transaction`; Prisma 8
`db.transaction`), and `withSnapshot` opens its own interactive transaction on
a separate connection using `snapshotIsolationLevel` and `transactionOptions`.

To run authorization reads and writes inside your **own** transaction — sharing
its isolation level, uncommitted writes, and session settings (`SET LOCAL` /
`set_config` for RLS) — pass the transaction client `tx` to `PrismaAdapter(tx)`
(and `PrismaRoleCatalog(tx)` if using runtime roles):

```typescript
// Prisma 6 / 7
await prisma.$transaction(async (tx) => {
  const authz = new AuthSystem({ storage: PrismaAdapter(tx), schema });
  const doc = await tx.document.create({ data: { /* ... */ } });
  await authz.allow({ who: user, toBe: "owner", onWhat: { type: "document", id: doc.id } });
  if (!(await authz.check({ who: user, canThey: "edit", onWhat: doc, consistency: "strong" }))) {
    throw new Error("forbidden");
  }
});

// Prisma 8
await db.transaction(async (tx) => {
  const authz = new AuthSystem({ storage: PrismaAdapter(tx), schema });
  if (!(await authz.check({ who, canThey: "edit", onWhat }))) {
    throw new Error("forbidden");
  }
  // ... your writes on tx
}, { isolationLevel: "RepeatableRead", timeout: 10000 });
```

When given a transaction client:

- **No `withSnapshot`:** `consistency: "strong"` runs directly on `tx` instead of opening a separate connection.
- **Sequential writes on `tx`:** `write()` runs its upserts in sequence on the caller's transaction, so they commit or roll back atomically with it. (In 0.6.x, `PrismaAdapter(tx)` threw `p.$transaction is not a function` on Prisma 6 and used `tx.$transaction([...])` on Prisma 7, which escaped caller rollbacks; both are fixed in 0.7.0.)
- **Detection:** Prisma marks its own transaction clients (Prisma 6/7: an internal transaction symbol; Prisma 8: the `invalidated` flag on `tx`), and polizy treats a client with that mark as a transaction client. Any other client (a root client, an `$extends` client, or your own wrapper) is a root client: writes run in one transaction through its `$transaction` / `transaction()`, and it gets `withSnapshot`. Pass Prisma's `tx` itself, not a wrapper around it. An object that is neither (no transaction mark and no `$transaction` / `transaction()` method) is rejected when the adapter is created, because its writes could not be atomic.

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
