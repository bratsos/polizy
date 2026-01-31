# Prisma Setup for Polizy

## Prerequisites

```bash
npm install @prisma/client
npm install -D prisma
```

## Prisma Model

Add this model to your `prisma/schema.prisma`:

```prisma
model PolizyTuple {
  id String @id @default(uuid())

  subjectType String  // e.g., 'user', 'team'
  subjectId   String  // e.g., 'alice', 'team-alpha'
  relation    String  // e.g., 'owner', 'member', 'parent'
  objectType  String  // e.g., 'document', 'folder'
  objectId    String  // e.g., 'doc1', 'folder-a'
  condition   Json?   // Optional: time-based conditions

  createdAt DateTime @default(now())

  // Ensure each relationship is unique
  @@unique([subjectType, subjectId, relation, objectType, objectId])

  // Index for finding relationships FOR a subject
  @@index([subjectType, subjectId, relation])

  // Index for finding relationships ON an object
  @@index([objectType, objectId, relation])
}
```

## Generate and Migrate

```bash
# Development: Push schema directly
npx prisma db push

# Production: Create migration
npx prisma migrate dev --name add_polizy_tuples
npx prisma generate
```

## Using the Adapter

```typescript
import { AuthSystem } from "polizy";
import { PrismaAdapter } from "polizy/prisma-storage";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const storage = PrismaAdapter(prisma);

const authz = new AuthSystem({ storage, schema });
```

## Custom Model Name

If your model is named differently:

```typescript
const storage = PrismaAdapter(prisma, {
  model: "AuthorizationTuple" // Custom model name
});
```

## Multiple Databases

For multi-tenant setups with separate databases:

```typescript
function getAuthzForTenant(tenantId: string) {
  const prisma = new PrismaClient({
    datasources: {
      db: { url: getTenantDbUrl(tenantId) }
    }
  });

  return new AuthSystem({
    storage: PrismaAdapter(prisma),
    schema
  });
}
```

## Index Recommendations

For high-volume applications, consider additional indexes:

```prisma
model PolizyTuple {
  // ... fields ...

  // For listAccessibleObjects queries
  @@index([objectType, relation])

  // For group membership lookups
  @@index([relation, objectType, objectId])
}
```

## Troubleshooting

### "Table 'PolizyTuple' doesn't exist"

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

### Slow queries

1. Verify indexes are created
2. Check `npx prisma migrate status`
3. Run `EXPLAIN ANALYZE` on slow queries
