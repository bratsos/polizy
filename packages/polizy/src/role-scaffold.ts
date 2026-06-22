import { SchemaError } from "./errors.ts";
import type {
  AuthSchema,
  RelationDefinition,
  RoleScaffoldMeta,
  SchemaObjectTypes,
  SchemaSubjectTypes,
  TypedAction,
} from "./types.ts";

/**
 * Runtime-roles scaffold for polizy.
 *
 * The canonical Zanzibar pattern for end-user custom roles is "roles as data":
 * declare a generic `role` object type once, then express every tenant-defined
 * role purely as tuples. {@link withRoleScaffold} bakes that scaffold into a
 * schema while preserving its literal types — so the action vocabulary a role
 * may grant stays compile-time-checked, and only the role *name* (born at
 * runtime) is a string.
 *
 * It adds, to an existing schema:
 *  - a `role` object type,
 *  - a reserved `assignee` **group** relation (subject -> role membership), and
 *  - one `cap_<action>` **direct** relation per grantable action, appended to
 *    that action's `actionToRelations`.
 *
 * A custom role then resolves on the *unchanged* engine:
 * `user --assignee--> role --cap_<action>--> resource` (with hierarchy
 * propagation carrying a workspace-scoped cap down to its resources).
 */

/** The `cap_<action>` relation name for a grantable action. */
export type CapName<
  Prefix extends string,
  Action extends string,
> = `${Prefix}${Action}`;

type ScaffoldRelations<
  Relations,
  Grantable extends readonly string[],
  Assignee extends string,
  Prefix extends string,
> = Relations & { readonly [K in Assignee]: { type: "group" } } & {
  readonly [K in Grantable[number] as CapName<Prefix, K & string>]: {
    type: "direct";
  };
};

type ScaffoldActions<
  ActionRelations,
  Grantable extends readonly string[],
  Prefix extends string,
> = {
  readonly [K in keyof ActionRelations]: K extends Grantable[number]
    ? readonly [
        ...(ActionRelations[K] extends readonly unknown[]
          ? ActionRelations[K]
          : never),
        CapName<Prefix, K & string>,
      ]
    : ActionRelations[K];
};

/**
 * A schema returned by {@link withRoleScaffold}: the original schema with the
 * role scaffold relations/actions merged in (literal types preserved), the
 * `role` object type added, and the grantable action union recorded for the
 * `RoleRegistry` via the `_grantable` phantom.
 */
export type RoleScaffoldedSchema<
  S extends AuthSchema<any, any, any, any, any>,
  Grantable extends readonly string[],
  RoleType extends string = "role",
  Assignee extends string = "assignee",
  Prefix extends string = "cap_",
> = {
  relations: ScaffoldRelations<S["relations"], Grantable, Assignee, Prefix>;
  actionToRelations: ScaffoldActions<S["actionToRelations"], Grantable, Prefix>;
  hierarchyPropagation?: S["hierarchyPropagation"];
  fieldLevelObjects?: S["fieldLevelObjects"];
  fieldSeparator?: string;
  roleScaffold: RoleScaffoldMeta;
  _subjectType?: SchemaSubjectTypes<S>;
  _objectType?: SchemaObjectTypes<S> | RoleType;
  _grantable?: Grantable[number];
};

/** A schema known to carry a role scaffold (the `RoleRegistry`'s constraint). */
export type AnyRoleScaffoldedSchema = AuthSchema<any, any, any, any, any> & {
  roleScaffold: RoleScaffoldMeta;
  _grantable?: string;
};

/** The literal union of actions custom roles may grant on a scaffolded schema. */
export type GrantableAction<S extends AnyRoleScaffoldedSchema> = NonNullable<
  S["_grantable"]
> &
  TypedAction<S>;

/**
 * Merge the runtime-roles scaffold into a schema, preserving literal types.
 *
 * @example
 * const schema = withRoleScaffold(baseSchema, {
 *   grantable: ["view_bookings", "issue_refunds"],
 * });
 * // `role` object type, `assignee` group relation, and `cap_view_bookings` /
 * // `cap_issue_refunds` direct relations are now part of `schema`.
 */
export function withRoleScaffold<
  S extends AuthSchema<any, any, any, any, any>,
  const Grantable extends readonly (TypedAction<S> & string)[],
  RoleType extends string = "role",
  Assignee extends string = "assignee",
  Prefix extends string = "cap_",
>(
  schema: S,
  opts: {
    grantable: Grantable;
    /** Object type for role objects. Default `"role"`. */
    roleType?: RoleType;
    /** Reserved group relation for user->role membership. Default `"assignee"`. */
    assigneeRelation?: Assignee;
    /** Prefix for the per-action capability relations. Default `"cap_"`. */
    capPrefix?: Prefix;
  },
): RoleScaffoldedSchema<S, Grantable, RoleType, Assignee, Prefix> {
  const roleType = (opts.roleType ?? "role") as RoleType;
  const assigneeRelation = (opts.assigneeRelation ?? "assignee") as Assignee;
  const capPrefix = (opts.capPrefix ?? "cap_") as Prefix;
  const grantable = opts.grantable as readonly string[];

  const baseRelations = schema.relations as Record<string, RelationDefinition>;
  const baseActions = schema.actionToRelations as Record<
    string,
    readonly string[]
  >;

  if (baseRelations[assigneeRelation]) {
    throw new SchemaError(
      `Role scaffold cannot add reserved relation '${assigneeRelation}': it already exists in the schema. Pass a different 'assigneeRelation'.`,
    );
  }

  const relations: Record<string, RelationDefinition> = {
    ...baseRelations,
    [assigneeRelation]: { type: "group" },
  };
  const actionToRelations: Record<string, readonly string[]> = {
    ...baseActions,
  };

  const seen = new Set<string>();
  for (const action of grantable) {
    if (seen.has(action)) continue;
    seen.add(action);
    if (!baseActions[action]) {
      throw new SchemaError(
        `Role scaffold 'grantable' action '${action}' is not defined in actionToRelations.`,
      );
    }
    const capName = `${capPrefix}${action}`;
    if (baseRelations[capName]) {
      throw new SchemaError(
        `Role scaffold cannot add capability relation '${capName}': it already exists in the schema.`,
      );
    }
    relations[capName] = { type: "direct" };
    actionToRelations[action] = [...baseActions[action], capName];
  }

  const roleScaffold: RoleScaffoldMeta = {
    roleType,
    assigneeRelation,
    capPrefix,
    grantable: [...seen],
  };

  const out: Record<string, unknown> = {
    ...(schema as Record<string, unknown>),
    relations,
    actionToRelations,
    roleScaffold,
  };

  // Keep the runtime `objectTypes`/`subjectTypes` arrays (if present) coherent —
  // some consumers iterate them even though the engine relies only on types.
  const objectTypes = (schema as { objectTypes?: readonly string[] })
    .objectTypes;
  if (Array.isArray(objectTypes) && !objectTypes.includes(roleType)) {
    out.objectTypes = [...objectTypes, roleType];
  }

  return out as RoleScaffoldedSchema<S, Grantable, RoleType, Assignee, Prefix>;
}
