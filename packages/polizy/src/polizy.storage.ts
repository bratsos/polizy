import type {
  AnyObject,
  InputTuple,
  Relation,
  StoredTuple,
  Subject,
  SubjectType,
  ObjectType,
} from "./types";

export interface StorageAdapter<
  S extends SubjectType = SubjectType,
  O extends ObjectType = ObjectType,
> {
  /**
   * Writes new tuples to the storage.
   * @param tuples An array of tuples to write (without IDs).
   * @returns A promise resolving to an array of the created tuples (with assigned IDs).
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
  /** Finds stored tuples matching the filter. */
  findTuples(filter: Partial<InputTuple<S, O>>): Promise<StoredTuple<S, O>[]>;
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
}
