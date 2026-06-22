import { deepEqual } from "fast-equals";
import type { ReadOnlyStorage } from "./polizy.storage.ts";
import type {
  AnyObject,
  InputTuple,
  ObjectType,
  Relation,
  StoredTuple,
  Subject,
  SubjectType,
} from "./types.ts";

export type { ReadOnlyStorage };

/**
 * The read surface the engine resolves against. It mirrors the read half of
 * `StorageAdapter`, so the engine never cares whether it is talking to live
 * storage, a point-in-time snapshot, or the in-memory `ReadCache` below.
 */
export interface Reader<S extends SubjectType, O extends ObjectType> {
  findTuples(filter: Partial<InputTuple<S, O>>): Promise<StoredTuple<S, O>[]>;
  findSubjects(
    object: AnyObject<O>,
    relation: Relation,
    options?: { subjectType?: S },
  ): Promise<Subject<S>[]>;
  findObjects(
    subject: Subject<S>,
    relation: Relation,
    options?: { objectType?: O },
  ): Promise<AnyObject<O>[]>;
}

const objKey = (o: { type: string; id: string }) => `${o.type}:${o.id}`;

function matches<S extends SubjectType, O extends ObjectType>(
  t: StoredTuple<S, O>,
  f: Partial<InputTuple<S, O>>,
): boolean {
  // Full-value identity, exactly like the storage adapters' filters: a subject
  // or object carrying extra properties beyond {type,id} is NOT the same tuple
  // as a bare {type,id}. Comparing only type+id here would let a broadened
  // range read match tuples the adapter's point query would have rejected.
  if (f.subject && !deepEqual(t.subject, f.subject)) return false;
  if (f.relation && t.relation !== f.relation) return false;
  if (f.object && !deepEqual(t.object, f.object)) return false;
  return true;
}

/**
 * A fetched broad set plus secondary indexes over it, for O(matches) re-filtering.
 * `bySubject`/`byObject` are keyed by `objKey` (type:id) ONLY — never a full-value
 * serialization — so tuples that share a type:id but carry extra props still land
 * in the same bucket and are correctly accepted/rejected by `matches()`'s
 * `deepEqual`. These let a point query off a preloaded "*" set narrow to
 * O(deg(subject|object)) instead of scanning a whole relation bucket.
 */
type CachedSet<S extends SubjectType, O extends ObjectType> = {
  all: StoredTuple<S, O>[];
  byRelation: Map<string, StoredTuple<S, O>[]>;
  bySubject: Map<string, StoredTuple<S, O>[]>;
  byObject: Map<string, StoredTuple<S, O>[]>;
};

/**
 * Per-operation read layer that turns the engine's chatty point lookups into a
 * few broad range reads, then resolves in memory ("fetch-then-resolve").
 *
 * The engine asks tiny questions — `findTuples({subject, relation, object})`
 * ("does this one edge exist?") — over and over, re-fetching invariants like a
 * subject's group memberships on every recursion. For one logical operation the
 * tuple set is stable, so we instead fetch the BROADEST covering query once
 * (everything for that subject, or that object, or that relation), cache it, and
 * filter in memory. `findSubjects`/`findObjects` derive from the same cache, so
 * the whole operation shares one set of reads. On a measured workload this
 * collapsed 177 storage reads to single digits with identical results.
 *
 * Correctness: the engine never filters by `condition` in a read (it evaluates
 * conditions itself), so the in-memory `matches` only needs subject/relation/
 * object equality — exactly the adapters' filter semantics.
 */
