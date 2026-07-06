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

const keyOf = (o: { type: string; id: string }): string => `${o.type}:${o.id}`;
const EMPTY: ReadonlySet<TupleId> = new Set();

/**
 * The tuple store behind {@link InMemoryStorageAdapter}.
 *
 * The canonical data is `tuples` (a Map by id), but every read first narrows to
 * a candidate set via one of three secondary indexes — by subject, by object,
 * by relation — so a lookup costs O(matches) instead of O(T) (a full scan).
 * `broaden()` in the read layer emits exactly these three filter shapes, so the
 * adapter serves them straight from the matching index. Index iteration order
 * is naturally id-ascending (ids increase monotonically and are never reused),
 * which preserves the stable pagination order the contract requires.
 */
class TupleStore<S extends SubjectType, O extends ObjectType> {
  readonly tuples = new Map<TupleId, StoredTuple<S, O>>();
  private readonly bySubject = new Map<string, Set<TupleId>>();
  private readonly byObject = new Map<string, Set<TupleId>>();
  private readonly byRelation = new Map<string, Set<TupleId>>();
  private nextId = 1;

  generateId(): TupleId {
    return (this.nextId++).toString();
  }

  private static add(map: Map<string, Set<TupleId>>, key: string, id: TupleId) {
    let set = map.get(key);
    if (!set) {
      set = new Set();
      map.set(key, set);
    }
    set.add(id);
  }

  private static drop(
    map: Map<string, Set<TupleId>>,
    key: string,
    id: TupleId,
  ) {
    const set = map.get(key);
    if (set) {
      set.delete(id);
      if (set.size === 0) map.delete(key);
    }
  }

  insert(tuple: StoredTuple<S, O>): void {
    this.tuples.set(tuple.id, tuple);
    TupleStore.add(this.bySubject, keyOf(tuple.subject), tuple.id);
    TupleStore.add(this.byObject, keyOf(tuple.object), tuple.id);
    TupleStore.add(this.byRelation, tuple.relation, tuple.id);
  }

  removeId(id: TupleId): void {
    const tuple = this.tuples.get(id);
    if (!tuple) return;
    this.tuples.delete(id);
    TupleStore.drop(this.bySubject, keyOf(tuple.subject), id);
    TupleStore.drop(this.byObject, keyOf(tuple.object), id);
    TupleStore.drop(this.byRelation, tuple.relation, id);
  }

  /** O(deg(subject)) idempotency lookup — replaces the old O(T) findExisting scan. */
  findExisting(input: InputTuple<S, O>): StoredTuple<S, O> | undefined {
    const candidates = this.bySubject.get(keyOf(input.subject));
    if (!candidates) return undefined;
    for (const id of candidates) {
      const tuple = this.tuples.get(id);
      if (
        tuple &&
        tuple.relation === input.relation &&
        deepEqual(tuple.object, input.object) &&
        deepEqual(tuple.subject, input.subject)
      ) {
        return tuple;
      }
    }
    return undefined;
  }

  /** Narrow to the most selective index present (subject > object > relation). */
  private candidates(filter: {
    subject?: { type: string; id: string };
    object?: { type: string; id: string };
    relation?: Relation;
  }): Iterable<TupleId> {
    if (filter.subject)
      return this.bySubject.get(keyOf(filter.subject)) ?? EMPTY;
    if (filter.object) return this.byObject.get(keyOf(filter.object)) ?? EMPTY;
    if (filter.relation) return this.byRelation.get(filter.relation) ?? EMPTY;
    return this.tuples.keys();
  }

  readTuples(
    filter: Partial<InputTuple<S, O>>,
    options?: { limit?: number; offset?: number },
  ): StoredTuple<S, O>[] {
    const results: StoredTuple<S, O>[] = [];
    for (const id of this.candidates(filter)) {
      const tuple = this.tuples.get(id);
      if (!tuple) continue;
      if (filter.subject && !deepEqual(tuple.subject, filter.subject)) continue;
      if (filter.relation && tuple.relation !== filter.relation) continue;
      if (filter.object && !deepEqual(tuple.object, filter.object)) continue;
      if (filter.condition && !deepEqual(tuple.condition, filter.condition))
        continue;
      results.push(tuple);
    }
    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? Number.POSITIVE_INFINITY;
    return results.slice(offset, offset + limit);
  }

  readSubjects(
    object: AnyObject<O>,
    relation: Relation,
    options?: { subjectType?: S },
  ): Subject<S>[] {
    const subjects: Subject<S>[] = [];
    const seen = new Set<string>();
    for (const id of this.byObject.get(keyOf(object)) ?? EMPTY) {
      const tuple = this.tuples.get(id);
      if (
        tuple &&
        tuple.relation === relation &&
        deepEqual(tuple.object, object) &&
        (!options?.subjectType || tuple.subject.type === options.subjectType)
      ) {
        const k = keyOf(tuple.subject);
        if (!seen.has(k)) {
          subjects.push(tuple.subject as Subject<S>);
          seen.add(k);
        }
      }
    }
    return subjects;
  }

