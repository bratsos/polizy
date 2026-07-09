---
title: Prisma Storage
sidebar_position: 2
---

# Prisma Storage

The **Prisma Storage Adapter** is the recommended adapter for persisting relationship facts (tuples) in production. It maps polizy's tuple structure to a database table managed by your Prisma schema.

Because the Prisma adapter is kept in a separate subpath (`polizy/prisma-storage`), the core `polizy` package does not depend directly on `@prisma/client`. This ensures your bundle stays small if you are using polizy elsewhere (like in tests or in the browser) without Prisma.

---

## 1. Install dependencies

Ensure you have `@prisma/client` and `prisma` installed in your project:

```bash
npm install @prisma/client
npm install --save-dev prisma
```

---

## 2. Define the model in your schema

Add the `PolizyTuple` model to your `schema.prisma` file. 

:::warning

You must copy this model structure exactly. The compound `@@unique` constraint is **required** to ensure that granting permissions is idempotent (i.e., writing an existing tuple updates its condition rather than creating a duplicate). The `@@index` fields are critical for query performance.

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
```

---

## 3. Run migrations and code generation

Apply the schema changes to your database and regenerate your Prisma Client:

```bash
# Create and apply a migration (for development databases with migrations)
npx prisma migrate dev --name add_polizy_tuples

# Or push schema changes directly (for quick prototyping)
npx prisma db push

# Generate client types
npx prisma generate
```

---

## 4. Import and configure the adapter

Configure the `AuthSystem` with the Prisma adapter. 

:::important

`PrismaStorageAdapter` is a **factory function**, not a class. Call it directly to create the adapter; do not use the `new` keyword.

:::

```ts
import { AuthSystem } from "polizy";
import { PrismaStorageAdapter } from "polizy/prisma-storage";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Create the adapter using the factory function
const storage = PrismaStorageAdapter(prisma);

// Alternatively, you can use the original PrismaAdapter import:
// import { PrismaAdapter } from "polizy/prisma-storage";
// const storage = PrismaAdapter(prisma);

const authz = new AuthSystem({
  schema,
  storage,
});
```

---

## 5. Enable Strong Consistency (PostgreSQL)

By default, queries in polizy are executed with live reads. If you require point-in-time consistency across multi-step permission checks, you can query with `consistency: "strong"`. 

To support strong consistency without blocking concurrent database writes on PostgreSQL, configure the adapter with the `snapshotIsolationLevel` option set to `"RepeatableRead"`:

```ts
const storage = PrismaStorageAdapter(prisma, {
  snapshotIsolationLevel: "RepeatableRead",
});
```

With MVCC (Multi-Version Concurrency Control) databases like PostgreSQL, this ensures that reads in a strong-consistency check are served from a single consistent snapshot, without readers blocking writers or writers blocking readers. 

### Customizing Transaction Timeouts

You can also specify `transactionOptions` to configure the interactive database transaction that handles point-in-time snapshots behind the scenes:

```ts
const storage = PrismaStorageAdapter(prisma, {
  snapshotIsolationLevel: "RepeatableRead",
  transactionOptions: {
    maxWait: 5000, // Time (in ms) to wait for a connection (default: 2000)
    timeout: 10000, // Timeout (in ms) for the snapshot transaction (default: 5000)
  },
});
```

Raising these values is recommended for running strong-consistency list operations over large datastores where queries might take longer to resolve, preventing premature transaction timeouts.

For SQLite, this option can be left unset, as SQLite's default read transactions are already snapshots.

For more details on read scopes and strong consistency, see **[Consistency & Read-After-Write](../performance/consistency.md)**.
