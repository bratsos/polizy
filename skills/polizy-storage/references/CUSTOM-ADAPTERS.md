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
interface StorageAdapter<S extends AuthSchema, O extends ObjectTypes> {
  /**
   * Write tuples to storage
   * @returns The stored tuples with any generated IDs
   */
  write(tuples: InputTuple<S, O>[]): Promise<StoredTuple<S, O>[]>;

  /**
   * Delete tuples matching the filter
   * @returns Number of deleted tuples
   */
  delete(filter: {
    who?: Subject<S>;
    was?: string;
    onWhat?: AnyObject<O>;
  }): Promise<number>;

  /**
   * Find tuples matching the filter
   */
  findTuples(
    filter: Partial<InputTuple<S, O>>
  ): Promise<StoredTuple<S, O>[]>;

  /**
   * Find subjects that have a relation to an object
   */
  findSubjects(
    object: AnyObject<O>,
    relation: string,
    options?: { distinct?: boolean }
  ): Promise<Subject<S>[]>;

  /**
   * Find objects that a subject has a relation to
   */
  findObjects(
    subject: Subject<S>,
    relation: string,
    options?: { distinct?: boolean }
  ): Promise<AnyObject<O>[]>;
}
```

## Tuple Types

```typescript
// Input tuple (what you write)
interface InputTuple<S, O> {
  subject: Subject<S>;
  relation: string;
  object: AnyObject<O>;
  condition?: Condition;
}

// Stored tuple (what you read)
interface StoredTuple<S, O> extends InputTuple<S, O> {
  id?: string;  // Optional unique ID
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

// Condition type
interface Condition {
  validSince?: Date;
  validUntil?: Date;
}
```

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
      const storedTuple: StoredTuple<any, any> = {
        ...tuple,
        id: key,
      };
      this.tuples.set(key, storedTuple);
      stored.push(storedTuple);
    }

    return stored;
  }

  async delete(filter: {
    who?: Subject<any>;
    was?: string;
    onWhat?: AnyObject<any>;
  }): Promise<number> {
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
    filter: Partial<InputTuple<any, any>>
  ): Promise<StoredTuple<any, any>[]> {
    const results: StoredTuple<any, any>[] = [];

    for (const tuple of this.tuples.values()) {
      if (this.matchesTupleFilter(tuple, filter)) {
        results.push(tuple);
      }
    }

    return results;
  }

  async findSubjects(
    object: AnyObject<any>,
    relation: string,
    options?: { distinct?: boolean }
  ): Promise<Subject<any>[]> {
    const subjects: Subject<any>[] = [];
    const seen = new Set<string>();

    for (const tuple of this.tuples.values()) {
      if (
        tuple.object.type === object.type &&
        tuple.object.id === object.id &&
        tuple.relation === relation
      ) {
        const key = `${tuple.subject.type}:${tuple.subject.id}`;
        if (!options?.distinct || !seen.has(key)) {
          subjects.push(tuple.subject);
          seen.add(key);
        }
      }
    }

    return subjects;
  }

  async findObjects(
    subject: Subject<any>,
    relation: string,
    options?: { distinct?: boolean }
  ): Promise<AnyObject<any>[]> {
    const objects: AnyObject<any>[] = [];
    const seen = new Set<string>();

    for (const tuple of this.tuples.values()) {
      if (
        tuple.subject.type === subject.type &&
        tuple.subject.id === subject.id &&
        tuple.relation === relation
      ) {
        const key = `${tuple.object.type}:${tuple.object.id}`;
        if (!options?.distinct || !seen.has(key)) {
          objects.push(tuple.object);
          seen.add(key);
        }
      }
    }

    return objects;
  }

  private matchesFilter(
    tuple: StoredTuple<any, any>,
    filter: { who?: Subject<any>; was?: string; onWhat?: AnyObject<any> }
  ): boolean {
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

    if (filter.onWhat) {
      if (
        tuple.object.type !== filter.onWhat.type ||
        tuple.object.id !== filter.onWhat.id
      ) {
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

      await this.collection.updateOne(
        { _id: id },
        { $set: { ...doc, _id: id } },
        { upsert: true }
      );

      stored.push({
        ...tuple,
        id,
      });
    }

    return stored;
  }

  async delete(filter: {
    who?: Subject<any>;
    was?: string;
    onWhat?: AnyObject<any>;
  }): Promise<number> {
    const query: any = {};

    if (filter.who) {
      query.subjectType = filter.who.type;
      query.subjectId = filter.who.id;
    }

    if (filter.was) {
      query.relation = filter.was;
    }

    if (filter.onWhat) {
      query.objectType = filter.onWhat.type;
      query.objectId = filter.onWhat.id;
    }

    const result = await this.collection.deleteMany(query);
    return result.deletedCount;
  }

  async findTuples(
    filter: Partial<InputTuple<any, any>>
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

    const docs = await this.collection.find(query).toArray();
    return docs.map(doc => this.documentToTuple(doc));
  }

  async findSubjects(
    object: AnyObject<any>,
    relation: string,
    options?: { distinct?: boolean }
  ): Promise<Subject<any>[]> {
    const query = {
      objectType: object.type,
      objectId: object.id,
      relation,
    };

    if (options?.distinct) {
      const pipeline = [
        { $match: query },
        { $group: { _id: { type: "$subjectType", id: "$subjectId" } } },
      ];
      const results = await this.collection.aggregate(pipeline).toArray();
      return results.map(r => ({ type: r._id.type, id: r._id.id }));
    }

    const docs = await this.collection.find(query).toArray();
    return docs.map(doc => ({ type: doc.subjectType, id: doc.subjectId }));
  }

  async findObjects(
    subject: Subject<any>,
    relation: string,
    options?: { distinct?: boolean }
  ): Promise<AnyObject<any>[]> {
    const query = {
      subjectType: subject.type,
      subjectId: subject.id,
      relation,
    };

    if (options?.distinct) {
      const pipeline = [
        { $match: query },
        { $group: { _id: { type: "$objectType", id: "$objectId" } } },
      ];
      const results = await this.collection.aggregate(pipeline).toArray();
      return results.map(r => ({ type: r._id.type, id: r._id.id }));
    }

    const docs = await this.collection.find(query).toArray();
    return docs.map(doc => ({ type: doc.objectType, id: doc.objectId }));
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
    // Find matching tuples first
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

Use the shared test suite:

```typescript
import { describe, it } from "node:test";
import { runStorageTests } from "polizy/testing";
import { MyStorageAdapter } from "./my-adapter";

describe("MyStorageAdapter", () => {
  runStorageTests(() => new MyStorageAdapter());
});
```

## Best Practices

1. **Handle duplicates gracefully** - Upsert rather than error
2. **Create proper indexes** - Subject and object lookups are hot paths
3. **Support conditions** - Time-based access is a core feature
4. **Implement distinct option** - Reduces result set size
5. **Test thoroughly** - Use shared test suite
