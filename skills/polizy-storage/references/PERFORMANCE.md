# Storage Performance Optimization

Strategies for high-performance authorization at scale.

## Performance Factors

| Factor | Impact | Solution |
|--------|--------|----------|
| Group nesting depth | High | Keep 2-3 levels max |
| Hierarchy depth | Medium | Configure `defaultCheckDepth` |
| Tuple count | Medium | Regular cleanup, good indexes |
| Query patterns | High | Proper database indexes |
| Caching | High | Add caching layer |

## Database Indexes

### Essential Indexes

```prisma
model PolizyTuple {
  // ... fields ...

  // REQUIRED: Unique constraint
  @@unique([subjectType, subjectId, relation, objectType, objectId])

  // REQUIRED: Subject lookups (findObjects)
  @@index([subjectType, subjectId, relation])

  // REQUIRED: Object lookups (findSubjects)
  @@index([objectType, objectId, relation])
}
```

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
| Many round trips | Deep group nesting | Reduce nesting depth |
| Large result sets | No filtering | Add `distinct` option |
| Condition evaluation | Many expired tuples | Cleanup old tuples |

## Reducing Group Nesting

### Problem

Each group level requires additional queries:

```
User in 2 groups: 2-3 queries
Each group in 2 more: 6-7 queries
Another level: 14-15 queries
```

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

## Cleanup Strategies

### Remove Expired Tuples

```typescript
async function cleanupExpiredTuples(): Promise<number> {
  const allTuples = await authz.listTuples({});
  const now = new Date();
  let cleaned = 0;

  for (const tuple of allTuples) {
    if (tuple.condition?.validUntil && tuple.condition.validUntil < now) {
      await authz.disallowAllMatching({
        who: tuple.subject,
        was: tuple.relation,
        onWhat: tuple.object,
      });
      cleaned++;
    }
  }

  return cleaned;
}

// Run daily
setInterval(cleanupExpiredTuples, 24 * 60 * 60 * 1000);
```

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

1. **Index properly** - Subject and object lookups must be indexed
2. **Limit depth** - 2-3 group levels, configure `defaultCheckDepth`
3. **Cache aggressively** - Most checks are repeated
4. **Invalidate carefully** - Clear cache on permission changes
5. **Batch operations** - Use parallel writes
6. **Clean up regularly** - Remove expired tuples
7. **Monitor actively** - Track latency and depth warnings
