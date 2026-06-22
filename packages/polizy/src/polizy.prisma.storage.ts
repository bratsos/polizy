/**
 * @module polizy/prisma-storage
 */

import type { ReadOnlyStorage, StorageAdapter } from "./polizy.storage";
import type { RoleCatalogRecord, RoleCatalogStore } from "./role-registry";
import type {
  AnyObject,
  Condition,
  InputTuple,
  ObjectType,
  Relation,
  StoredTuple,
  Subject,
  SubjectType,
} from "./types";

/**
 * The minimal Prisma client surface this adapter uses. Defining it structurally
 * — rather than importing `PrismaClient` from `@prisma/client` — keeps the
 * library's type-check independent of whether the consumer has run
 * `prisma generate`, and avoids coupling to a specific Prisma version. Any
 * generated client that exposes a `polizyTuple` delegate satisfies this shape.
 */
type PrismaClientLike = {
  $transaction(operations: any[]): Promise<any[]>;
  polizyTuple: {
    upsert(args: any): any;
    deleteMany(args: { where: unknown }): Promise<{ count: number }>;
    findMany(args: any): Promise<any[]>;
  };
};

/** The `findMany` delegate, available both on the client and inside a tx. */
type TupleDelegate = { findMany(args: any): Promise<any[]> };

/** Prisma's interactive (callback) transaction form, used for snapshot reads. */
type InteractiveTransaction = <R>(
  fn: (tx: { polizyTuple: TupleDelegate }) => Promise<R>,
  options?: { isolationLevel?: string },
) => Promise<R>;

/**
 * Revive a condition read from a JSON column. JSON does not preserve `Date`, so
 * `validSince`/`validUntil` come back as ISO strings — convert them back to
 * `Date` so the engine's condition logic receives the contract it expects.
 */
function reviveCondition(raw: unknown): Condition | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const c = raw as Record<string, unknown>;
  const out: Condition = {};
  if (c.validSince != null) out.validSince = new Date(c.validSince as string);
  if (c.validUntil != null) out.validUntil = new Date(c.validUntil as string);
  if (Array.isArray(c.attributes))
    out.attributes = c.attributes as Condition["attributes"];
  return Object.keys(out).length > 0 ? out : undefined;
}

function mapPrismaTupleToStoredTuple<
  S extends SubjectType,
  O extends ObjectType,
>(prismaTuple: any): StoredTuple<S, O> {
  return {
    id: prismaTuple.id,
    subject: { type: prismaTuple.subjectType as S, id: prismaTuple.subjectId },
    relation: prismaTuple.relation,
    object: { type: prismaTuple.objectType as O, id: prismaTuple.objectId },
    condition: reviveCondition(prismaTuple.condition),
  };
}

// Read queries, parameterised by the `polizyTuple` delegate so the live client
// and a transaction-scoped snapshot resolve reads through the same code.

async function queryTuples<S extends SubjectType, O extends ObjectType>(
  tuple: TupleDelegate,
  filter: Partial<InputTuple<S, O>>,
  options?: { limit?: number; offset?: number },
): Promise<StoredTuple<S, O>[]> {
  const whereClause: any = {};
  if (filter.subject) {
    whereClause.subjectType = filter.subject.type;
    whereClause.subjectId = filter.subject.id;
  }
  if (filter.relation) {
    whereClause.relation = filter.relation;
  }
  if (filter.object) {
    whereClause.objectType = filter.object.type;
    whereClause.objectId = filter.object.id;
  }
  if (filter.condition !== undefined) {
    whereClause.condition = filter.condition;
  } else if (Object.hasOwn(filter, "condition")) {
    whereClause.condition = null;
  }

  const results = await tuple.findMany({
    where: whereClause,
    ...(options?.offset !== undefined ? { skip: options.offset } : {}),
    ...(options?.limit !== undefined ? { take: options.limit } : {}),
    orderBy: { id: "asc" },
  });
  return results.map(mapPrismaTupleToStoredTuple) as StoredTuple<S, O>[];
}

