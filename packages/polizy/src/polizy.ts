import type { StorageAdapter } from "./polizy.storage.ts";
import type {
  Subject,
  AnyObject,
  AuthSchema,
  InputTuple,
  Condition,
  TypedRelation,
  TypedAction,
  StoredTuple,
  TupleSubject,
  SchemaSubjectTypes,
  SchemaObjectTypes,
  ListAccessibleObjectsArgs,
  ListAccessibleObjectsResult,
  AccessibleObject,
  TypedObject,
  RelationDefinition,
} from "./types.ts";
import { ConfigurationError, SchemaError } from "./errors.ts";

const createCacheKey = (
  s: Subject<any> | AnyObject<any>,
  r: string,
  o: AnyObject<any>,
): string => `${s.type}:${s.id}|${r}|${o.type}:${o.id}`;

const createObjectIdentifierString = (obj: TypedObject<any>): string =>
  `${obj.type}:${obj.id}`;

export class AuthSystem<S extends AuthSchema<any, any, any, any, any>> {
  private readonly storage: StorageAdapter<
    SchemaSubjectTypes<S>,
    SchemaObjectTypes<S>
  >;
  private readonly schema: S;
  private readonly defaultCheckDepth: number;
  private readonly fieldSeparator: string;

  constructor(config: {
    storage: StorageAdapter<SchemaSubjectTypes<S>, SchemaObjectTypes<S>>;
    schema: S;
    defaultCheckDepth?: number;
    fieldSeparator?: string;
  }) {
    if (!config.storage)
      throw new ConfigurationError("Storage adapter is required.");
    if (!config.schema)
      throw new ConfigurationError("Authorization schema is required.");

    this.storage = config.storage;
    this.schema = config.schema;
    this.defaultCheckDepth = config.defaultCheckDepth ?? 10;
    this.fieldSeparator = config.fieldSeparator ?? "#";
  }

