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
 * The minimal Prisma 6/7 client surface this adapter uses. Defining it
 * structurally — rather than importing `PrismaClient` from `@prisma/client` —
 * keeps the library's type-check independent of whether the consumer has run
 * `prisma generate`, and avoids coupling to a specific Prisma version. Any
 * generated client that exposes a `polizyTuple` delegate satisfies this shape,
 * including the `tx` client of an interactive transaction.
 */
type PrismaClientLike = {
  $transaction?(operations: any[]): Promise<any[]>;
  polizyTuple: {
    upsert(args: any): any;
    deleteMany(args: any): Promise<{ count: number }>;
    findMany(args: any): Promise<any[]>;
  };
};

/**
 * A Prisma 8 client (`postgres({ contract })` from `@prisma/orm-postgres`) or
 * the `tx` that its `transaction()` callback receives. Typed loosely so any
 * contract's client fits; the contract must declare the `PolizyTuple` model (and
 * `PolizyRole` for the role catalog) in the `public` namespace.
 */
type Prisma8ClientLike = {
  orm: { public: object };
  transaction?: unknown;
};

type PrismaAdapterOptions = {
  /**
   * Isolation level for {@link StorageAdapter.withSnapshot}. With Postgres use
   * `"RepeatableRead"` — MVCC means readers never block writers and writers
   * never block readers. SQLite ignores isolation levels (its read
   * transaction is already a snapshot), so leave it unset there. Prisma 8
   * honors it from `@prisma/orm-postgres` 8.0.0-rc.25; earlier release
   * candidates ignore it and read at READ COMMITTED.
   */
  snapshotIsolationLevel?: string;
  /**
   * Options for the underlying interactive transaction. Prisma 6/7 defaults
   * are maxWait 2s, timeout 5s. Raise them for strong-consistency list
   * operations over large stores. Prisma 8 has no `maxWait`; only `timeout`
   * applies there.
   */
  transactionOptions?: {
    maxWait?: number;
    timeout?: number;
  };
};

/** The `findMany` delegate, available both on the client and inside a tx. */
type TupleDelegate = { findMany(args: any): Promise<any[]> };