async function querySubjects<S extends SubjectType, O extends ObjectType>(
  tuple: TupleDelegate,
  object: AnyObject<O>,
  relation: Relation,
  options?: { subjectType?: S },
): Promise<Subject<S>[]> {
  const results = await tuple.findMany({
    where: {
      objectType: object.type,
      objectId: object.id,
      relation: relation,
      ...(options?.subjectType && { subjectType: options.subjectType }),
    },
    distinct: ["subjectType", "subjectId"],
    select: { subjectType: true, subjectId: true },
  });
  return results.map((r: { subjectType: string; subjectId: string }) => ({
    type: r.subjectType as S,
    id: r.subjectId,
  }));
}

async function queryObjects<S extends SubjectType, O extends ObjectType>(
  tuple: TupleDelegate,
  subject: Subject<S>,
  relation: Relation,
  options?: { objectType?: O },
): Promise<AnyObject<O>[]> {
  const results = await tuple.findMany({
    where: {
      subjectType: subject.type,
      subjectId: subject.id,
      relation: relation,
      ...(options?.objectType && { objectType: options.objectType }),
    },
    distinct: ["objectType", "objectId"],
    select: { objectType: true, objectId: true },
  });
  return results.map((r: { objectType: string; objectId: string }) => ({
    type: r.objectType as O,
    id: r.objectId,
  }));
}

export function PrismaAdapter<
  S extends SubjectType = SubjectType,
  O extends ObjectType = ObjectType,
>(
  prisma: PrismaClientLike,
  options?: {
    /**
     * Isolation level for {@link StorageAdapter.withSnapshot}. With Postgres use
     * `"RepeatableRead"` — MVCC means readers never block writers and writers
     * never block readers. SQLite ignores isolation levels (its read
     * transaction is already a snapshot), so leave it unset there.
     */
    snapshotIsolationLevel?: string;
  },
): StorageAdapter<S, O> {
  const p = prisma;
  const snapshotIsolationLevel = options?.snapshotIsolationLevel;

  return {
    async write(tuples: InputTuple<S, O>[]): Promise<StoredTuple<S, O>[]> {
      // Idempotent upsert per tuple, atomically, preserving input order. A
      // condition is only written when provided, so re-granting a tuple without
      // a `when` leaves any existing condition untouched (revoke to clear it).
      const rows = await p.$transaction(
        tuples.map((tuple) => {
          const key = {
            subjectType: tuple.subject.type,
            subjectId: tuple.subject.id,
            relation: tuple.relation,
            objectType: tuple.object.type,
            objectId: tuple.object.id,
          };
          const condition =
            tuple.condition !== undefined ? { condition: tuple.condition } : {};
          // The `where` targets the `@@unique([...])` compound key, whose
          // generated name Prisma derives by joining the fields with `_`.
          return p.polizyTuple.upsert({
            where: {
              subjectType_subjectId_relation_objectType_objectId: key,
            },
            create: { ...key, ...condition },
            update: condition,
          });
        }),
      );

      return rows.map(mapPrismaTupleToStoredTuple) as StoredTuple<S, O>[];
    },

    async delete(filter: {
      who?: Subject<S> | AnyObject<O>;
      was?: Relation;
      onWhat?: AnyObject<O>;
    }): Promise<number> {
      if (!filter.who && !filter.was && !filter.onWhat) {
        // Guard against accidental full deletion (AuthSystem also guards).
        return 0;
      }

      // Mirror the in-memory contract exactly:
      //   (who?  subject == who) AND
      //   (was?  relation == was) AND
      //   (onWhat?  object == onWhat OR subject == onWhat)
      // Because `who` is AND-ed at the top level, the subject-position arm can
      // only match when who === onWhat, so an explicit `who` never causes the
      // over-deletion the previous OR-spread did.
      const where: any = {};
      if (filter.who) {
        where.subjectType = filter.who.type;
        where.subjectId = filter.who.id;
      }
      if (filter.was) {
        where.relation = filter.was;
      }
      if (filter.onWhat) {
        where.OR = [
          { objectType: filter.onWhat.type, objectId: filter.onWhat.id },
          { subjectType: filter.onWhat.type, subjectId: filter.onWhat.id },
        ];
      }

      const result = await p.polizyTuple.deleteMany({ where });
      return result.count;
    },

    findTuples(
      filter: Partial<InputTuple<S, O>>,
      opts?: { limit?: number; offset?: number },
    ): Promise<StoredTuple<S, O>[]> {
      return queryTuples<S, O>(p.polizyTuple, filter, opts);
    },

    findSubjects(
      object: AnyObject<O>,
      relation: Relation,
      opts?: { subjectType?: S },
    ): Promise<Subject<S>[]> {
      return querySubjects<S, O>(p.polizyTuple, object, relation, opts);
    },

    findObjects(
      subject: Subject<S>,
      relation: Relation,
      opts?: { objectType?: O },
    ): Promise<AnyObject<O>[]> {
      return queryObjects<S, O>(p.polizyTuple, subject, relation, opts);
    },

    /**
     * Run `fn` inside one interactive transaction so every read sees the same
     * snapshot. Postgres with `snapshotIsolationLevel: "RepeatableRead"` gives
     * true MVCC point-in-time reads without blocking writers; SQLite's read
     * transaction is a snapshot already.
     */
    withSnapshot<T>(fn: (reader: ReadOnlyStorage<S, O>) => Promise<T>) {
      // Call through `p.$transaction` (not a detached local) so Prisma keeps
      // its `this` binding; the cast only selects the interactive overload.
      return (p.$transaction as unknown as InteractiveTransaction)(
        (tx) =>
          fn({
            findTuples: (filter, opts) =>
              queryTuples<S, O>(tx.polizyTuple, filter, opts),
            findSubjects: (object, relation, opts) =>
              querySubjects<S, O>(tx.polizyTuple, object, relation, opts),
            findObjects: (subject, relation, opts) =>
              queryObjects<S, O>(tx.polizyTuple, subject, relation, opts),
          }),
        snapshotIsolationLevel
          ? { isolationLevel: snapshotIsolationLevel }
          : undefined,
      );
    },
  };
}

