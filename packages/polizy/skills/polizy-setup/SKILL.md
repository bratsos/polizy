---
name: polizy-setup
description: Setup and installation guide for the polizy authorization library. Use when adding authorization to a project, installing polizy, choosing a storage adapter (InMemory or Prisma), constructing AuthSystem, or integrating polizy for the first time.
license: MIT
metadata:
  author: bratsos
  version: "0.2.0"
  repository: https://github.com/bratsos/polizy
---

# Polizy Setup

Guide for installing and configuring polizy in your project.

## When to Apply

- User says "add authorization to my project"
- User says "install polizy" or "set up polizy"
- User has no existing polizy configuration
- User asks about initial setup or storage selection
- User is starting a new project with authorization needs

## Priority Table

| Priority | Task | Notes |
|----------|------|-------|
| Critical | Install package | `npm install polizy` |
| Critical | Define schema | Relations, actions, mappings |
| Critical | Choose storage | InMemory (dev) or Prisma (prod) |
| Important | Test setup | Verify with a permission check |
| Optional | Configure options | Depth behavior, logger, field separator |

## Step-by-Step Setup

### Step 1: Install

```bash
npm install polizy
# or
pnpm add polizy
# or
yarn add polizy
```

Requires **Node >= 22.11.0**. polizy ships both ESM and CJS builds. The Prisma
adapter needs `@prisma/client` (an **optional** peer dependency) — install it only
if you use persistent storage:

```bash
npm install @prisma/client && npm install -D prisma
```

### Step 2: Define Schema

Create your authorization model:

```typescript
import { defineSchema } from "polizy";

const schema = defineSchema({
  // Define relationship types
  relations: {
    owner: { type: "direct" },    // Direct user → resource
    editor: { type: "direct" },
    viewer: { type: "direct" },
    member: { type: "group" },    // Group membership
    parent: { type: "hierarchy" } // Folder → file
  },

  // Map actions to relations that grant them
  actionToRelations: {
    delete: ["owner"],
    edit: ["owner", "editor"],
    view: ["owner", "editor", "viewer"]
  },

  // Optional: How permissions propagate through hierarchies
  hierarchyPropagation: {
    view: ["view"],  // view on parent → view on children
    edit: ["edit"]
  }
});
```

### Step 3: Choose Storage Adapter

**For development/testing:**
```typescript
import { InMemoryStorageAdapter } from "polizy";

const storage = new InMemoryStorageAdapter();
```

**For production (Prisma):**
```typescript
import { PrismaStorageAdapter } from "polizy/prisma-storage"; // alias of PrismaAdapter
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const storage = PrismaStorageAdapter(prisma); // factory function — call it, no `new`
```

The Prisma adapter lives on the `polizy/prisma-storage` subpath (the core `polizy`
entry never imports `@prisma/client`, so it stays an optional peer dependency).
`PrismaStorageAdapter` is a **factory function**, not a class — call it directly,
do not `new` it. `PrismaAdapter` is the same function under its original name.

This requires a `PolizyTuple` model (with a compound `@@unique` constraint) plus a
`prisma generate` + migrate step. See [PRISMA-SETUP.md](references/PRISMA-SETUP.md)
for the model, migration commands, and details.

### Step 4: Create AuthSystem

```typescript
import { AuthSystem } from "polizy";

const authz = new AuthSystem({
  storage,
  schema,
  // All of the following are optional — see "Configuration Options" below.
});
```

### Step 5: Verify Setup

```typescript
// Grant a permission
await authz.allow({
  who: { type: "user", id: "alice" },
  toBe: "owner",
  onWhat: { type: "document", id: "doc1" }
});

// Check it works
const canEdit = await authz.check({
  who: { type: "user", id: "alice" },
  canThey: "edit",
  onWhat: { type: "document", id: "doc1" }
});

console.log("Setup working:", canEdit); // true
```

## Storage Decision Matrix

| Factor | InMemoryStorageAdapter | PrismaStorageAdapter |
|--------|----------------------|---------------|
| Construction | `new InMemoryStorageAdapter()` | `PrismaStorageAdapter(prisma)` (factory, no `new`) |
| Import | `from "polizy"` | `from "polizy/prisma-storage"` |
| Persistence | No (lost on restart) | Yes |
| Multi-instance | No | Yes |
| Setup | Zero config | `PolizyTuple` model + `@@unique` + migrate |
| Performance | Fastest | Database-dependent |
| Use case | Testing, dev | Production |