/** Prisma's interactive (callback) transaction form. */
type InteractiveTransaction = <R>(
  fn: (tx: Pick<PrismaClientLike, "polizyTuple">) => Promise<R>,
  options?: { isolationLevel?: string; maxWait?: number; timeout?: number },
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

/** Map a tuple filter to column equalities (both Prisma generations use them). */
function tupleWhere(filter: Partial<InputTuple>): Record<string, unknown> {
  const where: Record<string, unknown> = {};
  if (filter.subject) {
    where.subjectType = filter.subject.type;
    where.subjectId = filter.subject.id;
  }
  if (filter.relation) {
    where.relation = filter.relation;
  }
  if (filter.object) {
    where.objectType = filter.object.type;
    where.objectId = filter.object.id;
  }
  if (filter.condition !== undefined) {
    where.condition = filter.condition;
  }
  return where;
}

// Read queries, parameterised by the `polizyTuple` delegate so the live client
// and a transaction-scoped snapshot resolve reads through the same code.

async function queryTuples<S extends SubjectType, O extends ObjectType>(
  tuple: TupleDelegate,
  filter: Partial<InputTuple<S, O>>,
  options?: { limit?: number; offset?: number },
): Promise<StoredTuple<S, O>[]> {
  const results = await tuple.findMany({
    where: tupleWhere(filter),
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

/**
 * Prisma marks the client of an interactive transaction: Prisma 6 to 7.4 with
 * `prisma.client.transaction.id`, Prisma 7.5 and later with
 * `…transaction.scope_context`. Root clients, extended clients and hand-made
 * wrappers carry neither.
 */
const PRISMA_TX_MARKS = [
  Symbol.for("prisma.client.transaction.id"),
  Symbol.for("prisma.client.transaction.scope_context"),
];
const isPrismaTransaction = (c: object) =>
  PRISMA_TX_MARKS.some((mark) => mark in c);

/** An unmarked client must open its own transactions, or multi-row writes could partially commit. */
function cannotWriteAtomically(): never {
  throw new Error(
    "polizy: pass PrismaAdapter a Prisma client or the `tx` of an interactive transaction. This object is neither: it has no $transaction()/transaction() method and no Prisma transaction mark, so its writes could not be atomic.",
  );
}

/** A Prisma 8 client has `orm`; a Prisma 6/7 one has model delegates (even if an extension adds `orm`). */
const isPrisma8 = (c: object): c is Prisma8ClientLike =>
  "orm" in c && !("polizyTuple" in c) && !("polizyRole" in c);

/** The (subject, relation, object) identity columns of a tuple. */
function tupleKey(tuple: InputTuple) {
  return {
    subjectType: tuple.subject.type,
    subjectId: tuple.subject.id,
    relation: tuple.relation,
    objectType: tuple.object.type,
    objectId: tuple.object.id,
  };
}

/**
 * A condition is only written when provided, so re-granting a tuple without a
 * `when` leaves any existing condition untouched (revoke to clear it).
 */
function conditionUpdate(tuple: InputTuple) {
  return tuple.condition !== undefined ? { condition: tuple.condition } : {};
}

/**
 * Storage adapter for Prisma 6, 7 and 8.
 *
 * Pass the root client, or the transaction client your own code is running in
 * (Prisma 6/7: the `tx` of `prisma.$transaction(async (tx) => …)`; Prisma 8:
 * the `tx` of `db.transaction(async (tx) => …)`). With a transaction client,
 * every read and write runs on that transaction — under its isolation level,
 * row-level-security settings and uncommitted writes — and the adapter offers
 * no `withSnapshot`, so `consistency: "strong"` reads follow your transaction.
 */
export function PrismaAdapter<
  S extends SubjectType = SubjectType,
  O extends ObjectType = ObjectType,
>(
  prisma: PrismaClientLike | Prisma8ClientLike,
  options?: PrismaAdapterOptions,
): StorageAdapter<S, O> {
  if (isPrisma8(prisma)) return prisma8Adapter<S, O>(prisma, options);
  const p = prisma;
  const snapshotIsolationLevel = options?.snapshotIsolationLevel;
  // On an interactive-transaction client, run on the caller's transaction:
  // Prisma 7's tx keeps a `$transaction` whose batch form would commit apart.
  const inTransaction = isPrismaTransaction(p);
  // Captured once: the adapter's mode cannot change after construction.
  const transaction =
    !inTransaction && typeof p.$transaction === "function"
      ? p.$transaction.bind(p)
      : undefined;
  if (!inTransaction && !transaction) cannotWriteAtomically();
  const adapter: StorageAdapter<S, O> = {
    async write(tuples: InputTuple<S, O>[]): Promise<StoredTuple<S, O>[]> {
      // Idempotent upsert per tuple, atomically, preserving input order.
      // The `where` targets the `@@unique([...])` compound key, whose
      // generated name Prisma derives by joining the fields with `_`.
      type Delegate = PrismaClientLike["polizyTuple"];
      const upsert = (delegate: Delegate, tuple: InputTuple<S, O>) => {
        const key = tupleKey(tuple);
        const condition = conditionUpdate(tuple);
        return delegate.upsert({
          where: { subjectType_subjectId_relation_objectType_objectId: key },
          create: { ...key, ...condition },
          update: condition,
        });
      };
      let rows: any[];
      if (transaction) {
        rows = await transaction(
          tuples.map((tuple) => upsert(p.polizyTuple, tuple)),
        );
      } else {
        // The caller's transaction provides atomicity.
        rows = [];
        for (const tuple of tuples)
          rows.push(await upsert(p.polizyTuple, tuple));
      }
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
  };
  if (!transaction) return adapter;

  /**
   * Run `fn` inside one interactive transaction so every read sees the same
   * snapshot. Postgres with `snapshotIsolationLevel: "RepeatableRead"` gives
   * true MVCC point-in-time reads without blocking writers; SQLite's read
   * transaction is a snapshot already.
   */
  return {
    ...adapter,
    withSnapshot<T>(fn: (reader: ReadOnlyStorage<S, O>) => Promise<T>) {
      // `transaction` is bound to the client; the cast only selects the
      // interactive overload.
      let txOpts:
        | { isolationLevel?: string; maxWait?: number; timeout?: number }
        | undefined = undefined;
      if (snapshotIsolationLevel || options?.transactionOptions) {
        txOpts = {
          ...(snapshotIsolationLevel
            ? { isolationLevel: snapshotIsolationLevel }
            : {}),
          ...options?.transactionOptions,
        };
      }
      return (transaction as unknown as InteractiveTransaction)(
        (tx) =>
          fn({
            findTuples: (filter, opts) =>
              queryTuples<S, O>(tx.polizyTuple, filter, opts),
            findSubjects: (object, relation, opts) =>
              querySubjects<S, O>(tx.polizyTuple, object, relation, opts),
            findObjects: (subject, relation, opts) =>
              queryObjects<S, O>(tx.polizyTuple, subject, relation, opts),
          }),
        txOpts,
      );
    },
  };
}

/**
 * Alias for {@link PrismaAdapter}. Provided so the documented
 * `PrismaStorageAdapter` name resolves; both are the same factory.
 */
export const PrismaStorageAdapter = PrismaAdapter;

// --- Prisma 8 (`@prisma/orm-postgres`) ---------------------------------------

/** The slice of a Prisma 8 ORM collection (`db.orm.public.<Model>`) used here. */
type OrmCollection = {
  where(
    filter:
      | Record<string, unknown>
      | ((row: any, helpers: { fns: any }) => unknown),
  ): OrmCollection;
  orderBy(order: (row: any) => unknown): OrmCollection;
  limit(n: number): OrmCollection;
  offset(n: number): OrmCollection;
  all(): PromiseLike<any[]>;
  first(): PromiseLike<any>;
  upsert(input: {
    create: object;
    update: object;
    conflictOn: object;
  }): PromiseLike<any>;
  deleteAndCount(): PromiseLike<number>;
};

type OrmScope = { orm: { public: Record<string, OrmCollection | undefined> } };

/**
 * A Prisma 8 client that can open transactions. The `tx` of
 * `db.transaction()` carries an `invalidated` flag that root clients lack; on
 * it, polizy runs every query on the caller's transaction.
 */
type OrmRoot = OrmScope & {
  transaction<R>(
    fn: (tx: OrmScope) => PromiseLike<R>,
    options?: { isolationLevel?: string; timeout?: number },
  ): Promise<R>;
};

const isOrmTransaction = (c: OrmScope) =>
  typeof (c as { invalidated?: unknown }).invalidated === "boolean";

const isOrmRoot = (c: OrmScope): c is OrmRoot =>
  !isOrmTransaction(c) &&
  typeof (c as Partial<OrmRoot>).transaction === "function";

function ormModel(client: OrmScope, name: string): OrmCollection {
  const model = client.orm.public[name];
  if (!model) {
    throw new Error(
      `polizy: the Prisma 8 client has no '${name}' model in the 'public' namespace. Add it to your contract and run \`prisma contract emit\`.`,
    );
  }
  return model;
}

async function ormFindTuples<S extends SubjectType, O extends ObjectType>(
  client: OrmScope,
  filter: Partial<InputTuple<S, O>>,
  options?: { limit?: number; offset?: number },
): Promise<StoredTuple<S, O>[]> {
  let query = ormModel(client, "PolizyTuple")
    .where(tupleWhere(filter))
    .orderBy((t) => t.id.asc());
  if (options?.offset !== undefined) query = query.offset(options.offset);
  if (options?.limit !== undefined) query = query.limit(options.limit);
  const rows = await query.all();
  return rows.map(mapPrismaTupleToStoredTuple) as StoredTuple<S, O>[];
}

/** The read surface over a Prisma 8 client or transaction. */
function ormReader<S extends SubjectType, O extends ObjectType>(
  client: OrmScope,
): ReadOnlyStorage<S, O> {
  // Not on the engine's read path (it derives these from findTuples), so a
  // filter plus an in-memory dedupe keeps them simple.
  const unique = <T extends { type: string; id: string }>(items: T[]) => [
    ...new Map(items.map((i) => [JSON.stringify([i.type, i.id]), i])).values(),
  ];
  return {
    findTuples: (filter, opts) => ormFindTuples<S, O>(client, filter, opts),
    async findSubjects(object, relation, opts) {
      const rows = await ormFindTuples<S, O>(client, { object, relation });
      return unique(
        rows
          .filter((t) => t.relation === relation) // tupleWhere skips ""
          .map((t) => t.subject as Subject<S>)
          .filter((s) => !opts?.subjectType || s.type === opts.subjectType),
      );
    },
    async findObjects(subject, relation, opts) {
      const rows = await ormFindTuples<S, O>(client, { subject, relation });
      return unique(
        rows
          .filter((t) => t.relation === relation) // tupleWhere skips ""
          .map((t) => t.object)
          .filter((o) => !opts?.objectType || o.type === opts.objectType),
      );
    },
  };
}

function prisma8Adapter<S extends SubjectType, O extends ObjectType>(
  prisma: Prisma8ClientLike,
  options?: PrismaAdapterOptions,
): StorageAdapter<S, O> {
  const client = prisma as OrmScope;
  ormModel(client, "PolizyTuple"); // fail fast on a contract without the model
  // Captured once: the adapter's mode cannot change after construction.
  const transaction = isOrmRoot(client)
    ? client.transaction.bind(client)
    : undefined;
  if (!transaction && !isOrmTransaction(client)) cannotWriteAtomically();
  // On a transaction client, run on the caller's transaction.
  const atomically = <R>(fn: (scope: OrmScope) => Promise<R>) =>
    transaction ? transaction(fn) : fn(client);

  const adapter: StorageAdapter<S, O> = {
    ...ormReader<S, O>(client),

    async write(tuples: InputTuple<S, O>[]): Promise<StoredTuple<S, O>[]> {
      // Prisma 8 has no batch `$transaction([...])`: upsert in sequence,
      // atomically, preserving input order.
      const rows = await atomically(async (scope) => {
        const out: any[] = [];
        for (const tuple of tuples) {
          const key = tupleKey(tuple);
          const condition = conditionUpdate(tuple);
          out.push(
            await ormModel(scope, "PolizyTuple").upsert({
              create: { ...key, ...condition },
              update: condition,
              conflictOn: key,
            }),
          );
        }
        return out;
      });
      return rows.map(mapPrismaTupleToStoredTuple) as StoredTuple<S, O>[];
    },

    async delete(filter: {
      who?: Subject<S> | AnyObject<O>;
      was?: Relation;
      onWhat?: AnyObject<O>;
    }): Promise<number> {
      const { who, was, onWhat } = filter;
      if (!who && !was && !onWhat) return 0; // never delete everything
      const base: Record<string, unknown> = {};
      if (who) {
        base.subjectType = who.type;
        base.subjectId = who.id;
      }
      if (was) base.relation = was;
      const matching = ormModel(client, "PolizyTuple").where(base);
      if (!onWhat) return matching.deleteAndCount();
      // One statement: `onWhat` matches the object OR the subject position.
      // The combinators come from the callback, so polizy imports no Prisma.
      return matching
        .where((t, { fns }) =>
          fns.or(
            fns.and(t.objectType.eq(onWhat.type), t.objectId.eq(onWhat.id)),
            fns.and(t.subjectType.eq(onWhat.type), t.subjectId.eq(onWhat.id)),
          ),
        )
        .deleteAndCount();
    },
  };
  if (!transaction) return adapter;

  const txOptions = {
    ...(options?.snapshotIsolationLevel
      ? { isolationLevel: options.snapshotIsolationLevel }
      : {}),
    ...(options?.transactionOptions?.timeout !== undefined
      ? { timeout: options.transactionOptions.timeout }
      : {}),
  };
  return {
    ...adapter,
    withSnapshot: (fn) =>
      transaction((tx) => fn(ormReader<S, O>(tx)), txOptions),
  };
}

/** The minimal `polizyRole` delegate the role catalog uses. */
type PrismaRoleClientLike = {
  polizyRole: {
    upsert(args: any): Promise<any>;
    deleteMany(args: any): Promise<{ count: number }>;
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
 * Accepts a Prisma 6/7 client or a Prisma 8 client (or either one's
 * transaction client), like {@link PrismaAdapter}.
 *
 * @example
 * const roles = new RoleRegistry(authz, schema, {
 *   catalog: PrismaRoleCatalog(new PrismaClient()),
 * });
 */
export function PrismaRoleCatalog(
  prisma: PrismaRoleClientLike | Prisma8ClientLike,
): RoleCatalogStore {
  if (isPrisma8(prisma)) return prisma8RoleCatalog(prisma as OrmScope);
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

function prisma8RoleCatalog(client: OrmScope): RoleCatalogStore {
  const roles = () => ormModel(client, "PolizyRole");
  roles(); // fail fast on a contract without the model
  return {
    async upsert(record: RoleCatalogRecord): Promise<void> {
      const key = { tenant: record.tenant, key: record.key };
      const fields = { label: record.label ?? null, actions: record.actions };
      await roles().upsert({
        create: { ...key, ...fields },
        update: fields,
        conflictOn: key,
      });
    },
    async remove(tenant: string, key: string): Promise<void> {
      await roles().where({ tenant, key }).deleteAndCount();
    },
    async get(tenant: string, key: string): Promise<RoleCatalogRecord | null> {
      const row = await roles().where({ tenant, key }).first();
      return row ? mapRoleRecord(row) : null;
    },
    async list(tenant: string): Promise<RoleCatalogRecord[]> {
      const rows = await roles()
        .where({ tenant })
        .orderBy((r) => r.key.asc())
        .all();
      return rows.map(mapRoleRecord);
    },
  };
}
