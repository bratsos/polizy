export type SubjectType = string;
export type ObjectType = string;

export type Subject<T extends SubjectType = SubjectType> = {
  type: T;
  id: string;
};
export type AnyObject<T extends ObjectType = ObjectType> = {
  type: T;
  id: string;
};

export type Relation = string;
export type Action = string;
export type Condition = { validSince?: Date; validUntil?: Date };
export type TupleId = string;

export type TupleSubject<S extends SubjectType, O extends ObjectType> =
  | Subject<S>
  | AnyObject<O>;

export type StoredTuple<
  S extends SubjectType = SubjectType,
  O extends ObjectType = ObjectType,
> = {
  id: TupleId;
  subject: TupleSubject<S, O>;
  relation: Relation;
  object: AnyObject<O>;
  condition?: Condition;
};

export type InputTuple<
  S extends SubjectType = SubjectType,
  O extends ObjectType = ObjectType,
> = Omit<StoredTuple<S, O>, "id">;

/** Base relation definition structure */
export type RelationDefinition = { type: "direct" | "group" | "hierarchy" };

/**
 * Represents a complete authorization schema structure.
 * Generic parameters for SubjectType and ObjectType are handled by AuthSystem.
 */
export interface AuthSchema<
  Relations extends Readonly<Record<string, RelationDefinition>> = Readonly<
    Record<string, RelationDefinition>
  >,
  ActionRelations extends Readonly<
    Record<string, ReadonlyArray<keyof Relations>>
  > = Readonly<Record<string, ReadonlyArray<string>>>,
  HierarchyProp extends
    | Readonly<
        Record<keyof ActionRelations, ReadonlyArray<keyof ActionRelations>>
      >
    | undefined = undefined,
  ValidSubjectTypes extends SubjectType = SubjectType,
  ValidObjectTypes extends ObjectType = ObjectType,
> {
  relations: Relations;
  actionToRelations: ActionRelations;
  hierarchyPropagation?: HierarchyProp;

  _subjectType?: ValidSubjectTypes;
  _objectType?: ValidObjectTypes;
}

/** Extracts the literal union type of relation names from a specific schema type */
export type SchemaRelations<S extends AuthSchema<any, any, any>> =
  keyof S["relations"];

/** Extracts the literal union type of action names from a specific schema type */
export type SchemaActions<S extends AuthSchema<any, any, any>> =
  keyof S["actionToRelations"];

export type SchemaSubjectTypes<S extends AuthSchema<any, any, any, any, any>> =
  NonNullable<S["_subjectType"]>;
export type SchemaObjectTypes<S extends AuthSchema<any, any, any, any, any>> =
  NonNullable<S["_objectType"]>;

/** Represents a relation name that is guaranteed to exist in the schema */
export type TypedRelation<S extends AuthSchema<any, any, any>> =
  SchemaRelations<S>;

/** Represents an action name that is guaranteed to exist in the schema */
export type TypedAction<S extends AuthSchema<any, any, any>> = SchemaActions<S>;

export type TypedSubject<S extends AuthSchema<any, any, any, any, any>> =
  Subject<SchemaSubjectTypes<S>>;
export type TypedObject<S extends AuthSchema<any, any, any, any, any>> =
  AnyObject<SchemaObjectTypes<S>>;
export type TypedInputTuple<S extends AuthSchema<any, any, any, any, any>> =
  InputTuple<SchemaSubjectTypes<S>, SchemaObjectTypes<S>>;
export type TypedStoredTuple<S extends AuthSchema<any, any, any, any, any>> =
  StoredTuple<SchemaSubjectTypes<S>, SchemaObjectTypes<S>>;

/**
 * Helper function to define an AuthSchema with strong type inference for structure.
 * Captures the literal types of relation and action names.
 * Subject and Object types are captured via optional arrays and generics.
 */
export function defineSchema<
  const Relations extends Readonly<Record<string, RelationDefinition>>,
  const ActionRelations extends Readonly<
    Record<string, ReadonlyArray<keyof Relations>>
  >,
  const SubT extends SubjectType,
  const ObjT extends ObjectType,
  const HierarchyProp extends
    | Readonly<
        Record<keyof ActionRelations, ReadonlyArray<keyof ActionRelations>>
      >
    | undefined = undefined,
>(schema: {
  relations: Relations;
  actionToRelations: ActionRelations;
  hierarchyPropagation?: HierarchyProp;

  subjectTypes?: ReadonlyArray<SubT>;
  objectTypes?: ReadonlyArray<ObjT>;
}): AuthSchema<Relations, ActionRelations, HierarchyProp, SubT, ObjT> {
  for (const action in schema.actionToRelations) {
    const relationsForAction = schema.actionToRelations[action];
    if (relationsForAction) {
      for (const relation of relationsForAction) {
        if (!(relation in schema.relations)) {
          console.warn(
            `Schema Warning: Action '${String(
              action,
            )}' references undefined relation '${String(relation)}'.`,
          );
        }
      }
    }
  }
  if (schema.hierarchyPropagation) {
    for (const childAction in schema.hierarchyPropagation) {
      if (!(childAction in schema.actionToRelations)) {
        console.warn(
          `Schema Warning: hierarchyPropagation references undefined child action '${String(
            childAction,
          )}'.`,
        );
      }
      const parentActions = schema.hierarchyPropagation[childAction];
      if (parentActions) {
        for (const parentAction of parentActions) {
          if (!(parentAction in schema.actionToRelations)) {
            console.warn(
              `Schema Warning: hierarchyPropagation for '${String(
                childAction,
              )}' references undefined parent action '${String(parentAction)}'.`,
            );
          }
        }
      }
    }
  }

  return schema as AuthSchema<
    Relations,
    ActionRelations,
    HierarchyProp,
    SubT,
    ObjT
  >;
}

/** Arguments for the listAccessibleObjects method */
export interface ListAccessibleObjectsArgs<
  Schema extends AuthSchema<any, any, any, any, any>,
> {
  who: TypedSubject<Schema>;
  ofType: SchemaObjectTypes<Schema>;

  canThey?: TypedAction<Schema>;

  context?: Record<string, any>;

  maxDepth?: number;
}

/** Represents a single accessible object and the actions allowed on it */
export interface AccessibleObject<
  Schema extends AuthSchema<any, any, any, any, any>,
> {
  /** The specific object identifier (e.g., "doc:1" or "doc:1#field") */
  object: TypedObject<Schema>;
  /** List of actions the subject can perform on this specific object identifier */
  actions: Array<TypedAction<Schema>>;
  /** Optional: The direct parent object if this object is part of a hierarchy */
  parent?: TypedObject<Schema>;
}

/** Result of the listAccessibleObjects method */
export interface ListAccessibleObjectsResult<
  Schema extends AuthSchema<any, any, any, any, any>,
> {
  accessible: Array<AccessibleObject<Schema>>;
}
