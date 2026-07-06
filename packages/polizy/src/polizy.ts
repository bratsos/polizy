import { isConditionValid } from "./conditions.ts";
import {
  ConfigurationError,
  MaxDepthExceededError,
  NotAuthorizedError,
  SchemaError,
} from "./errors.ts";
import type { StorageAdapter } from "./polizy.storage.ts";
import { ReadCache, type Reader } from "./read-layer.ts";
import {
  fieldSeparator,
  groupRelations,
  hierarchyRelations,
  isFieldType,
  resolveRelation,
} from "./schema.ts";
import type {
  AccessibleObject,
  AnyObject,
  AuthSchema,
  Condition,
  ExplainNode,
  ExplainResult,
  InputTuple,
  ListAccessibleObjectsArgs,
  ListAccessibleObjectsResult,
  Logger,
  ObjectType,
  SchemaObjectTypes,
  SchemaSubjectTypes,
  StoredTuple,
  Subject,
  SubjectType,
  TupleSubject,
  TypedAction,
  TypedObject,
  TypedRelation,
  TypedSubject,
} from "./types.ts";
import { PUBLIC_ID } from "./types.ts";

const noopLogger: Logger = { warn: () => {}, error: () => {} };

const cacheKey = (
  s: { type: string; id: string },
  r: string,
  o: { type: string; id: string },
): string => `${s.type}:${s.id}|${r}|${o.type}:${o.id}`;

const objKey = (o: { type: string; id: string }): string => `${o.type}:${o.id}`;