  async writeTuple(
    tuple: Omit<
      InputTuple<SchemaSubjectTypes<S>, SchemaObjectTypes<S>>,
      "id"
    > & {
      relation: TypedRelation<S>;
    },
  ): Promise<StoredTuple<SchemaSubjectTypes<S>, SchemaObjectTypes<S>>> {
    if (!this.schema.relations[tuple.relation]) {
      throw new SchemaError(
        `Relation '${String(tuple.relation)}' is not defined in the schema.`,
      );
    }
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

  /**
   * Internal helper to delete tuples using the storage adapter based on filter criteria.
   * Ensures that an empty filter is not passed to the storage adapter.
   * @param filter An object containing optional 'who', 'was', and 'onWhat' criteria.
   * @returns A promise resolving to the number of tuples deleted.
   * @private
   */
  private async deleteTuple(filter: {
    who?: Subject<SchemaSubjectTypes<S>> | AnyObject<SchemaObjectTypes<S>>;
    was?: TypedRelation<S>;
    onWhat?: AnyObject<SchemaObjectTypes<S>>;
  }): Promise<number> {
    if (!filter.who && !filter.was && !filter.onWhat) {
      console.warn(
        "deleteTuple called with an empty filter. No tuples were deleted.",
      );

      return 0;
    }

    return this.storage.delete({
      ...filter,
      was: filter.was as string | undefined,
    });
  }

  async check(request: {
    who: Subject<SchemaSubjectTypes<S>> | AnyObject<SchemaObjectTypes<S>>;
    canThey: TypedAction<S>;
    onWhat: AnyObject<SchemaObjectTypes<S>>;
    context?: Record<string, any>;
    _internalParams?: {
      depth: number;
      visited: Set<string>;
    };
  }): Promise<boolean> {
    const { who, canThey, onWhat, context } = request;
    const depth = request._internalParams?.depth ?? 0;
    const visited = request._internalParams?.visited ?? new Set<string>();

    const cacheKey = createCacheKey(who, canThey as string, onWhat);
    if (visited.has(cacheKey)) {
      return false;
    }
    if (depth > this.defaultCheckDepth) {
      console.warn(
        `Authorization check exceeded maximum depth (${
          this.defaultCheckDepth
        }) for ${who.type}:${who.id} ${String(canThey)} ${onWhat.type}:${
          onWhat.id
        }`,
      );
      return false;
    }

    visited.add(cacheKey);

    const requiredRelations = this.schema.actionToRelations[canThey];
    if (!requiredRelations || requiredRelations.length === 0) {
      visited.delete(cacheKey);
      return false;
    }

    const targetObjectIdentifiers = this.getTargetObjectIdentifiers(onWhat);

    for (const targetObj of targetObjectIdentifiers) {
      for (const relation of requiredRelations) {
        const potentialTuples = await this.storage.findTuples({
          subject: who as TupleSubject<
            SchemaSubjectTypes<S>,
            SchemaObjectTypes<S>
          >,
          relation: relation as string,
          object: targetObj as AnyObject<SchemaObjectTypes<S>>,
        });
        for (const tuple of potentialTuples) {
          if (this.isConditionValid(tuple.condition)) {
            visited.delete(cacheKey);
            return true;
          }
        }
      }
    }

    const groupRelations = Object.entries(this.schema.relations)
      .filter(([, def]) => (def as RelationDefinition).type === "group")
      .map(([name]) => name as TypedRelation<S>);

    if (groupRelations.length > 0) {
      for (const groupRelation of groupRelations) {
        const membershipTuples = await this.storage.findTuples({
          subject: who as TupleSubject<
            SchemaSubjectTypes<S>,
            SchemaObjectTypes<S>
          >,
          relation: groupRelation as string,
        });

        for (const membershipTuple of membershipTuples) {
          if (!this.isConditionValid(membershipTuple.condition)) {
            continue;
          }

          const groupSubject: AnyObject<SchemaObjectTypes<S>> =
            membershipTuple.object as AnyObject<SchemaObjectTypes<S>>;

          const groupHasAccess = await this.check({
            who: groupSubject,
            canThey,
            onWhat,
            context,
            _internalParams: { depth: depth + 1, visited },
          });

          if (groupHasAccess) {
            visited.delete(cacheKey);
            return true;
          }
        }
      }
    }

    const hierarchyRelation = this.findHierarchyRelation();
    if (hierarchyRelation) {
      const parentLinkTuples = await this.storage.findTuples({
        subject: onWhat as TupleSubject<
          SchemaSubjectTypes<S>,
          SchemaObjectTypes<S>
        >,
        relation: hierarchyRelation as string,
      });

      for (const parentLinkTuple of parentLinkTuples) {
        if (!this.isConditionValid(parentLinkTuple.condition)) {
          continue;
        }
        const parentObject: AnyObject<SchemaObjectTypes<S>> =
          parentLinkTuple.object as AnyObject<SchemaObjectTypes<S>>;
        const requiredParentActions =
          this.schema.hierarchyPropagation?.[canThey];

        if (requiredParentActions) {
          for (const parentAction of requiredParentActions) {
            const subjectHasRequiredParentAccess = await this.check({
              who,
              canThey: parentAction,
              onWhat: parentObject,
              context,
              _internalParams: { depth: depth + 1, visited },
            });

            if (subjectHasRequiredParentAccess) {
              visited.delete(cacheKey);
              return true;
            }
          }
        }
      }
    }

    visited.delete(cacheKey);
    return false;
  }

  private getTargetObjectIdentifiers(
    object: AnyObject<SchemaObjectTypes<S>>,
  ): AnyObject<SchemaObjectTypes<S>>[] {
    const ids: AnyObject<SchemaObjectTypes<S>>[] = [object];
    const fieldSepIndex = object.id.lastIndexOf(this.fieldSeparator);
    if (fieldSepIndex > -1) {
      ids.push({
        type: object.type,
        id: object.id.substring(0, fieldSepIndex),
      });
    }
    return ids;
  }

  private isConditionValid(condition?: Condition): boolean {
    if (!condition) return true;
    const now = Date.now();
    if (condition.validSince && condition.validSince.getTime() > now)
      return false;
    if (condition.validUntil && condition.validUntil.getTime() <= now)
      return false;
    return true;
  }

  async allow(args: {
    who: Subject<SchemaSubjectTypes<S>>;
    toBe: TypedRelation<S>;
    onWhat: AnyObject<SchemaObjectTypes<S>>;
    when?: Condition;
  }): Promise<StoredTuple<SchemaSubjectTypes<S>, SchemaObjectTypes<S>>> {
    return this.writeTuple({
      subject: args.who,
      relation: args.toBe as string & TypedRelation<S>,
      object: args.onWhat,
      condition: args.when,
    });
  }

  /**
   * Removes policy tuples (relationships) that match the specified filter criteria.
   *
   * This method provides flexibility for removing single or multiple tuples:
   * - **Single Tuple Removal:** If 'who', 'was', and 'onWhat' are all provided,
   *   it removes the single, specific tuple matching all criteria (equivalent to the old `disallow`).
   * - **Bulk Removal:** If only a subset of criteria is provided (e.g., only 'who', or 'who' and 'was'),
   *   it removes *all* tuples matching that subset. This is useful for scenarios like:
   *     - Removing all permissions for a user (`{ who: ... }`).
   *     - Removing all permissions related to an object (`{ onWhat: ... }`).
   *     - Removing all instances of a specific relation (`{ was: ... }`).
   *
   * **Important:** Requires at least one filter criterion (`who`, `was`, or `onWhat`) to be provided.
   * Providing an empty filter object (`{}`) will result in a console warning and no tuples being deleted,
   * preventing accidental deletion of all data.
   *
   * @param filter An object containing the filter criteria:
   *   - `who` (Optional): The subject (e.g., `{ type: 'user', id: 'alice' }`) or object acting as subject.
   *   - `was` (Optional): The relation name (e.g., `'owner'`, `'editor'`).
   *   - `onWhat` (Optional): The object (e.g., `{ type: 'document', id: 'doc123' }`).
   * @returns A promise resolving to the number of tuples that were successfully deleted.
   * @example
   * // Remove a specific permission
   * await authz.disallowAllMatching({
   *   who: { type: 'user', id: 'alice' },
   *   was: 'viewer',
   *   onWhat: { type: 'document', id: 'doc1' }
   * });
   *
   * // Remove all permissions for user 'bob'
   * await authz.disallowAllMatching({ who: { type: 'user', id: 'bob' } });
   *
   * // Remove all 'editor' relations on 'doc2'
   * await authz.disallowAllMatching({ was: 'editor', onWhat: { type: 'document', id: 'doc2' } });
   * - Providing an empty filter object will result in a warning and no deletion.
   *
   * @param filter An object containing optional 'who', 'was' (relation), and 'onWhat' criteria.
   * @returns A promise resolving to the number of tuples deleted.
   */
  async disallowAllMatching(filter: {
    who?: Subject<SchemaSubjectTypes<S>> | AnyObject<SchemaObjectTypes<S>>;
    was?: TypedRelation<S>;
    onWhat?: AnyObject<SchemaObjectTypes<S>>;
  }): Promise<number> {
    return this.deleteTuple(filter);
  }
  async addMember(args: {
    member: Subject<SchemaSubjectTypes<S>> | AnyObject<SchemaSubjectTypes<S>>;
    group: AnyObject<SchemaObjectTypes<S>>;
    condition?: Condition;
  }): Promise<StoredTuple<SchemaSubjectTypes<S>, SchemaObjectTypes<S>>> {
    const groupRelation = this.findGroupRelation();
    if (!groupRelation)
      throw new SchemaError(
        "Schema does not define any relation with type 'group'.",
      );
    return this.writeTuple({
      subject: args.member as TupleSubject<
        SchemaSubjectTypes<S>,
        SchemaObjectTypes<S>
      >,
      relation: groupRelation as string & TypedRelation<S>,
      object: args.group,
      condition: args.condition,
    });
  }

  async removeMember(args: {
    member: Subject<SchemaSubjectTypes<S>>;
    group: AnyObject<SchemaObjectTypes<S>>;
  }): Promise<number> {
    const groupRelation = this.findGroupRelation();
    if (!groupRelation) {
      console.warn(
        "Attempted removeMember, but no 'group' relation defined in schema.",
      );
      return 0;
    }
    return this.deleteTuple({
      who: args.member,
      was: groupRelation as TypedRelation<S>,
      onWhat: args.group,
    });
  }

  async setParent(args: {
    child: AnyObject<SchemaObjectTypes<S>>;
    parent: AnyObject<SchemaObjectTypes<S>>;
    condition?: Condition;
  }): Promise<StoredTuple<SchemaSubjectTypes<S>, SchemaObjectTypes<S>>> {
    const hierarchyRelation = this.findHierarchyRelation();
    if (!hierarchyRelation)
      throw new SchemaError(
        "Schema does not define any relation with type 'hierarchy'.",
      );
    return this.writeTuple({
      subject: args.child as TupleSubject<
        SchemaSubjectTypes<S>,
        SchemaObjectTypes<S>
      >,
      relation: hierarchyRelation as string & TypedRelation<S>,
      object: args.parent,
      condition: args.condition,
    });
  }

  async removeParent(args: {
    child: AnyObject<SchemaObjectTypes<S>>;
    parent: AnyObject<SchemaObjectTypes<S>>;
  }): Promise<number> {
    const hierarchyRelation = this.findHierarchyRelation();
    if (!hierarchyRelation)
      throw new SchemaError(
        "Schema does not define any relation with type 'hierarchy'.",
      );
    return this.deleteTuple({
      who: args.child as TupleSubject<
        SchemaSubjectTypes<S>,
        SchemaObjectTypes<S>
      >,
      was: hierarchyRelation as TypedRelation<S>,
      onWhat: args.parent,
    });
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
    );
    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? Number.POSITIVE_INFINITY;
    return results.slice(offset, offset + limit) as StoredTuple<
      SchemaSubjectTypes<S>,
      SchemaObjectTypes<S>
    >[];
  }

