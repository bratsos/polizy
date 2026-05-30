import type { AuthSchema, ObjectType, RelationDefinition } from "./types.ts";

type AnySchema = AuthSchema<any, any, any, any, any>;

const relationsOfType = (
  schema: AnySchema,
  type: RelationDefinition["type"],
): string[] =>
  Object.entries(schema.relations)
    .filter(([, def]) => (def as RelationDefinition).type === type)
    .map(([name]) => name);

/** All relation names declared with `type: "group"`. */
export const groupRelations = (schema: AnySchema): string[] =>
  relationsOfType(schema, "group");

/** All relation names declared with `type: "hierarchy"`. */
export const hierarchyRelations = (schema: AnySchema): string[] =>
  relationsOfType(schema, "hierarchy");

/** The configured field separator, defaulting to `"#"`. */
export const fieldSeparator = (schema: AnySchema): string =>
  schema.fieldSeparator ?? "#";

/** Whether the given object type opts into field-level identifiers. */
export const isFieldType = (schema: AnySchema, type: ObjectType): boolean =>
  Array.isArray(schema.fieldLevelObjects) &&
  (schema.fieldLevelObjects as readonly string[]).includes(type);

/**
 * Resolve the relation to use for a group/hierarchy write. When the schema
 * declares exactly one relation of the kind, it is inferred; when it declares
 * several, the caller must pass `as`. Throws via the provided factory otherwise.
 */
export const resolveRelation = (
  available: string[],
  as: string | undefined,
  kind: "group" | "hierarchy",
  onMissing: (message: string) => Error,
): string => {
  if (available.length === 0) {
    throw onMissing(`Schema does not define any relation with type '${kind}'.`);
  }
  if (as !== undefined) {
    if (!available.includes(as)) {
      throw onMissing(
        `Relation '${as}' is not a '${kind}' relation. Available: ${available.join(", ")}.`,
      );
    }
    return as;
  }
  if (available.length > 1) {
    throw onMissing(
      `Schema declares multiple '${kind}' relations (${available.join(
        ", ",
      )}); specify which via 'as'.`,
    );
  }
  return available[0] as string;
};
