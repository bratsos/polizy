# Storage Performance Optimization

Strategies for high-performance authorization at scale.

## What 0.3.0 already does for you

Two former cliffs are fixed in the engine — you do not need to work around them:

- **`check()` is memoized per call.** Within a single `check()`, each
  `(subject, relation, object)` subproblem is resolved once and reused. Deep and
  wide group/hierarchy graphs that share subgraphs resolve in roughly linear
  time instead of re-traversing exponentially, and **cycles terminate safely**
  (a membership loop no longer hangs or blows the stack). You can model real org
  graphs without hand-pruning them for performance.
- **`listAccessibleObjects` no longer full-scans the tuple table.** In 0.2.x and earlier it
  effectively did `findTuples({})` and filtered in memory. In 0.3.0 its cost
  scales with the **subject's reachable set** (the groups/folders they can
  traverse), not the total number of tuples in the system. Reverse expansion
  (`listSubjects`) is similarly bounded.

Memoization is per-call, not across calls — repeated identical `check()`s still
re-run. For that, add an application-level cache (see Caching Strategies below).

## Performance Factors

| Factor | Impact | Solution |
|--------|--------|----------|
| Group nesting depth | Medium | Memoized, but still costs DB round trips — keep reasonable |
| Hierarchy depth | Medium | Configure `defaultCheckDepth` (default 20) |
| Tuple count | Medium | Regular cleanup, good indexes |
| Query patterns | High | Proper database indexes |
| Large result sets | Medium | Paginate `listTuples` / `listAccessibleObjects` |
| Caching | High | Add caching layer (memoization is per-call only) |

## Database Indexes

### Essential Indexes

```prisma
model PolizyTuple {
  // ... fields ...

  // REQUIRED: Unique constraint — also the upsert target for idempotent writes
  @@unique([subjectType, subjectId, relation, objectType, objectId])

  // RECOMMENDED: Subject lookups (findObjects) — "what does this subject have?"
  @@index([subjectType, subjectId, relation])

  // RECOMMENDED: Object lookups (findSubjects) — "who has this object?"
  @@index([objectType, objectId, relation])
}
```

These two indexes are exactly the hot paths `check()` walks: it repeatedly asks
"what groups/parents does this subject have?" (`findObjects`) and "who are the
members of this group / what's the parent of this object?" (`findSubjects`).
With memoization each distinct lookup happens once per `check()`, so the index
quality of these two queries dominates check latency.

### High-Volume Indexes

```prisma
model PolizyTuple {
  // ... fields ...

  // For listAccessibleObjects
  @@index([objectType, relation])

  // For group membership queries
  @@index([relation, objectType, objectId])

  // For finding all user permissions
  @@index([subjectType, subjectId])

  // For finding all resource permissions
  @@index([objectType, objectId])
}
```

### SQL Index Creation

```sql
-- PostgreSQL
CREATE INDEX CONCURRENTLY idx_tuple_subject
ON polizy_tuple(subject_type, subject_id, relation);

CREATE INDEX CONCURRENTLY idx_tuple_object
ON polizy_tuple(object_type, object_id, relation);

-- Covering index for common query
CREATE INDEX CONCURRENTLY idx_tuple_check
ON polizy_tuple(subject_type, subject_id, relation, object_type, object_id);
```

## Query Analysis

### Identify Slow Queries

```sql
-- PostgreSQL: Enable slow query logging
ALTER SYSTEM SET log_min_duration_statement = 100;  -- Log queries > 100ms
SELECT pg_reload_conf();

-- Check query plan
EXPLAIN ANALYZE
SELECT * FROM polizy_tuple
WHERE subject_type = 'user'
AND subject_id = 'alice'
AND relation = 'member';
```

### Common Slow Query Patterns

| Pattern | Cause | Fix |
|---------|-------|-----|
| Sequential scan | Missing index | Add appropriate index |
| Many round trips | Wide reachable set / deep nesting | Reduce nesting; one round trip per unique node |
| Large result sets | No pagination | Page with `{ limit, offset }` |
| Condition evaluation | Many expired tuples | Cleanup old tuples |

## Reducing Group Nesting

### Problem

Each *distinct* group/parent in the reachable set costs a storage lookup. 0.3.0
memoization means a shared group is only visited **once per check** (no
exponential re-traversal of diamonds, and cycles terminate), so the cost is
proportional to the number of *unique* nodes reachable, not the number of paths:

```
User in 2 groups, each in 2 more, etc.:
  ~one findObjects per unique subject node +
  ~one findSubjects per unique group/parent node visited
```

The remaining cost is DB round trips, one per unique node. Flatter graphs and
fewer unique ancestors still mean fewer round trips.

### Solution