  async listAccessibleObjects(
    args: ListAccessibleObjectsArgs<S>,
  ): Promise<ListAccessibleObjectsResult<S>> {
    const {
      who,
      ofType,
      canThey: specificActionFilter,
      context,
      maxDepth: argsMaxDepth,
    } = args;
    const maxDepth = argsMaxDepth ?? this.defaultCheckDepth;
    const hierarchyRelation = this.findHierarchyRelation();

    const childToParentMap = new Map<string, TypedObject<S>>();
    if (hierarchyRelation) {
      const allParentLinkTuples = await this.storage.findTuples({
        relation: hierarchyRelation as string,
      });
      for (const tuple of allParentLinkTuples) {
        if (this.isConditionValid(tuple.condition)) {
          const childKey = createObjectIdentifierString(
            tuple.subject as TypedObject<S>,
          );
          childToParentMap.set(childKey, tuple.object as TypedObject<S>);
        }
      }
    }

    const potentialObjectIdentifiers = new Map<string, TypedObject<S>>();
    const visitedForPotential = new Set<string>();

    const addPotentialObject = (obj: TypedObject<S>) => {
      const objKey = createObjectIdentifierString(obj);
      if (!visitedForPotential.has(objKey)) {
        potentialObjectIdentifiers.set(objKey, obj);
        visitedForPotential.add(objKey);
      }

      const baseObj = this.getBaseObject(obj);
      if (baseObj) {
        const baseKey = createObjectIdentifierString(baseObj);
        if (!visitedForPotential.has(baseKey)) {
          potentialObjectIdentifiers.set(baseKey, baseObj);
          visitedForPotential.add(baseKey);
        }
      }
    };

    const directTuples = await this.storage.findTuples({ subject: who });
    for (const tuple of directTuples) {
      if (this.isConditionValid(tuple.condition)) {
        addPotentialObject(tuple.object);
      }
    }

    const groups = await this.findGroupsRecursive(who, maxDepth, new Set());
    for (const group of groups) {
      const groupTuples = await this.storage.findTuples({ subject: group });
      for (const tuple of groupTuples) {
        if (this.isConditionValid(tuple.condition)) {
          addPotentialObject(tuple.object);
        }
      }
    }

    if (hierarchyRelation) {
      const propagatingActions = new Set<TypedAction<S>>();
      if (this.schema.hierarchyPropagation) {
        for (const childAction in this.schema.hierarchyPropagation) {
          const parentActions =
            this.schema.hierarchyPropagation[
              childAction as keyof S["hierarchyPropagation"]
            ];
          if (parentActions) {
            for (const pa of parentActions)
              propagatingActions.add(pa as TypedAction<S>);
          }
        }
      }

      const allTuples = await this.storage.findTuples({});
      const accessibleParents = new Map<string, TypedObject<S>>();

      for (const tuple of allTuples) {
        const potentialParent = tuple.object as TypedObject<S>;
        const parentKey = createObjectIdentifierString(potentialParent);
        if (accessibleParents.has(parentKey)) continue;

        for (const propAction of propagatingActions) {
          const canAccessParent = await this.check({
            who,
            canThey: propAction,
            onWhat: potentialParent,
            context,
            _internalParams: { depth: 0, visited: new Set() },
          });
          if (canAccessParent) {
            accessibleParents.set(parentKey, potentialParent);
            break;
          }
        }
      }

      for (const parent of accessibleParents.values()) {
        const childTuples = await this.storage.findTuples({
          relation: hierarchyRelation as string,
          object: parent,
        });
        for (const childTuple of childTuples) {
          if (this.isConditionValid(childTuple.condition)) {
            addPotentialObject(childTuple.subject as TypedObject<S>);
          }
        }
      }
    }

    const accessible: AccessibleObject<S>[] = [];
    const checkPromises = Array.from(potentialObjectIdentifiers.values())
      .filter((objId) => objId.type === ofType)
      .map(async (objIdentifier) => {
        const allowedActions = new Set<TypedAction<S>>();
        const allActions = Object.keys(
          this.schema.actionToRelations,
        ) as TypedAction<S>[];

        for (const action of allActions) {
          const hasAccess = await this.check({
            who,
            canThey: action,
            onWhat: objIdentifier,
            context,
            _internalParams: { depth: 0, visited: new Set() },
          });
          if (hasAccess) {
            allowedActions.add(action);
          }
        }

        if (allowedActions.size > 0) {
          if (
            !specificActionFilter ||
            allowedActions.has(specificActionFilter)
          ) {
            const objIdentifierKey =
              createObjectIdentifierString(objIdentifier);
            const parent = childToParentMap.get(objIdentifierKey);

            accessible.push({
              object: objIdentifier,
              actions: Array.from(allowedActions),
              parent: parent,
            });
          }
        }
      });

    await Promise.all(checkPromises);

    const finalResult: ListAccessibleObjectsResult<S> = { accessible };
    finalResult.accessible.sort((a, b) => {
      const keyA = createObjectIdentifierString(a.object);
      const keyB = createObjectIdentifierString(b.object);
      return keyA.localeCompare(keyB);
    });

    return finalResult;
  }

