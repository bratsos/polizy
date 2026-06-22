/**
 * @module polizy
 */

export { isConditionValid } from "./conditions";
export * from "./polizy";
export { InMemoryStorageAdapter } from "./polizy.in-memory.storage";
export type { StorageAdapter } from "./polizy.storage";
export type {
  PermissionMatrix,
  RoleCatalogRecord,
  RoleCatalogStore,
  RoleRef,
} from "./role-registry";
export { InMemoryRoleCatalog, RoleRegistry } from "./role-registry";
export type {
  AnyRoleScaffoldedSchema,
  CapName,
  GrantableAction,
  RoleScaffoldedSchema,
} from "./role-scaffold";
// Runtime roles: define and assign custom roles as data, with no schema change.
export { withRoleScaffold } from "./role-scaffold";
export { defineSchema, everyone, PUBLIC_ID } from "./types";

// The Prisma adapter is exported from the "polizy/prisma-storage" subpath so the
// core entry's types never depend on @prisma/client (an optional peer).

export * from "./errors";
export type {
  AccessibleObject,
  AnyObject,
  AttributeOperator,
  AttributePredicate,
  AuthSchema,
  Condition,
  ExplainNode,
  ExplainResult,
  InputTuple,
  JsonScalar,
  ListAccessibleObjectsArgs,
  ListAccessibleObjectsResult,
  Logger,
  RoleScaffoldMeta,
  SchemaActions,
  SchemaObjectTypes,
  SchemaRelations,
  SchemaSubjectTypes,
  StoredTuple,
  Subject,
  TupleSubject,
  TypedAction,
  TypedInputTuple,
  TypedObject,
  TypedRelation,
  TypedStoredTuple,
  TypedSubject,
} from "./types";
