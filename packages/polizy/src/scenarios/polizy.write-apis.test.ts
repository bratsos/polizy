import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { AuthSystem } from "../polizy.ts";
import { InMemoryStorageAdapter } from "../polizy.in-memory.storage.ts";
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

const u = (id: string) => ({ type: "user" as const, id });
const doc = (id: string) => ({ type: "document" as const, id });
const folder = (id: string) => ({ type: "folder" as const, id });
const team = (id: string) => ({ type: "team" as const, id });

describe("write APIs", () => {
  let storage: InMemoryStorageAdapter<string, string>;
  let authz: AuthSystem<typeof schema>;

  beforeEach(() => {
    storage = new InMemoryStorageAdapter();
    authz = new AuthSystem({ storage, schema });
  });

  describe("allow idempotency", () => {
    it("re-granting the same relationship does not create duplicates", async () => {
      await authz.allow({ who: u("a"), toBe: "owner", onWhat: doc("d1") });
      await authz.allow({ who: u("a"), toBe: "owner", onWhat: doc("d1") });
      const tuples = await authz.listTuples({ subject: u("a") });
      assert.equal(tuples.length, 1);
    });
  });

  describe("allowMany", () => {
    it("writes multiple grants and returns them aligned", async () => {
      const written = await authz.allowMany([
        { who: u("a"), toBe: "owner", onWhat: doc("d1") },
        { who: u("b"), toBe: "viewer", onWhat: doc("d2") },
      ]);
      assert.equal(written.length, 2);
      assert.equal(
        await authz.check({ who: u("a"), canThey: "edit", onWhat: doc("d1") }),
        true,
      );
      assert.equal(
        await authz.check({ who: u("b"), canThey: "view", onWhat: doc("d2") }),
        true,
      );
    });
  });

  describe("removeMember", () => {
    it("removes a user member", async () => {
      await authz.allow({
        who: team("t") as any,
        toBe: "viewer",
        onWhat: doc("d1"),
      });
      await authz.addMember({ member: u("a"), group: team("t") });
      assert.equal(
        await authz.check({ who: u("a"), canThey: "view", onWhat: doc("d1") }),
        true,
      );
      await authz.removeMember({ member: u("a"), group: team("t") });
      assert.equal(
        await authz.check({ who: u("a"), canThey: "view", onWhat: doc("d1") }),
        false,
      );
    });
    it("accepts an object (e.g. nested group) as the member", async () => {
      await authz.addMember({
        member: team("child") as any,
        group: team("parentTeam"),
      });
      const removed = await authz.removeMember({
        member: team("child") as any,
        group: team("parentTeam"),
      });
      assert.equal(removed, 1);
    });
  });

  describe("removeParent does not over-remove (in-memory parity already, regression guard)", () => {
    it("removes only the targeted child->parent link", async () => {
      await authz.setParent({ child: doc("d1"), parent: folder("f1") });
      await authz.setParent({
        child: folder("f1") as any,
        parent: folder("root"),
      });
      await authz.removeParent({ child: doc("d1"), parent: folder("f1") });
      const f1Parent = await authz.listTuples({
        subject: folder("f1") as any,
        relation: "parent",
      });
      assert.equal(f1Parent.length, 1, "f1->root must survive");
    });
  });

  describe("disallowAllMatching", () => {
    it("revokes by partial filter and refuses an empty filter", async () => {
      await authz.allow({ who: u("a"), toBe: "owner", onWhat: doc("d1") });
      await authz.allow({ who: u("a"), toBe: "viewer", onWhat: doc("d2") });
      const removed = await authz.disallowAllMatching({ who: u("a") });
      assert.equal(removed, 2);
      const none = await authz.disallowAllMatching({});
      assert.equal(none, 0);
    });
  });
});
