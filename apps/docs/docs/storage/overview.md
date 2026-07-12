---
title: Storage Adapters
sidebar_position: 1
---

# Storage Adapters

In **polizy**, relationship facts (tuples) are not stored directly in the core engine. Instead, polizy delegates all reading, writing, and deleting of tuples to a **Storage Adapter**. This decoupling keeps polizy extremely lightweight and allows it to run in any environment—from local testing in memory to serverless functions and production databases.

## What is stored?

An adapter is responsible for the persistence of relationship **tuples**. A tuple represents a fact about how a subject relates to an object:

```
(subject)        (relation)   (object)
{user: "alice"}   owner        {document: "readme"}
```

Every time you modify permissions (via `authz.allow()` or `authz.disallowAllMatching()`) or run check queries (via `authz.check()`), the engine coordinates with the configured storage adapter.

---

## Built-in Adapters

polizy ships with two built-in storage adapters, covering development, testing, and production SQL databases.

### 1. In-Memory Storage (`InMemoryStorageAdapter`)

The `InMemoryStorageAdapter` stores all tuples in a local JavaScript map.

* **Best for:** Local development, unit testing, and learning the library.
* **Caveat:** All data is lost when your application or test process restarts.
* **Reference Safety:** Returns live references into its internal store. You should treat returned results as immutable. If you require an isolated, safe copy of the data, use `withSnapshot`.
* **Import path:** `import { InMemoryStorageAdapter } from "polizy"`

### 2. Prisma Storage (`PrismaStorageAdapter`)

The `PrismaStorageAdapter` persists tuples to your database using your existing Prisma client setup.

* **Best for:** Production applications, serverless deployments, and persistent state.
* **Caveat:** Requires `@prisma/client` as a peer dependency and a dedicated `PolizyTuple` model in your database schema.
* **Import path:** `import { PrismaStorageAdapter } from "polizy/prisma-storage"`

---

## Custom Adapters

If you use a database without a Prisma client (like Redis, DynamoDB, or MongoDB) or need to query tuples through an external API, you can write a custom adapter. Any object that implements the `StorageAdapter` interface can be passed directly to the `AuthSystem` constructor.

:::tip

When writing a custom adapter, you can import and run the published test suite from `polizy/storage-tests` to ensure your implementation behaves exactly like the built-in adapters. See [Writing a Custom Adapter](./custom-adapter.md#testing-your-adapter) for details.

:::

---

## Next Steps

Explore the following guides to configure and customize your storage layer:

* **[Prisma Storage](./prisma.md)** — Set up the Prisma storage adapter, define the database schema, and run migrations.
* **[Writing a Custom Adapter](./custom-adapter.md)** — Implement the custom storage adapter contract and run contract tests.
* **[StorageAdapter Reference](./adapter-reference.md)** — Reference tables for the storage interface methods and model requirements.