Both adapters honor an identical, contract-tested behavior, so you can develop
against `InMemoryStorageAdapter` and swap in Prisma for production without
changing your authorization logic. For custom adapters and performance tuning,
see **[polizy-storage](../polizy-storage/SKILL.md)**.

## Complete Minimal Setup

```typescript
// auth.ts
import {
  defineSchema,
  AuthSystem,
  InMemoryStorageAdapter
} from "polizy";

const schema = defineSchema({
  relations: {
    owner: { type: "direct" },
    viewer: { type: "direct" },
  },
  actionToRelations: {
    edit: ["owner"],
    view: ["owner", "viewer"],
  },
});

const storage = new InMemoryStorageAdapter();

export const authz = new AuthSystem({ storage, schema });
```

## Configuration Options

```typescript
const authz = new AuthSystem({
  storage,
  schema,

  // Optional: max group/hierarchy traversal depth per check (default: 20)
  defaultCheckDepth: 20,

  // Optional: what happens when a check exceeds defaultCheckDepth.
  //   "throw" (default) → throws MaxDepthExceededError
  //   "deny"            → returns false (the silent behavior 0.1.x always had)
  maxDepthBehavior: "throw",

  // Optional: field separator for field-level permissions.
  // Overrides the schema's separator; falls back to the schema's, then "#".
  fieldSeparator: "#",

  // Optional: logger for depth/empty-filter warnings.
  // Defaults to a NO-OP — the library never writes to console on its own.
  // `console` satisfies the Logger interface { warn, error, debug? }.
  logger: console,
});
```

> **0.2.0 changes:** the depth option is now controlled by `maxDepthBehavior:
> "throw" | "deny"` (the old `throwOnMaxDepth` boolean no longer exists), the
> default depth rose from 10 to 20, and the library no longer logs to `console`
> unless you pass a `logger`. Pass `maxDepthBehavior: "deny"` to keep the old
> silent-deny-on-depth behavior.

## Common Issues

| Issue | Solution |
|-------|----------|
| "Cannot find module 'polizy'" | Run `npm install polizy` (Node >= 22.11.0 required) |
| TypeScript errors in schema | Ensure `defineSchema` is imported from `"polizy"` |
| "PrismaStorageAdapter is not a constructor" | It is a factory: `PrismaStorageAdapter(prisma)`, not `new PrismaStorageAdapter(...)` |
| `PrismaStorageAdapter` not found on `"polizy"` | Import it from `"polizy/prisma-storage"`, not the core entry |
| Prisma model / unique-constraint errors | See [PRISMA-SETUP.md](references/PRISMA-SETUP.md) — add the `@@unique` and run `prisma generate` + migrate |
| `SchemaError` at startup | An action maps to an undefined relation, or `hierarchyPropagation` references an undefined action — fix the dangling reference |
| `MaxDepthExceededError` thrown | A check exceeded `defaultCheckDepth` (20); deepen it, fix a cycle, or set `maxDepthBehavior: "deny"` |
| Permission check returns false | Verify the relation is listed in `actionToRelations` for that action |

## Already on polizy 0.1.x?

If you are upgrading an existing project rather than setting up fresh, follow the
migration guide instead of this skill — the Prisma import/factory and the
`@@unique` constraint changed, depth-exceeded now throws, `defineSchema` throws
on bad models, and the library stopped logging to `console`. See
[migrate-0.1-to-0.2.md](../polizy/migrations/migrate-0.1-to-0.2.md).

## Next Steps

After setup, use these skills:
- **[polizy-schema](../polizy-schema/SKILL.md)** - Design your authorization model (relations, actions, multiple group/hierarchy relations, field-level objects)
- **[polizy-patterns](../polizy-patterns/SKILL.md)** - Implement authorization scenarios
- **[polizy-storage](../polizy-storage/SKILL.md)** - Production storage setup, custom adapters, performance

## References

- [PRISMA-SETUP.md](references/PRISMA-SETUP.md) - Full Prisma configuration
- [FRAMEWORK-INTEGRATIONS.md](references/FRAMEWORK-INTEGRATIONS.md) - Next.js, Express examples
