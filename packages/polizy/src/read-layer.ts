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

/** A fetched broad set plus a relation index over it, for O(matches) re-filtering. */
type CachedSet<S extends SubjectType, O extends ObjectType> = {
  all: StoredTuple<S, O>[];
  byRelation: Map<string, StoredTuple<S, O>[]>;
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
    const { all, byRelation } = await entry;
    // Narrow by relation first: a broad per-subject/-object set splits across
    // relations, so the in-memory filter stays O(matches) even when the
    // broadened set is large (a hot wildcard principal, a big team).
    const pool = filter.relation
      ? (byRelation.get(filter.relation) ?? [])
      : all;
    const base = pool.filter((t) => matches(t, filter));
    const fromContext = this.contextual.filter((t) => matches(t, filter));
    return fromContext.length ? [...base, ...fromContext] : base;
  }

  /** Fetch a broad set once and index it by relation. */
  private async fetch(
    broad: Partial<InputTuple<S, O>>,
  ): Promise<CachedSet<S, O>> {
    const all = await this.storage.findTuples(broad);
    const byRelation = new Map<string, StoredTuple<S, O>[]>();
    for (const t of all) {
      let bucket = byRelation.get(t.relation);
      if (!bucket) {
        bucket = [];
        byRelation.set(t.relation, bucket);
      }
      bucket.push(t);
    }
    return { all, byRelation };
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
