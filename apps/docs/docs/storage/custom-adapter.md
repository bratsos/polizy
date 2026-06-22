---
title: Writing a Custom Adapter
sidebar_position: 3
---

# Writing a Custom Adapter

If you want to store polizy's relationship tuples in a store other than memory or a SQL database via Prisma—such as Redis, DynamoDB, MongoDB, or an external API—you can build a custom adapter. 

A custom adapter is simply an object or class that implements the `StorageAdapter` interface.

---

## The Adapter Interface

A storage adapter must implement five core methods and can optionally implement a sixth for snapshot consistency. 

Here is a skeleton implementation:

```ts
import type { 
  StorageAdapter, 
  InputTuple, 
  StoredTuple, 
  Subject, 
  AnyObject, 
  Relation, 
  ReadOnlyStorage 
} from "polizy";

export class MyCustomStorageAdapter implements StorageAdapter {
  /**
   * Writes tuples to storage, idempotently.
   * If a tuple with the same (subject, relation, object) already exists,
   * its condition should be updated rather than creating a duplicate.
   */
  async write(tuples: InputTuple[]): Promise<StoredTuple[]> {
    // 1. Write the input tuples to your store
    // 2. Ensure idempotency based on (subject, relation, object)
    // 3. Return the stored tuples with their unique string IDs in the same order as input
  }

  /**
   * Deletes tuples matching the specified filter criteria.
   * Multiple filter criteria must be combined with logical AND.
   */
  async delete(filter: {
    who?: Subject | AnyObject;
    was?: Relation;
    onWhat?: AnyObject;
  }): Promise<number> {
    // Delete matching tuples and return the count of deleted items.
    // See the delete matching contract below for logic specifics.
  }

  /**
   * Finds stored tuples matching the exact filter.
   */
  async findTuples(
    filter: Partial<InputTuple>,
    options?: { limit?: number; offset?: number }
  ): Promise<StoredTuple[]> {
    // Query tuples matching the provided filter keys (subject, relation, object, condition).
    // Implement pagination with limit and offset if provided.
  }

  /**
   * Finds all subjects that have a specific relation to a given object.
   * Useful for finding e.g., "all members of the group 'admin'".
   */
  async findSubjects(
    object: AnyObject,
    relation: Relation,
    options?: { subjectType?: string }
  ): Promise<Subject[]> {
    // Return a list of unique subjects matching the relation and object.
  }

  /**
   * Finds all objects a subject has a specific relation to.
   * Useful for finding e.g., "all groups a user belongs to".
   */
  async findObjects(
    subject: Subject,
    relation: Relation,
    options?: { objectType?: string }
  ): Promise<AnyObject[]> {
    // Return a list of unique objects matching the relation and subject.
  }

  /**
   * Optional: Run queries inside a consistent, point-in-time snapshot.
   * If omitted, strong-consistency checks fall back to live reads.
   */
  async withSnapshot?<T>(
    fn: (reader: ReadOnlyStorage) => Promise<T>
  ): Promise<T> {
    // Wrap execution of fn inside a read-only snapshot or repeatable-read transaction
  }
}
```

---

## Core Contracts & Rules

When implementing these methods, your adapter must adhere to the following contracts to prevent security leaks or corrupted states.

### 1. Write Idempotency
When writing a tuple, it is identified by its unique `(subject, relation, object)` triple. If you call `write()` with a tuple that already exists in the database:
- **Do not** insert a duplicate row.
- **Do** update its `condition` (if provided). If the new tuple does not specify a condition, leave the existing condition untouched.
- Return the resulting tuples with their database-generated unique `id` strings in the same order as they were input.

### 2. Delete Filtering
The `delete` method receives an object with optional parameters `who`, `was`, and `onWhat`. You must evaluate the filter using a logical **AND**:
- `who`: If provided, matches the tuple's subject (`subjectType` and `subjectId`).
- `was`: If provided, matches the tuple's relation (`relation`).
- `onWhat`: If provided, matches **either** the tuple's object (`objectType` and `objectId`) **OR** the tuple's subject (`subjectType` and `subjectId`).

Therefore, your deletion filter criteria should map to:
```
(who == null OR subject == who) AND
(was == null OR relation == was) AND
(onWhat == null OR object == onWhat OR subject == onWhat)
```
If the entire filter object is empty (all fields are undefined), return `0` and do not perform a deletion (to guard against accidental database clears).

### 3. Consistency Snapshots (Optional)
If your database supports repeatable reads or snapshot isolation (like PostgreSQL, MySQL, or Spanner), you should implement `withSnapshot`.
- It receives a callback function `fn`.
- It must initialize a read-only transaction or snapshot.
- It must execute the callback `fn`, passing it a `reader` object which implements `findTuples`, `findSubjects`, and `findObjects` resolved against that snapshot.
- If you do not implement this, polizy will automatically fall back to live reads when users ask for `consistency: "strong"`.

### 4. Index both hot read paths (required for performance)

polizy reads tuples two ways, and **both must be indexed** or list operations
degrade to full table scans at scale:

- **Subject-anchored:** `WHERE subjectType = ? AND subjectId = ?` — "what does this subject have?" (the `check` walk).
- **Object-anchored:** `WHERE objectType = ? AND objectId = ?` — "who holds this object?" (`findSubjects`, reverse expansion, and the `listSubjects` / `listAccessibleObjects` gather).

A common mistake is to rely on a single `UNIQUE (subjectType, subjectId, relation, objectType, objectId)` constraint: its left prefix serves subject-anchored reads, but object-anchored reads are **not** a prefix of it, so they fall back to a full scan. That makes the list operations scale super-linearly with the table size. Add an explicit object index (the bundled Prisma adapter already ships both):

```sql
CREATE INDEX polizy_tuple_subject_idx ON polizy_tuple (subject_type, subject_id, relation);
CREATE INDEX polizy_tuple_object_idx  ON polizy_tuple (object_type, object_id, relation);
```

:::tip[Measured impact]

On a ~35k-tuple dataset, adding the object index alone took direct `listSubjects`
from ~9.7s to ~1.2s (~8×) and `listAccessibleObjects` from ~4.3s to ~0.4s (~10×) —
before any other optimization. See [Performance](../performance/overview.md).

:::

---

## Testing Your Adapter

polizy uses a shared cross-adapter test suite to validate that both `InMemoryStorageAdapter` and `PrismaStorageAdapter` conform to the exact contracts. You can run your custom adapter against the same test suite.

The test suite is located in the source code at:
`packages/polizy/src/polizy.storage.shared-tests.ts`

While it is not a published npm export, you can reference it directly during local development if you are working within a monorepo, or copy its assertions into your own codebase.

To run it, configure a test file using `node:test`:

```ts
import { describe } from "node:test";
import { MyCustomStorageAdapter } from "./my-adapter";
import { 
  defineStorageAdapterTestSuite, 
  type StorageAdapterTestContext 
} from "polizy/src/polizy.storage.shared-tests.ts"; // path to source file

describe("MyCustomStorageAdapter Shared Tests", () => {
  const context: StorageAdapterTestContext = {
    getAdapter: async () => {
      return new MyCustomStorageAdapter();
    },
    cleanup: async () => {
      // Clean up database tables between test runs
    }
  };

  defineStorageAdapterTestSuite("MyCustomStorageAdapter", context);
});
```
