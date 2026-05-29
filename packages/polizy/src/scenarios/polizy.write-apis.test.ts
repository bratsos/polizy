import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { InMemoryStorageAdapter } from "../polizy.in-memory.storage.ts";
import { AuthSystem } from "../polizy.ts";
import type { SchemaObjectTypes, SchemaSubjectTypes } from "../types.ts";
import { defineSchema } from "../types.ts";

const schema = defineSchema({
  subjectTypes: ["user"],
  objectTypes: ["document", "folder", "team"],
  relations: {
    owner: { type: "direct" },
    viewer: { type: "direct" },
    member: { type: "group" },
    parent: { type: "hierarchy" },
  },
  actionToRelations: {
    view: ["viewer", "owner", "member"],
    edit: ["owner"],
  },
  hierarchyPropagation: { view: ["view"], edit: [] },
});

type Subj = SchemaSubjectTypes<typeof schema>;
type Obj = SchemaObjectTypes<typeof schema>;

describe("write APIs", () => {
  let storage: InMemoryStorageAdapter<Subj, Obj>;
  let authz: AuthSystem<typeof schema>;

  beforeEach(() => {
    storage = new InMemoryStorageAdapter<Subj, Obj>();
    authz = new AuthSystem({ storage, schema });
  });

  describe("allow idempotency", () => {
    it("re-granting the same relationship does not create duplicates", async () => {
      await authz.allow({
        who: { type: "user", id: "a" },
        toBe: "owner",
        onWhat: { type: "document", id: "d1" },
      });
      await authz.allow({
        who: { type: "user", id: "a" },
        toBe: "owner",
        onWhat: { type: "document", id: "d1" },
      });
      const tuples = await authz.listTuples({
        subject: { type: "user", id: "a" },
      });
      assert.equal(tuples.length, 1);
    });
  });

  describe("allowMany", () => {
    it("writes multiple grants and returns them aligned", async () => {
      const written = await authz.allowMany([
        {
          who: { type: "user", id: "a" },
          toBe: "owner",
          onWhat: { type: "document", id: "d1" },
        },
        {
          who: { type: "user", id: "b" },
          toBe: "viewer",
          onWhat: { type: "document", id: "d2" },
        },
      ]);
      assert.equal(written.length, 2);
      assert.equal(
        await authz.check({
          who: { type: "user", id: "a" },
          canThey: "edit",
          onWhat: { type: "document", id: "d1" },
        }),
        true,
      );
      assert.equal(
        await authz.check({
          who: { type: "user", id: "b" },
          canThey: "view",
          onWhat: { type: "document", id: "d2" },
        }),
        true,
      );
    });
  });

  describe("removeMember", () => {
    it("removes a user member", async () => {
      await authz.allow({
        who: { type: "team", id: "t" },
        toBe: "viewer",
        onWhat: { type: "document", id: "d1" },
      });
      await authz.addMember({
        member: { type: "user", id: "a" },
        group: { type: "team", id: "t" },
      });
      assert.equal(
        await authz.check({
          who: { type: "user", id: "a" },
          canThey: "view",
          onWhat: { type: "document", id: "d1" },
        }),
        true,
      );
      await authz.removeMember({
        member: { type: "user", id: "a" },
        group: { type: "team", id: "t" },
      });
      assert.equal(
        await authz.check({
          who: { type: "user", id: "a" },
          canThey: "view",
          onWhat: { type: "document", id: "d1" },
        }),
        false,
      );
    });

    it("accepts an object (e.g. nested group) as the member", async () => {
      await authz.addMember({
        member: { type: "team", id: "child" },
        group: { type: "team", id: "parentTeam" },
      });
      const removed = await authz.removeMember({
        member: { type: "team", id: "child" },
        group: { type: "team", id: "parentTeam" },
      });
      assert.equal(removed, 1);
    });
  });

  describe("removeParent does not over-remove (regression guard)", () => {
    it("removes only the targeted child->parent link", async () => {
      await authz.setParent({
        child: { type: "document", id: "d1" },
        parent: { type: "folder", id: "f1" },
      });
      await authz.setParent({
        child: { type: "folder", id: "f1" },
        parent: { type: "folder", id: "root" },
      });
      await authz.removeParent({
        child: { type: "document", id: "d1" },
        parent: { type: "folder", id: "f1" },
      });
      const f1Parent = await authz.listTuples({
        subject: { type: "folder", id: "f1" },
        relation: "parent",
      });
      assert.equal(f1Parent.length, 1, "f1->root must survive");
    });
  });

  describe("disallowAllMatching", () => {
    it("revokes by partial filter and refuses an empty filter", async () => {
      await authz.allow({
        who: { type: "user", id: "a" },
        toBe: "owner",
        onWhat: { type: "document", id: "d1" },
      });
      await authz.allow({
        who: { type: "user", id: "a" },
        toBe: "viewer",
        onWhat: { type: "document", id: "d2" },
      });
      const removed = await authz.disallowAllMatching({
        who: { type: "user", id: "a" },
      });
      assert.equal(removed, 2);
      const none = await authz.disallowAllMatching({});
      assert.equal(none, 0);
    });
  });
});
