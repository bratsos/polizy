---
title: StorageAdapter Reference
sidebar_position: 4
---

# StorageAdapter Reference

This page provides the formal API specification and operational contracts for polizy storage adapters.

---

## Interface Specification

The `StorageAdapter` interface defines the boundary between the polizy execution engine and the persistence layer. Any storage adapter passed to the `AuthSystem` must satisfy these methods.

| Method | Type Signature | Purpose |
| :--- | :--- | :--- |
| **write** | `write(tuples: InputTuple<S, O>[]): Promise<StoredTuple<S, O>[]>` | Writes a list of tuples to storage, enforcing unique compound constraints. Returns the saved tuples with IDs in the original order. |
| **delete** | `delete(filter: { who?: Subject<S> or AnyObject<O>; was?: Relation; onWhat?: AnyObject<O> }): Promise<number>` | Deletes all stored tuples matching the active filter properties. Returns the number of deleted records. |
| **findTuples** | `findTuples(filter: Partial<InputTuple<S, O>>, options?: { limit?: number; offset?: number }): Promise<StoredTuple<S, O>[]>` | Returns tuples matching the exact filter properties. Supports stable pagination order. |
| **findSubjects** | `findSubjects(object: AnyObject<O>, relation: Relation, options?: { subjectType?: S }): Promise<Subject<S>[]>` | Returns all unique subjects that have a direct relationship to the target object. |
| **findObjects** | `findObjects(subject: Subject<S>, relation: Relation, options?: { objectType?: O }): Promise<AnyObject<O>[]>` | Returns all unique objects that the subject has a direct relationship to. |
| **withSnapshot** | `withSnapshot?<T>(fn: (reader: ReadOnlyStorage<S, O>) => Promise<T>): Promise<T>` | *Optional.* Executes a callback within a consistent read-only transaction (snapshot). |

:::note

In the signatures above, `S` represents the union of valid subject types, and `O` represents the union of valid object types, as defined in your schema.

Additionally, the `StorageAdapter` interface carries an optional `@internal` phantom `_types` property as a compile-time variance device. Custom adapters do not need to implement or define this property.

:::

### Engine Read & Write Usage

The polizy engine reads storage **only through `findTuples`**. It never calls `findSubjects` or `findObjects` on the adapter, though both remain part of `StorageAdapter` and are verified by the shared test suite. Writes use `write` and `delete`; strong-consistency reads use `withSnapshot` when present.

The engine sends `findTuples` these filter shapes: `{ object }`, `{ subject, relation }`, `{ subject }`, `{ relation }`, and `{}` (preload). `listTuples` passes the caller's filter plus `limit` and `offset`.

---

## Core Types

`Subject`, `AnyObject`, `TupleSubject`, `StoredTuple`, `InputTuple`, `Relation`, and `ReadOnlyStorage` are all exported as types from `"polizy"`.

### Relation
A string identifying the relationship between a subject and an object.
```ts
type Relation = string;
```

### Subject
Represents the actor initiating an action.
```ts
type Subject<S extends string = string> = {
  type: S;
  id: string;
};
```

### AnyObject
Represents the target resource.
```ts
type AnyObject<O extends string = string> = {
  type: O;
  id: string;
};
```

### TupleSubject
A union type allowing a subject or another object to act in the subject position of a tuple (e.g., for nested groups or folders).
```ts
type TupleSubject<S extends string, O extends string> = Subject<S> | AnyObject<O>;
```

### StoredTuple
The complete database representation of a stored relationship fact.
```ts
type StoredTuple<S extends string, O extends string> = {
  id: string;
  subject: TupleSubject<S, O>;
  relation: string;
  object: AnyObject<O>;
  condition?: Condition;
};
```

### InputTuple
Used when writing new tuples. It is identical to `StoredTuple` but lacks the unique database-generated `id`.
```ts
type InputTuple<S extends string, O extends string> = Omit<StoredTuple<S, O>, "id">;
```

### ReadOnlyStorage
The slice of `StorageAdapter` containing only the query methods. This is passed to the callback function in `withSnapshot`.
```ts
type ReadOnlyStorage<S extends string, O extends string> = Pick<
  StorageAdapter<S, O>,
  "findTuples" | "findSubjects" | "findObjects"
>;
```