/** Order-independent serialization of a value, for fingerprinting `context`. */
const stableStringify = (v: unknown): string => {
  if (v === null || typeof v !== "object")
    return JSON.stringify(v) ?? "undefined";
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const obj = v as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(",")}}`;
};

/** Fingerprint of a check's `context` (conditions depend on it). */
const contextKey = (context?: Record<string, unknown>): string =>
  context && Object.keys(context).length > 0 ? stableStringify(context) : "";

/** Internal per-`check` traversal state. */
type ResolveState<Sub extends SubjectType, Obj extends ObjectType> = {
  depth: number;
  /** Cycle guard: keys currently on the recursion stack. */
  visited: Set<string>;
  /** Memo of fully-resolved, cycle-independent results for this check. */
  resolved: Map<string, boolean>;
  /** Context fingerprint, part of the cross-check negative-memo key. */
  ctxKey: string;
  /**
   * Optional cross-operation memo of STABLE NEGATIVE subproblems (proven to
   * have NO granting path), keyed `cacheKey@ctxKey`. Shared across the checks of
   * one operation so the same dead end isn't re-walked per check. ONLY stable
   * negatives are shared, and ONLY in `deny` mode: a negative proven by full
   * exploration is path-free at every depth, and in `deny` mode the engine
   * returns false (never throws) past the cap, so reusing it is exactly what a
   * standalone check computes. Positives are never shared (the depth cap is
   * applied before grants, so a grant past the cap denies); `throw` mode is
   * never shared (it would suppress a depth-exceeded throw).
   */
  sharedNeg?: Set<string>;
  /**
   * Optional cross-operation memo of STABLE POSITIVE subproblems, keyed
   * `cacheKey@ctxKey` → the MINIMUM observed granting-path length `L` (hops from
   * the subproblem's frame to the leaf grant). Shared across the checks of one
   * operation (deny mode only, like {@link sharedNeg}) so the upward tail every
   * candidate/object reuses (`member → team → folder → grant`) isn't re-walked.
   *
   * Soundness: a granting path of length `L` exists from this subproblem, so it
   * grants from a frame at depth `d` whenever `d + L <= defaultCheckDepth` (every
   * frame on the path is then `<= cap`). Shortest granting paths are acyclic, so
   * `L` is depth/stack-independent. Storing the MIN keeps the reuse maximally
   * applicable; `L` is always an achieved length, so it can never understate a
   * path and wrongly claim a fit. On a non-fit the engine falls through to the
   * real walk — never denies. Gated to deny mode so a depth-exceeded throw is
   * never suppressed. This is strictly more conservative than the within-check
   * `resolved` memo, which already returns cached positives with no budget gate.
   */
  sharedPos?: Map<string, number>;
  /** Per-operation read layer (broadened range reads + memoization). */
  reader: Reader<Sub, Obj>;
};

/**
 * Result of one resolution step.
 * `stable` is false when the result was influenced by a cycle cutoff or a depth
 * cutoff, meaning it is only valid in the current stack context and must NOT be
 * memoized globally. `grantDepth` (set only on positive results with a known
 * path) is the absolute depth of the leaf grant, so a caller computes the
 * granting-path length from its own frame as `grantDepth - state.depth`.
 */
type ResolveOutcome = {
  value: boolean;
  stable: boolean;
  grantDepth?: number;
};

/**
 * A request to check a single authorization query.
 */
export type CheckRequest<S extends AuthSchema<any, any, any, any, any>> = {
  /** The subject or object attempting to perform the action. */
  who: Subject<SchemaSubjectTypes<S>> | AnyObject<SchemaObjectTypes<S>>;
  /** The action to check authorization for. */
  canThey: TypedAction<S>;
  /** The resource being accessed. */
  onWhat: AnyObject<SchemaObjectTypes<S>>;
  /** Optional custom attributes for dynamic policy conditions. */
  context?: Record<string, unknown>;
};

/**
 * Options controlling how read and check operations behave.
 */
export type ReadOptions<S extends AuthSchema<any, any, any, any, any>> = {
  /**
   * Consistency mode for this query (mirrors OpenFGA's naming).
   *
   * - `"default"` reads live: consistent per broadened key via the read
   *   cache, but not guaranteed across keys, with no snapshot overhead.
   * - `"strong"` pins every read in the check to one point-in-time snapshot
   *   for full cross-key consistency — when the storage adapter supports
   *   snapshots (`withSnapshot`). Adapters without snapshot support fall back
   *   to live reads. See the read-after-write notes in the docs.
   */
  consistency?: "default" | "strong";
  /**
   * Ephemeral tuples evaluated as if they were stored — the embeddable way to
   * get read-your-writes (e.g. pass the grant you just made) without a token
   * protocol. Never persisted.
   */
  contextualTuples?: InputTuple<SchemaSubjectTypes<S>, SchemaObjectTypes<S>>[];
  /**
   * Fetch the whole tuple set up front, then resolve every check in memory.
   * Worth it when the batch issues many reads over a large working set; skip
   * it for small batches over a big store (the up-front read won't pay off). For
   * list operations (`listSubjects` / `listAccessibleObjects`) over a large store,
   * preload is the recommended mode — it replaces many per-candidate reads with
   * one pass (equivalent to `withReadScope({ preload: true })`).
   */
  preload?: boolean;
};

/**
 * The read operations exposed inside {@link AuthSystem.withReadScope}. Every
 * call shares ONE read pass, so each (subject | object | relation) is fetched
 * from storage at most once for the whole scope.
 *
 * Operation-specific options like consistency, preload, or contextualTuples must
 * not be passed to scope operations, as they share the single scope-wide reader.
 */
export interface ReadScope<S extends AuthSchema<any, any, any, any, any>> {
  check(request: CheckRequest<S>): Promise<boolean>;
  checkMany(requests: CheckRequest<S>[]): Promise<boolean[]>;
  explain(request: CheckRequest<S>): Promise<ExplainResult>;
  listAccessibleObjects(
    args: ListAccessibleObjectsArgs<S> & { limit?: number; offset?: number },
  ): Promise<ListAccessibleObjectsResult<S>>;
  listSubjects(args: {
    canThey: TypedAction<S>;
    onWhat: AnyObject<SchemaObjectTypes<S>>;
    ofType?: SchemaSubjectTypes<S>;
    context?: Record<string, unknown>;
    limit?: number;
    offset?: number;
  }): Promise<Subject<SchemaSubjectTypes<S>>[]>;
  someoneCan(args: {
    canThey: TypedAction<S>;
    onWhat: AnyObject<SchemaObjectTypes<S>>;
    ofType?: SchemaSubjectTypes<S>;
    context?: Record<string, unknown>;
  }): Promise<boolean>;
  countSubjects(args: {
    canThey: TypedAction<S>;
    onWhat: AnyObject<SchemaObjectTypes<S>>;
    ofType?: SchemaSubjectTypes<S>;
    context?: Record<string, unknown>;
  }): Promise<number>;
  countAccessibleObjects(args: ListAccessibleObjectsArgs<S>): Promise<number>;
}

export class AuthSystem<S extends AuthSchema<any, any, any, any, any>> {
  private readonly storage: StorageAdapter<
    SchemaSubjectTypes<S>,
    SchemaObjectTypes<S>
  >;
  private readonly schema: S;
  private readonly defaultCheckDepth: number;
  private readonly maxDepthBehavior: "throw" | "deny";
  private readonly logger: Logger;
  private readonly fieldSep: string;
  private readonly groupRels: string[];
  private readonly hierRels: string[];
  /** Default relation for `addMember`/`removeMember` when several group relations exist. */
  private readonly defaultGroupRelation?: string;
  /** Default relation for `setParent`/`removeParent` when several hierarchy relations exist. */
  private readonly defaultHierarchyRelation?: string;
  /** Group relations eligible for `as`-less inference (excludes scaffold-reserved ones). */
  private readonly inferableGroupRels: string[];
  /** Object types that are never real subjects (e.g. the role scaffold's `role` type). */
  private readonly nonSubjectTypes: ReadonlySet<string>;
  /** relation name -> actions it grants (inverse of `actionToRelations`). */
  private readonly relationToActions: ReadonlyMap<string, string[]>;
  /** parentAction -> child actions it propagates to (inverse of `hierarchyPropagation`). */
  private readonly inverseHierarchyPropagation: ReadonlyMap<string, string[]>;
  /** True when no object type uses field-level ids (enables the list fast paths). */
  private readonly fieldFree: boolean;

  constructor(config: {
    storage: StorageAdapter<SchemaSubjectTypes<S>, SchemaObjectTypes<S>>;
    schema: S;
    defaultCheckDepth?: number;
    maxDepthBehavior?: "throw" | "deny";
    logger?: Logger;
    /** Overrides the schema's field separator (defaults to the schema's, then "#"). */
    fieldSeparator?: string;
    /**
     * Relation `addMember`/`removeMember` use when no `as` is given and the
     * schema declares more than one `group` relation. Without it, an ambiguous
     * call throws. Useful when a second group relation (e.g. the role scaffold's
     * `assignee`) is added to a schema that previously had exactly one.
     */
    defaultGroupRelation?: TypedRelation<S>;
    /** Like {@link defaultGroupRelation}, for `setParent`/`removeParent`. */
    defaultHierarchyRelation?: TypedRelation<S>;
    /**
     * Object types that must never surface as subjects in `listSubjects` (unless
     * explicitly requested via `ofType`). The role scaffold's `role` type is
     * added automatically. Roles are an indirection node, not an actor.
     */
    nonSubjectTypes?: ReadonlyArray<SchemaObjectTypes<S>>;
  }) {
    if (!config.storage)
      throw new ConfigurationError("Storage adapter is required.");
    if (!config.schema)
      throw new ConfigurationError("Authorization schema is required.");

    this.storage = config.storage;
    this.schema = config.schema;
    this.defaultCheckDepth = config.defaultCheckDepth ?? 20;
    this.maxDepthBehavior = config.maxDepthBehavior ?? "throw";
    this.logger = config.logger ?? noopLogger;
    this.fieldSep = config.fieldSeparator ?? fieldSeparator(this.schema);
    this.groupRels = groupRelations(this.schema);
    this.hierRels = hierarchyRelations(this.schema);

    this.defaultGroupRelation = config.defaultGroupRelation as
      | string
      | undefined;
    if (
      this.defaultGroupRelation !== undefined &&
      !this.groupRels.includes(this.defaultGroupRelation)
    ) {
      throw new SchemaError(
        `defaultGroupRelation '${this.defaultGroupRelation}' is not a 'group' relation. Available: ${this.groupRels.join(", ")}.`,
      );
    }
    this.defaultHierarchyRelation = config.defaultHierarchyRelation as
      | string
      | undefined;
    if (
      this.defaultHierarchyRelation !== undefined &&
      !this.hierRels.includes(this.defaultHierarchyRelation)
    ) {
      throw new SchemaError(
        `defaultHierarchyRelation '${this.defaultHierarchyRelation}' is not a 'hierarchy' relation. Available: ${this.hierRels.join(", ")}.`,
      );
    }

    // The role scaffold reserves a dedicated `assignee` group relation for
    // user->role membership. Excluding it from inference keeps existing
    // `addMember` calls (which relied on a single group relation) working after
    // a schema opts into the scaffold — the registry always passes `as`.
    const scaffold = this.schema.roleScaffold;
    const reservedGroup = scaffold?.assigneeRelation;
    this.inferableGroupRels = reservedGroup
      ? this.groupRels.filter((r) => r !== reservedGroup)
      : this.groupRels;

    const nonSubject = new Set<string>(config.nonSubjectTypes ?? []);
    if (scaffold?.roleType) nonSubject.add(scaffold.roleType);
    this.nonSubjectTypes = nonSubject;

    // Precompute schema-derived inverse maps used by the single-pass
    // listAccessibleObjects derivation (deny mode): relation -> granting actions,
    // and parentAction -> child actions (the inverse of hierarchyPropagation).
    const relToActions = new Map<string, string[]>();
    for (const [action, rels] of Object.entries(
      this.schema.actionToRelations as Record<string, readonly string[]>,
    )) {
      for (const r of rels) {
        const list = relToActions.get(r);
        if (list) list.push(action);
        else relToActions.set(r, [action]);
      }
    }
    this.relationToActions = relToActions;

    const inverseProp = new Map<string, string[]>();
    const prop = (this.schema.hierarchyPropagation ?? {}) as Record<
      string,
      readonly string[]
    >;
    for (const [childAction, parentActions] of Object.entries(prop)) {
      for (const pa of parentActions) {
        const list = inverseProp.get(pa);
        if (list) list.push(childAction);
        else inverseProp.set(pa, [childAction]);
      }
    }
    this.inverseHierarchyPropagation = inverseProp;

    this.fieldFree =
      !this.schema.fieldLevelObjects ||
      (this.schema.fieldLevelObjects as readonly string[]).length === 0;
  }

  /** Resolve the group relation for a member write, honoring `as`/default/inference. */
  private resolveGroupRelation(as?: string): string {
    if (as !== undefined) {
      if (!this.groupRels.includes(as)) {
        throw new SchemaError(
          `Relation '${as}' is not a 'group' relation. Available: ${this.groupRels.join(", ")}.`,
        );
      }
      return as;
    }
    if (this.defaultGroupRelation !== undefined)
      return this.defaultGroupRelation;
    return resolveRelation(
      this.inferableGroupRels,
      undefined,
      "group",
      (m) => new SchemaError(m),
    );
  }

  /** Resolve the hierarchy relation for a parent write, honoring `as`/default/inference. */
  private resolveHierarchyRelation(as?: string): string {
    return resolveRelation(
      this.hierRels,
      as ?? this.defaultHierarchyRelation,
      "hierarchy",
      (m) => new SchemaError(m),
    );
  }

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  async check(request: CheckRequest<S> & ReadOptions<S>): Promise<boolean> {
    return this.withReader((reader) => this.resolveCheck(request, reader), {
      contextual: this.toContextual(request.contextualTuples),
      consistency: request.consistency,
      preload: request.preload,
    });
  }

  /**
   * Run several read operations against ONE shared read pass. Inside `fn`,
   * `scope.check`/`checkMany`/`explain`/`listAccessibleObjects`/`listSubjects`
   * all share a single reader, so each subject/object/relation is fetched from
   * storage at most once for the whole scope — not once per operation. Ideal for
   * a page that asks many authorization questions (a list endpoint, a dashboard).
   *
   * `{ preload: true }` fetches the entire tuple set up front in ONE read, so
   * every check then resolves in memory — use it when the working set is small
   * or storage round-trips are expensive (e.g. an in-browser database). Omit it
   * for large stores, where the per-key range reads scale better.
   */
  async withReadScope<T>(
    fn: (scope: ReadScope<S>) => Promise<T>,
    options?: ReadOptions<S>,
  ): Promise<T> {
    return this.withReader(
      async (reader) => {
        const scope: ReadScope<S> = {
          check: (request) => this.resolveCheck(request, reader),
          checkMany: (requests) => this.checkManyWith(requests, reader),
          explain: (request) => this.explainWith(request, reader),
          listAccessibleObjects: (args) =>
            this.listAccessibleObjectsWith(args, reader),
          listSubjects: (args) => this.listSubjectsWith(args, reader),
          someoneCan: (args) => this.someoneCanWith(args, reader),
          countSubjects: (args) => this.countSubjectsWith(args, reader),
          countAccessibleObjects: (args) =>
            this.countAccessibleObjectsWith(args, reader),
        };
        return fn(scope);
      },
      {
        contextual: this.toContextual(options?.contextualTuples),
        consistency: options?.consistency,
        preload: options?.preload,
      },
    );
  }

  /** Resolve one check against a given (per-operation) reader. */
  private async resolveCheck(
    request: CheckRequest<S>,
    reader: Reader<SchemaSubjectTypes<S>, SchemaObjectTypes<S>>,
    sharedNeg?: Set<string>,
    sharedPos?: Map<string, number>,
  ): Promise<boolean> {
    const state: ResolveState<SchemaSubjectTypes<S>, SchemaObjectTypes<S>> = {
      depth: 0,
      visited: new Set(),
      resolved: new Map(),
      ctxKey: contextKey(request.context),
      sharedNeg,
      sharedPos,
      reader,
    };
    const outcome = await this.resolveAccess(
      request.who,
      request.canThey,
      request.onWhat,
      request.context,
      state,
    );
    return outcome.value;
  }

  /**
   * Run a read operation against a per-operation {@link Reader}. The reader
   * fetches broad, deduplicated range reads (fetch-then-resolve) and, when the
   * adapter supports it, all reads come from ONE point-in-time snapshot so a
   * single operation sees a coherent view without locking writers.
   */
  private async withReader<T>(
    fn: (
      reader: Reader<SchemaSubjectTypes<S>, SchemaObjectTypes<S>>,
    ) => Promise<T>,
    options: {
      contextual?: StoredTuple<SchemaSubjectTypes<S>, SchemaObjectTypes<S>>[];
      consistency?: "default" | "strong";
      /** Fetch the entire tuple set up front so all reads resolve in memory. */
      preload?: boolean;
    } = {},
  ): Promise<T> {
    const {
      contextual = [],
      consistency = "default",
      preload = false,
    } = options;
    const storage = this.storage;
    const run = async (
      reader: Reader<SchemaSubjectTypes<S>, SchemaObjectTypes<S>>,
    ) => {
      // Materialize the whole set once; subsequent point reads resolve in
      // memory off the cache's subject/object indexes (see ReadCache).
      if (preload) await reader.findTuples({});
      return fn(reader);
    };
    // "strong" pins every read in the operation to one point-in-time snapshot
    // (when the adapter supports it) — full consistency at the cost of a
    // read transaction. "default" reads live: still consistent per broadened
    // key thanks to the ReadCache, just not across keys, and with no snapshot
    // overhead on the hot path.
    if (consistency === "strong" && storage.withSnapshot) {
      return storage.withSnapshot((snap) =>
        run(new ReadCache(snap, contextual)),
      );
    }
    return run(new ReadCache(storage, contextual));
  }

  /** Stamp request-scoped tuples with a synthetic id so they read like stored ones. */
  private toContextual(
    tuples?: InputTuple<SchemaSubjectTypes<S>, SchemaObjectTypes<S>>[],
  ): StoredTuple<SchemaSubjectTypes<S>, SchemaObjectTypes<S>>[] {
    if (!tuples || tuples.length === 0) return [];
    return tuples.map((t, i) => ({ ...t, id: `ctx:${i}` }));
  }

  /** Like {@link check}, but throws {@link NotAuthorizedError} when denied. */
  async checkOrThrow(request: CheckRequest<S> & ReadOptions<S>): Promise<void> {
    const allowed = await this.check(request);
    if (!allowed) {
      throw new NotAuthorizedError(
        request.who,
        request.canThey as string,
        request.onWhat,
      );
    }
  }

  /**
   * Answer several authorization questions at once. Each question is resolved
   * with its own memo (questions may carry different `context`), but every
   * question still benefits from within-question memoization.
   *
   * Note: per-request contextual tuples are intentionally not supported — one
   * reader per batch.
   */
  async checkMany(
    requests: CheckRequest<S>[],
    options?: ReadOptions<S>,
  ): Promise<boolean[]> {
    // One shared reader (and snapshot) across the batch: overlapping reads —
    // a subject's grants, a folder's hierarchy — are fetched once for all.
    return this.withReader((reader) => this.checkManyWith(requests, reader), {
      contextual: this.toContextual(options?.contextualTuples),
      consistency: options?.consistency,
      preload: options?.preload,
    });
  }

  /** `checkMany` against a given reader (so a read scope can share one). */
  private checkManyWith(
    requests: CheckRequest<S>[],
    reader: Reader<SchemaSubjectTypes<S>, SchemaObjectTypes<S>>,
  ): Promise<boolean[]> {
    // Each request keeps its own decision memo (a check is depth-sensitive), but
    // they may share proven dead ends (stable negatives) in deny mode.
    const sharedNeg = this.negMemo();
    return Promise.all(
      requests.map((r) => this.resolveCheck(r, reader, sharedNeg)),
    );
  }

  /**
   * A cross-operation stable-negative memo, or undefined when sharing is unsafe.
   * Only enabled in `deny` mode — see {@link ResolveState.sharedNeg}.
   */
  private negMemo(): Set<string> | undefined {
    return this.maxDepthBehavior === "deny" ? new Set<string>() : undefined;
  }

  /**
   * A cross-operation stable-positive memo (path lengths), or undefined when
   * sharing is unsafe. Only enabled in `deny` mode — see
   * {@link ResolveState.sharedPos}. Used by the list operations, whose many
   * confirms share the same upward subpaths.
   */
  private posMemo(): Map<string, number> | undefined {
    return this.maxDepthBehavior === "deny"
      ? new Map<string, number>()
      : undefined;
  }

  /** Explain why a check is allowed or denied, returning the granting path. */
  async explain(
    request: CheckRequest<S>,
    options?: ReadOptions<S>,
  ): Promise<ExplainResult> {
    return this.withReader((reader) => this.explainWith(request, reader), {
      contextual: this.toContextual(options?.contextualTuples),
      consistency: options?.consistency,
      preload: options?.preload,
    });
  }

  /** `explain` against a given reader (so a read scope can share one). */
  private async explainWith(
    request: CheckRequest<S>,
    reader: Reader<SchemaSubjectTypes<S>, SchemaObjectTypes<S>>,
  ): Promise<ExplainResult> {
    const result = await this.explainAccess(
      request.who,
      request.canThey,
      request.onWhat,
      request.context,
      0,
      new Set(),
      new Set(),
      reader,
    );
    return { allowed: result.via !== null, via: result.via };
  }

  /**
   * Reverse expansion: list the subjects that can perform `canThey` on `onWhat`.
   * Candidates are gathered from direct holders, group members (transitively),
   * and the object's hierarchy ancestors, then each is confirmed with `check`.
   */
  async listSubjects(
    args: {
      canThey: TypedAction<S>;
      onWhat: AnyObject<SchemaObjectTypes<S>>;
      ofType?: SchemaSubjectTypes<S>;
      context?: Record<string, unknown>;
      limit?: number;
      offset?: number;
    } & ReadOptions<S>,
  ): Promise<Subject<SchemaSubjectTypes<S>>[]> {
    return this.withReader((reader) => this.listSubjectsWith(args, reader), {
      contextual: this.toContextual(args.contextualTuples),
      consistency: args.consistency,
      preload: args.preload,
    });
  }

  /**
   * Existence query: does ANY subject (optionally of `ofType`) hold `canThey` on
   * `onWhat`? Short-circuits the reverse expansion at the first qualifying
   * subject rather than enumerating the whole set (field-level schemas fall back
   * to the gather-then-confirm path).
   */
  async someoneCan(
    args: {
      canThey: TypedAction<S>;
      onWhat: AnyObject<SchemaObjectTypes<S>>;
      ofType?: SchemaSubjectTypes<S>;
      context?: Record<string, unknown>;
    } & ReadOptions<S>,
  ): Promise<boolean> {
    return this.withReader((reader) => this.someoneCanWith(args, reader), {
      contextual: this.toContextual(args.contextualTuples),
      consistency: args.consistency,
      preload: args.preload,
    });
  }

  private async someoneCanWith(
    args: {
      canThey: TypedAction<S>;
      onWhat: AnyObject<SchemaObjectTypes<S>>;
      ofType?: SchemaSubjectTypes<S>;
      context?: Record<string, unknown>;
    },
    reader: Reader<SchemaSubjectTypes<S>, SchemaObjectTypes<S>>,
  ): Promise<boolean> {
    if (this.fieldFree) {
      const hit = await this.reverseExpandSubjects(args, reader, {
        earlyExit: true,
      });
      return hit.length > 0;
    }
    return (await this.listSubjectsViaForwardConfirm(args, reader)).length > 0;
  }

  /**
   * Count the subjects that can perform `canThey` on `onWhat`. A wildcard grant
   * (`everyone(type)`) counts as ONE entry (the `{type, "*"}` subject) — it is
   * not expanded to a per-user count. Computes the full set today (so it is
   * `O(reachable)`, not yet sub-linear); a future materialized index can
   * accelerate it without an API change.
   */
  async countSubjects(
    args: {
      canThey: TypedAction<S>;
      onWhat: AnyObject<SchemaObjectTypes<S>>;
      ofType?: SchemaSubjectTypes<S>;
      context?: Record<string, unknown>;
    } & ReadOptions<S>,
  ): Promise<number> {
    return this.withReader((reader) => this.countSubjectsWith(args, reader), {
      contextual: this.toContextual(args.contextualTuples),
      consistency: args.consistency,
      preload: args.preload,
    });
  }

  private async countSubjectsWith(
    args: {
      canThey: TypedAction<S>;
      onWhat: AnyObject<SchemaObjectTypes<S>>;
      ofType?: SchemaSubjectTypes<S>;
      context?: Record<string, unknown>;
    } & { limit?: number; offset?: number },
    reader: Reader<SchemaSubjectTypes<S>, SchemaObjectTypes<S>>,
  ): Promise<number> {
    // counts are over the unpaginated set, so pagination keys are stripped defensively.
    const { limit: _limit, offset: _offset, ...rest } = args;
    return (await this.listSubjectsWith(rest, reader)).length;
  }

  /**
   * Count the objects of `ofType` that `who` can access (optionally filtered to a
   * single `canThey`). Computes the full set today (`O(reachable)`); a future
   * materialized index can accelerate it without an API change.
   */
  async countAccessibleObjects(
    args: ListAccessibleObjectsArgs<S> & ReadOptions<S>,
  ): Promise<number> {
    return this.withReader(
      (reader) => this.countAccessibleObjectsWith(args, reader),
      {
        contextual: this.toContextual(args.contextualTuples),
        consistency: args.consistency,
        preload: args.preload,
      },
    );
  }

  private async countAccessibleObjectsWith(
    args: ListAccessibleObjectsArgs<S> & { limit?: number; offset?: number },
    reader: Reader<SchemaSubjectTypes<S>, SchemaObjectTypes<S>>,
  ): Promise<number> {
    // counts are over the unpaginated set, so pagination keys are stripped defensively.
    const { limit: _limit, offset: _offset, ...rest } = args;
    return (await this.listAccessibleObjectsWith(rest, reader)).accessible
      .length;
  }

  /**
   * `listSubjects` against a given reader. Field-free schemas use the
   * output-linear {@link reverseExpandSubjects} in BOTH depth modes (no
   * per-candidate forward check); in `throw` mode it raises
   * `MaxDepthExceededError` when the query's relevant subgraph exceeds the cap.
   * Field-level schemas fall back to the gather-then-confirm path.
   */
  private async listSubjectsWith(
    args: {
      canThey: TypedAction<S>;
      onWhat: AnyObject<SchemaObjectTypes<S>>;
      ofType?: SchemaSubjectTypes<S>;
      context?: Record<string, unknown>;
      limit?: number;
      offset?: number;
    },
    reader: Reader<SchemaSubjectTypes<S>, SchemaObjectTypes<S>>,
  ): Promise<Subject<SchemaSubjectTypes<S>>[]> {
    // Reverse expansion handles both modes (it throws on depth-cap truncation in
    // `throw` mode). Field-level schemas use the verify path, which handles
    // base/field expansion.
    let result: Subject<SchemaSubjectTypes<S>>[];
    if (this.fieldFree) {
      result = await this.reverseExpandSubjects(args, reader);
    } else {
      result = await this.listSubjectsViaForwardConfirm(args, reader);
    }
    const offset = args.offset ?? 0;
    const limit = args.limit ?? Number.POSITIVE_INFINITY;
    return result.slice(offset, offset + limit);
  }

  /**
   * Reverse expansion (deny mode). Compute the authorized subject set directly,
   * with no per-candidate forward check:
   *  1. walk the hierarchy UP from `onWhat`, building `(object, action)` frames
   *     with their hierarchy depth `h` (mirroring `resolveAccess` step 3:
   *     `hierarchyPropagation` remap, all hierarchy relations, field bases via
   *     `targetIdentifiers`);
   *  2. on each frame, the direct/wildcard holders of the action's relations are
   *     authorized "roots" at depth `h`;
   *  3. BFS *backward* over membership edges (a member of an authorized principal
   *     is authorized at +1) in non-decreasing combined depth, so every subject
   *     gets its SHORTEST depth and is kept iff that depth `<= defaultCheckDepth`
   *     — the same single hier+group budget the forward check enforces.
   *
   * Every read is condition-gated against `context`, and membership is read via
   * `findTuples({object, relation})` (not `findSubjects`, which drops
   * conditions). Wildcard holders/members surface verbatim as `{type, "*"}`.
   */
  private async reverseExpandSubjects(
    args: {
      canThey: TypedAction<S>;
      onWhat: AnyObject<SchemaObjectTypes<S>>;
      ofType?: SchemaSubjectTypes<S>;
      context?: Record<string, unknown>;
    },
    reader: Reader<SchemaSubjectTypes<S>, SchemaObjectTypes<S>>,
    opts?: { earlyExit?: boolean },
  ): Promise<Subject<SchemaSubjectTypes<S>>[]> {
    const { canThey, onWhat, ofType, context } = args;
    const cap = this.defaultCheckDepth;
    const earlyExit = opts?.earlyExit ?? false;
    const qualifies = (c: { type: string; id: string }) =>
      ofType ? c.type === ofType : !this.nonSubjectTypes.has(c.type);
    // Set when an edge would extend the relevant subgraph past the cap — i.e.
    // the result may be incomplete. In `throw` mode this raises at the end.
    let truncated = false;
    type Node = { type: string; id: string };

    // --- Phases 1+2: hierarchy frames → direct/wildcard holder roots (min h). ---
    const roots = new Map<string, { subject: Node; depth: number }>();
    const addRoot = (s: Node, depth: number) => {
      const k = objKey(s);
      const prev = roots.get(k);
      if (!prev || depth < prev.depth) roots.set(k, { subject: s, depth });
    };
    const frameSeen = new Set<string>();
    const frameQueue: { obj: Node; act: string; h: number }[] = [];
    const enqueueFrame = (obj: Node, act: string, h: number) => {
      if (h > cap) {
        truncated = true;
        return;
      }
      const k = `${objKey(obj)}|${act}`;
      if (frameSeen.has(k)) return;
      frameSeen.add(k);
      frameQueue.push({ obj, act, h });
    };
    enqueueFrame(onWhat, canThey as string, 0);

    while (frameQueue.length > 0) {
      const { obj, act, h } = frameQueue.shift() as {
        obj: Node;
        act: string;
        h: number;
      };
      const requiredRelations = this.schema.actionToRelations[act];
      if (!requiredRelations || requiredRelations.length === 0) continue;
      const targets = this.targetIdentifiers(obj);
      for (const target of targets) {
        for (const relation of requiredRelations) {
          const holders = await reader.findTuples({
            object: target as AnyObject<SchemaObjectTypes<S>>,
            relation: relation as string,
          });
          for (const t of holders) {
            if (isConditionValid(t.condition, context)) addRoot(t.subject, h);
          }
        }
      }
      if (this.hierRels.length > 0 && h < cap) {
        const parentActions = this.schema.hierarchyPropagation?.[act];
        if (parentActions && parentActions.length > 0) {
          for (const target of targets) {
            for (const hierRelation of this.hierRels) {
              const links = await reader.findTuples({
                subject: target as TupleSubject<
                  SchemaSubjectTypes<S>,
                  SchemaObjectTypes<S>
                >,
                relation: hierRelation,
              });
              for (const link of links) {
                if (!isConditionValid(link.condition, context)) continue;
                for (const pa of parentActions) {
                  enqueueFrame(link.object, pa as string, h + 1);
                }
              }
            }
          }
        }
      }
    }

    // --- Phase 3: reverse-membership BFS by combined depth (bucket queue). ---
    const authorized = new Map<string, Node>();
    const depthOf = new Map<string, number>();
    const buckets: Node[][] = Array.from({ length: cap + 1 }, () => []);
    const consider = (s: Node, depth: number) => {
      if (depth > cap) {
        truncated = true;
        return;
      }
      const k = objKey(s);
      const prev = depthOf.get(k);
      if (prev === undefined || depth < prev) {
        depthOf.set(k, depth);
        buckets[depth]?.push(s);
      }
    };
    for (const { subject, depth } of roots.values()) consider(subject, depth);

    for (let d = 0; d <= cap; d++) {
      for (const principal of buckets[d] ?? []) {
        const k = objKey(principal);
        if (depthOf.get(k) !== d) continue; // superseded by a shorter path
        if (authorized.has(k)) continue;
        authorized.set(k, principal);
        if (earlyExit && qualifies(principal)) {
          return [principal] as Subject<SchemaSubjectTypes<S>>[];
        }
        // At d === cap, members would land at cap+1; `consider` records that as
        // truncation rather than adding them, so the throw-mode signal fires.
        if (principal.id === PUBLIC_ID) {
          // A wildcard `{type, "*"}` authorizes EVERY concrete subject of that
          // type, so every concrete group of that type is authorized too — and
          // `check` honors the wildcard for any such group. Expand the members
          // of ALL groups of this type (one relation scan, only when a wildcard
          // of a group-acting type is in play).
          for (const groupRelation of this.groupRels) {
            const all = await reader.findTuples({ relation: groupRelation });
            for (const t of all) {
              if (t.object.type !== principal.type) continue;
              if (!isConditionValid(t.condition, context)) continue;
              consider(t.subject, d + 1);
            }
          }
        } else {
          for (const groupRelation of this.groupRels) {
            const members = await reader.findTuples({
              object: principal as AnyObject<SchemaObjectTypes<S>>,
              relation: groupRelation,
            });
            for (const t of members) {
              if (!isConditionValid(t.condition, context)) continue;
              consider(t.subject, d + 1);
            }
          }
        }
      }
    }

    // In `throw` mode, a relevant subgraph deeper than the cap means the result
    // could be incomplete — surface it like a `check` would (mirrors the
    // forward path, which throws when a candidate's resolution exceeds the cap).
    if (this.maxDepthBehavior === "throw" && truncated) {
      throw new MaxDepthExceededError(
        `listSubjects exceeded maximum depth (${cap}): the authorization graph for this query is deeper than the cap.`,
        { type: ofType ?? onWhat.type, id: "*" },
        canThey as string,
        onWhat,
        cap + 1,
      );
    }

    // --- Phase 4: filter + sort (identical to the forward-confirm path). ---
    const out = [...authorized.values()].filter(qualifies) as Subject<
      SchemaSubjectTypes<S>
    >[];
    out.sort((a, b) => objKey(a).localeCompare(objKey(b)));
    return out;
  }

  /** `listSubjects` via gather-then-forward-confirm (throw-mode fallback). */
  private async listSubjectsViaForwardConfirm(
    args: {
      canThey: TypedAction<S>;
      onWhat: AnyObject<SchemaObjectTypes<S>>;
      ofType?: SchemaSubjectTypes<S>;
      context?: Record<string, unknown>;
    },
    reader: Reader<SchemaSubjectTypes<S>, SchemaObjectTypes<S>>,
  ): Promise<Subject<SchemaSubjectTypes<S>>[]> {
    const { canThey, onWhat, ofType, context } = args;
    const candidates = new Map<string, Subject<SchemaSubjectTypes<S>>>();
    const addCandidate = (s: { type: string; id: string }) => {
      candidates.set(objKey(s), s as Subject<SchemaSubjectTypes<S>>);
    };

    // Objects whose grantees could reach onWhat: onWhat, its base, its ancestors.
    const objectsToInspect = await this.ancestorsOf(onWhat, context, reader);

    for (const obj of objectsToInspect) {
      const holders = await reader.findTuples({
        object: obj as AnyObject<SchemaObjectTypes<S>>,
      });
      for (const tuple of holders) {
        addCandidate(tuple.subject);
        await this.collectGroupMembers(
          tuple.subject,
          addCandidate,
          new Set(),
          0,
          reader,
        );
      }
    }

    // Confirm candidates concurrently (reads are shared via `reader`; each check
    // keeps its own decision memo, dead ends shared in deny mode). When no
    // `ofType` filter is given, drop non-subject types (e.g. role-scaffold
    // `role` objects) so an indirection node never leaks as an actor; an
    // explicit `ofType` is always honored verbatim.
    const toCheck = [...candidates.values()].filter((c) =>
      ofType ? c.type === ofType : !this.nonSubjectTypes.has(c.type),
    );
    const sharedNeg = this.negMemo();
    // Candidates share the upward confirm tail (member → team → folder → grant);
    // a shared positive memo collapses it instead of re-walking it per candidate.
    const sharedPos = this.posMemo();
    const decisions = await Promise.all(
      toCheck.map((candidate) =>
        this.resolveCheck(
          { who: candidate, canThey, onWhat, context },
          reader,
          sharedNeg,
          sharedPos,
        ),
      ),
    );
    const confirmed = toCheck.filter((_, i) => decisions[i]);
    confirmed.sort((a, b) => objKey(a).localeCompare(objKey(b)));
    return confirmed;
  }

  async listTuples(
    filter: Partial<
      Omit<InputTuple<SchemaSubjectTypes<S>, SchemaObjectTypes<S>>, "id"> & {
        relation: TypedRelation<S>;
      }
    >,
    options?: { limit?: number; offset?: number },
  ): Promise<StoredTuple<SchemaSubjectTypes<S>, SchemaObjectTypes<S>>[]> {
    const results = await this.storage.findTuples(
      filter as Partial<
        InputTuple<SchemaSubjectTypes<S>, SchemaObjectTypes<S>>
      >,
      options,
    );
    return results as StoredTuple<
      SchemaSubjectTypes<S>,
      SchemaObjectTypes<S>
    >[];
  }

  async listAccessibleObjects(
    args: ListAccessibleObjectsArgs<S> & {
      limit?: number;
      offset?: number;
    } & ReadOptions<S>,
  ): Promise<ListAccessibleObjectsResult<S>> {
    return this.withReader(
      (reader) => this.listAccessibleObjectsWith(args, reader),
      {
        contextual: this.toContextual(args.contextualTuples),
        consistency: args.consistency,
        preload: args.preload,
      },
    );
  }

  /**
   * `listAccessibleObjects` against a given reader. Field-free schemas use the
   * single-pass forward derivation {@link deriveAccessibleObjects} in BOTH depth
   * modes (no per-(object × action) check); in `throw` mode it raises
   * `MaxDepthExceededError` when the reachable subgraph exceeds the cap.
   * Field-level schemas fall back to gather-then-verify, which handles
   * base/field expansion.
   */
  private async listAccessibleObjectsWith(
    args: ListAccessibleObjectsArgs<S> & { limit?: number; offset?: number },
    reader: Reader<SchemaSubjectTypes<S>, SchemaObjectTypes<S>>,
  ): Promise<ListAccessibleObjectsResult<S>> {
    // Single-pass derivation handles both modes (it throws on depth-cap
    // truncation in `throw` mode). Field-level schemas use the verify path,
    // which handles base/field expansion.
    if (this.fieldFree) {
      return this.deriveAccessibleObjects(args, reader);
    }
    return this.listAccessibleObjectsViaVerify(args, reader);
  }

  /**
   * Single-pass derivation (deny mode, no field-level objects). Compute each
   * accessible object's action set in one forward sweep instead of a
   * per-(object × action) `check`:
   *  1. subject closure — `who`, its `everyone(who.type)` wildcard, and the
   *     groups it belongs to (transitively, bounded by `maxDepth`), each with a
   *     min group-depth `gd`. Reaching a concrete group of type T also activates
   *     `everyone(T)` at the same depth (the wildcard a group matches);
   *  2. seed — each closure principal's direct grants give object `o` relation
   *     `r` at depth `gd`, so `o` gains every action in `relationToActions[r]`;
   *  3. propagate DOWN the hierarchy via the inverse of `hierarchyPropagation`,
   *     each hop +1, keeping the MIN total depth per (object, action);
   * an object grants an action iff that min depth `<= defaultCheckDepth`.
   * Conditions are evaluated at every read against `context`.
   */
  private async deriveAccessibleObjects(
    args: ListAccessibleObjectsArgs<S> & { limit?: number; offset?: number },
    reader: Reader<SchemaSubjectTypes<S>, SchemaObjectTypes<S>>,
  ): Promise<ListAccessibleObjectsResult<S>> {
    const {
      who,
      ofType,
      canThey: specificActionFilter,
      context,
      maxDepth: argsMaxDepth,
    } = args;
    const cap = this.defaultCheckDepth;
    const maxDepth = argsMaxDepth ?? cap;
    // Set when an edge would extend the relevant subgraph past the cap; raises
    // in `throw` mode at the end (a `maxDepth` arg below the cap is a requested
    // bound, not truncation, so only depths beyond the cap count).
    let truncated = false;
    type Node = { type: string; id: string };

    // --- Phase A: subject closure (concrete principals + `everyone(type)`). ---
    const closure = new Map<string, { principal: Node; gd: number }>();
    const cDepth = new Map<string, number>();
    const cBuckets: Node[][] = Array.from({ length: maxDepth + 1 }, () => []);
    const addPrincipal = (p: Node, gd: number) => {
      if (gd > maxDepth) {
        if (gd > cap) truncated = true;
        return;
      }
      const k = objKey(p);
      const prev = cDepth.get(k);
      if (prev === undefined || gd < prev) {
        cDepth.set(k, gd);
        cBuckets[gd]?.push(p);
      }
    };
    addPrincipal(who, 0);
    if (who.id !== PUBLIC_ID)
      addPrincipal({ type: who.type, id: PUBLIC_ID }, 0);
    for (let gd = 0; gd <= maxDepth; gd++) {
      for (const p of cBuckets[gd] ?? []) {
        const k = objKey(p);
        if (cDepth.get(k) !== gd) continue;
        if (closure.has(k)) continue;
        closure.set(k, { principal: p, gd });
        // At gd === maxDepth, members land at maxDepth+1; `addPrincipal` records
        // that as truncation (when past the cap) rather than adding them.
        for (const groupRelation of this.groupRels) {
          // `p`'s memberships, plus the wildcard memberships of `p`'s type
          // (everyone(p.type) is a member of g => p is too).
          const direct = await reader.findTuples({
            subject: p as TupleSubject<
              SchemaSubjectTypes<S>,
              SchemaObjectTypes<S>
            >,
            relation: groupRelation,
          });
          const wild =
            p.id === PUBLIC_ID
              ? []
              : await reader.findTuples({
                  subject: { type: p.type, id: PUBLIC_ID } as TupleSubject<
                    SchemaSubjectTypes<S>,
                    SchemaObjectTypes<S>
                  >,
                  relation: groupRelation,
                });
          for (const t of [...direct, ...wild]) {
            if (!isConditionValid(t.condition, context)) continue;
            const g = t.object;
            addPrincipal(g, gd + 1);
            // reaching group g (type T) also activates everyone(T) at gd+1.
            if (g.id !== PUBLIC_ID)
              addPrincipal({ type: g.type, id: PUBLIC_ID }, gd + 1);
          }
        }
      }
    }

    // --- Phases B+C: seed object/action depths from grants, then propagate. ---
    // objActionDepth: objKey -> (action -> min total depth gd + hierarchy hops).
    const objActionDepth = new Map<string, Map<string, number>>();
    const objNode = new Map<string, Node>();
    const propBuckets: { objKey: string; action: string }[][] = Array.from(
      { length: cap + 1 },
      () => [],
    );
    const record = (obj: Node, action: string, depth: number) => {
      if (depth > cap) {
        truncated = true;
        return;
      }
      const ok = objKey(obj);
      objNode.set(ok, obj);
      let m = objActionDepth.get(ok);
      if (!m) {
        m = new Map();
        objActionDepth.set(ok, m);
      }
      const prev = m.get(action);
      if (prev === undefined || depth < prev) {
        m.set(action, depth);
        propBuckets[depth]?.push({ objKey: ok, action });
      }
    };

    for (const { principal, gd } of closure.values()) {
      if (gd > cap) continue;
      for (const tuple of await reader.findTuples({
        subject: principal as TupleSubject<
          SchemaSubjectTypes<S>,
          SchemaObjectTypes<S>
        >,
      })) {
        if (!isConditionValid(tuple.condition, context)) continue;
        const actions = this.relationToActions.get(tuple.relation);
        if (!actions) continue;
        for (const a of actions) record(tuple.object, a, gd);
      }
    }

    // Propagate down the hierarchy in non-decreasing total depth.
    for (let d = 0; d <= cap; d++) {
      for (const { objKey: ok, action } of propBuckets[d] ?? []) {
        const m = objActionDepth.get(ok);
        if (!m || m.get(action) !== d) continue; // superseded by a shorter path
        // At d === cap, children land at cap+1; `record` flags that as
        // truncation rather than adding them.
        const childActions = this.inverseHierarchyPropagation.get(action);
        if (!childActions || childActions.length === 0) continue;
        const parent = objNode.get(ok);
        if (!parent) continue;
        for (const hierRel of this.hierRels) {
          const childLinks = await reader.findTuples({
            relation: hierRel,
            object: parent as AnyObject<SchemaObjectTypes<S>>,
          });
          for (const link of childLinks) {
            if (!isConditionValid(link.condition, context)) continue;
            for (const a2 of childActions) record(link.subject, a2, d + 1);
          }
        }
      }
    }

    // In `throw` mode, a reachable subgraph deeper than the cap means the result
    // could be incomplete — surface it like a `check` would.
    if (this.maxDepthBehavior === "throw" && truncated) {
      throw new MaxDepthExceededError(
        `listAccessibleObjects exceeded maximum depth (${cap}): the reachable graph for this subject is deeper than the cap.`,
        who,
        (specificActionFilter ?? "*") as string,
        { type: ofType, id: "*" },
        cap + 1,
      );
    }

    // --- Assemble: objects of `ofType` with at least one in-budget action. ---
    // Action order matches the verify path (schema `actionToRelations` order).
    const allActions = Object.keys(
      this.schema.actionToRelations,
    ) as TypedAction<S>[];
    const accessible: AccessibleObject<S>[] = [];
    for (const [ok, m] of objActionDepth) {
      const obj = objNode.get(ok) as Node;
      if (obj.type !== ofType) continue;
      const allowed = allActions.filter((a) => {
        const depth = m.get(a as string);
        return depth !== undefined && depth <= cap;
      });
      if (allowed.length === 0) continue;
      if (specificActionFilter && !allowed.includes(specificActionFilter))
        continue;
      // `parent` key always present (undefined when none) to match the verify path.
      accessible.push({
        object: obj as TypedObject<S>,
        actions: allowed,
        parent: undefined,
      });
    }

    // Parent field, reachable-set only (matches the verify path).
    await Promise.all(
      accessible.map(async (entry) => {
        for (const hierRel of this.hierRels) {
          const links = await reader.findTuples({
            subject: entry.object as TupleSubject<
              SchemaSubjectTypes<S>,
              SchemaObjectTypes<S>
            >,
            relation: hierRel,
          });
          const valid = links.find((l) =>
            isConditionValid(l.condition, context),
          );
          if (valid) {
            entry.parent = valid.object as TypedObject<S>;
            break;
          }
        }
      }),
    );

    accessible.sort((a, b) => objKey(a.object).localeCompare(objKey(b.object)));
    const offset = args.offset ?? 0;
    const limit = args.limit ?? Number.POSITIVE_INFINITY;
    return { accessible: accessible.slice(offset, offset + limit) };
  }

  /** `listAccessibleObjects` via gather-then-verify (throw mode / field-level). */
  private async listAccessibleObjectsViaVerify(
    args: ListAccessibleObjectsArgs<S> & { limit?: number; offset?: number },
    reader: Reader<SchemaSubjectTypes<S>, SchemaObjectTypes<S>>,
  ): Promise<ListAccessibleObjectsResult<S>> {
    const {
      who,
      ofType,
      canThey: specificActionFilter,
      context,
      maxDepth: argsMaxDepth,
    } = args;
    const maxDepth = argsMaxDepth ?? this.defaultCheckDepth;

    const potential = new Map<string, TypedObject<S>>();
    const addPotential = (obj: { type: string; id: string }) => {
      potential.set(objKey(obj), obj as TypedObject<S>);
      const base = this.baseObject(obj);
      if (base) potential.set(objKey(base), base as TypedObject<S>);
    };

    // 1. Objects the subject has a direct relationship to — including wildcard
    //    (`everyone(type)`) direct grants, which `check` honors for any concrete
    //    subject of that type but which a `{subject: who}` read alone would miss.
    for (const tuple of await reader.findTuples({ subject: who })) {
      if (isConditionValid(tuple.condition, context))
        addPotential(tuple.object);
    }
    if (who.id !== PUBLIC_ID) {
      for (const tuple of await reader.findTuples({
        subject: { type: who.type, id: PUBLIC_ID } as TupleSubject<
          SchemaSubjectTypes<S>,
          SchemaObjectTypes<S>
        >,
      })) {
        if (isConditionValid(tuple.condition, context))
          addPotential(tuple.object);
      }
    }

    // 2. Objects reachable via the subject's groups (transitively).
    const groups = await this.findGroupsRecursive(
      who,
      maxDepth,
      new Set(),
      reader,
      context,
    );
    for (const group of groups) {
      for (const tuple of await reader.findTuples({
        subject: group as TupleSubject<
          SchemaSubjectTypes<S>,
          SchemaObjectTypes<S>
        >,
      })) {
        if (isConditionValid(tuple.condition, context))
          addPotential(tuple.object);
      }
    }

    // 2b. Wildcard grants to a group-acting type: if `who` belongs to a group of
    //     type T, and `everyone(T)` is granted something, `check` honors that for
    //     `who` (the concrete group matches the wildcard) — so gather those too.
    const wildcardTypes = new Set<string>(groups.map((g) => g.type));
    wildcardTypes.delete(who.type); // who.type already gathered in step 1
    for (const t of wildcardTypes) {
      for (const tuple of await reader.findTuples({
        subject: { type: t, id: PUBLIC_ID } as TupleSubject<
          SchemaSubjectTypes<S>,
          SchemaObjectTypes<S>
        >,
      })) {
        if (isConditionValid(tuple.condition, context))
          addPotential(tuple.object);
      }
    }

    // 3. Descend the hierarchy from accessible objects to their descendants.
    //    Each descendant is verified with check() below, so an over-inclusive
    //    candidate set is harmless. No full-table scan is performed.
    const queue: TypedObject<S>[] = Array.from(potential.values());
    const walkedParents = new Set<string>();
    while (queue.length > 0) {
      const parent = queue.shift() as TypedObject<S>;
      const pk = objKey(parent);
      if (walkedParents.has(pk)) continue;
      walkedParents.add(pk);
      for (const hierRel of this.hierRels) {
        const childLinks = await reader.findTuples({
          relation: hierRel,
          object: parent as AnyObject<SchemaObjectTypes<S>>,
        });
        for (const link of childLinks) {
          if (!isConditionValid(link.condition, context)) continue;
          const child = link.subject as TypedObject<S>;
          if (!potential.has(objKey(child))) {
            addPotential(child);
            queue.push(child);
          }
        }
      }
    }

    // Map each accessible object to its (first) parent, for the result's
    // `parent` field — built from the reachable set only (each object's own
    // parent links), not a full per-hierarchy-relation table scan. Declared
    // relation order with first valid link winning preserves the previous
    // selection.
    const childToParentMap = new Map<string, TypedObject<S>>();
    await Promise.all(
      Array.from(potential.values()).map(async (obj) => {
        for (const hierRel of this.hierRels) {
          const links = await reader.findTuples({
            subject: obj as TupleSubject<
              SchemaSubjectTypes<S>,
              SchemaObjectTypes<S>
            >,
            relation: hierRel,
          });
          const valid = links.find((l) =>
            isConditionValid(l.condition, context),
          );
          if (valid) {
            childToParentMap.set(objKey(obj), valid.object as TypedObject<S>);
            break;
          }
        }
      }),
    );

    const allActions = Object.keys(
      this.schema.actionToRelations,
    ) as TypedAction<S>[];

    // The (object, action) checks all share `who` and `context`, so proven
    // dead ends (e.g. "who is not owner of this folder") are reused across
    // them in deny mode — as is the shared upward grant tail of positives
    // (the same (who, ancestor-chain) subproblem recurs across actions and
    // sibling objects).
    const sharedNeg = this.negMemo();
    const sharedPos = this.posMemo();
    const accessible: AccessibleObject<S>[] = [];
    await Promise.all(
      Array.from(potential.values())
        .filter((obj) => obj.type === ofType)
        .map(async (obj) => {
          const allowed: TypedAction<S>[] = [];
          for (const action of allActions) {
            if (
              await this.resolveCheck(
                { who, canThey: action, onWhat: obj, context },
                reader,
                sharedNeg,
                sharedPos,
              )
            ) {
              allowed.push(action);
            }
          }
          if (allowed.length === 0) return;
          if (specificActionFilter && !allowed.includes(specificActionFilter))
            return;
          accessible.push({
            object: obj,
            actions: allowed,
            parent: childToParentMap.get(objKey(obj)),
          });
        }),
    );

    accessible.sort((a, b) => objKey(a.object).localeCompare(objKey(b.object)));

    const offset = args.offset ?? 0;
    const limit = args.limit ?? Number.POSITIVE_INFINITY;
    return { accessible: accessible.slice(offset, offset + limit) };
  }

  // ---------------------------------------------------------------------------
  // Writes
  // ---------------------------------------------------------------------------

  async writeTuple(
    tuple: Omit<
      InputTuple<SchemaSubjectTypes<S>, SchemaObjectTypes<S>>,
      "id"
    > & { relation: TypedRelation<S> },
  ): Promise<StoredTuple<SchemaSubjectTypes<S>, SchemaObjectTypes<S>>> {
    if (!this.schema.relations[tuple.relation]) {
      throw new SchemaError(
        `Relation '${String(tuple.relation)}' is not defined in the schema.`,
      );
    }
    this.validateFieldId(tuple.object);
    const results = await this.storage.write([
      tuple as InputTuple<SchemaSubjectTypes<S>, SchemaObjectTypes<S>>,
    ]);
    if (!results || results.length === 0 || !results[0]) {
      throw new Error("Storage adapter failed to return the written tuple.");
    }
    return results[0] as StoredTuple<
      SchemaSubjectTypes<S>,
      SchemaObjectTypes<S>
    >;
  }

  async allow(args: {
    who: Subject<SchemaSubjectTypes<S>> | AnyObject<SchemaObjectTypes<S>>;
    toBe: TypedRelation<S>;
    onWhat: AnyObject<SchemaObjectTypes<S>>;
    when?: Condition;
  }): Promise<StoredTuple<SchemaSubjectTypes<S>, SchemaObjectTypes<S>>> {
    return this.writeTuple({
      subject: args.who as TupleSubject<
        SchemaSubjectTypes<S>,
        SchemaObjectTypes<S>
      >,
      relation: args.toBe as string & TypedRelation<S>,
      object: args.onWhat,
      condition: args.when,
    });
  }

  /** Idempotently grant several relationships at once. */
  async allowMany(
    grants: Array<{
      who: Subject<SchemaSubjectTypes<S>> | AnyObject<SchemaObjectTypes<S>>;
      toBe: TypedRelation<S>;
      onWhat: AnyObject<SchemaObjectTypes<S>>;
      when?: Condition;
    }>,
  ): Promise<StoredTuple<SchemaSubjectTypes<S>, SchemaObjectTypes<S>>[]> {
    for (const g of grants) {
      if (!this.schema.relations[g.toBe]) {
        throw new SchemaError(
          `Relation '${String(g.toBe)}' is not defined in the schema.`,
        );
      }
      this.validateFieldId(g.onWhat);
    }
    const inputs = grants.map((g) => ({
      subject: g.who,
      relation: g.toBe as string,
      object: g.onWhat,
      condition: g.when,
    })) as InputTuple<SchemaSubjectTypes<S>, SchemaObjectTypes<S>>[];
    const results = await this.storage.write(inputs);
    return results as StoredTuple<
      SchemaSubjectTypes<S>,
      SchemaObjectTypes<S>
    >[];
  }

  async disallowAllMatching(filter: {
    who?: Subject<SchemaSubjectTypes<S>> | AnyObject<SchemaObjectTypes<S>>;
    was?: TypedRelation<S>;
    onWhat?: AnyObject<SchemaObjectTypes<S>>;
  }): Promise<number> {
    return this.deleteTuple(filter);
  }

  async addMember(args: {
    member: Subject<SchemaSubjectTypes<S>> | AnyObject<SchemaObjectTypes<S>>;
    group: AnyObject<SchemaObjectTypes<S>>;
    as?: TypedRelation<S>;
    condition?: Condition;
  }): Promise<StoredTuple<SchemaSubjectTypes<S>, SchemaObjectTypes<S>>> {
    const relation = this.resolveGroupRelation(args.as as string | undefined);
    return this.writeTuple({
      subject: args.member as TupleSubject<
        SchemaSubjectTypes<S>,
        SchemaObjectTypes<S>
      >,
      relation: relation as string & TypedRelation<S>,
      object: args.group,
      condition: args.condition,
    });
  }

  async removeMember(args: {
    member: Subject<SchemaSubjectTypes<S>> | AnyObject<SchemaObjectTypes<S>>;
    group: AnyObject<SchemaObjectTypes<S>>;
    as?: TypedRelation<S>;
  }): Promise<number> {
    const relation = this.resolveGroupRelation(args.as as string | undefined);
    return this.deleteTuple({
      who: args.member,
      was: relation as TypedRelation<S>,
      onWhat: args.group,
    });
  }

  async setParent(args: {
    child: AnyObject<SchemaObjectTypes<S>>;
    parent: AnyObject<SchemaObjectTypes<S>>;
    as?: TypedRelation<S>;
    condition?: Condition;
  }): Promise<StoredTuple<SchemaSubjectTypes<S>, SchemaObjectTypes<S>>> {
    const relation = this.resolveHierarchyRelation(
      args.as as string | undefined,
    );
    return this.writeTuple({
      subject: args.child as TupleSubject<
        SchemaSubjectTypes<S>,
        SchemaObjectTypes<S>
      >,
      relation: relation as string & TypedRelation<S>,
      object: args.parent,
      condition: args.condition,
    });
  }

  async removeParent(args: {
    child: AnyObject<SchemaObjectTypes<S>>;
    parent: AnyObject<SchemaObjectTypes<S>>;
    as?: TypedRelation<S>;
  }): Promise<number> {
    const relation = this.resolveHierarchyRelation(
      args.as as string | undefined,
    );
    return this.deleteTuple({
      who: args.child as TupleSubject<
        SchemaSubjectTypes<S>,
        SchemaObjectTypes<S>
      >,
      was: relation as TypedRelation<S>,
      onWhat: args.parent,
    });
  }

  // ---------------------------------------------------------------------------
  // Internal engine
  // ---------------------------------------------------------------------------

  private async deleteTuple(filter: {
    who?: Subject<SchemaSubjectTypes<S>> | AnyObject<SchemaObjectTypes<S>>;
    was?: TypedRelation<S>;
    onWhat?: AnyObject<SchemaObjectTypes<S>>;
  }): Promise<number> {
    if (!filter.who && !filter.was && !filter.onWhat) {
      this.logger.warn(
        "disallowAllMatching called with an empty filter. No tuples were deleted.",
      );
      return 0;
    }
    return this.storage.delete({
      ...filter,
      was: filter.was as string | undefined,
    });
  }

  /**
   * Core recursive resolution with cycle-aware memoization.
   *
   * `visited` is a stack guard: re-entering a key on the current stack is a cycle
   * and yields `false` (unstable). `resolved` memoizes results, but only those
   * not influenced by a cycle or depth cutoff (`stable`), so the memo can never
   * cache a false produced by cutting a cycle short.
   */
  private async resolveAccess(
    who: { type: string; id: string },
    action: TypedAction<S>,
    onWhat: { type: string; id: string },
    context: Record<string, unknown> | undefined,
    state: ResolveState<SchemaSubjectTypes<S>, SchemaObjectTypes<S>>,
  ): Promise<ResolveOutcome> {
    const key = cacheKey(who, action as string, onWhat);

    if (state.resolved.has(key)) {
      return { value: state.resolved.get(key) as boolean, stable: true };
    }
    // Cross-check: a subproblem proven path-free by an earlier check in this
    // operation (deny mode only — see ResolveState.sharedNeg).
    if (state.sharedNeg?.has(`${key}@${state.ctxKey}`)) {
      return { value: false, stable: true };
    }
    // Cross-check: a subproblem with a known granting path that fits the budget
    // from here (deny mode only — see ResolveState.sharedPos). On a non-fit we
    // fall through to the real walk; we never deny on a miss.
    if (state.sharedPos !== undefined) {
      const cachedLen = state.sharedPos.get(`${key}@${state.ctxKey}`);
      if (
        cachedLen !== undefined &&
        state.depth + cachedLen <= this.defaultCheckDepth
      ) {
        state.resolved.set(key, true);
        return {
          value: true,
          stable: true,
          grantDepth: state.depth + cachedLen,
        };
      }
    }
    if (state.visited.has(key)) {
      return { value: false, stable: false }; // cycle cutoff
    }
    if (state.depth > this.defaultCheckDepth) {
      if (this.maxDepthBehavior === "throw") {
        throw new MaxDepthExceededError(
          `Authorization check exceeded maximum depth (${this.defaultCheckDepth}).`,
          who,
          action as string,
          onWhat,
          state.depth,
        );
      }
      this.logger.warn(
        `Authorization check exceeded maximum depth (${this.defaultCheckDepth})`,
        { who, action, onWhat },
      );
      return { value: false, stable: false }; // depth cutoff
    }

    const requiredRelations = this.schema.actionToRelations[action];
    if (!requiredRelations || requiredRelations.length === 0) {
      return { value: false, stable: true };
    }

    const targets = this.targetIdentifiers(onWhat);
    state.visited.add(key);
    let stable = true;
    const posKey = `${key}@${state.ctxKey}`;
    const recordPos = (len: number) => {
      if (state.sharedPos === undefined) return;
      const prev = state.sharedPos.get(posKey);
      if (prev === undefined || len < prev) state.sharedPos.set(posKey, len);
    };
    // A grant found at this very frame: path length 0, leaf depth = state.depth.
    const grantHere = (): ResolveOutcome => {
      state.resolved.set(key, true);
      recordPos(0);
      return { value: true, stable: true, grantDepth: state.depth };
    };
    // A grant found via a sub-call: propagate the leaf's absolute depth; the
    // path length from here is `sub.grantDepth - state.depth`. Skip the memo
    // write when the sub-result has no known path (a within-check `resolved`
    // hit) so the memo only ever stores achieved lengths.
    const grantVia = (sub: ResolveOutcome): ResolveOutcome => {
      state.resolved.set(key, true);
      if (sub.grantDepth !== undefined) recordPos(sub.grantDepth - state.depth);
      return { value: true, stable: true, grantDepth: sub.grantDepth };
    };
    try {
      // 1. Direct relationships (and wildcard/public grants).
      for (const target of targets) {
        for (const relation of requiredRelations) {
          const direct = await state.reader.findTuples({
            subject: who as TupleSubject<
              SchemaSubjectTypes<S>,
              SchemaObjectTypes<S>
            >,
            relation: relation as string,
            object: target as AnyObject<SchemaObjectTypes<S>>,
          });
          for (const tuple of direct) {
            if (isConditionValid(tuple.condition, context)) {
              return grantHere();
            }
          }
          if (who.id !== PUBLIC_ID) {
            const wild = await state.reader.findTuples({
              subject: { type: who.type, id: PUBLIC_ID } as TupleSubject<
                SchemaSubjectTypes<S>,
                SchemaObjectTypes<S>
              >,
              relation: relation as string,
              object: target as AnyObject<SchemaObjectTypes<S>>,
            });
            for (const tuple of wild) {
              if (isConditionValid(tuple.condition, context)) {
                return grantHere();
              }
            }
          }
        }
      }

      // 2. Group memberships (all group relations). Recurse with the original
      //    onWhat so the group's own field/hierarchy resolution applies. A
      //    wildcard membership (`everyone(type)` is a member of the group) lets
      //    every subject of that type inherit the group's access.
      for (const groupRelation of this.groupRels) {
        const memberships = await state.reader.findTuples({
          subject: who as TupleSubject<
            SchemaSubjectTypes<S>,
            SchemaObjectTypes<S>
          >,
          relation: groupRelation,
        });
        const wildMemberships =
          who.id === PUBLIC_ID
            ? []
            : await state.reader.findTuples({
                subject: { type: who.type, id: PUBLIC_ID } as TupleSubject<
                  SchemaSubjectTypes<S>,
                  SchemaObjectTypes<S>
                >,
                relation: groupRelation,
              });
        for (const membership of [...memberships, ...wildMemberships]) {
          if (!isConditionValid(membership.condition, context)) continue;
          const sub = await this.resolveAccess(
            membership.object,
            action,
            onWhat,
            context,
            { ...state, depth: state.depth + 1 },
          );
          if (sub.value) {
            return grantVia(sub);
          }
          stable = stable && sub.stable;
        }
      }

      // 3. Hierarchy propagation (all hierarchy relations), per target id.
      if (this.hierRels.length > 0) {
        const parentActions = this.schema.hierarchyPropagation?.[action];
        if (parentActions && parentActions.length > 0) {
          for (const target of targets) {
            for (const hierRelation of this.hierRels) {
              const parentLinks = await state.reader.findTuples({
                subject: target as TupleSubject<
                  SchemaSubjectTypes<S>,
                  SchemaObjectTypes<S>
                >,
                relation: hierRelation,
              });
              for (const link of parentLinks) {
                if (!isConditionValid(link.condition, context)) continue;
                for (const parentAction of parentActions) {
                  const sub = await this.resolveAccess(
                    who,
                    parentAction as TypedAction<S>,
                    link.object,
                    context,
                    { ...state, depth: state.depth + 1 },
                  );
                  if (sub.value) {
                    return grantVia(sub);
                  }
                  stable = stable && sub.stable;
                }
              }
            }
          }
        }
      }

      if (stable) {
        state.resolved.set(key, false);
        state.sharedNeg?.add(`${key}@${state.ctxKey}`);
      }
      return { value: false, stable };
    } finally {
      state.visited.delete(key);
    }
  }

  /** Parallel walk that returns the first granting path (for `explain`). */
  private async explainAccess(
    who: { type: string; id: string },
    action: TypedAction<S>,
    onWhat: { type: string; id: string },
    context: Record<string, unknown> | undefined,
    depth: number,
    visited: Set<string>,
    noPath: Set<string>,
    reader: Reader<SchemaSubjectTypes<S>, SchemaObjectTypes<S>>,
  ): Promise<{ via: ExplainNode | null; stable: boolean }> {
    const key = cacheKey(who, action as string, onWhat);
    // Stable negative memo: keys proven to have NO granting path (fully
    // explored, not cut short by a cycle or the depth cap) short-circuit, so a
    // shared subproblem isn't re-walked once per path. Without it, explain walks
    // the subproblem DAG as a tree — exponential on deep deny paths.
    if (noPath.has(key)) return { via: null, stable: true };
    if (visited.has(key)) return { via: null, stable: false };
    if (depth > this.defaultCheckDepth) return { via: null, stable: false };
    const requiredRelations = this.schema.actionToRelations[action];
    if (!requiredRelations || requiredRelations.length === 0) {
      noPath.add(key);
      return { via: null, stable: true };
    }

    const targets = this.targetIdentifiers(onWhat);
    const wrap = (
      target: { type: string; id: string },
      node: ExplainNode,
    ): ExplainNode =>
      target.id === onWhat.id
        ? node
        : { kind: "field", base: target as AnyObject, via: node };

    visited.add(key);
    let stable = true;
    try {
      for (const target of targets) {
        for (const relation of requiredRelations) {
          for (const tuple of await reader.findTuples({
            subject: who as TupleSubject<
              SchemaSubjectTypes<S>,
              SchemaObjectTypes<S>
            >,
            relation: relation as string,
            object: target as AnyObject<SchemaObjectTypes<S>>,
          })) {
            if (isConditionValid(tuple.condition, context)) {
              return {
                via: wrap(target, {
                  kind: "direct",
                  relation: relation as string,
                }),
                stable: true,
              };
            }
          }
          if (who.id !== PUBLIC_ID) {
            for (const tuple of await reader.findTuples({
              subject: { type: who.type, id: PUBLIC_ID } as TupleSubject<
                SchemaSubjectTypes<S>,
                SchemaObjectTypes<S>
              >,
              relation: relation as string,
              object: target as AnyObject<SchemaObjectTypes<S>>,
            })) {
              if (isConditionValid(tuple.condition, context)) {
                return {
                  via: wrap(target, {
                    kind: "wildcard",
                    relation: relation as string,
                  }),
                  stable: true,
                };
              }
            }
          }
        }
      }

      for (const groupRelation of this.groupRels) {
        const memberships = await reader.findTuples({
          subject: who as TupleSubject<
            SchemaSubjectTypes<S>,
            SchemaObjectTypes<S>
          >,
          relation: groupRelation,
        });
        const wildMemberships =
          who.id === PUBLIC_ID
            ? []
            : await reader.findTuples({
                subject: { type: who.type, id: PUBLIC_ID } as TupleSubject<
                  SchemaSubjectTypes<S>,
                  SchemaObjectTypes<S>
                >,
                relation: groupRelation,
              });
        for (const membership of [...memberships, ...wildMemberships]) {
          if (!isConditionValid(membership.condition, context)) continue;
          const child = await this.explainAccess(
            membership.object,
            action,
            onWhat,
            context,
            depth + 1,
            visited,
            noPath,
            reader,
          );
          if (child.via) {
            return {
              via: {
                kind: "group",
                relation: groupRelation,
                through: membership.object as AnyObject,
                via: child.via,
              },
              stable: true,
            };
          }
          if (!child.stable) stable = false;
        }
      }

      if (this.hierRels.length > 0) {
        const parentActions = this.schema.hierarchyPropagation?.[action];
        if (parentActions && parentActions.length > 0) {
          for (const target of targets) {
            for (const hierRelation of this.hierRels) {
              for (const link of await reader.findTuples({
                subject: target as TupleSubject<
                  SchemaSubjectTypes<S>,
                  SchemaObjectTypes<S>
                >,
                relation: hierRelation,
              })) {
                if (!isConditionValid(link.condition, context)) continue;
                for (const parentAction of parentActions) {
                  const child = await this.explainAccess(
                    who,
                    parentAction as TypedAction<S>,
                    link.object,
                    context,
                    depth + 1,
                    visited,
                    noPath,
                    reader,
                  );
                  if (child.via) {
                    return {
                      via: wrap(target, {
                        kind: "hierarchy",
                        relation: hierRelation,
                        parent: link.object as AnyObject,
                        via: child.via,
                      }),
                      stable: true,
                    };
                  }
                  if (!child.stable) stable = false;
                }
              }
            }
          }
        }
      }

      if (stable) noPath.add(key);
      return { via: null, stable };
    } finally {
      visited.delete(key);
    }
  }

  /** onWhat plus, for field-enabled types, its base object. */
  private targetIdentifiers(object: {
    type: string;
    id: string;
  }): { type: string; id: string }[] {
    const ids: { type: string; id: string }[] = [object];
    const base = this.baseObject(object);
    if (base) ids.push(base);
    return ids;
  }

  /** The base object of a field id, or null when not a (valid) field id. */
  private baseObject(object: {
    type: string;
    id: string;
  }): { type: string; id: string } | null {
    if (!isFieldType(this.schema, object.type)) return null;
    const idx = object.id.lastIndexOf(this.fieldSep);
    if (idx <= 0) return null; // no separator, or empty base (no wildcard leak)
    return { type: object.type, id: object.id.substring(0, idx) };
  }

  /** Reject malformed field ids on write (empty base or empty field). */
  private validateFieldId(object: { type: string; id: string }): void {
    if (!isFieldType(this.schema, object.type)) return;
    const idx = object.id.indexOf(this.fieldSep);
    if (idx === -1) return;
    const last = object.id.lastIndexOf(this.fieldSep);
    const base = object.id.substring(0, last);
    const field = object.id.substring(last + this.fieldSep.length);
    if (base.length === 0 || field.length === 0) {
      throw new SchemaError(
        `Invalid field id '${object.id}': the base and field around '${this.fieldSep}' must both be non-empty.`,
      );
    }
  }

  /** onWhat, its base, and all hierarchy ancestors (for reverse expansion). */
  private async ancestorsOf(
    onWhat: { type: string; id: string },
    context: Record<string, unknown> | undefined,
    reader: Reader<SchemaSubjectTypes<S>, SchemaObjectTypes<S>>,
  ): Promise<{ type: string; id: string }[]> {
    const seen = new Map<string, { type: string; id: string }>();
    const queue = [...this.targetIdentifiers(onWhat)];
    let depth = 0;
    while (queue.length > 0 && depth <= this.defaultCheckDepth) {
      const next: { type: string; id: string }[] = [];
      for (const obj of queue) {
        const k = objKey(obj);
        if (seen.has(k)) continue;
        seen.set(k, obj);
        for (const hierRel of this.hierRels) {
          for (const link of await reader.findTuples({
            subject: obj as TupleSubject<
              SchemaSubjectTypes<S>,
              SchemaObjectTypes<S>
            >,
            relation: hierRel,
          })) {
            if (isConditionValid(link.condition, context)) {
              next.push(link.object);
              const base = this.baseObject(link.object);
              if (base) next.push(base);
            }
          }
        }
      }
      queue.length = 0;
      queue.push(...next);
      depth++;
    }
    return Array.from(seen.values());
  }

  /** Recursively collect subjects that are members of `group` (nested groups). */
  private async collectGroupMembers(
    group: { type: string; id: string },
    add: (s: { type: string; id: string }) => void,
    seen: Set<string>,
    depth: number,
    reader: Reader<SchemaSubjectTypes<S>, SchemaObjectTypes<S>>,
  ): Promise<void> {
    if (depth > this.defaultCheckDepth) return;
    const k = objKey(group);
    if (seen.has(k)) return;
    seen.add(k);
    if (group.id === PUBLIC_ID) {
      // A wildcard `{type, "*"}` matches every concrete group of that type, so
      // members of ALL groups of this type inherit. Over-inclusion is harmless
      // because every candidate is confirmed with a forward check afterwards.
      for (const groupRelation of this.groupRels) {
        const all = await reader.findTuples({ relation: groupRelation });
        for (const t of all) {
          if (t.object.type !== group.type) continue;
          add(t.subject);
          await this.collectGroupMembers(
            t.subject,
            add,
            seen,
            depth + 1,
            reader,
          );
        }
      }
    } else {
      for (const groupRelation of this.groupRels) {
        const members = await reader.findSubjects(
          group as AnyObject<SchemaObjectTypes<S>>,
          groupRelation,
        );
        for (const member of members) {
          add(member);
          await this.collectGroupMembers(member, add, seen, depth + 1, reader);
        }
      }
    }
  }

  /** All groups (transitively) that `subject` belongs to. */
  private async findGroupsRecursive(
    subject: { type: string; id: string },
    maxDepth: number,
    visitedGroups: Set<string>,
    reader: Reader<SchemaSubjectTypes<S>, SchemaObjectTypes<S>>,
    context?: Record<string, unknown>,
  ): Promise<AnyObject<SchemaObjectTypes<S>>[]> {
    if (maxDepth <= 0) return [];
    const subjectKey = objKey(subject);
    if (visitedGroups.has(subjectKey)) return [];
    visitedGroups.add(subjectKey);

    const all: AnyObject<SchemaObjectTypes<S>>[] = [];
    const seen = new Set<string>();
    for (const groupRelation of this.groupRels) {
      const memberships = await reader.findTuples({
        subject: subject as TupleSubject<
          SchemaSubjectTypes<S>,
          SchemaObjectTypes<S>
        >,
        relation: groupRelation,
      });
      // Wildcard memberships (`everyone(type)` is a member) apply to every
      // subject of that type, so a concrete subject inherits those groups too.
      const wildMemberships =
        subject.id === PUBLIC_ID
          ? []
          : await reader.findTuples({
              subject: { type: subject.type, id: PUBLIC_ID } as TupleSubject<
                SchemaSubjectTypes<S>,
                SchemaObjectTypes<S>
              >,
              relation: groupRelation,
            });
      for (const tuple of [...memberships, ...wildMemberships]) {
        if (!isConditionValid(tuple.condition, context)) continue;
        const group = tuple.object as AnyObject<SchemaObjectTypes<S>>;
        const gk = objKey(group);
        if (!seen.has(gk)) {
          seen.add(gk);
          all.push(group);
        }
        const parents = await this.findGroupsRecursive(
          group,
          maxDepth - 1,
          new Set(visitedGroups),
          reader,
          context,
        );
        for (const pg of parents) {
          const pk = objKey(pg);
          if (!seen.has(pk)) {
            seen.add(pk);
            all.push(pg);
          }
        }
      }
    }
    return all;
  }
}