export class ReadCache<S extends SubjectType, O extends ObjectType>
  implements Reader<S, O>
{
  private readonly sets = new Map<string, Promise<CachedSet<S, O>>>();
  private readonly storage: ReadOnlyStorage<S, O>;
  /** Ephemeral, request-scoped tuples evaluated as if stored (read-your-writes). */
  private readonly contextual: StoredTuple<S, O>[];

  constructor(
    storage: ReadOnlyStorage<S, O>,
    contextual: StoredTuple<S, O>[] = [],
  ) {
    this.storage = storage;
    this.contextual = contextual;
  }

  /** Map a specific filter to its broadest covering query (and a cache key). */
  private broaden(f: Partial<InputTuple<S, O>>): {
    key: string;
    broad: Partial<InputTuple<S, O>>;
  } {
    if (f.subject)
      return { key: `s:${objKey(f.subject)}`, broad: { subject: f.subject } };
    if (f.object)
      return { key: `o:${objKey(f.object)}`, broad: { object: f.object } };
    if (f.relation)
      return { key: `r:${f.relation}`, broad: { relation: f.relation } };
    return { key: "*", broad: {} };
  }

  async findTuples(
    filter: Partial<InputTuple<S, O>>,
  ): Promise<StoredTuple<S, O>[]> {
    // Preload fast-path: once the whole store has been fetched (key "*", e.g.
    // by a read scope's preload), serve every query from it — no narrower reads.
    let entry = this.sets.get("*");
    if (!entry) {
      const { key, broad } = this.broaden(filter);
      entry = this.sets.get(key);
      if (!entry) {
        entry = this.fetch(broad);
        this.sets.set(key, entry);
      }
    }
    const { all, byRelation, bySubject, byObject } = await entry;
    // Narrow to the most selective index present (subject > object > relation),
    // mirroring broaden()'s precedence and the adapter's own candidate router.
    // For a per-subject/-object cache the routed bucket equals `all`'s relevant
    // subset; for a preloaded "*" set it avoids scanning a whole relation bucket
    // (a hot wildcard principal, a big team). matches() then applies the rest.
    let pool: StoredTuple<S, O>[];
    if (filter.subject) pool = bySubject.get(objKey(filter.subject)) ?? [];
    else if (filter.object) pool = byObject.get(objKey(filter.object)) ?? [];
    else if (filter.relation) pool = byRelation.get(filter.relation) ?? [];
    else pool = all;
    const base = pool.filter((t) => matches(t, filter));
    const fromContext = this.contextual.filter((t) => matches(t, filter));
    return fromContext.length ? [...base, ...fromContext] : base;
  }

  /** Fetch a broad set once and index it by relation, subject, and object. */
  private async fetch(
    broad: Partial<InputTuple<S, O>>,
  ): Promise<CachedSet<S, O>> {
    const all = await this.storage.findTuples(broad);
    const byRelation = new Map<string, StoredTuple<S, O>[]>();
    const bySubject = new Map<string, StoredTuple<S, O>[]>();
    const byObject = new Map<string, StoredTuple<S, O>[]>();
    const push = (
      map: Map<string, StoredTuple<S, O>[]>,
      key: string,
      t: StoredTuple<S, O>,
    ) => {
      const bucket = map.get(key);
      if (bucket) bucket.push(t);
      else map.set(key, [t]);
    };
    for (const t of all) {
      push(byRelation, t.relation, t);
      push(bySubject, objKey(t.subject), t);
      push(byObject, objKey(t.object), t);
    }
    return { all, byRelation, bySubject, byObject };
  }

  async findSubjects(
    object: AnyObject<O>,
    relation: Relation,
    options?: { subjectType?: S },
  ): Promise<Subject<S>[]> {
    const tuples = await this.findTuples({
      object,
      relation: relation as InputTuple<S, O>["relation"],
    });
    const out = new Map<string, Subject<S>>();
    for (const t of tuples) {
      if (options?.subjectType && t.subject.type !== options.subjectType)
        continue;
      out.set(objKey(t.subject), t.subject as Subject<S>);
    }
    return [...out.values()];
  }

  async findObjects(
    subject: Subject<S>,
    relation: Relation,
    options?: { objectType?: O },
  ): Promise<AnyObject<O>[]> {
    const tuples = await this.findTuples({
      subject: subject as InputTuple<S, O>["subject"],
      relation: relation as InputTuple<S, O>["relation"],
    });
    const out = new Map<string, AnyObject<O>>();
    for (const t of tuples) {
      if (options?.objectType && t.object.type !== options.objectType) continue;
      out.set(objKey(t.object), t.object as AnyObject<O>);
    }
    return [...out.values()];
  }
}
