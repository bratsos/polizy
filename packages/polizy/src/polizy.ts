import { isConditionValid } from "./conditions.ts";
import {
  ConfigurationError,
  MaxDepthExceededError,
  NotAuthorizedError,
  SchemaError,
} from "./errors.ts";
import type { StorageAdapter } from "./polizy.storage.ts";
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
  SchemaObjectTypes,
  SchemaSubjectTypes,
  StoredTuple,
  Subject,
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

/** Internal per-`check` traversal state. */
type ResolveState = {
  depth: number;
  /** Cycle guard: keys currently on the recursion stack. */
  visited: Set<string>;
  /** Memo of fully-resolved, cycle-independent results for this check. */
  resolved: Map<string, boolean>;
};

/**
 * Result of one resolution step.
 * `stable` is false when the result was influenced by a cycle cutoff or a depth
 * cutoff, meaning it is only valid in the current stack context and must NOT be
 * memoized globally.
 */
type ResolveOutcome = { value: boolean; stable: boolean };

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

  constructor(config: {
    storage: StorageAdapter<SchemaSubjectTypes<S>, SchemaObjectTypes<S>>;
    schema: S;
    defaultCheckDepth?: number;
    maxDepthBehavior?: "throw" | "deny";
    logger?: Logger;
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
    this.fieldSep = fieldSeparator(this.schema);
    this.groupRels = groupRelations(this.schema);
    this.hierRels = hierarchyRelations(this.schema);
  }

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  async check(request: {
    who: Subject<SchemaSubjectTypes<S>> | AnyObject<SchemaObjectTypes<S>>;
    canThey: TypedAction<S>;
    onWhat: AnyObject<SchemaObjectTypes<S>>;
    context?: Record<string, unknown>;
  }): Promise<boolean> {
    const state: ResolveState = {
      depth: 0,
      visited: new Set(),
      resolved: new Map(),
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

  /** Like {@link check}, but throws {@link NotAuthorizedError} when denied. */
  async checkOrThrow(request: {
    who: Subject<SchemaSubjectTypes<S>> | AnyObject<SchemaObjectTypes<S>>;
    canThey: TypedAction<S>;
    onWhat: AnyObject<SchemaObjectTypes<S>>;
    context?: Record<string, unknown>;
  }): Promise<void> {
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
   */
  async checkMany(
    requests: Array<{
      who: Subject<SchemaSubjectTypes<S>> | AnyObject<SchemaObjectTypes<S>>;
      canThey: TypedAction<S>;
      onWhat: AnyObject<SchemaObjectTypes<S>>;
      context?: Record<string, unknown>;
    }>,
  ): Promise<boolean[]> {
    return Promise.all(requests.map((r) => this.check(r)));
  }

  /** Explain why a check is allowed or denied, returning the granting path. */
  async explain(request: {
    who: Subject<SchemaSubjectTypes<S>> | AnyObject<SchemaObjectTypes<S>>;
    canThey: TypedAction<S>;
    onWhat: AnyObject<SchemaObjectTypes<S>>;
    context?: Record<string, unknown>;
  }): Promise<ExplainResult> {
    const via = await this.explainAccess(
      request.who,
      request.canThey,
      request.onWhat,
      request.context,
      0,
      new Set(),
    );
    return { allowed: via !== null, via };
  }

  /**
   * Reverse expansion: list the subjects that can perform `canThey` on `onWhat`.
   * Candidates are gathered from direct holders, group members (transitively),
   * and the object's hierarchy ancestors, then each is confirmed with `check`.
   */
  async listSubjects(args: {
    canThey: TypedAction<S>;
    onWhat: AnyObject<SchemaObjectTypes<S>>;
    ofType?: SchemaSubjectTypes<S>;
    context?: Record<string, unknown>;
  }): Promise<Subject<SchemaSubjectTypes<S>>[]> {
    const { canThey, onWhat, ofType, context } = args;
    const candidates = new Map<string, Subject<SchemaSubjectTypes<S>>>();
    const addCandidate = (s: { type: string; id: string }) => {
      candidates.set(objKey(s), s as Subject<SchemaSubjectTypes<S>>);
    };

    // Objects whose grantees could reach onWhat: onWhat, its base, its ancestors.
    const objectsToInspect = await this.ancestorsOf(onWhat, context);

    for (const obj of objectsToInspect) {
      const holders = await this.storage.findTuples({
        object: obj as AnyObject<SchemaObjectTypes<S>>,
      });
      for (const tuple of holders) {
        addCandidate(tuple.subject);
        await this.collectGroupMembers(
          tuple.subject,
          addCandidate,
          new Set(),
          0,
        );
      }
    }

    const confirmed: Subject<SchemaSubjectTypes<S>>[] = [];
    for (const candidate of candidates.values()) {
      if (ofType && candidate.type !== ofType) continue;
      if (await this.check({ who: candidate, canThey, onWhat, context })) {
        confirmed.push(candidate);
      }
    }
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
    args: ListAccessibleObjectsArgs<S> & { limit?: number; offset?: number },
  ): Promise<ListAccessibleObjectsResult<S>> {
    const {
      who,
      ofType,
      canThey: specificActionFilter,
      context,
      maxDepth: argsMaxDepth,
    } = args;
    const maxDepth = argsMaxDepth ?? this.defaultCheckDepth;

    // Map each child to its (first) parent, for the result's `parent` field.
    const childToParentMap = new Map<string, TypedObject<S>>();
    for (const hierRel of this.hierRels) {
      const links = await this.storage.findTuples({ relation: hierRel });
      for (const link of links) {
        if (!isConditionValid(link.condition, context)) continue;
        const childKey = objKey(link.subject);
        if (!childToParentMap.has(childKey)) {
          childToParentMap.set(childKey, link.object as TypedObject<S>);
        }
      }
    }

    const potential = new Map<string, TypedObject<S>>();
    const addPotential = (obj: { type: string; id: string }) => {
      potential.set(objKey(obj), obj as TypedObject<S>);
      const base = this.baseObject(obj);
      if (base) potential.set(objKey(base), base as TypedObject<S>);
    };

    // 1. Objects the subject has a direct relationship to.
    for (const tuple of await this.storage.findTuples({ subject: who })) {
      if (isConditionValid(tuple.condition, context))
        addPotential(tuple.object);
    }

    // 2. Objects reachable via the subject's groups (transitively).
    const groups = await this.findGroupsRecursive(who, maxDepth, new Set());
    for (const group of groups) {
      for (const tuple of await this.storage.findTuples({
        subject: group as TupleSubject<
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
        const childLinks = await this.storage.findTuples({
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

    const allActions = Object.keys(
      this.schema.actionToRelations,
    ) as TypedAction<S>[];

    const accessible: AccessibleObject<S>[] = [];
    await Promise.all(
      Array.from(potential.values())
        .filter((obj) => obj.type === ofType)
        .map(async (obj) => {
          const allowed: TypedAction<S>[] = [];
          for (const action of allActions) {
            if (
              await this.check({ who, canThey: action, onWhat: obj, context })
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
    const relation = resolveRelation(
      this.groupRels,
      args.as as string | undefined,
      "group",
      (m) => new SchemaError(m),
    );
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
    const relation = resolveRelation(
      this.groupRels,
      args.as as string | undefined,
      "group",
      (m) => new SchemaError(m),
    );
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
    const relation = resolveRelation(
      this.hierRels,
      args.as as string | undefined,
      "hierarchy",
      (m) => new SchemaError(m),
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
    const relation = resolveRelation(
      this.hierRels,
      args.as as string | undefined,
      "hierarchy",
      (m) => new SchemaError(m),
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
    state: ResolveState,
  ): Promise<ResolveOutcome> {
    const key = cacheKey(who, action as string, onWhat);

    if (state.resolved.has(key)) {
      return { value: state.resolved.get(key) as boolean, stable: true };
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
    try {
      // 1. Direct relationships (and wildcard/public grants).
      for (const target of targets) {
        for (const relation of requiredRelations) {
          const direct = await this.storage.findTuples({
            subject: who as TupleSubject<
              SchemaSubjectTypes<S>,
              SchemaObjectTypes<S>
            >,
            relation: relation as string,
            object: target as AnyObject<SchemaObjectTypes<S>>,
          });
          for (const tuple of direct) {
            if (isConditionValid(tuple.condition, context)) {
              state.resolved.set(key, true);
              return { value: true, stable: true };
            }
          }
          if (who.id !== PUBLIC_ID) {
            const wild = await this.storage.findTuples({
              subject: { type: who.type, id: PUBLIC_ID } as TupleSubject<
                SchemaSubjectTypes<S>,
                SchemaObjectTypes<S>
              >,
              relation: relation as string,
              object: target as AnyObject<SchemaObjectTypes<S>>,
            });
            for (const tuple of wild) {
              if (isConditionValid(tuple.condition, context)) {
                state.resolved.set(key, true);
                return { value: true, stable: true };
              }
            }
          }
        }
      }

      // 2. Group memberships (all group relations). Recurse with the original
      //    onWhat so the group's own field/hierarchy resolution applies.
      for (const groupRelation of this.groupRels) {
        const memberships = await this.storage.findTuples({
          subject: who as TupleSubject<
            SchemaSubjectTypes<S>,
            SchemaObjectTypes<S>
          >,
          relation: groupRelation,
        });
        for (const membership of memberships) {
          if (!isConditionValid(membership.condition, context)) continue;
          const sub = await this.resolveAccess(
            membership.object,
            action,
            onWhat,
            context,
            { ...state, depth: state.depth + 1 },
          );
          if (sub.value) {
            state.resolved.set(key, true);
            return { value: true, stable: true };
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
              const parentLinks = await this.storage.findTuples({
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
                    state.resolved.set(key, true);
                    return { value: true, stable: true };
                  }
                  stable = stable && sub.stable;
                }
              }
            }
          }
        }
      }

      if (stable) state.resolved.set(key, false);
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
  ): Promise<ExplainNode | null> {
    const key = cacheKey(who, action as string, onWhat);
    if (visited.has(key)) return null;
    if (depth > this.defaultCheckDepth) return null;
    const requiredRelations = this.schema.actionToRelations[action];
    if (!requiredRelations || requiredRelations.length === 0) return null;

    const targets = this.targetIdentifiers(onWhat);
    const wrap = (
      target: { type: string; id: string },
      node: ExplainNode,
    ): ExplainNode =>
      target.id === onWhat.id
        ? node
        : { kind: "field", base: target as AnyObject, via: node };

    visited.add(key);
    try {
      for (const target of targets) {
        for (const relation of requiredRelations) {
          for (const tuple of await this.storage.findTuples({
            subject: who as TupleSubject<
              SchemaSubjectTypes<S>,
              SchemaObjectTypes<S>
            >,
            relation: relation as string,
            object: target as AnyObject<SchemaObjectTypes<S>>,
          })) {
            if (isConditionValid(tuple.condition, context)) {
              return wrap(target, {
                kind: "direct",
                relation: relation as string,
              });
            }
          }
          if (who.id !== PUBLIC_ID) {
            for (const tuple of await this.storage.findTuples({
              subject: { type: who.type, id: PUBLIC_ID } as TupleSubject<
                SchemaSubjectTypes<S>,
                SchemaObjectTypes<S>
              >,
              relation: relation as string,
              object: target as AnyObject<SchemaObjectTypes<S>>,
            })) {
              if (isConditionValid(tuple.condition, context)) {
                return wrap(target, {
                  kind: "wildcard",
                  relation: relation as string,
                });
              }
            }
          }
        }
      }

      for (const groupRelation of this.groupRels) {
        for (const membership of await this.storage.findTuples({
          subject: who as TupleSubject<
            SchemaSubjectTypes<S>,
            SchemaObjectTypes<S>
          >,
          relation: groupRelation,
        })) {
          if (!isConditionValid(membership.condition, context)) continue;
          const via = await this.explainAccess(
            membership.object,
            action,
            onWhat,
            context,
            depth + 1,
            visited,
          );
          if (via) {
            return {
              kind: "group",
              relation: groupRelation,
              through: membership.object as AnyObject,
              via,
            };
          }
        }
      }

      if (this.hierRels.length > 0) {
        const parentActions = this.schema.hierarchyPropagation?.[action];
        if (parentActions && parentActions.length > 0) {
          for (const target of targets) {
            for (const hierRelation of this.hierRels) {
              for (const link of await this.storage.findTuples({
                subject: target as TupleSubject<
                  SchemaSubjectTypes<S>,
                  SchemaObjectTypes<S>
                >,
                relation: hierRelation,
              })) {
                if (!isConditionValid(link.condition, context)) continue;
                for (const parentAction of parentActions) {
                  const via = await this.explainAccess(
                    who,
                    parentAction as TypedAction<S>,
                    link.object,
                    context,
                    depth + 1,
                    visited,
                  );
                  if (via) {
                    return wrap(target, {
                      kind: "hierarchy",
                      relation: hierRelation,
                      parent: link.object as AnyObject,
                      via,
                    });
                  }
                }
              }
            }
          }
        }
      }
      return null;
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
          for (const link of await this.storage.findTuples({
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
  ): Promise<void> {
    if (depth > this.defaultCheckDepth) return;
    const k = objKey(group);
    if (seen.has(k)) return;
    seen.add(k);
    for (const groupRelation of this.groupRels) {
      const members = await this.storage.findSubjects(
        group as AnyObject<SchemaObjectTypes<S>>,
        groupRelation,
      );
      for (const member of members) {
        add(member);
        await this.collectGroupMembers(member, add, seen, depth + 1);
      }
    }
  }

  /** All groups (transitively) that `subject` belongs to. */
  private async findGroupsRecursive(
    subject: { type: string; id: string },
    maxDepth: number,
    visitedGroups: Set<string>,
  ): Promise<AnyObject<SchemaObjectTypes<S>>[]> {
    if (maxDepth <= 0) return [];
    const subjectKey = objKey(subject);
    if (visitedGroups.has(subjectKey)) return [];
    visitedGroups.add(subjectKey);

    const all: AnyObject<SchemaObjectTypes<S>>[] = [];
    const seen = new Set<string>();
    for (const groupRelation of this.groupRels) {
      const memberships = await this.storage.findTuples({
        subject: subject as TupleSubject<
          SchemaSubjectTypes<S>,
          SchemaObjectTypes<S>
        >,
        relation: groupRelation,
      });
      for (const tuple of memberships) {
        if (!isConditionValid(tuple.condition)) continue;
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
