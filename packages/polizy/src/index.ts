export { isConditionValid } from "./conditions";
export * from "./polizy";
export { InMemoryStorageAdapter } from "./polizy.in-memory.storage";
export type { StorageAdapter } from "./polizy.storage";
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
