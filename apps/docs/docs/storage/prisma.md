---
title: Prisma Storage
sidebar_position: 2
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Prisma Storage

The **Prisma Storage Adapter** persists relationship facts (tuples) in a SQL database. `PrismaAdapter` (also exported as `PrismaStorageAdapter`) and `PrismaRoleCatalog` from `polizy/prisma-storage` accept Prisma 6, Prisma 7, and Prisma 8 clients, as well as transaction clients from any of them.

The core `polizy` package does not depend on `@prisma/client`. `@prisma/client` (`^6.0.0 || ^7.0.0`) is an optional peer dependency of `polizy`, and Prisma 8 requires no polizy peer dependency because the adapter does not import Prisma packages.

---

## 1. Install dependencies

<Tabs>
  <TabItem value="prisma6" label="Prisma 6" default>

```bash
npm install @prisma/client
npm install --save-dev prisma
```

  </TabItem>
  <TabItem value="prisma7" label="Prisma 7">

Prisma 7 requires Node.js `22.12+` or `24+` and a driver adapter such as `@prisma/adapter-pg`:

```bash
npm install @prisma/client @prisma/adapter-pg pg
npm install --save-dev prisma @types/pg
```

  </TabItem>
  <TabItem value="prisma8" label="Prisma 8">

Prisma 8 (`@prisma/orm-postgres`) requires TypeScript `>= 5.9`:

```bash
npm install @prisma/orm-postgres pg temporal-polyfill
npm install --save-dev prisma @types/pg
```

  </TabItem>
</Tabs>

---

## 2. Define the model in your schema

<Tabs>
  <TabItem value="prisma6-7" label="Prisma 6 & 7 (schema.prisma)" default>

Add `PolizyTuple` to `schema.prisma`. Add `PolizyRole` as well if you use `PrismaRoleCatalog`.

:::warning

Keep this model structure unchanged. The compound `@@unique` constraint makes grants idempotent (re-writing an existing tuple updates its condition rather than creating a duplicate). The `@@index` definitions are required for query performance.

:::

```prisma
model PolizyTuple {
  id          String  @id @default(cuid())
  subjectType String
  subjectId   String
  relation    String
  objectType  String
  objectId    String
  condition   Json?

  @@unique([subjectType, subjectId, relation, objectType, objectId])
  @@index([subjectType, subjectId, relation])
  @@index([objectType, objectId, relation])
}

// Only needed for PrismaRoleCatalog
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

  </TabItem>
  <TabItem value="prisma8" label="Prisma 8 (contract.prisma)">

Create `contract.prisma`. The `// use prisma-8` header is required. Both models must live in the default `public` namespace with these exact model and field names (the adapter reads `db.orm.public.PolizyTuple` and `db.orm.public.PolizyRole`).

Use `Jsonb` (not plain `Json`, which lacks equality filtering, and not `Json(storage: jsonb)`, which fails on `@prisma/orm-postgres` `8.0.0-rc.21`). The table is `"PolizyTuple"` with camelCase columns matching the Prisma 6 and 7 layout, so an existing Prisma 6 or 7 table can be reused.

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

  </TabItem>
</Tabs>

---

## 3. Run migrations and code generation

<Tabs>
  <TabItem value="prisma6" label="Prisma 6" default>

```bash
# Create and apply a migration
npx prisma migrate dev --name add_polizy_tuples

# Or push schema changes directly
npx prisma db push

# Generate client types
npx prisma generate
```

  </TabItem>
  <TabItem value="prisma7" label="Prisma 7">

In Prisma 7, the datasource URL lives in `prisma.config.ts`. Both the `prisma-client` and `prisma-client-js` generators work.

```bash
npx prisma migrate dev --name add_polizy_tuples
npx prisma generate
```

  </TabItem>
  <TabItem value="prisma8" label="Prisma 8">

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

Emit `contract.json` and `contract.d.ts` next to the contract, then update the database:

```bash
npx prisma contract emit
npx prisma db update
```

`prisma db update` also creates the tables in an empty database.

  </TabItem>
</Tabs>

---

## 4. Import and configure the adapter

:::important

`PrismaAdapter` (and its alias `PrismaStorageAdapter`) is a **factory function**, not a class. Call it directly; do not use `new`.

:::

<Tabs>
  <TabItem value="prisma6" label="Prisma 6" default>

```ts
import { AuthSystem } from "polizy";
import { PrismaAdapter } from "polizy/prisma-storage";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const storage = PrismaAdapter(prisma);

const authz = new AuthSystem({
  schema,
  storage,
});
```

  </TabItem>
  <TabItem value="prisma7" label="Prisma 7">

Prisma 7 takes a driver adapter on `PrismaClient`. `PrismaAdapter(prisma)` and `PrismaAdapter(tx)` type-check against generated Prisma 7 types without casts.

```ts
import { AuthSystem } from "polizy";
import { PrismaAdapter } from "polizy/prisma-storage";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});
const storage = PrismaAdapter(prisma);

const authz = new AuthSystem({
  schema,
  storage,
});
```

  </TabItem>
  <TabItem value="prisma8" label="Prisma 8">

