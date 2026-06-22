import type { PGlite } from "@electric-sql/pglite";
import type {
  AnyObject,
  Condition,
  InputTuple,
  StorageAdapter,
  StoredTuple,
  Subject,
} from "polizy";

/**
 * A polizy StorageAdapter backed by PGlite (Postgres in WASM).
 *
 * Polizy keeps its engine (the `check`/`explain` graph walk) separate from
 * *where the tuples live*. A `StorageAdapter` is that seam: implement these five
 * methods for any database and the engine works unchanged. The library ships an
 * in-memory adapter and a Prisma adapter; this is a third, ~plain-SQL one, so
 * the whole demo can run a real Postgres **in each visitor's browser** (Prisma
 * Client can't run client-side yet — PGlite can).
 *
 * Every tuple is one row: (subject, relation, object) + an optional JSON
 * `condition` (time window / attribute predicates).
 */

/** The single table every polizy adapter manages. */
export const POLIZY_TUPLE_DDL = `
  CREATE TABLE IF NOT EXISTS polizy_tuple (
    id           TEXT PRIMARY KEY,
    subject_type TEXT NOT NULL,
    subject_id   TEXT NOT NULL,
    relation     TEXT NOT NULL,
    object_type  TEXT NOT NULL,
    object_id    TEXT NOT NULL,
    condition    JSONB,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- One fact per (subject, relation, object): makes writes idempotent.
    UNIQUE (subject_type, subject_id, relation, object_type, object_id)
  );
  -- Both hot read paths must be indexed. The UNIQUE above already covers
  -- subject-anchored reads (its left prefix), but OBJECT-anchored reads
  -- ("who holds this object?", reverse expansion, the list-op gather) would
  -- otherwise be full table scans. Mirror the library's Prisma indexes.
  CREATE INDEX IF NOT EXISTS polizy_tuple_subject_idx
    ON polizy_tuple (subject_type, subject_id, relation);
  CREATE INDEX IF NOT EXISTS polizy_tuple_object_idx
    ON polizy_tuple (object_type, object_id, relation);
`;

type Row = {
  id: string;
  subject_type: string;
  subject_id: string;
  relation: string;
  object_type: string;
  object_id: string;
  condition: Record<string, unknown> | null;
};

/** JSON has no Date type, so `validSince`/`validUntil` come back as ISO strings;
 *  turn them back into Dates so the engine's condition logic gets what it expects. */
export function reviveCondition(raw: unknown): Condition | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const c = raw as Record<string, unknown>;
  const out: Condition = {};
  if (c.validSince != null) out.validSince = new Date(c.validSince as string);
  if (c.validUntil != null) out.validUntil = new Date(c.validUntil as string);
  if (Array.isArray(c.attributes))
    out.attributes = c.attributes as Condition["attributes"];
  return Object.keys(out).length > 0 ? out : undefined;
}

function toStoredTuple<S extends string, O extends string>(
  r: Row,
): StoredTuple<S, O> {
  const condition = reviveCondition(r.condition);
  return {
    id: r.id,
    subject: { type: r.subject_type as S, id: r.subject_id },
    relation: r.relation,
    object: { type: r.object_type as O, id: r.object_id },
    ...(condition ? { condition } : {}),
  };
}

export function createPGliteAdapter<
  S extends string = string,
  O extends string = string,
