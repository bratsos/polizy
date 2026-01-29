/**
 * Internal test utilities for the polizy package.
 *
 * These utilities are intended for internal testing only and are not exported
 * from the package's public API. They provide consistent patterns for creating
 * test fixtures and making assertions in authorization tests.
 *
 * @internal
 */

import { InMemoryStorageAdapter } from "./polizy.in-memory.storage.ts";
import { AuthSystem } from "./polizy.ts";
import type {
  AnyObject,
  AuthSchema,
  SchemaObjectTypes,
  SchemaSubjectTypes,
  Subject,
  TypedAction,
} from "./types.ts";

/**
 * Creates an AuthSystem instance for testing.
 * Use this instead of accessing storage directly in tests.
 */
export function createTestAuthSystem<
  S extends AuthSchema<any, any, any, any, any>,
>(schema: S): AuthSystem<S> {
  const storage = new InMemoryStorageAdapter();
  return new AuthSystem({ storage, schema });
}

/**
 * Standard assertion helper for permission checks.
 * Provides consistent assertion style across all tests.
 */
export async function assertCanDo<
  S extends AuthSchema<any, any, any, any, any>,
>(
  authz: AuthSystem<S>,
  who: Subject<SchemaSubjectTypes<S>> | AnyObject<SchemaObjectTypes<S>>,
  action: TypedAction<S>,
  onWhat: AnyObject<SchemaObjectTypes<S>>,
  message?: string,
): Promise<void> {
  const result = await authz.check({ who, canThey: action, onWhat });
  if (!result) {
    throw new Error(
      message ??
        `Expected ${who.type}:${who.id} to be able to ${action as string} ${onWhat.type}:${onWhat.id}`,
    );
  }
}

/**
 * Standard assertion helper for permission denials.
 * Provides consistent assertion style across all tests.
 */
export async function assertCannotDo<
  S extends AuthSchema<any, any, any, any, any>,
>(
  authz: AuthSystem<S>,
  who: Subject<SchemaSubjectTypes<S>> | AnyObject<SchemaObjectTypes<S>>,
  action: TypedAction<S>,
  onWhat: AnyObject<SchemaObjectTypes<S>>,
  message?: string,
): Promise<void> {
  const result = await authz.check({ who, canThey: action, onWhat });
  if (result) {
    throw new Error(
      message ??
        `Expected ${who.type}:${who.id} to NOT be able to ${action as string} ${onWhat.type}:${onWhat.id}`,
    );
  }
}