```ts
import { AuthSystem } from "polizy";
import postgres from "@prisma/orm-postgres/runtime";
import { contractFromJson } from "@prisma/orm-postgres/static";
import { PrismaAdapter } from "polizy/prisma-storage";
import type { Contract } from "./prisma/contract.d.ts";
import contractJson from "./prisma/contract.json" with { type: "json" };

const db = postgres({
  contract: contractFromJson<Contract>(contractJson),
  url: process.env.DATABASE_URL,
});
const storage = PrismaAdapter(db);

const authz = new AuthSystem({
  schema,
  storage,
});
```

  </TabItem>
</Tabs>

---

## 5. Enable Strong Consistency (PostgreSQL)

By default, queries in polizy run as live reads. When you pass `consistency: "strong"`, a root-client adapter runs the operation inside `withSnapshot`, opening an interactive transaction so all reads see one point-in-time snapshot.

On PostgreSQL, configure `snapshotIsolationLevel: "RepeatableRead"` so snapshot reads do not block concurrent writes:

```ts
const storage = PrismaAdapter(prisma, {
  snapshotIsolationLevel: "RepeatableRead",
});
```

On Prisma 8, `snapshotIsolationLevel` is honored starting in `@prisma/orm-postgres` `8.0.0-rc.25`. Earlier release candidates (such as `rc.21`) ignore the isolation level, so `withSnapshot` runs at `READ COMMITTED`.

For SQLite, leave `snapshotIsolationLevel` unset because SQLite read transactions are already snapshots.

### Customizing Transaction Timeouts

Use `transactionOptions` to configure the interactive transaction used by `withSnapshot`:

```ts
const storage = PrismaAdapter(prisma, {
  snapshotIsolationLevel: "RepeatableRead",
  transactionOptions: {
    maxWait: 5000, // Prisma 6/7 only: time (in ms) to wait for a connection (default: 2000)
    timeout: 10000, // Timeout (in ms) for the snapshot transaction (default: 5000 in Prisma 6/7)
  },
});
```

- **Prisma 6 and 7**: Both `maxWait` and `timeout` are passed to `prisma.$transaction`.
- **Prisma 8**: `timeout` is passed to `db.transaction`. Prisma 8 has no `maxWait`, so `maxWait` is ignored.

For more details on read scopes and strong consistency, see **[Consistency & Read-After-Write](../performance/consistency.md)**.

---

## 6. Passing a Transaction Client

Both `PrismaAdapter` and `PrismaRoleCatalog` accept an active transaction client instead of a root client:

- **Prisma 6 and 7**: the `tx` from `prisma.$transaction(async (tx) => ...)`.
- **Prisma 8**: the `tx` from `db.transaction(async (tx) => ...)`.

When given a transaction client:

1. Every read and write runs on that transaction, using its isolation level, its RLS / `set_config` settings, and its uncommitted writes.
2. The adapter does **not** expose `withSnapshot`, so `consistency: "strong"` reads also run on the caller's transaction instead of opening a separate connection.
3. `write()` executes its upserts in sequence on the caller's transaction, so tuple writes are atomic with the transaction and roll back if it rolls back.

Prisma marks its own transaction clients (Prisma 6/7: an internal transaction symbol; Prisma 8: the `invalidated` flag on `tx`), and polizy treats a client with that mark as a transaction client. Any other client (a root client, an `$extends` client, or your own wrapper) is a root client: writes run in one transaction through its `$transaction` / `transaction()`, and it gets `withSnapshot`. Pass Prisma's `tx` itself, not a wrapper around it. An object that is neither (no transaction mark and no `$transaction` / `transaction()` method) is rejected when the adapter is created, because its writes could not be atomic.

<Tabs>
  <TabItem value="prisma6-7-tx" label="Prisma 6 & 7" default>

```ts
await prisma.$transaction(async (tx) => {
  const authz = new AuthSystem({ storage: PrismaAdapter(tx), schema });
  if (!(await authz.check({ who, canThey: "edit", onWhat }))) {
    throw new Error("forbidden");
  }
  // ... your writes on tx
});
```

  </TabItem>
  <TabItem value="prisma8-tx" label="Prisma 8">

```ts
await db.transaction(
  async (tx) => {
    const authz = new AuthSystem({ storage: PrismaAdapter(tx), schema });
    if (!(await authz.check({ who, canThey: "edit", onWhat }))) {
      throw new Error("forbidden");
    }
    // ... your writes on tx
  },
  { isolationLevel: "RepeatableRead", timeout: 10000 },
);
```

  </TabItem>
</Tabs>

---

## 7. Role Catalog (`PrismaRoleCatalog`)

If you use `RoleRegistry` with a persistent catalog, `PrismaRoleCatalog` accepts the same Prisma 6, 7, and 8 root and transaction clients as `PrismaAdapter` and reads/writes the `PolizyRole` table:

```ts
import { RoleRegistry } from "polizy";
import { PrismaAdapter, PrismaRoleCatalog } from "polizy/prisma-storage";

const storage = PrismaAdapter(client);
const catalog = PrismaRoleCatalog(client);

const roles = new RoleRegistry(authz, schema, { catalog });
```
