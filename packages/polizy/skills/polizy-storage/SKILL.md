---
name: polizy-storage
description: Storage adapter setup for polizy authorization. Use when configuring InMemory, Prisma, or custom storage adapters, database setup, or performance optimization.
license: MIT
metadata:
  author: bratsos
  version: "0.3.0"
  repository: https://github.com/bratsos/polizy
---

# Polizy Storage

Storage adapters handle persistence of authorization tuples.

## When to Apply

- User asks "set up database storage"
- User asks "use Prisma with polizy"
- User asks "create custom storage adapter"
- User asks about "production storage"
- User has performance concerns with authorization

## Adapter Comparison

| Feature | InMemoryStorageAdapter | PrismaAdapter |
|---------|------------------------|---------------|
| Persistence | No (RAM only) | Yes (database) |
| Multi-instance | No | Yes |
| Setup | Zero config | Prisma model + `@@unique` required |
| Idempotent writes | Yes | Yes (upsert in a transaction) |
| Pagination | Yes (`limit`/`offset`) | Yes (`take`/`skip`) |
| Performance | Fastest | Good with indexes |
| Use case | Testing, dev | Production |

## Quick Setup

### InMemory (Development/Testing)

```typescript
import { AuthSystem, InMemoryStorageAdapter } from "polizy";

const storage = new InMemoryStorageAdapter();
const authz = new AuthSystem({ storage, schema });
```

### Prisma (Production)

```typescript
import { AuthSystem } from "polizy";
import { PrismaAdapter } from "polizy/prisma-storage";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const storage = PrismaAdapter(prisma);
const authz = new AuthSystem({ storage, schema });
```

**Requires Prisma model** - see [PRISMA-ADAPTER.md](references/PRISMA-ADAPTER.md)

## InMemoryStorageAdapter

### When to Use

- Unit tests
- Development environment
- Single-process applications
- Prototyping

### Behavior

- Data stored in JavaScript `Map`
- Lost on process restart
- No network latency
- Fastest possible reads

### Testing Example

```typescript
import { describe, it, beforeEach } from "node:test";
import { AuthSystem, InMemoryStorageAdapter, defineSchema } from "polizy";

describe("authorization", () => {
  let authz: AuthSystem<typeof schema>;

  beforeEach(() => {
    // Fresh storage for each test
    const storage = new InMemoryStorageAdapter();
    authz = new AuthSystem({ storage, schema });
  });

  it("grants access correctly", async () => {
    await authz.allow({
      who: { type: "user", id: "alice" },
      toBe: "owner",
      onWhat: { type: "doc", id: "doc1" }
    });

    const result = await authz.check({
      who: { type: "user", id: "alice" },
      canThey: "edit",
      onWhat: { type: "doc", id: "doc1" }
    });

    assert.strictEqual(result, true);
  });
});
```

## PrismaAdapter

### When to Use

- Production environments
- Multi-instance deployments
- Need audit trail
- Data must survive restarts

### Setup Steps

1. **Install dependencies**
   ```bash
   npm install @prisma/client
   npm install -D prisma
   ```

2. **Add Prisma model** (see [PRISMA-ADAPTER.md](references/PRISMA-ADAPTER.md))

3. **Run migrations**
   ```bash
   npx prisma migrate dev --name add_polizy
   ```

4. **Use adapter**
   ```typescript
   import { PrismaAdapter } from "polizy/prisma-storage";
   const storage = PrismaAdapter(prisma);
   ```

## Storage Interface

All adapters implement the same contract. The bundled `InMemoryStorageAdapter`
and `PrismaAdapter` are both held to it by a shared cross-adapter test suite, so
they behave identically:

