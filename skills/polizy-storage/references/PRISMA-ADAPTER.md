# Prisma Adapter Setup

Complete guide for setting up the Prisma storage adapter.

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
  id String @id @default(uuid())

  // Subject (who)
  subjectType String  // e.g., 'user', 'team'
  subjectId   String  // e.g., 'alice', 'team-alpha'

  // Relation (what relationship)
  relation String     // e.g., 'owner', 'member', 'parent'

  // Object (what)
  objectType String   // e.g., 'document', 'folder'
  objectId   String   // e.g., 'doc1', 'folder-a'

  // Optional: Time-based conditions
  condition Json?     // { validSince?: Date, validUntil?: Date }

  // Metadata
  createdAt DateTime @default(now())

  // Constraints
  @@unique([subjectType, subjectId, relation, objectType, objectId])

  // Indexes for query performance
  @@index([subjectType, subjectId, relation])
  @@index([objectType, objectId, relation])
  @@index([relation])
}
```

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

## Custom Model Name

If your model is named differently:

```typescript
// Your Prisma model is called "AuthorizationTuple"
const storage = PrismaAdapter(prisma, {
  modelName: "authorizationTuple"  // camelCase of model name
});
```

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
  id String @id @default(uuid())

  subjectType String
  subjectId   String
  relation    String
  objectType  String
  objectId    String
  condition   String?  // SQLite stores JSON as text

  createdAt DateTime @default(now())

  @@unique([subjectType, subjectId, relation, objectType, objectId])
  @@index([subjectType, subjectId, relation])
  @@index([objectType, objectId, relation])
}
```

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

  // Grant permission (manually using tx)
  await tx.polizyTuple.create({
    data: {
      subjectType: "user",
      subjectId: userId,
      relation: "owner",
      objectType: "document",
      objectId: doc.id,
    }
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

### Unique constraint violation

```typescript
// Tuple already exists - this is usually fine
// The tuple is idempotent

// If you need to update condition, delete first:
await authz.disallowAllMatching({
  who: user,
  was: "editor",
  onWhat: doc
});

await authz.allow({
  who: user,
  toBe: "editor",
  onWhat: doc,
  when: { validUntil: newDate }
});
```

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