---

## Database Schema Specification

For SQL-backed engines, your tuples table must satisfy the following constraints. The Prisma schema representation is the canonical specification:

```prisma
model PolizyTuple {
  id          String  @id @default(cuid())
  subjectType String
  subjectId   String
  relation    String
  objectType  String
  objectId    String
  condition   Json?

  @@unique([subjectType, subjectId, relation, objectType, objectId])
  @@index([subjectType, subjectId, relation])
  @@index([objectType, objectId, relation])
}
```

### Key Specifications

1. **Compound Unique Index**  
   A unique constraint on `[subjectType, subjectId, relation, objectType, objectId]` is required to make grants idempotent and prevent duplicate facts.
2. **Subject Index**  
   An index on `[subjectType, subjectId, relation]` is required to optimize subject-anchored `findTuples` filters (`{ subject, relation }` and `{ subject }`).
3. **Object Index**  
   An index on `[objectType, objectId, relation]` is required to optimize object-anchored `findTuples` filters (`{ object }`).
4. **Condition Store**  
   The `condition` column is optional and stores JSON context rules (such as time-based validity or environmental checks).

---

## Operational Contracts

### Write Idempotency Contract
When the engine requests a write of input tuples:
* The store must check if a tuple matching the combination of `(subject, relation, object)` already exists.
* If it exists, the adapter **must not** insert a new row. If a new `condition` is specified in the input, the adapter must update the existing record's condition block. If `condition` is undefined in the input, the adapter must leave the existing condition untouched.
* The return value must be a list of `StoredTuple` objects containing the generated database IDs, preserving the exact order of the input array.

### Delete Matching Contract
The deletion logic uses a logical **AND** between all provided fields:
* `who`: Maps to the subject (`subjectType` and `subjectId`).
* `was`: Maps to the relation (`relation`).
* `onWhat`: Maps to **either** the object (`objectType` and `objectId`) **OR** the subject (`subjectType` and `subjectId`).

The matching logic must evaluate to:
```
(who == null OR (subject.type == who.type AND subject.id == who.id)) AND
(was == null OR relation == was) AND
(onWhat == null OR (object.type == onWhat.type AND object.id == onWhat.id) OR (subject.type == onWhat.type AND subject.id == onWhat.id))
```

### Snapshot Consistency Contract
* When `withSnapshot` is called, the adapter must open a transaction/snapshot block at the database level.
* All queries called on the provided `reader` parameter during `withSnapshot` must execute within that isolation level.
* For relational databases, this should map to `RepeatableRead` (PostgreSQL) or similar read-only snapshot transaction levels.
* An adapter built on a caller's active transaction should omit `withSnapshot` so `consistency: "strong"` reads stay on the caller's transaction.

### Find Tuples Condition Filtering Contract
* When querying stored tuples via `findTuples(filter)`:
* If the `condition` field in the filter object is explicitly present but its value is `undefined` (e.g. `{ subject: ..., condition: undefined }`), the adapter must apply **no** condition constraint. This means it must return matching tuples regardless of whether they have a condition or not (it must not filter for tuples where the condition is null).

---

## Verification & Testing

To ensure your adapter satisfies these operational contracts, polizy publishes a shared cross-adapter test suite via `polizy/storage-tests`. You can import `defineStorageAdapterTestSuite` to run these assertions against your implementation:

* Write idempotency, order preservation, and re-writing without a `condition` preserving any existing condition.
* Full `condition` round-trip (`validSince`, `validUntil`, `attributes`).
* Logical AND `delete` filtering across `who`, `was`, and `onWhat`.
* Stable and complete `limit`/`offset` pagination in `findTuples`, plus `findTuples({})` returning all stored tuples.
* `findSubjects` and `findObjects` with and without a type filter.
* `withSnapshot` seeing written tuples (executed only if `withSnapshot` is implemented).

For a setup guide and example snippet, see [Writing a Custom Adapter](custom-adapter.md#testing-your-adapter).