```typescript
interface StorageAdapter<S, O> {
  // Idempotent on (subject, relation, object). Re-writing updates the
  // condition, never duplicates. Returns stored tuples in input order.
  write(tuples: InputTuple<S, O>[]): Promise<StoredTuple<S, O>[]>;

  // (who? subject==who) AND (was? relation==was)
  //   AND (onWhat? object==onWhat OR subject==onWhat).
  // An explicit `who` is never dropped — the subject-position arm of `onWhat`
  // only fires when `who` is absent. Returns the number deleted.
  delete(filter: {
    who?: Subject<S> | AnyObject<O>;
    was?: Relation;
    onWhat?: AnyObject<O>;
  }): Promise<number>;

  // Supports { limit, offset } pagination in stable order.
  findTuples(
    filter: Partial<InputTuple<S, O>>,
    options?: { limit?: number; offset?: number },
  ): Promise<StoredTuple<S, O>[]>;

  findSubjects(object, relation, options?: { subjectType?: S }): Promise<Subject<S>[]>;
  findObjects(subject, relation, options?: { objectType?: O }): Promise<AnyObject<O>[]>;
}
```

See [CUSTOM-ADAPTERS.md](references/CUSTOM-ADAPTERS.md) for the exact
idempotent-write, delete, and pagination semantics every adapter must honor.

## Common Patterns

### Shared Storage Instance

```typescript
// storage.ts
import { InMemoryStorageAdapter } from "polizy";
// or: import { PrismaAdapter } from "polizy/prisma-storage";

export const storage = new InMemoryStorageAdapter();
// or: export const storage = PrismaAdapter(prisma);

// auth.ts
import { AuthSystem } from "polizy";
import { storage } from "./storage";
import { schema } from "./schema";

export const authz = new AuthSystem({ storage, schema });
```

### Environment-Based Selection

```typescript
import { AuthSystem, InMemoryStorageAdapter } from "polizy";
import { PrismaAdapter } from "polizy/prisma-storage";
import { PrismaClient } from "@prisma/client";

function createStorage() {
  if (process.env.NODE_ENV === "test") {
    return new InMemoryStorageAdapter();
  }

  const prisma = new PrismaClient();
  return PrismaAdapter(prisma);
}

const storage = createStorage();
export const authz = new AuthSystem({ storage, schema });
```

## Performance Considerations

| Concern | Solution |
|---------|----------|
| Slow reads | Add indexes on `(subjectType, subjectId, relation)` and `(objectType, objectId, relation)` |
| Too many queries | Reduce group nesting depth |
| Large tuple counts | Periodic cleanup of expired tuples |
| Large `listTuples`/`listAccessibleObjects` results | Page with `{ limit, offset }` |
| Bulk grants | Use `allowMany(grants[])` or `storage.write(tuples[])` |

`check()` is memoized per call (no exponential blow-up on deep/wide group or
hierarchy graphs; cycles terminate), and `listAccessibleObjects` scales with the
subject's reachable set rather than scanning the whole tuple table. See
[PERFORMANCE.md](references/PERFORMANCE.md).

## Common Issues

| Issue | Solution |
|-------|----------|
| Data lost on restart | Switch from InMemory to Prisma |
| "Table doesn't exist" | Run `npx prisma migrate deploy` |
| `new PrismaStorageAdapter(...)` fails | It's a factory from `polizy/prisma-storage` — call it, don't `new` it |
| Upsert/idempotent write errors | Add `@@unique([subjectType, subjectId, relation, objectType, objectId])` and migrate |
| Migration fails on the new `@@unique` | Dedupe 0.2.x and earlier duplicate rows first (see migration guide) |
| Time-based grants threw on Prisma | Fixed in 0.3.0 — conditions revive `validSince`/`validUntil` to `Date` on read |
| Revocation removed too much | Fixed in 0.3.0 — both adapters keep an explicit `who` and no longer over-delete |
| Slow checks | Reduce group/hierarchy depth; index the two hot paths |
| Memory growing | Clean up expired conditional tuples |

## References

- [PRISMA-ADAPTER.md](references/PRISMA-ADAPTER.md) - Full Prisma setup
- [CUSTOM-ADAPTERS.md](references/CUSTOM-ADAPTERS.md) - Building custom adapters
- [PERFORMANCE.md](references/PERFORMANCE.md) - Optimization strategies

## Related Skills

- [polizy-setup](../polizy-setup/SKILL.md) - Initial setup
- [polizy-troubleshooting](../polizy-troubleshooting/SKILL.md) - Debugging
