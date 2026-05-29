# Building Custom Storage Adapters

Implement the `StorageAdapter` interface for custom backends.

## When to Build Custom

- Using a database without Prisma support
- Need Redis, MongoDB, or other NoSQL
- Custom caching layer
- Specialized audit requirements
- Integration with existing systems

## StorageAdapter Interface

```typescript
interface StorageAdapter<
  S extends SubjectType = SubjectType,
  O extends ObjectType = ObjectType,
> {
  /**
   * Write tuples, idempotently, in input order.
   * @returns The stored tuples, each with an `id`, in the same order as input.
   */
  write(tuples: InputTuple<S, O>[]): Promise<StoredTuple<S, O>[]>;

  /**
   * Delete tuples matching the filter.
   * @returns Number of deleted tuples.
   */
  delete(filter: {
    who?: Subject<S> | AnyObject<O>;
    was?: Relation;
    onWhat?: AnyObject<O>;
  }): Promise<number>;

  /**
   * Find tuples matching the filter, with optional pagination.
   */
  findTuples(
    filter: Partial<InputTuple<S, O>>,
    options?: { limit?: number; offset?: number },
  ): Promise<StoredTuple<S, O>[]>;

  /**
   * Find DISTINCT subjects that have `relation` TO `object`.
   * Optionally narrow to one subject type.
   */
  findSubjects(
    object: AnyObject<O>,
    relation: Relation,
    options?: { subjectType?: S },
  ): Promise<Subject<S>[]>;

  /**
   * Find DISTINCT objects a `subject` has `relation` TO.
   * Optionally narrow to one object type.
   */
  findObjects(
    subject: Subject<S>,
    relation: Relation,
    options?: { objectType?: O },
  ): Promise<AnyObject<O>[]>;
}
```

> The generics are `SubjectType`/`ObjectType` (string unions of your type
> names), not the schema object. `Relation` is a string. There is no `distinct`
> option — `findSubjects`/`findObjects` must **always** return de-duplicated
> results.

## The Contract (must hold, or `check()` misbehaves)

Both bundled adapters are held to these rules by a shared cross-adapter test
suite. A custom adapter must satisfy all of them:

### `write()` — idempotent on the triple

- A tuple's identity is its `(subject, relation, object)` triple. Writing one
  that already exists **updates its condition**, it does NOT insert a duplicate.
- Update the stored condition **only when the input provides one**. Re-writing a
  tuple with no `condition` must leave any existing condition intact (callers
  revoke to clear it).
- Return the stored tuples **in the same order as the input**, each carrying its
  `id`.

### `delete(filter)` — exact match semantics

Delete every tuple matching, with all present clauses AND-ed:

```
(who?    subject == who) AND
(was?    relation == was) AND
(onWhat? object == onWhat OR subject == onWhat)
```

