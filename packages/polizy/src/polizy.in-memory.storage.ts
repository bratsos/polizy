import { deepEqual } from "fast-equals";
import type { ReadOnlyStorage, StorageAdapter } from "./polizy.storage";
import type {
  AnyObject,
  InputTuple,
  ObjectType,
  Relation,
  StoredTuple,
  Subject,
  SubjectType,
  TupleId,
} from "./types";

// Read scans, parameterised by the tuple store so the live adapter and a
// point-in-time snapshot resolve reads through exactly the same code.

function matchesFilter<S extends SubjectType, O extends ObjectType>(
  tuple: StoredTuple<S, O>,
  filter: {
    who?: Subject<S> | AnyObject<O>;
    was?: Relation;
    onWhat?: AnyObject<O>;
  },
): boolean {
  if (filter.who && !deepEqual(tuple.subject, filter.who)) {
    return false;
  }
  if (filter.was && tuple.relation !== filter.was) {
    return false;
  }
  if (filter.onWhat && !deepEqual(tuple.object, filter.onWhat)) {
    return false;
  }
  return true;
}

function readTuples<S extends SubjectType, O extends ObjectType>(
  tuples: Map<TupleId, StoredTuple<S, O>>,
  filter: Partial<InputTuple<S, O>>,
  options?: { limit?: number; offset?: number },
): StoredTuple<S, O>[] {
  const results: StoredTuple<S, O>[] = [];
  const adaptedFilter = {
    who: filter.subject,
    was: filter.relation,
    onWhat: filter.object,
  };
  for (const tuple of tuples.values()) {
    if (matchesFilter(tuple, adaptedFilter)) {
      if (filter.condition && !deepEqual(tuple.condition, filter.condition)) {
        continue;
      }
      results.push(tuple);
    }
  }
  const offset = options?.offset ?? 0;
  const limit = options?.limit ?? Number.POSITIVE_INFINITY;
  return results.slice(offset, offset + limit);
}

function readSubjects<S extends SubjectType, O extends ObjectType>(
  tuples: Map<TupleId, StoredTuple<S, O>>,
  object: AnyObject<O>,
  relation: Relation,
  options?: { subjectType?: S },
): Subject<S>[] {
  const subjects: Subject<S>[] = [];
  const seenSubjects = new Set<string>();
  for (const tuple of tuples.values()) {
    if (
      tuple.relation === relation &&
      deepEqual(tuple.object, object) &&
      (!options?.subjectType || tuple.subject.type === options.subjectType)
    ) {
      const subjectKey = `${tuple.subject.type}:${tuple.subject.id}`;
      if (!seenSubjects.has(subjectKey)) {
        subjects.push(tuple.subject as Subject<S>);
        seenSubjects.add(subjectKey);
      }
    }
  }
  return subjects;
}

function readObjects<S extends SubjectType, O extends ObjectType>(
  tuples: Map<TupleId, StoredTuple<S, O>>,
  subject: Subject<S>,
  relation: Relation,
  options?: { objectType?: O },
): AnyObject<O>[] {
  const objects: AnyObject<O>[] = [];
  const seenObjects = new Set<string>();
  for (const tuple of tuples.values()) {
    if (
      tuple.relation === relation &&
      deepEqual(tuple.subject, subject) &&
      (!options?.objectType || tuple.object.type === options.objectType)
    ) {
      const objectKey = `${tuple.object.type}:${tuple.object.id}`;
      if (!seenObjects.has(objectKey)) {
        objects.push(tuple.object as AnyObject<O>);
        seenObjects.add(objectKey);
      }
    }
  }
  return objects;
}

export class InMemoryStorageAdapter<
  S extends SubjectType = SubjectType,
  O extends ObjectType = ObjectType,