/**
 * Alias for {@link PrismaAdapter}. Provided so the documented
 * `PrismaStorageAdapter` name resolves; both are the same factory.
 */
export const PrismaStorageAdapter = PrismaAdapter;

/** The minimal `polizyRole` delegate the role catalog uses. */
type PrismaRoleClientLike = {
  polizyRole: {
    upsert(args: any): Promise<any>;
    deleteMany(args: { where: unknown }): Promise<{ count: number }>;
    findUnique(args: any): Promise<any>;
    findMany(args: any): Promise<any[]>;
  };
};

/** Coerce a stored JSON `actions` column back into a string[]. */
function reviveActions(raw: unknown): string[] {
  return Array.isArray(raw)
    ? raw.filter((a): a is string => typeof a === "string")
    : [];
}

function mapRoleRecord(row: any): RoleCatalogRecord {
  return {
    tenant: row.tenant,
    key: row.key,
    label: row.label ?? undefined,
    actions: reviveActions(row.actions),
  };
}

/**
 * A persistent {@link RoleCatalogStore} backed by the `PolizyRole` table. Pass
 * it to a {@link RoleRegistry} so empty roles are listable and `assignRole` can
 * verify a role exists. The authorization engine never reads it — capabilities
 * and assignments live in `PolizyTuple` via the {@link PrismaAdapter}.
 *
 * @example
 * const roles = new RoleRegistry(authz, schema, {
 *   catalog: PrismaRoleCatalog(new PrismaClient()),
 * });
 */
export function PrismaRoleCatalog(
  prisma: PrismaRoleClientLike,
): RoleCatalogStore {
  const p = prisma;
  return {
    async upsert(record: RoleCatalogRecord): Promise<void> {
      await p.polizyRole.upsert({
        where: { tenant_key: { tenant: record.tenant, key: record.key } },
        create: {
          tenant: record.tenant,
          key: record.key,
          label: record.label ?? null,
          actions: record.actions,
        },
        update: {
          label: record.label ?? null,
          actions: record.actions,
        },
      });
    },
    async remove(tenant: string, key: string): Promise<void> {
      await p.polizyRole.deleteMany({ where: { tenant, key } });
    },
    async get(tenant: string, key: string): Promise<RoleCatalogRecord | null> {
      const row = await p.polizyRole.findUnique({
        where: { tenant_key: { tenant, key } },
      });
      return row ? mapRoleRecord(row) : null;
    },
    async list(tenant: string): Promise<RoleCatalogRecord[]> {
      const rows = await p.polizyRole.findMany({
        where: { tenant },
        orderBy: { key: "asc" },
      });
      return rows.map(mapRoleRecord);
    },
  };
}