- The subject-position arm of `onWhat` (matching `subject == onWhat`) lets a
  resource be revoked as both object and subject of links. But because it is
  AND-ed under `who`, an explicit `who` is **never dropped** — when `who` is
  present, the only rows the subject-arm can add are ones where `who == onWhat`.
  Do not OR the subject match out at the top level; that over-deletes (the 0.1.x
  Prisma bug, e.g. `removeParent` wiping a parent's own parent link).
- An empty filter (no `who`, `was`, or `onWhat`) must delete **nothing** and
  return `0` — guard against accidental table wipes.

### `findTuples(filter, { limit, offset })` — pagination

- Filter on whichever of `subject` / `relation` / `object` are present.
- Apply `offset` then `limit` in a **stable order** (e.g. by `id`) so repeated
  pages don't overlap or skip rows. Omitting `options` returns all matches.

## Tuple Types

```typescript
// Input tuple (what you write)
interface InputTuple<S, O> {
  subject: Subject<S>;
  relation: string;
  object: AnyObject<O>;
  condition?: Condition;
}

// Stored tuple (what you read) — id is REQUIRED, not optional
interface StoredTuple<S, O> {
  id: string;       // your adapter assigns this (cuid/uuid/autoincrement)
  subject: Subject<S>;
  relation: string;
  object: AnyObject<O>;
  condition?: Condition;
}

// Subject type
interface Subject<S> {
  type: string;  // One of the subject types
  id: string;
}

// Object type
interface AnyObject<O> {
  type: string;  // One of the object types
  id: string;    // May include field separator, e.g., "doc1#salary"
}

// Condition type — note `attributes` (ABAC) added in 0.2.0
interface Condition {
  validSince?: Date;                 // time window start
  validUntil?: Date;                 // time window end
  attributes?: AttributePredicate[]; // all must pass (logical AND)
}

interface AttributePredicate {
  attribute: string;  // dot-path into the check() context
  operator: "eq" | "ne" | "in" | "nin" | "gt" | "gte" | "lt" | "lte";
  value: JsonScalar | JsonScalar[];
}
```

> **Persist the whole `condition`, revive `Date`s on read.** If you serialize
> `condition` to JSON (most stores do), `validSince`/`validUntil` come back as
> strings. You MUST convert them back to `Date` when reading — the engine's
> condition logic expects `Date`, and passing strings makes time-based grants
> throw (this was the 0.1.x Prisma bug). Preserve `attributes` verbatim.

## Minimal Implementation

```typescript
import { StorageAdapter, InputTuple, StoredTuple, Subject, AnyObject } from "polizy";

export class MyStorageAdapter implements StorageAdapter<any, any> {
  private tuples: Map<string, StoredTuple<any, any>> = new Map();

  private getTupleKey(tuple: InputTuple<any, any>): string {
    return `${tuple.subject.type}:${tuple.subject.id}|${tuple.relation}|${tuple.object.type}:${tuple.object.id}`;
  }

  async write(tuples: InputTuple<any, any>[]): Promise<StoredTuple<any, any>[]> {
    const stored: StoredTuple<any, any>[] = [];

    for (const tuple of tuples) {
      const key = this.getTupleKey(tuple);
      const existing = this.tuples.get(key);

      if (existing) {
        // Idempotent: only overwrite the condition when the input provides one,
        // so re-granting without a `when` preserves any existing condition.
        if (tuple.condition !== undefined) {
          existing.condition = tuple.condition;
        }
        stored.push(existing);
        continue;
      }

      const storedTuple: StoredTuple<any, any> = { ...tuple, id: key };
      this.tuples.set(key, storedTuple);
      stored.push(storedTuple); // preserve input order
    }

    return stored;
  }

  async delete(filter: {
    who?: Subject<any> | AnyObject<any>;
    was?: string;
    onWhat?: AnyObject<any>;
  }): Promise<number> {
    // Never wipe the table on an empty filter.
    if (!filter.who && !filter.was && !filter.onWhat) return 0;

    let deleted = 0;
    for (const [key, tuple] of this.tuples) {
      if (this.matchesFilter(tuple, filter)) {
        this.tuples.delete(key);
        deleted++;
      }
    }

    return deleted;
  }

  async findTuples(
    filter: Partial<InputTuple<any, any>>,
    options?: { limit?: number; offset?: number }
  ): Promise<StoredTuple<any, any>[]> {
    const results: StoredTuple<any, any>[] = [];

    for (const tuple of this.tuples.values()) {
      if (this.matchesTupleFilter(tuple, filter)) {
        results.push(tuple);
      }
    }

    // Stable order, then offset/limit.
    results.sort((a, b) => a.id.localeCompare(b.id));
    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? Number.POSITIVE_INFINITY;
    return results.slice(offset, offset + limit);
  }

  // Always de-duplicated; optional subjectType narrows the result.
  async findSubjects(
    object: AnyObject<any>,
    relation: string,
    options?: { subjectType?: string }
  ): Promise<Subject<any>[]> {
    const subjects: Subject<any>[] = [];
    const seen = new Set<string>();

    for (const tuple of this.tuples.values()) {
      if (
        tuple.object.type === object.type &&
        tuple.object.id === object.id &&
        tuple.relation === relation &&
        (!options?.subjectType || tuple.subject.type === options.subjectType)
      ) {
        const key = `${tuple.subject.type}:${tuple.subject.id}`;
        if (!seen.has(key)) {
          subjects.push(tuple.subject);
          seen.add(key);
        }
      }
    }

    return subjects;
  }

  // Always de-duplicated; optional objectType narrows the result.
  async findObjects(
    subject: Subject<any>,
    relation: string,
    options?: { objectType?: string }
  ): Promise<AnyObject<any>[]> {
    const objects: AnyObject<any>[] = [];
    const seen = new Set<string>();

    for (const tuple of this.tuples.values()) {
      if (
        tuple.subject.type === subject.type &&
        tuple.subject.id === subject.id &&
        tuple.relation === relation &&
        (!options?.objectType || tuple.object.type === options.objectType)
      ) {
        const key = `${tuple.object.type}:${tuple.object.id}`;
        if (!seen.has(key)) {
          objects.push(tuple.object);
          seen.add(key);
        }
      }
    }

    return objects;
  }

  private matchesFilter(
    tuple: StoredTuple<any, any>,
    filter: {
      who?: Subject<any> | AnyObject<any>;
      was?: string;
      onWhat?: AnyObject<any>;
    }
  ): boolean {
    // who: pins the subject position (AND).
    if (filter.who) {
      if (
        tuple.subject.type !== filter.who.type ||
        tuple.subject.id !== filter.who.id
      ) {
        return false;
      }
    }

    if (filter.was && tuple.relation !== filter.was) {
      return false;
    }

    // onWhat: matches object OR subject position. AND-ed with `who` above, so a
    // present `who` is never dropped — this only widens matches when who absent.
    if (filter.onWhat) {
      const matchesObject =
        tuple.object.type === filter.onWhat.type &&
        tuple.object.id === filter.onWhat.id;
      const matchesSubject =
        tuple.subject.type === filter.onWhat.type &&
        tuple.subject.id === filter.onWhat.id;
      if (!matchesObject && !matchesSubject) {
        return false;
      }
    }

    return true;
  }

  private matchesTupleFilter(
    tuple: StoredTuple<any, any>,
    filter: Partial<InputTuple<any, any>>
  ): boolean {
    if (filter.subject) {
      if (
        tuple.subject.type !== filter.subject.type ||
        tuple.subject.id !== filter.subject.id
      ) {
        return false;
      }
    }

    if (filter.relation && tuple.relation !== filter.relation) {
      return false;
    }

    if (filter.object) {
      if (
        tuple.object.type !== filter.object.type ||
        tuple.object.id !== filter.object.id
      ) {
        return false;
      }
    }

    return true;
  }
}
```

## MongoDB Example

```typescript
import { MongoClient, Collection } from "mongodb";
import { StorageAdapter, InputTuple, StoredTuple, Subject, AnyObject } from "polizy";

interface TupleDocument {
  _id: string;
  subjectType: string;
  subjectId: string;
  relation: string;
  objectType: string;
  objectId: string;
  condition?: {
    validSince?: Date;
    validUntil?: Date;
  };
}

export class MongoStorageAdapter implements StorageAdapter<any, any> {
  private collection: Collection<TupleDocument>;

  constructor(client: MongoClient, dbName: string, collectionName = "polizy_tuples") {
    this.collection = client.db(dbName).collection(collectionName);
  }

  async init() {
    // Create indexes
    await this.collection.createIndex(
      { subjectType: 1, subjectId: 1, relation: 1, objectType: 1, objectId: 1 },
      { unique: true }
    );
    await this.collection.createIndex({ subjectType: 1, subjectId: 1, relation: 1 });
    await this.collection.createIndex({ objectType: 1, objectId: 1, relation: 1 });
  }

  private documentToTuple(doc: TupleDocument): StoredTuple<any, any> {
    return {
      id: doc._id,
      subject: { type: doc.subjectType, id: doc.subjectId },
      relation: doc.relation,
      object: { type: doc.objectType, id: doc.objectId },
      // MongoDB's driver preserves Date, but if you ever store condition as a
      // JSON string, revive validSince/validUntil to Date here.
      condition: doc.condition,
    };
  }

  private tupleToDocument(tuple: InputTuple<any, any>): Omit<TupleDocument, "_id"> {
    return {
      subjectType: tuple.subject.type,
      subjectId: tuple.subject.id,
      relation: tuple.relation,
      objectType: tuple.object.type,
      objectId: tuple.object.id,
      condition: tuple.condition,
    };
  }

  async write(tuples: InputTuple<any, any>[]): Promise<StoredTuple<any, any>[]> {
    const stored: StoredTuple<any, any>[] = [];

    for (const tuple of tuples) {
      const doc = this.tupleToDocument(tuple);
      const id = `${doc.subjectType}:${doc.subjectId}|${doc.relation}|${doc.objectType}:${doc.objectId}`;

      // Idempotent upsert keyed on the triple. Only $set the condition when the
      // input provides one, so re-grants without a `when` keep the old one.
      const update: any = {
        $setOnInsert: {
          _id: id,
          subjectType: doc.subjectType,
          subjectId: doc.subjectId,
          relation: doc.relation,
          objectType: doc.objectType,
          objectId: doc.objectId,
        },
      };
      if (tuple.condition !== undefined) {
        update.$set = { condition: doc.condition };
      }

      await this.collection.updateOne({ _id: id }, update, { upsert: true });
      stored.push({ ...tuple, id }); // preserve input order
    }

    return stored;
  }

  async delete(filter: {
    who?: Subject<any> | AnyObject<any>;
    was?: string;
    onWhat?: AnyObject<any>;
  }): Promise<number> {
    if (!filter.who && !filter.was && !filter.onWhat) return 0;

    const query: any = {};

    if (filter.who) {
      query.subjectType = filter.who.type;
      query.subjectId = filter.who.id;
    }

    if (filter.was) {
      query.relation = filter.was;
    }

    // onWhat matches the OBJECT or the SUBJECT position (AND-ed with `who`).
    if (filter.onWhat) {
      query.$or = [
        { objectType: filter.onWhat.type, objectId: filter.onWhat.id },
        { subjectType: filter.onWhat.type, subjectId: filter.onWhat.id },
      ];
    }

    const result = await this.collection.deleteMany(query);
    return result.deletedCount;
  }

  async findTuples(
    filter: Partial<InputTuple<any, any>>,
    options?: { limit?: number; offset?: number }
  ): Promise<StoredTuple<any, any>[]> {
    const query: any = {};

    if (filter.subject) {
      query.subjectType = filter.subject.type;
      query.subjectId = filter.subject.id;
    }

    if (filter.relation) {
      query.relation = filter.relation;
    }

    if (filter.object) {
      query.objectType = filter.object.type;
      query.objectId = filter.object.id;
    }

    let cursor = this.collection.find(query).sort({ _id: 1 }); // stable order
    if (options?.offset) cursor = cursor.skip(options.offset);
    if (options?.limit !== undefined) cursor = cursor.limit(options.limit);

    const docs = await cursor.toArray();
    return docs.map(doc => this.documentToTuple(doc));
  }

  // Always distinct; subjectType narrows the result.
  async findSubjects(
    object: AnyObject<any>,
    relation: string,
    options?: { subjectType?: string }
  ): Promise<Subject<any>[]> {
    const match: any = { objectType: object.type, objectId: object.id, relation };
    if (options?.subjectType) match.subjectType = options.subjectType;

    const results = await this.collection
      .aggregate([
        { $match: match },
        { $group: { _id: { type: "$subjectType", id: "$subjectId" } } },
      ])
      .toArray();
    return results.map(r => ({ type: r._id.type, id: r._id.id }));
  }

  // Always distinct; objectType narrows the result.
  async findObjects(
    subject: Subject<any>,
    relation: string,
    options?: { objectType?: string }
  ): Promise<AnyObject<any>[]> {
    const match: any = { subjectType: subject.type, subjectId: subject.id, relation };
    if (options?.objectType) match.objectType = options.objectType;

    const results = await this.collection
      .aggregate([
        { $match: match },
        { $group: { _id: { type: "$objectType", id: "$objectId" } } },
      ])
      .toArray();
    return results.map(r => ({ type: r._id.type, id: r._id.id }));
  }
}
```

## Redis Example (Caching Layer)

```typescript
import Redis from "ioredis";
import { StorageAdapter, InputTuple, StoredTuple } from "polizy";

export class RedisStorageAdapter implements StorageAdapter<any, any> {
  private redis: Redis;
  private prefix: string;

  constructor(redis: Redis, prefix = "polizy:") {
    this.redis = redis;
    this.prefix = prefix;
  }

  private getTupleKey(tuple: InputTuple<any, any>): string {
    return `${this.prefix}tuple:${tuple.subject.type}:${tuple.subject.id}|${tuple.relation}|${tuple.object.type}:${tuple.object.id}`;
  }

  private getSubjectKey(subject: { type: string; id: string }): string {
    return `${this.prefix}subject:${subject.type}:${subject.id}`;
  }

  private getObjectKey(object: { type: string; id: string }): string {
    return `${this.prefix}object:${object.type}:${object.id}`;
  }

  async write(tuples: InputTuple<any, any>[]): Promise<StoredTuple<any, any>[]> {
    const pipeline = this.redis.pipeline();
    const stored: StoredTuple<any, any>[] = [];

    for (const tuple of tuples) {
      const key = this.getTupleKey(tuple);
      const data = JSON.stringify(tuple);

      // Store tuple
      pipeline.set(key, data);

      // Index by subject
      pipeline.sadd(this.getSubjectKey(tuple.subject), key);

      // Index by object
      pipeline.sadd(this.getObjectKey(tuple.object), key);

      stored.push({ ...tuple, id: key });
    }

    await pipeline.exec();
    return stored;
  }

  async delete(filter: {
    who?: { type: string; id: string };
    was?: string;
    onWhat?: { type: string; id: string };
  }): Promise<number> {
    if (!filter.who && !filter.was && !filter.onWhat) return 0;

    // Find matching tuples first. NOTE: a complete implementation must also
    // honor the subject-position arm of `onWhat` (object==onWhat OR
    // subject==onWhat) — index by object AND subject and union the matches.
    const tuples = await this.findTuples({
      subject: filter.who,
      relation: filter.was,
      object: filter.onWhat,
    });

    if (tuples.length === 0) return 0;

    const pipeline = this.redis.pipeline();

    for (const tuple of tuples) {
      const key = this.getTupleKey(tuple);
      pipeline.del(key);
      pipeline.srem(this.getSubjectKey(tuple.subject), key);
      pipeline.srem(this.getObjectKey(tuple.object), key);
    }

    await pipeline.exec();
    return tuples.length;
  }

  // ... implement findTuples, findSubjects, findObjects
}
```

## Testing Your Adapter

polizy validates its own adapters with a shared cross-adapter test suite
(`defineStorageAdapterTestSuite` in
`packages/polizy/src/polizy.storage.shared-tests.ts`). It is **not a published
export** — there is no `polizy/testing` entry point — but it is the source of
truth for adapter behavior and is the best template to copy.

The cheapest way to vet a custom adapter is to run your adapter against the same
assertions. At minimum, cover the contract directly with `node:test`:

```typescript
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { MyStorageAdapter } from "./my-adapter";

describe("MyStorageAdapter contract", () => {
  let adapter: MyStorageAdapter;
  beforeEach(() => { adapter = new MyStorageAdapter(); });

  it("write() is idempotent on the triple and preserves order", async () => {
    const t = { subject: { type: "user", id: "a" }, relation: "owner",
                object: { type: "document", id: "d1" } };
    const [first] = await adapter.write([t]);
    const [again] = await adapter.write([t]); // re-write same triple
    assert.equal(again.id, first.id);          // no duplicate
    const all = await adapter.findTuples({});
    assert.equal(all.length, 1);
  });

  it("delete() with explicit `who` does not over-delete", async () => {
    await adapter.write([
      { subject: { type: "folder", id: "f1" }, relation: "parent",
        object: { type: "document", id: "d1" } },
      { subject: { type: "folder", id: "root" }, relation: "parent",
        object: { type: "folder", id: "f1" } }, // f1's own parent link
    ]);
    await adapter.delete({
      who: { type: "folder", id: "f1" },
      was: "parent",
      onWhat: { type: "document", id: "d1" },
    });
    const remaining = await adapter.findTuples({});
    assert.equal(remaining.length, 1); // root→f1 link must survive
  });

  it("findTuples() paginates in a stable order", async () => {
    // write N tuples, then assert offset/limit returns non-overlapping pages
  });

  it("conditions revive validSince/validUntil to Date on read", async () => {
    // write a tuple with `when`, read it back, assert instanceof Date
  });
});
```

## Best Practices

1. **Idempotent writes** - Upsert on the `(subject, relation, object)` triple;
   only overwrite the condition when one is supplied; return in input order.
2. **Exact delete semantics** - Honor the subject-position arm of `onWhat`, never
   drop an explicit `who`, and refuse empty filters.
3. **Create proper indexes** - Subject and object lookups are hot paths.
4. **Always de-duplicate** - `findSubjects`/`findObjects` must return distinct
   results; there is no `distinct` flag.
5. **Revive `Date`s** - Convert `validSince`/`validUntil` back from strings on
   read, or time-based grants will throw.
6. **Support pagination** - Apply `{ limit, offset }` in a stable order.
7. **Test against the contract** - Mirror the bundled shared test suite.