> implements StorageAdapter<S, O>
{
  private tuples: Map<TupleId, StoredTuple<S, O>> = new Map();
  private nextId = 1;

  private generateId(): TupleId {
    return (this.nextId++).toString();
  }

  private findExisting(
    inputTuple: InputTuple<S, O>,
  ): StoredTuple<S, O> | undefined {
    for (const tuple of this.tuples.values()) {
      if (
        deepEqual(tuple.subject, inputTuple.subject) &&
        tuple.relation === inputTuple.relation &&
        deepEqual(tuple.object, inputTuple.object)
      ) {
        return tuple;
      }
    }
    return undefined;
  }

  async write(tuples: InputTuple<S, O>[]) {
    const result: StoredTuple<S, O>[] = [];
    for (const inputTuple of tuples) {
      const existing = this.findExisting(inputTuple);
      if (existing) {
        // Idempotent: re-writing only updates the condition when one is
        // provided, so re-granting without a `when` preserves any existing
        // condition (matches the Prisma adapter). Revoke to clear it.
        if (inputTuple.condition !== undefined) {
          existing.condition = inputTuple.condition;
        }
        result.push(existing);
        continue;
      }
      const id = this.generateId();
      const newTuple: StoredTuple<S, O> = { ...inputTuple, id };
      this.tuples.set(id, newTuple);
      result.push(newTuple);
    }
    return result;
  }

  async delete(filter: {
    who?: Subject<S> | AnyObject<O>;
    was?: Relation;
    onWhat?: AnyObject<O>;
  }) {
    let deleteCount = 0;
    const idsToDelete: TupleId[] = [];

    if (!filter.who && !filter.was && !filter.onWhat) {
      console.warn(
        "InMemoryStorageAdapter.delete called with an empty filter. No tuples deleted.",
      );
      return 0;
    }

    for (const [id, tuple] of this.tuples.entries()) {
      let matches = true;

      if (filter.who && !deepEqual(tuple.subject, filter.who)) {
        matches = false;
      }

      if (matches && filter.was && tuple.relation !== filter.was) {
        matches = false;
      }

      if (matches && filter.onWhat) {
        const matchesObject = deepEqual(tuple.object, filter.onWhat);
        const matchesSubject = deepEqual(tuple.subject, filter.onWhat);
        if (!matchesObject && !matchesSubject) {
          matches = false;
        }
      }

      if (matches) {
        idsToDelete.push(id);
      }
    }
    for (const id of idsToDelete) {
      this.tuples.delete(id);
      deleteCount++;
    }
    return deleteCount;
  }

  async findTuples(
    filter: Partial<InputTuple<S, O>>,
    options?: { limit?: number; offset?: number },
  ) {
    return readTuples(this.tuples, filter, options);
  }

  async findSubjects(
    object: AnyObject<O>,
    relation: Relation,
    options?: { subjectType?: S },
  ): Promise<Subject<S>[]> {
    return readSubjects(this.tuples, object, relation, options);
  }

  async findObjects(
    subject: Subject<S>,
    relation: Relation,
    options?: { objectType?: O },
  ): Promise<AnyObject<O>[]> {
    return readObjects(this.tuples, subject, relation, options);
  }

  /**
   * Run `fn` against a point-in-time copy of the tuples. A write that lands
   * while `fn` is in flight mutates the live map (and can edit a live tuple's
   * condition in place); copying each tuple isolates the operation from both,
   * so it sees one coherent view without blocking writers.
   */
  async withSnapshot<T>(
    fn: (reader: ReadOnlyStorage<S, O>) => Promise<T>,
  ): Promise<T> {
    const snapshot = new Map<TupleId, StoredTuple<S, O>>();
    for (const [id, tuple] of this.tuples) {
      snapshot.set(id, { ...tuple });
    }
    const reader: ReadOnlyStorage<S, O> = {
      findTuples: async (filter, options) =>
        readTuples(snapshot, filter, options),
      findSubjects: async (object, relation, options) =>
        readSubjects(snapshot, object, relation, options),
      findObjects: async (subject, relation, options) =>
        readObjects(snapshot, subject, relation, options),
    };
    return fn(reader);
  }
}
