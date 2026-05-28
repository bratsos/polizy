import { deepEqual } from "fast-equals";
import type { StorageAdapter } from "./polizy.storage";
import type {
  AnyObject,
  InputTuple,
  Relation,
  StoredTuple,
  Subject,
  TupleId,
  SubjectType,
  ObjectType,
} from "./types";

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

  private matchesFilter(
    tuple: StoredTuple<S, O>,
    filter: {
      who?: Subject<S> | AnyObject<O>;
      was?: Relation;
      onWhat?: AnyObject<O>;
    },
  ) {
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
        // Idempotent: update the condition on the existing tuple, no duplicate.
        existing.condition = inputTuple.condition;
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
    const results: StoredTuple<S, O>[] = [];

    const adaptedFilter = {
      who: filter.subject,
      was: filter.relation,
      onWhat: filter.object,
    };
    for (const tuple of this.tuples.values()) {
      if (this.matchesFilter(tuple, adaptedFilter)) {
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

  async findSubjects(
    object: AnyObject<O>,
    relation: Relation,
    options?: { subjectType?: S },
  ): Promise<Subject<S>[]> {
    const subjects: Subject<S>[] = [];
    const seenSubjects = new Set<string>();

    for (const tuple of this.tuples.values()) {
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

  async findObjects(
    subject: Subject<S>,
    relation: Relation,
    options?: { objectType?: O },
  ): Promise<AnyObject<O>[]> {
    const objects: AnyObject<O>[] = [];
    const seenObjects = new Set<string>();

    for (const tuple of this.tuples.values()) {
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
}