Keep organizational structure flat:

```typescript
// ❌ Bad: Deep hierarchy
user → team → department → division → region → country

// ✅ Good: Flat structure
user → team → organization
```

### Alternative: Direct Grants

For performance-critical paths, use direct grants:

```typescript
// Instead of relying on group traversal
await authz.addMember({ member: alice, group: engineering });
await authz.addMember({ member: engineering, group: company });
await authz.allow({ who: company, toBe: "viewer", onWhat: resource });

// Grant directly for hot paths
await authz.allow({ who: alice, toBe: "viewer", onWhat: resource });
```

## Caching Strategies

### Simple LRU Cache

```typescript
import { LRUCache } from "lru-cache";

const checkCache = new LRUCache<string, boolean>({
  max: 10000,       // Max entries
  ttl: 60 * 1000,   // 1 minute TTL
});

async function cachedCheck(
  who: Subject,
  canThey: string,
  onWhat: AnyObject
): Promise<boolean> {
  const key = `${who.type}:${who.id}|${canThey}|${onWhat.type}:${onWhat.id}`;

  const cached = checkCache.get(key);
  if (cached !== undefined) {
    return cached;
  }

  const result = await authz.check({ who, canThey, onWhat });
  checkCache.set(key, result);
  return result;
}
```

### Cache Invalidation

```typescript
class CachedAuthSystem {
  private authz: AuthSystem<any>;
  private cache: LRUCache<string, boolean>;

  constructor(authz: AuthSystem<any>) {
    this.authz = authz;
    this.cache = new LRUCache({ max: 10000, ttl: 60000 });
  }

  async check(params: CheckParams): Promise<boolean> {
    const key = this.getCacheKey(params);
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;

    const result = await this.authz.check(params);
    this.cache.set(key, result);
    return result;
  }

  async allow(params: AllowParams): Promise<void> {
    await this.authz.allow(params);
    // Invalidate affected cache entries
    this.invalidateForSubject(params.who);
  }

  async disallowAllMatching(params: DisallowParams): Promise<void> {
    await this.authz.disallowAllMatching(params);
    if (params.who) {
      this.invalidateForSubject(params.who);
    }
    if (params.onWhat) {
      this.invalidateForObject(params.onWhat);
    }
  }

  private invalidateForSubject(subject: Subject): void {
    const prefix = `${subject.type}:${subject.id}|`;
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
      }
    }
  }

  private invalidateForObject(object: AnyObject): void {
    const suffix = `|${object.type}:${object.id}`;
    for (const key of this.cache.keys()) {
      if (key.endsWith(suffix)) {
        this.cache.delete(key);
      }
    }
  }

  private getCacheKey(params: CheckParams): string {
    return `${params.who.type}:${params.who.id}|${params.canThey}|${params.onWhat.type}:${params.onWhat.id}`;
  }
}
```

### Redis Cache

```typescript
import Redis from "ioredis";

class RedisCachedCheck {
  private redis: Redis;
  private authz: AuthSystem<any>;
  private ttl: number;

  constructor(redis: Redis, authz: AuthSystem<any>, ttlSeconds = 60) {
    this.redis = redis;
    this.authz = authz;
    this.ttl = ttlSeconds;
  }

  async check(params: CheckParams): Promise<boolean> {
    const key = `polizy:check:${params.who.type}:${params.who.id}:${params.canThey}:${params.onWhat.type}:${params.onWhat.id}`;

    const cached = await this.redis.get(key);
    if (cached !== null) {
      return cached === "1";
    }

    const result = await this.authz.check(params);
    await this.redis.setex(key, this.ttl, result ? "1" : "0");
    return result;
  }

  async invalidateUser(userId: string): Promise<void> {
    const pattern = `polizy:check:user:${userId}:*`;
    const keys = await this.redis.keys(pattern);
    if (keys.length > 0) {
      await this.redis.del(...keys);
    }
  }
}
```

## Batch Operations

### Parallel Permission Grants

```typescript
// ❌ Slow: Sequential
for (const user of users) {
  await authz.allow({ who: user, toBe: "viewer", onWhat: doc });
}

// ✅ Fast: Parallel
await Promise.all(
  users.map(user =>
    authz.allow({ who: user, toBe: "viewer", onWhat: doc })
  )
);
```

### Bulk Writes (Custom Adapter)

```typescript
// If using custom adapter with bulk support
await storage.write(
  users.map(user => ({
    subject: user,
    relation: "viewer",
    object: doc,
  }))
);
```

## Pagination

`listTuples(filter, { limit, offset })` and
`listAccessibleObjects({ ..., limit, offset })` accept pagination. Use it for
admin/audit views and any background sweep — never load an unbounded list into
memory.