>(db: PGlite): StorageAdapter<S, O> {
  return {
    /** Idempotent upsert per tuple. Re-granting without a `when` leaves any
     *  existing condition untouched (revoke to clear it) — hence COALESCE. */
    async write(tuples: InputTuple<S, O>[]): Promise<StoredTuple<S, O>[]> {
      const out: StoredTuple<S, O>[] = [];
      for (const t of tuples) {
        const condition =
          t.condition === undefined ? null : JSON.stringify(t.condition);
        const { rows } = await db.query<Row>(
          `INSERT INTO polizy_tuple
             (id, subject_type, subject_id, relation, object_type, object_id, condition)
           VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
           ON CONFLICT (subject_type, subject_id, relation, object_type, object_id)
           DO UPDATE SET condition = COALESCE(EXCLUDED.condition, polizy_tuple.condition)
           RETURNING *`,
          [
            crypto.randomUUID(),
            t.subject.type,
            t.subject.id,
            t.relation,
            t.object.type,
            t.object.id,
            condition,
          ],
        );
        if (rows[0]) out.push(toStoredTuple<S, O>(rows[0]));
      }
      return out;
    },

    /** Mirrors the in-memory contract exactly:
     *    (who? subject == who) AND (was? relation == was)
     *    AND (onWhat? object == onWhat OR subject == onWhat)
     *  Empty filter deletes nothing (guards against wiping the table). */
    async delete(filter: {
      who?: Subject<S> | AnyObject<O>;
      was?: string;
      onWhat?: AnyObject<O>;
    }): Promise<number> {
      if (!filter.who && !filter.was && !filter.onWhat) return 0;
      const where: string[] = [];
      const params: unknown[] = [];
      const p = (v: unknown) => `$${params.push(v)}`;
      if (filter.who)
        where.push(
          `(subject_type = ${p(filter.who.type)} AND subject_id = ${p(filter.who.id)})`,
        );
      if (filter.was) where.push(`relation = ${p(filter.was)}`);
      if (filter.onWhat) {
        const ot = p(filter.onWhat.type);
        const oi = p(filter.onWhat.id);
        where.push(
          `((object_type = ${ot} AND object_id = ${oi}) OR (subject_type = ${ot} AND subject_id = ${oi}))`,
        );
      }
      const res = await db.query(
        `DELETE FROM polizy_tuple WHERE ${where.join(" AND ")}`,
        params,
      );
      return res.affectedRows ?? 0;
    },

    async findTuples(
      filter: Partial<InputTuple<S, O>>,
      options?: { limit?: number; offset?: number },
    ): Promise<StoredTuple<S, O>[]> {
      const where: string[] = [];
      const params: unknown[] = [];
      const p = (v: unknown) => `$${params.push(v)}`;
      if (filter.subject) {
        where.push(`subject_type = ${p(filter.subject.type)}`);
        where.push(`subject_id = ${p(filter.subject.id)}`);
      }
      if (filter.relation) where.push(`relation = ${p(filter.relation)}`);
      if (filter.object) {
        where.push(`object_type = ${p(filter.object.type)}`);
        where.push(`object_id = ${p(filter.object.id)}`);
      }
      const clauses = where.length ? `WHERE ${where.join(" AND ")}` : "";
      const limit =
        options?.limit !== undefined ? `LIMIT ${p(options.limit)}` : "";
      const offset =
        options?.offset !== undefined ? `OFFSET ${p(options.offset)}` : "";
      const { rows } = await db.query<Row>(
        `SELECT * FROM polizy_tuple ${clauses} ORDER BY created_at, id ${limit} ${offset}`,
        params,
      );
      return rows.map((r) => toStoredTuple<S, O>(r));
    },

    /** Reverse lookup: which subjects hold `relation` directly on this object. */
    async findSubjects(
      object: AnyObject<O>,
      relation: string,
      options?: { subjectType?: S },
    ): Promise<Subject<S>[]> {
      const params: unknown[] = [object.type, object.id, relation];
      let sql = `SELECT DISTINCT subject_type, subject_id FROM polizy_tuple
                 WHERE object_type = $1 AND object_id = $2 AND relation = $3`;
      if (options?.subjectType) {
        params.push(options.subjectType);
        sql += " AND subject_type = $4";
      }
      const { rows } = await db.query<Row>(sql, params);
      return rows.map((r) => ({ type: r.subject_type as S, id: r.subject_id }));
    },

    /** Forward lookup: which objects this subject holds `relation` on directly. */
    async findObjects(
      subject: Subject<S>,
      relation: string,
      options?: { objectType?: O },
    ): Promise<AnyObject<O>[]> {
      const params: unknown[] = [subject.type, subject.id, relation];
      let sql = `SELECT DISTINCT object_type, object_id FROM polizy_tuple
                 WHERE subject_type = $1 AND subject_id = $2 AND relation = $3`;
      if (options?.objectType) {
        params.push(options.objectType);
        sql += " AND object_type = $4";
      }
      const { rows } = await db.query<Row>(sql, params);
      return rows.map((r) => ({ type: r.object_type as O, id: r.object_id }));
    },
  };
}