  private getBaseObject(object: TypedObject<S>): TypedObject<S> | null {
    const fieldSepIndex = object.id.lastIndexOf(this.fieldSeparator);
    if (fieldSepIndex > -1) {
      return {
        type: object.type,
        id: object.id.substring(0, fieldSepIndex),
      };
    }
    return null;
  }

  private findHierarchyRelation(): TypedRelation<S> | undefined {
    for (const relationName in this.schema.relations) {
      if (this.schema.relations[relationName]?.type === "hierarchy") {
        return relationName as TypedRelation<S>;
      }
    }
    return undefined;
  }

  private findGroupRelation(): TypedRelation<S> | undefined {
    for (const relationName in this.schema.relations) {
      if (this.schema.relations[relationName]?.type === "group") {
        return relationName as TypedRelation<S>;
      }
    }
    return undefined;
  }

  private async findGroupsRecursive(
    subject: Subject<SchemaSubjectTypes<S>> | AnyObject<SchemaObjectTypes<S>>,
    maxDepth: number,
    visitedGroups: Set<string>,
  ): Promise<AnyObject<SchemaObjectTypes<S>>[]> {
    if (maxDepth <= 0) {
      return [];
    }

    const subjectKey = createObjectIdentifierString(subject as TypedObject<S>);
    if (visitedGroups.has(subjectKey)) {
      return [];
    }
    visitedGroups.add(subjectKey);

    const allGroups: AnyObject<SchemaObjectTypes<S>>[] = [];
    const groupRelations = Object.entries(this.schema.relations)
      .filter(([, def]) => (def as RelationDefinition).type === "group")
      .map(([name]) => name as TypedRelation<S>);

    for (const groupRelation of groupRelations) {
      const directMembershipTuples = await this.storage.findTuples({
        subject: subject as TupleSubject<
          SchemaSubjectTypes<S>,
          SchemaObjectTypes<S>
        >,
        relation: groupRelation as string,
      });

      for (const tuple of directMembershipTuples) {
        if (this.isConditionValid(tuple.condition)) {
          const group = tuple.object as AnyObject<SchemaObjectTypes<S>>;
          const groupKey = createObjectIdentifierString(group);

          if (
            !allGroups.some((g) => createObjectIdentifierString(g) === groupKey)
          ) {
            allGroups.push(group);
          }

          const parentGroups = await this.findGroupsRecursive(
            group,
            maxDepth - 1,
            new Set(visitedGroups),
          );
          for (const pg of parentGroups) {
            const pgKey = createObjectIdentifierString(pg);
            if (
              !allGroups.some((g) => createObjectIdentifierString(g) === pgKey)
            ) {
              allGroups.push(pg);
            }
          }
        }
      }
    }

    return allGroups;
  }
}
