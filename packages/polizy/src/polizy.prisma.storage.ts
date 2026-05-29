import type { PrismaClient } from "@prisma/client";
import type { StorageAdapter } from "./polizy.storage";
import type {
  AnyObject,
  Condition,
  InputTuple,
  Relation,
  StoredTuple,
  Subject,
  SubjectType,
  ObjectType,
} from "./types";

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

export function PrismaAdapter<
  S extends SubjectType = SubjectType,
  O extends ObjectType = ObjectType,
>(
  prisma: PrismaClient | ReturnType<PrismaClient["$extends"]>,
): StorageAdapter<S, O> {
  const p = prisma as PrismaClient;

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
          // The compound-unique `where` shape comes from the consumer's own
          // generated Prisma client; @prisma/client's default types don't model
          // this project's `@@unique`, so the argument is asserted here.
          return p.polizyTuple.upsert({
            where: {
              subjectType_subjectId_relation_objectType_objectId: key,
            },
            create: { ...key, ...condition },
            update: condition,
            // biome-ignore lint/suspicious/noExplicitAny: see comment above
          } as any);
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

    async findTuples(
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

      const results = await p.polizyTuple.findMany({
        where: whereClause,
        ...(options?.offset !== undefined ? { skip: options.offset } : {}),
        ...(options?.limit !== undefined ? { take: options.limit } : {}),
        orderBy: { id: "asc" },
      });
      return results.map(mapPrismaTupleToStoredTuple) as StoredTuple<S, O>[];
    },

    async findSubjects(
      object: AnyObject<O>,
      relation: Relation,
      options?: { subjectType?: S },
    ): Promise<Subject<S>[]> {
      const results = await p.polizyTuple.findMany({
        where: {
          objectType: object.type,
          objectId: object.id,
          relation: relation,
          ...(options?.subjectType && { subjectType: options.subjectType }),
        },
        distinct: ["subjectType", "subjectId"],
        select: {
          subjectType: true,
          subjectId: true,
        },
      });

      return results.map((r: { subjectType: string; subjectId: string }) => ({
        type: r.subjectType as S,
        id: r.subjectId,
      }));
    },

    async findObjects(
      subject: Subject<S>,
      relation: Relation,
      options?: { objectType?: O },
    ): Promise<AnyObject<O>[]> {
      const results = await p.polizyTuple.findMany({
        where: {
          subjectType: subject.type,
          subjectId: subject.id,
          relation: relation,
          ...(options?.objectType && { objectType: options.objectType }),
        },
        distinct: ["objectType", "objectId"],
        select: {
          objectType: true,
          objectId: true,
        },
      });
      return results.map((r: { objectType: string; objectId: string }) => ({
        type: r.objectType as O,
        id: r.objectId,
      }));
    },
  };
}

/**
 * Alias for {@link PrismaAdapter}. Provided so the documented
 * `PrismaStorageAdapter` name resolves; both are the same factory.
 */
export const PrismaStorageAdapter = PrismaAdapter;