  readObjects(
    subject: Subject<S>,
    relation: Relation,
    options?: { objectType?: O },
  ): AnyObject<O>[] {
    const objects: AnyObject<O>[] = [];
    const seen = new Set<string>();
    for (const id of this.bySubject.get(keyOf(subject)) ?? EMPTY) {
      const tuple = this.tuples.get(id);
      if (
        tuple &&
        tuple.relation === relation &&
        deepEqual(tuple.subject, subject) &&
        (!options?.objectType || tuple.object.type === options.objectType)
      ) {
        const k = keyOf(tuple.object);
        if (!seen.has(k)) {
          objects.push(tuple.object as AnyObject<O>);
          seen.add(k);
        }
      }
    }
    return objects;
  }

  /**
   * Candidate ids for a delete filter, narrowed by the most selective term.
   * `onWhat` can match the subject OR object position, so when `who` is absent
   * we union both indexes.
   */
  deleteCandidates(filter: {
    who?: { type: string; id: string };
    was?: Relation;
    onWhat?: { type: string; id: string };
  }): Iterable<TupleId> {
    if (filter.who) return this.bySubject.get(keyOf(filter.who)) ?? EMPTY;
    if (filter.onWhat) {
      const key = keyOf(filter.onWhat);
      const union = new Set<TupleId>(this.byObject.get(key) ?? EMPTY);
      for (const id of this.bySubject.get(key) ?? EMPTY) union.add(id);
      return union;
    }
    if (filter.was) return this.byRelation.get(filter.was) ?? EMPTY;
    return this.tuples.keys();
  }

  /** Deep copy for point-in-time snapshots: copies each tuple and reindexes. */
  clone(): TupleStore<S, O> {
    const copy = new TupleStore<S, O>();
    for (const tuple of this.tuples.values()) {
      copy.insert({ ...tuple });
    }
    copy.nextId = this.nextId;
    return copy;
  }
}

function snapshotReader<S extends SubjectType, O extends ObjectType>(
  store: TupleStore<S, O>,
): ReadOnlyStorage<S, O> {
  return {
    findTuples: async (filter, options) => store.readTuples(filter, options),
    findSubjects: async (object, relation, options) =>
      store.readSubjects(object, relation, options),
    findObjects: async (subject, relation, options) =>
      store.readObjects(subject, relation, options),
  };
}

/**
 * An in-memory implementation of {@link StorageAdapter}.
 *
 * Results returned by methods like {@link findTuples} are live references to the stored
 * objects themselves, rather than deep copies, to maximize performance. Modifying these
 * objects directly will corrupt the store and its internal indexes silently. You should
 * treat all returned tuples as immutable, or use {@link withSnapshot} to obtain an
 * isolated, consistent point-in-time copy.
 */
export class InMemoryStorageAdapter<
  S extends SubjectType = SubjectType,
  O extends ObjectType = ObjectType,
> implements StorageAdapter<S, O>
{
  private store = new TupleStore<S, O>();

  async write(tuples: InputTuple<S, O>[]) {
    const result: StoredTuple<S, O>[] = [];
    for (const inputTuple of tuples) {
      const existing = this.store.findExisting(inputTuple);
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
      const newTuple: StoredTuple<S, O> = {
        ...inputTuple,
        id: this.store.generateId(),
      };
      this.store.insert(newTuple);
      result.push(newTuple);
    }
    return result;
  }

  async delete(filter: {
    who?: Subject<S> | AnyObject<O>;
    was?: Relation;
    onWhat?: AnyObject<O>;
  }) {
    // Guard against empty filters to prevent deleting all tuples in the store.
    if (!filter.who && !filter.was && !filter.onWhat) {
      return 0;
    }

    const idsToDelete: TupleId[] = [];
    for (const id of this.store.deleteCandidates(filter)) {
      const tuple = this.store.tuples.get(id);
      if (!tuple) continue;

      if (filter.who && !deepEqual(tuple.subject, filter.who)) continue;
      if (filter.was && tuple.relation !== filter.was) continue;
      if (filter.onWhat) {
        const matchesObject = deepEqual(tuple.object, filter.onWhat);
        const matchesSubject = deepEqual(tuple.subject, filter.onWhat);
        if (!matchesObject && !matchesSubject) continue;
      }
      idsToDelete.push(id);
    }
    for (const id of idsToDelete) this.store.removeId(id);
    return idsToDelete.length;
  }

  async findTuples(
    filter: Partial<InputTuple<S, O>>,
    options?: { limit?: number; offset?: number },
  ) {
    return this.store.readTuples(filter, options);
  }

  async findSubjects(
    object: AnyObject<O>,
    relation: Relation,
    options?: { subjectType?: S },
  ): Promise<Subject<S>[]> {
    return this.store.readSubjects(object, relation, options);
  }

  async findObjects(
    subject: Subject<S>,
    relation: Relation,
    options?: { objectType?: O },
  ): Promise<AnyObject<O>[]> {
    return this.store.readObjects(subject, relation, options);
  }

  /**
   * Run `fn` against a point-in-time copy of the store. A write that lands while
   * `fn` is in flight mutates the live store (and can edit a live tuple's
   * condition in place); cloning copies each tuple, so the operation sees one
   * coherent view without blocking writers.
   */
  async withSnapshot<T>(
    fn: (reader: ReadOnlyStorage<S, O>) => Promise<T>,
  ): Promise<T> {
    return fn(snapshotReader(this.store.clone()));
  }
}
