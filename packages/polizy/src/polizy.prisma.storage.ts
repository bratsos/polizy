import type { PrismaClient } from "@prisma/client";
import type { StorageAdapter } from "./polizy.storage";
import type {
  AnyObject,
  InputTuple,
  Relation,
  StoredTuple,
  Subject,
  SubjectType,
  ObjectType,
} from "./types";

function mapPrismaTupleToStoredTuple<
  S extends SubjectType,
  O extends ObjectType,
>(prismaTuple: any): StoredTuple<S, O> {
  return {
    id: prismaTuple.id,
    subject: { type: prismaTuple.subjectType as S, id: prismaTuple.subjectId },
    relation: prismaTuple.relation,
    object: { type: prismaTuple.objectType as O, id: prismaTuple.objectId },
    condition: prismaTuple.condition ?? undefined,
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
      const dataToCreate = tuples.map((tuple) => ({
        subjectType: tuple.subject.type,
        subjectId: tuple.subject.id,
        relation: tuple.relation,
        objectType: tuple.object.type,
        objectId: tuple.object.id,
        condition: tuple.condition ?? undefined,
      }));

      await p.polizyTuple.createMany({
        data: dataToCreate,
      });

      const createdPrismaTuples = await p.polizyTuple.findMany({
        where: {
          OR: dataToCreate.map((d) => ({
            subjectType: d.subjectType,
            subjectId: d.subjectId,
            relation: d.relation,
            objectType: d.objectType,
            objectId: d.objectId,
          })),
        },
      });

      return createdPrismaTuples.map(
        mapPrismaTupleToStoredTuple,
      ) as StoredTuple<S, O>[];
    },

    async delete(filter: {
      who?: Subject<S> | AnyObject<O>;
      was?: Relation;
      onWhat?: AnyObject<O>;
    }): Promise<number> {
      const baseWhereClause: any = {};
      if (filter.who) {
        baseWhereClause.subjectType = filter.who.type;
        baseWhereClause.subjectId = filter.who.id;
      }
      if (filter.was) {
        baseWhereClause.relation = filter.was;
      }

      let finalWhereClause: any;

      if (filter.onWhat) {
        const whereClauseObjectMatch = {
          ...baseWhereClause,
          objectType: filter.onWhat.type,
          objectId: filter.onWhat.id,
        };

        const whereClauseSubjectMatch = {
          ...baseWhereClause,
          subjectType: filter.onWhat.type,
          subjectId: filter.onWhat.id,
        };
        finalWhereClause = {
          OR: [whereClauseObjectMatch, whereClauseSubjectMatch],
        };
      } else {
        finalWhereClause = baseWhereClause;
      }

      if (Object.keys(finalWhereClause).length === 0 && !finalWhereClause.OR) {
        console.warn(
          "PrismaStorageAdapter.delete called with an empty filter. No tuples deleted.",
        );
        return 0;
      }

      const result = await p.polizyTuple.deleteMany({
        where: finalWhereClause,
      });
      return result.count;
    },

    async findTuples(
      filter: Partial<InputTuple<S, O>>,
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
