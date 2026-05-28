import { SchemaError } from "./errors.ts";

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

/** Reserved subject id representing "everyone" (a public/wildcard grant). */
export const PUBLIC_ID = "*";

/**
 * Build a wildcard subject of the given type. A grant to `everyone("user")`
 * authorizes every `user` subject.
 *
 * @example authz.allow({ who: everyone("user"), toBe: "viewer", onWhat: doc })
 */
export const everyone = <T extends SubjectType>(type: T): Subject<T> => ({
  type,
  id: PUBLIC_ID,
});

/** Pluggable logger. Defaults to a no-op inside AuthSystem. */
export interface Logger {
  warn(message: string, meta?: unknown): void;
  error(message: string, meta?: unknown): void;
  debug?(message: string, meta?: unknown): void;
}

export type Relation = string;
export type Action = string;
export type TupleId = string;

/** A JSON scalar usable as an attribute-predicate operand. */
export type JsonScalar = string | number | boolean | null;

/** Comparison operators supported by attribute predicates. */
export type AttributeOperator =
  | "eq"
  | "ne"
  | "in"
  | "nin"
  | "gt"
  | "gte"
  | "lt"
  | "lte";

/**
 * An attribute-based predicate evaluated against the `context` passed to
 * `check()`. `attribute` is a dot-path into the context object.
 */
export type AttributePredicate = {
  attribute: string;
  operator: AttributeOperator;
  value: JsonScalar | JsonScalar[];
};

/**
 * Constraints attached to a tuple. A tuple only grants access while its
 * condition is valid: within the optional time window AND with every attribute
 * predicate satisfied by the check-time context. Evaluation is fail-closed.
 */
export type Condition = {
  validSince?: Date;
  validUntil?: Date;
  /** All predicates must pass (logical AND). */
  attributes?: AttributePredicate[];
};

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

  /**
   * Object types that use field-level identifiers (id contains `fieldSeparator`,
   * e.g. `doc1#title`). Only these types inherit access from their base object.
   * Omit to disable field-level identifiers entirely (secure default).
   */
  fieldLevelObjects?: ReadonlyArray<ValidObjectTypes>;
  /** Separator between base id and field for `fieldLevelObjects`. Default `"#"`. */
  fieldSeparator?: string;

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

  fieldLevelObjects?: ReadonlyArray<ObjT>;
  fieldSeparator?: string;

  subjectTypes?: ReadonlyArray<SubT>;
  objectTypes?: ReadonlyArray<ObjT>;
}): AuthSchema<Relations, ActionRelations, HierarchyProp, SubT, ObjT> {
  for (const action in schema.actionToRelations) {
    const relationsForAction = schema.actionToRelations[action];
    if (relationsForAction) {
      for (const relation of relationsForAction) {
        if (!(relation in schema.relations)) {
          throw new SchemaError(
            `Action '${String(action)}' references undefined relation '${String(
              relation,
            )}'.`,
          );
        }
      }
    }
  }
  if (schema.hierarchyPropagation) {
    for (const childAction in schema.hierarchyPropagation) {
      if (!(childAction in schema.actionToRelations)) {
        throw new SchemaError(
          `hierarchyPropagation references undefined child action '${String(
            childAction,
          )}'.`,
        );
      }
      const parentActions = schema.hierarchyPropagation[childAction];
      if (parentActions) {
        for (const parentAction of parentActions) {
          if (!(parentAction in schema.actionToRelations)) {
            throw new SchemaError(
              `hierarchyPropagation for '${String(
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

/**
 * A node in an authorization explanation tree — the path by which access was
 * granted. Produced by `explain()`.
 */
export type ExplainNode =
  | { kind: "direct"; relation: string }
  | { kind: "wildcard"; relation: string }
  | { kind: "field"; base: AnyObject; via: ExplainNode }
  | { kind: "group"; relation: string; through: AnyObject; via: ExplainNode }
  | { kind: "hierarchy"; relation: string; parent: AnyObject; via: ExplainNode };

/** Result of `explain()`: the decision plus the granting path (null when denied). */
export type ExplainResult = { allowed: boolean; via: ExplainNode | null };
