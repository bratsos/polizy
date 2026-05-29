# Advanced Usage

## Field-Level Permissions

Polizy supports field-level permissions using a separator character (default: `#`).

### How It Works

When you check access to an object with a field separator, Polizy checks:
1. The specific field: `document:doc1#salary`
2. Falls back to the base object: `document:doc1`

```typescript
// Grant general access to the employee record
await authz.allow({
  who: alice,
  toBe: "viewer",
  onWhat: { type: "employee", id: "emp1" }
});

// Grant access to the salary field specifically
await authz.allow({
  who: hrManager,
  toBe: "viewer",
  onWhat: { type: "employee", id: "emp1#salary" }
});
```

### Checking Field Access

```typescript
// Alice can view the general record
await authz.check({
  who: alice,
  canThey: "view",
  onWhat: { type: "employee", id: "emp1" }
}); // => true

// Alice CANNOT view the salary field (no specific permission)
await authz.check({
  who: alice,
  canThey: "view",
  onWhat: { type: "employee", id: "emp1#salary" }
}); // => false (only checks emp1#salary, not emp1)

// HR Manager can view the salary field
await authz.check({
  who: hrManager,
  canThey: "view",
  onWhat: { type: "employee", id: "emp1#salary" }
}); // => true
```

### Implementing in Your Application

Polizy checks field permissions, but your application must:
1. Know which fields are sensitive
2. Make the right authorization check
3. Filter response data

```typescript
// In your API handler
async function getEmployee(userId: string, employeeId: string) {
  const user = { type: "user", id: userId };
  const employee = { type: "employee", id: employeeId };

  // Check base access
  const canView = await authz.check({
    who: user,
    canThey: "view",
    onWhat: employee
  });

  if (!canView) {
    throw new ForbiddenError("Cannot view this employee");
  }

  // Get the data
  const data = await db.getEmployee(employeeId);

  // Check sensitive field access
  const sensitiveFields = ["salary", "ssn", "bankAccount"];
  for (const field of sensitiveFields) {
    const canViewField = await authz.check({
      who: user,
      canThey: "view",
      onWhat: { type: "employee", id: `${employeeId}#${field}` }
    });

    if (!canViewField) {
      delete data[field];  // Redact if no access
    }
  }

  return data;
}
```

### Custom Field Separator

If your IDs contain `#`, use a different separator:

```typescript
const authz = new AuthSystem({
  storage,
  schema,
  fieldSeparator: "::"  // Use :: instead of #
});

// Now use :: for fields
await authz.allow({
  who: alice,
  toBe: "viewer",
  onWhat: { type: "doc", id: "project::budget" }
});
```

### Nested Fields

Multiple separators are supported (uses the last one):

```typescript
// Permission on "doc1#section1"
await authz.allow({
  who: alice,
  toBe: "editor",
  onWhat: { type: "doc", id: "doc1#section1" }
});

// Check "doc1#section1#paragraph2"
await authz.check({
  who: alice,
  canThey: "edit",
  onWhat: { type: "doc", id: "doc1#section1#paragraph2" }
});
// Falls back to: doc1#section1 (last separator), not doc1
```

## Configurable Logging

Redirect authorization warnings to your logging system:

```typescript
import { AuthSystem, Logger } from "polizy";
import winston from "winston";

const winstonLogger = winston.createLogger({
  level: "warn",
  transports: [new winston.transports.Console()]
});

const polizyLogger: Logger = {
  warn: (message) => winstonLogger.warn(message)
};

const authz = new AuthSystem({
  storage,
  schema,
  logger: polizyLogger
});
```

### Capturing Warnings for Monitoring

```typescript
const warnings: string[] = [];

const authz = new AuthSystem({
  storage,
  schema,
  logger: {
    warn: (msg) => {
      warnings.push(msg);
      console.warn(msg);  // Still log to console
    }
  }
});

// Later: send warnings to monitoring
setInterval(() => {
  if (warnings.length > 0) {
    sendToMonitoring(warnings.splice(0));
  }
}, 60000);
```

## Error Handling with throwOnMaxDepth

By default, when the depth limit is exceeded, Polizy returns `false`. Enable throwing for better debugging:

```typescript
const authz = new AuthSystem({
  storage,
  schema,
  defaultCheckDepth: 10,
  throwOnMaxDepth: true  // Throw instead of returning false
});

try {
  await authz.check({ who: user, canThey: "view", onWhat: doc });
} catch (error) {
  if (error instanceof MaxDepthExceededError) {
    console.error("Permission check too deep:", {
      subject: error.subject,
      action: error.action,
      object: error.object,
      depth: error.depth
    });
    // Investigate: circular groups? Too deep nesting?
  }
}
```

**When to use:**
- Development: Always enable to catch design issues
- Production: Consider enabling with proper error handling
- Testing: Enable to fail fast on configuration problems

## Performance Optimization

### 1. Minimize Group Nesting

Each group level adds database queries:

```
User in 2 groups: 2-3 queries
User in 2 groups, each in 2 more: 6-7 queries
User in 2 groups, each in 2 more, each in 2 more: 14-15 queries
```

**Recommendation:** Keep nesting to 2-3 levels maximum.

### 2. Use Hierarchies Instead of Many Direct Permissions

Instead of granting access to 100 files individually:

```typescript
// Bad: 100 tuples
for (const file of files) {
  await authz.allow({ who: user, toBe: "viewer", onWhat: file });
}
```