```typescript
// One page of a user's tuples
const page = await authz.listTuples(
  { subject: { type: "user", id: "alice" } },
  { limit: 50, offset: 0 },
);

// Page through accessible documents
const { accessible } = await authz.listAccessibleObjects({
  who: { type: "user", id: "alice" },
  ofType: "document",
  limit: 100,
  offset: 0,
});
```

Pages are returned in a stable order, so `offset`-stepping does not overlap or
skip rows. (`listAccessibleObjects` already scales with the subject's reachable
set rather than the whole table — pagination just bounds the response payload.)

## Cleanup Strategies

### Remove Expired Tuples

Page through tuples instead of loading them all at once:

```typescript
async function cleanupExpiredTuples(): Promise<number> {
  const now = new Date();
  const pageSize = 500;

  // Pass 1: page through and collect expired tuples (read-only, so offsets are
  // stable). Pass 2: delete. This avoids offsets shifting mid-scan as you delete.
  const expired: Array<{ subject: any; relation: string; object: any }> = [];
  for (let offset = 0; ; offset += pageSize) {
    const page = await authz.listTuples({}, { limit: pageSize, offset });
    if (page.length === 0) break;
    for (const t of page) {
      if (t.condition?.validUntil && t.condition.validUntil < now) {
        expired.push({ subject: t.subject, was: t.relation, object: t.object } as any);
      }
    }
  }

  for (const t of expired) {
    await authz.disallowAllMatching({ who: t.subject, was: t.was, onWhat: t.object });
  }
  return expired.length;
}

// Run daily
setInterval(cleanupExpiredTuples, 24 * 60 * 60 * 1000);
```

> For large tables, prefer the **Direct SQL Cleanup** below — a single
> `DELETE ... WHERE validUntil < NOW()` is far cheaper than reading every tuple
> through the adapter.

### Direct SQL Cleanup

```sql
-- Delete expired tuples
DELETE FROM polizy_tuple
WHERE condition->>'validUntil' IS NOT NULL
AND (condition->>'validUntil')::timestamp < NOW();

-- Delete orphaned tuples (resource deleted)
DELETE FROM polizy_tuple pt
WHERE pt.object_type = 'document'
AND NOT EXISTS (
  SELECT 1 FROM documents d WHERE d.id = pt.object_id
);
```

## Monitoring

### Metrics to Track

```typescript
// Track check latency
const checkStart = performance.now();
const result = await authz.check(params);
const latency = performance.now() - checkStart;

metrics.histogram("polizy.check.latency_ms", latency);
metrics.counter("polizy.check.total", 1);
metrics.counter(`polizy.check.result.${result}`, 1);
```

### Alert Thresholds

| Metric | Warning | Critical |
|--------|---------|----------|
| Check latency (p99) | > 50ms | > 200ms |
| Tuple count | > 1M | > 10M |
| Cache hit rate | < 80% | < 50% |
| Group depth exceeded | > 0/day | > 10/hour |

## Benchmarking

```typescript
import { performance } from "perf_hooks";

async function benchmark() {
  const iterations = 1000;
  const results: number[] = [];

  // Warmup
  for (let i = 0; i < 100; i++) {
    await authz.check({ who: alice, canThey: "view", onWhat: doc });
  }

  // Measure
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await authz.check({ who: alice, canThey: "view", onWhat: doc });
    results.push(performance.now() - start);
  }

  results.sort((a, b) => a - b);

  console.log({
    min: results[0],
    max: results[results.length - 1],
    median: results[Math.floor(results.length / 2)],
    p95: results[Math.floor(results.length * 0.95)],
    p99: results[Math.floor(results.length * 0.99)],
    avg: results.reduce((a, b) => a + b, 0) / results.length,
  });
}
```

## Best Practices Summary

1. **Index the two hot paths** - `(subjectType, subjectId, relation)` and
   `(objectType, objectId, relation)`; keep the `@@unique` for idempotent writes.
2. **Trust memoization, still bound depth** - No exponential blow-up and cycles
   terminate, but each unique node is one round trip; configure
   `defaultCheckDepth` (default 20).
3. **Cache across calls** - Memoization is per-`check()`; add an app-level cache
   for repeated checks.
4. **Invalidate carefully** - Clear cache on permission changes.
5. **Batch + idempotent writes** - Use `allowMany` / `storage.write` in bulk;
   re-grants upsert, they don't duplicate.
6. **Paginate reads** - `listTuples` / `listAccessibleObjects` take
   `{ limit, offset }`; `listAccessibleObjects` no longer full-scans.
7. **Clean up regularly** - Remove expired tuples (prefer direct SQL at scale).
8. **Monitor actively** - Track latency and depth warnings.
