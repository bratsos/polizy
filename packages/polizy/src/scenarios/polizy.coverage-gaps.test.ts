import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { SchemaError } from "../errors.ts";
import { InMemoryStorageAdapter } from "../polizy.in-memory.storage.ts";
import { AuthSystem, type CheckRequest } from "../polizy.ts";
import {
  defineSchema,
  type InputTuple,
  type SchemaObjectTypes,
  type SchemaSubjectTypes,
} from "../types.ts";

const schema = defineSchema({
  subjectTypes: ["user", "team"],
  objectTypes: ["document", "folder", "team"],
  relations: {
    viewer: { type: "direct" },
    member: { type: "group" },
    parent: { type: "hierarchy" },
  },
  actionToRelations: {
    view: ["viewer", "member"],
  },
  hierarchyPropagation: { view: ["view"] },
  fieldLevelObjects: ["document"],
  fieldSeparator: ":",
});

type Subj = SchemaSubjectTypes<typeof schema>;
type Obj = SchemaObjectTypes<typeof schema>;

describe("coverage-gaps", () => {
  let storage: InMemoryStorageAdapter<Subj, Obj>;
  let authz: AuthSystem<typeof schema>;

  beforeEach(() => {
    storage = new InMemoryStorageAdapter<Subj, Obj>();
    authz = new AuthSystem({ storage, schema });
  });

  describe("1. Contextual tuples breadth", () => {
    it("(a) a contextual GROUP MEMBERSHIP", async () => {
      // stored tuple: team viewer doc
      await authz.allow({
        who: { type: "team", id: "team1" },
        toBe: "viewer",
        onWhat: { type: "document", id: "doc" },
      });

      // contextual tuple: alice member team1
      const req: CheckRequest<typeof schema> = {
        who: { type: "user", id: "alice" },
        canThey: "view",
        onWhat: { type: "document", id: "doc" },
      };

      // false without
      assert.equal(await authz.check(req), false);

      // true with
      assert.equal(
        await authz.check({
          ...req,
          contextualTuples: [
            {
              subject: { type: "user", id: "alice" },
              relation: "member",
              object: { type: "team", id: "team1" },
            },
          ],
        }),
        true,
      );
    });

    it("(b) a contextual HIERARCHY link", async () => {
      // stored: alice viewer folder
      await authz.allow({
        who: { type: "user", id: "alice" },
        toBe: "viewer",
        onWhat: { type: "folder", id: "folder1" },
      });

      // contextual: doc parent folder1
      const req: CheckRequest<typeof schema> = {
        who: { type: "user", id: "alice" },
        canThey: "view",
        onWhat: { type: "document", id: "doc1" },
      };

      // false without
      assert.equal(await authz.check(req), false);

      // true with
      assert.equal(
        await authz.check({
          ...req,
          contextualTuples: [
            {
              subject: { type: "document", id: "doc1" },
              relation: "parent",
              object: { type: "folder", id: "folder1" },
            },
          ],
        }),
        true,
      );
    });

    it("(c) a contextual tuple carrying a CONDITION (time)", async () => {
      const now = Date.now();
      const pastDate = new Date(now - 10000);
      const futureDate = new Date(now + 10000);

      const req: CheckRequest<typeof schema> = {
        who: { type: "user", id: "alice" },
        canThey: "view",
        onWhat: { type: "document", id: "doc" },
      };

      // false with validUntil in the past
      assert.equal(
        await authz.check({
          ...req,
          contextualTuples: [
            {
              subject: { type: "user", id: "alice" },
              relation: "viewer",
              object: { type: "document", id: "doc" },
              condition: { validUntil: pastDate },
            },
          ],
        }),
        false,
      );

      // true with validUntil in the future
      assert.equal(
        await authz.check({
          ...req,
          contextualTuples: [
            {
              subject: { type: "user", id: "alice" },
              relation: "viewer",
              object: { type: "document", id: "doc" },
              condition: { validUntil: futureDate },
            },
          ],
        }),
        true,
      );
    });

    it("(d) a contextual tuple with attributes condition evaluated against check context", async () => {
      const req: CheckRequest<typeof schema> = {
        who: { type: "user", id: "alice" },
        canThey: "view",
        onWhat: { type: "document", id: "doc" },
      };

      const contextualTuples: InputTuple<Subj, Obj>[] = [
        {
          subject: { type: "user", id: "alice" },
          relation: "viewer",
          object: { type: "document", id: "doc" },
          condition: {
            attributes: [
              { attribute: "dept", operator: "eq" as const, value: "eng" },
            ],
          },
        },
      ];

      // false with mismatched attribute
      assert.equal(
        await authz.check({
          ...req,
          contextualTuples,
          context: { dept: "sales" },
        }),
        false,
      );

      // true with matched attribute
      assert.equal(
        await authz.check({
          ...req,
          contextualTuples,
          context: { dept: "eng" },
        }),
        true,
      );
    });
  });

  describe("2. Custom fieldSeparator END TO END", () => {
    it("grant on base authorizes field; grant on field stays scoped", async () => {
      // grant viewer on base "d1"
      await authz.allow({
        who: { type: "user", id: "alice" },
        toBe: "viewer",
        onWhat: { type: "document", id: "d1" },
      });

      // grant viewer on "d2:owner_field"
      await authz.allow({
        who: { type: "user", id: "alice" },
        toBe: "viewer",
        onWhat: { type: "document", id: "d2:owner_field" },
      });

      // base d1 authorizes d1:title
      assert.equal(
        await authz.check({
          who: { type: "user", id: "alice" },
          canThey: "view",
          onWhat: { type: "document", id: "d1:title" },
        }),
        true,
      );

      // grant on d2:owner_field authorizes itself
      assert.equal(
        await authz.check({
          who: { type: "user", id: "alice" },
          canThey: "view",
          onWhat: { type: "document", id: "d2:owner_field" },
        }),
        true,
      );

      // but stays scoped: no bleed to base d2 or other field d2:other
      assert.equal(
        await authz.check({
          who: { type: "user", id: "alice" },
          canThey: "view",
          onWhat: { type: "document", id: "d2" },
        }),
        false,
      );

      assert.equal(
        await authz.check({
          who: { type: "user", id: "alice" },
          canThey: "view",
          onWhat: { type: "document", id: "d2:other" },
        }),
        false,
      );
    });

    it("doc id containing '#' does NOT split", async () => {
      // x#y only matches x#y
      await authz.allow({
        who: { type: "user", id: "alice" },
        toBe: "viewer",
        onWhat: { type: "document", id: "x#y" },
      });

      // should match x#y exactly
      assert.equal(
        await authz.check({
          who: { type: "user", id: "alice" },
          canThey: "view",
          onWhat: { type: "document", id: "x#y" },
        }),
        true,
      );

      // does not match x as a base since separator is custom ':'
      assert.equal(
        await authz.check({
          who: { type: "user", id: "alice" },
          canThey: "view",
          onWhat: { type: "document", id: "x" },
        }),
        false,
      );

      // write grant on base x
      await authz.allow({
        who: { type: "user", id: "bob" },
        toBe: "viewer",
        onWhat: { type: "document", id: "x" },
      });

      // bob cannot view x#y because '#' is not the separator
      assert.equal(
        await authz.check({
          who: { type: "user", id: "bob" },
          canThey: "view",
          onWhat: { type: "document", id: "x#y" },
        }),
        false,
      );
    });

    it("validation rejects malformed ids with custom separator while '#' ids pass as literals", async () => {
      // rejects "d3:" (trailing separator)
      await assert.rejects(
        authz.allow({
          who: { type: "user", id: "alice" },
          toBe: "viewer",
          onWhat: { type: "document", id: "d3:" },
        }),
        SchemaError,
      );

      // '#' ids pass through as literals
      await assert.doesNotReject(
        authz.allow({
          who: { type: "user", id: "alice" },
          toBe: "viewer",
          onWhat: { type: "document", id: "d3#" },
        }),
      );
    });
  });

  describe("3. removeMember/removeParent/disallowAllMatching no-match return counts", () => {
    it("returns correct count values", async () => {
      // 1. removeMember
      // non-existent member -> 0
      const rMember0 = await authz.removeMember({
        member: { type: "user", id: "alice" },
        group: { type: "folder", id: "f1" }, // wait, objectType in schema includes folder
        as: "member",
      });
      assert.equal(rMember0, 0);

      // add and remove -> 1
      await authz.addMember({
        member: { type: "user", id: "alice" },
        group: { type: "folder", id: "f1" },
        as: "member",
      });
      const rMember1 = await authz.removeMember({
        member: { type: "user", id: "alice" },
        group: { type: "folder", id: "f1" },
        as: "member",
      });
      assert.equal(rMember1, 1);

      // 2. removeParent
      // non-existent link -> 0
      const rParent0 = await authz.removeParent({
        child: { type: "document", id: "d1" },
        parent: { type: "folder", id: "f1" },
        as: "parent",
      });
      assert.equal(rParent0, 0);

      // add and remove -> 1
      await authz.setParent({
        child: { type: "document", id: "d1" },
        parent: { type: "folder", id: "f1" },
        as: "parent",
      });
      const rParent1 = await authz.removeParent({
        child: { type: "document", id: "d1" },
        parent: { type: "folder", id: "f1" },
        as: "parent",
      });
      assert.equal(rParent1, 1);

      // 3. disallowAllMatching
      // non-matching -> 0
      const rDisallow0 = await authz.disallowAllMatching({
        who: { type: "user", id: "nonexistent" },
        was: "viewer",
        onWhat: { type: "document", id: "doc1" },
      });
      assert.equal(rDisallow0, 0);

      // add and disallow -> 1
      await authz.allow({
        who: { type: "user", id: "alice" },
        toBe: "viewer",
        onWhat: { type: "document", id: "doc1" },
      });
      const rDisallow1 = await authz.disallowAllMatching({
        who: { type: "user", id: "alice" },
        was: "viewer",
        onWhat: { type: "document", id: "doc1" },
      });
      assert.equal(rDisallow1, 1);
    });
  });

  describe("4. listTuples pagination stability", () => {
    it("paginates 5 tuples across pages without repeat, matching unpaginated result", async () => {
      // write 5 tuples for one object
      const obj = { type: "document" as const, id: "shared-doc" };
      const expectedTuples = [];
      for (let i = 0; i < 5; i++) {
        const tuple = await authz.allow({
          who: { type: "user", id: `user${i}` },
          toBe: "viewer",
          onWhat: obj,
        });
        expectedTuples.push(tuple);
      }

      // read page {limit:2, offset:0}, {limit:2, offset:2}, {limit:2, offset:4}
      const page1 = await authz.listTuples(
        { object: obj },
        { limit: 2, offset: 0 },
      );
      const page2 = await authz.listTuples(
        { object: obj },
        { limit: 2, offset: 2 },
      );
      const page3 = await authz.listTuples(
        { object: obj },
        { limit: 2, offset: 4 },
      );

      // check limit limits the output correctly
      assert.equal(page1.length, 2);
      assert.equal(page2.length, 2);
      assert.equal(page3.length, 1);

      // concatenation
      const paginatedConcat = [...page1, ...page2, ...page3];

      // unpaginated result
      const unpaginated = await authz.listTuples({ object: obj });

      // deep-equals the unpaginated result
      assert.deepEqual(paginatedConcat, unpaginated);

      // ensure no tuple repeats across pages
      const ids = paginatedConcat.map((t) => t.id);
      const uniqueIds = new Set(ids);
      assert.equal(uniqueIds.size, 5);
      assert.equal(ids.length, 5);
    });
  });
});