Use a folder hierarchy:

```typescript
// Good: 1 tuple + hierarchy setup
await authz.allow({ who: user, toBe: "viewer", onWhat: folder });
```

### 3. Cache Check Results (With Caution)

For read-heavy workloads, consider caching:

```typescript
import { LRUCache } from "lru-cache";

const permissionCache = new LRUCache<string, boolean>({
  max: 10000,
  ttl: 60000  // 1 minute
});

async function cachedCheck(who: Subject, action: string, onWhat: AnyObject) {
  const key = `${who.type}:${who.id}|${action}|${onWhat.type}:${onWhat.id}`;

  let result = permissionCache.get(key);
  if (result !== undefined) {
    return result;
  }

  result = await authz.check({ who, canThey: action, onWhat });
  permissionCache.set(key, result);
  return result;
}
```

**Cache invalidation triggers:**
- `allow()` - Invalidate subject's permissions
- `disallowAllMatching()` - Invalidate affected permissions
- `addMember()` / `removeMember()` - Invalidate member's permissions
- `setParent()` / `removeParent()` - Invalidate hierarchy descendants

### 4. Batch Permission Grants

Use `writeTuple` for bulk operations:

```typescript
// For many permissions at once
const tuples = users.map(user => ({
  subject: user,
  relation: "viewer",
  object: document
}));

// Write in parallel (if your storage supports it)
await Promise.all(tuples.map(t => authz.writeTuple(t)));
```

### 5. Use listAccessibleObjects Wisely

`listAccessibleObjects` is powerful but can be expensive:

```typescript
// This queries ALL tuples and checks each potential object
const result = await authz.listAccessibleObjects({
  who: user,
  ofType: "document"
});
```

**For better performance:**
- Add action filter to reduce checks: `canThey: "edit"`
- Set `maxDepth` to limit recursion depth
- Consider pagination in your application layer

## Time-Based Access Patterns

### Scheduled Access

Grant access that starts in the future:

```typescript
// New hire starts Monday
await authz.allow({
  who: newHire,
  toBe: "viewer",
  onWhat: internalDocs,
  when: {
    validSince: new Date("2024-02-05T09:00:00Z")
  }
});
```

### Expiring Access

Access that automatically expires:

```typescript
// Contractor for Q1
await authz.allow({
  who: contractor,
  toBe: "editor",
  onWhat: project,
  when: {
    validUntil: new Date("2024-03-31T23:59:59Z")
  }
});
```

### Time Windows

Access only during specific periods:

```typescript
// Access only during January
await authz.allow({
  who: auditor,
  toBe: "viewer",
  onWhat: financialRecords,
  when: {
    validSince: new Date("2024-01-01T00:00:00Z"),
    validUntil: new Date("2024-01-31T23:59:59Z")
  }
});
```

### Important: Conditions Are Not Automatically Cleaned Up

Expired tuples remain in storage. You should:

1. Periodically clean up expired tuples
2. Or: Let them accumulate (they're ignored in checks)

```typescript
// Cleanup job (run periodically)
async function cleanupExpiredTuples() {
  const allTuples = await authz.listTuples({});
  const now = new Date();

  for (const tuple of allTuples) {
    if (tuple.condition?.validUntil && tuple.condition.validUntil < now) {
      await authz.disallowAllMatching({
        who: tuple.subject,
        was: tuple.relation,
        onWhat: tuple.object
      });
    }
  }
}
```

## Multi-Instance Considerations

When running multiple application instances:

### With Prisma Adapter (Recommended)

All instances share the same database - authorization is consistent.

### With In-Memory Adapter

Each instance has its own storage - **not suitable for production** unless:
- Single instance deployment
- You implement your own synchronization
- Used only for testing

## Testing Authorization

### Unit Testing Schemas

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AuthSystem, InMemoryStorageAdapter, defineSchema } from "polizy";

describe("authorization", () => {
  it("owners can delete", async () => {
    const schema = defineSchema({
      relations: {
        owner: { type: "direct" },
        viewer: { type: "direct" }
      },
      actionToRelations: {
        delete: ["owner"],
        view: ["owner", "viewer"]
      }
    });

    const storage = new InMemoryStorageAdapter();
    const authz = new AuthSystem({ storage, schema });

    const alice = { type: "user", id: "alice" };
    const doc = { type: "document", id: "doc1" };

    await authz.allow({ who: alice, toBe: "owner", onWhat: doc });

    const canDelete = await authz.check({
      who: alice,
      canThey: "delete",
      onWhat: doc
    });

    assert.strictEqual(canDelete, true);
  });

  it("viewers cannot delete", async () => {
    // Similar test for negative case
  });
});
```

### Testing Group Inheritance

```typescript
it("group members inherit permissions", async () => {
  const alice = { type: "user", id: "alice" };
  const team = { type: "team", id: "engineering" };
  const doc = { type: "document", id: "doc1" };

  await authz.addMember({ member: alice, group: team });
  await authz.allow({ who: team, toBe: "editor", onWhat: doc });

  const canEdit = await authz.check({
    who: alice,
    canThey: "edit",
    onWhat: doc
  });

  assert.strictEqual(canEdit, true);
});
```

## Next Steps

- **[Troubleshooting](./troubleshooting.md)** - Common issues and solutions
- **[Examples](../../src/scenarios/)** - Real-world scenario tests
