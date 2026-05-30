import type {
  AnyObject,
  InputTuple,
  ObjectType,
  Relation,
  StoredTuple,
  Subject,
  SubjectType,
} from "./types";

export interface StorageAdapter<
  S extends SubjectType = SubjectType,
  O extends ObjectType = ObjectType,
> {
  /**
   * Writes tuples to storage, idempotently. A tuple is identified by its
   * (subject, relation, object) triple: writing one that already exists updates
   * its condition rather than creating a duplicate. Returns the stored tuples
   * (with ids) in the same order as the input.
   * @param tuples An array of tuples to write (without IDs).
   */
  write(tuples: InputTuple<S, O>[]): Promise<StoredTuple<S, O>[]>;

  /**
   * Deletes tuples matching the specified filter criteria.
   * The filter allows matching by subject ('who'), relation ('was'), and/or object ('onWhat').
   * If multiple criteria are provided, only tuples matching all of them are deleted.
   * If a criterion is omitted, it acts as a wildcard for that part of the tuple.
   * Implementations should handle the case where the filter might be empty (though AuthSystem prevents this).
   *
   * @param filter An object containing optional filter criteria:
   *   - `who`: The subject (or object acting as subject) of the tuple.
   *   - `was`: The relation of the tuple.
   *   - `onWhat`: The object of the tuple.
   * @returns A promise resolving to the number of tuples deleted.
   */
  delete(filter: {
    who?: Subject<S> | AnyObject<O>;
    was?: Relation;
    onWhat?: AnyObject<O>;
  }): Promise<number>;
  /**
   * Finds stored tuples matching the filter. The delete/find subject-position
   * semantics: a `who` constraint always pins the subject; `onWhat` matches the
   * subject position only when `who` is absent.
   * @param options Optional pagination (`limit`, `offset`) applied in stable order.
   */
  findTuples(
    filter: Partial<InputTuple<S, O>>,
    options?: { limit?: number; offset?: number },
  ): Promise<StoredTuple<S, O>[]>;
  /** Finds subjects with a specific relation TO an object (e.g., members of a group). */
  findSubjects(
    object: AnyObject<O>,
    relation: Relation,
    options?: { subjectType?: S },
  ): Promise<Subject<S>[]>;
  /** Finds objects a subject has a specific relation TO (e.g., groups user is in, parent of doc). */
  findObjects(
    subject: Subject<S>,
    relation: Relation,
    options?: { objectType?: O },
  ): Promise<AnyObject<O>[]>;

  /**
   * Optional: run `fn` against a read-only view pinned to a single point in
   * time, so one authorization operation sees a consistent snapshot WITHOUT
   * locking writers (e.g. a read-only `REPEATABLE READ` transaction for SQL, or
   * a captured copy for in-memory). Adapters that can't provide this omit it,
   * and the engine falls back to live reads.
   */
  withSnapshot?<T>(
    fn: (reader: ReadOnlyStorage<S, O>) => Promise<T>,
  ): Promise<T>;
}

/** The read-only subset of a {@link StorageAdapter}, exposed to snapshot callbacks. */
export type ReadOnlyStorage<
  S extends SubjectType = SubjectType,
  O extends ObjectType = ObjectType,
> = Pick<StorageAdapter<S, O>, "findTuples" | "findSubjects" | "findObjects">;
