import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { InMemoryStorageAdapter } from "../polizy.in-memory.storage.ts";
import { AuthSystem } from "../polizy.ts";
import { defineSchema, everyone } from "../types.ts";

/**
 * Engine-level behaviors that the runtime-roles feature depends on:
 *  - configurable default group/hierarchy relation (so addMember/setParent keep
 *    inferring when a schema has multiple relations of a kind),
 *  - wildcard (`everyone()`) membership propagating through group recursion.
 */

const multiGroup = defineSchema({
  subjectTypes: ["user"],
  objectTypes: ["document", "team", "org"],
  relations: {
    viewer: { type: "direct" },
    member: { type: "group" },
    orgMember: { type: "group" },
    parent: { type: "hierarchy" },
    orgParent: { type: "hierarchy" },
  },
  actionToRelations: { view: ["viewer", "member", "orgMember"] },
  hierarchyPropagation: { view: ["view"] },
});

describe("defaultGroupRelation / defaultHierarchyRelation config", () => {
  it("addMember infers the configured default group relation (no `as` needed)", async () => {
    const authz = new AuthSystem({
      storage: new InMemoryStorageAdapter(),
      schema: multiGroup,
      defaultGroupRelation: "member",
    });
    await authz.allow({
      who: { type: "team", id: "t" },
      toBe: "viewer",
      onWhat: { type: "document", id: "d1" },
    });
    // No `as`, despite two group relations — uses the configured default.
    await authz.addMember({
      member: { type: "user", id: "a" },
      group: { type: "team", id: "t" },
    });
    const tuples = await authz.listTuples({
      subject: { type: "user", id: "a" },
      relation: "member",
    });
    assert.equal(tuples.length, 1);
    assert.equal(
      await authz.check({
        who: { type: "user", id: "a" },
        canThey: "view",
        onWhat: { type: "document", id: "d1" },
      }),
      true,
    );
  });

  it("setParent infers the configured default hierarchy relation (no `as` needed)", async () => {
    const authz = new AuthSystem({
      storage: new InMemoryStorageAdapter(),
      schema: multiGroup,
      defaultHierarchyRelation: "parent",
    });
    await authz.setParent({
      child: { type: "document", id: "d1" },
      parent: { type: "org", id: "acme" },
    });
    const tuples = await authz.listTuples({
      subject: { type: "document", id: "d1" },
      relation: "parent",
    });
    assert.equal(tuples.length, 1);
  });

  it("an explicit `as` still overrides the configured default", async () => {
    const authz = new AuthSystem({
      storage: new InMemoryStorageAdapter(),
      schema: multiGroup,
      defaultGroupRelation: "member",
    });
    await authz.addMember({
      member: { type: "user", id: "a" },
      group: { type: "org", id: "acme" },
      as: "orgMember",
    });
    const tuples = await authz.listTuples({
      subject: { type: "user", id: "a" },
      relation: "orgMember",
    });
    assert.equal(tuples.length, 1);
  });

  it("rejects a defaultGroupRelation that is not a group relation", () => {
    assert.throws(
      () =>
        new AuthSystem({
          storage: new InMemoryStorageAdapter(),
          schema: multiGroup,
          defaultGroupRelation: "viewer",
        }),
    );
  });
});

const wildcardSchema = defineSchema({
  subjectTypes: ["user"],
  objectTypes: ["document", "team"],
  relations: {
    viewer: { type: "direct" },
    member: { type: "group" },
  },
  actionToRelations: { view: ["viewer", "member"] },
});

const nonSubjectSchema = defineSchema({
  subjectTypes: ["user"],
  objectTypes: ["document", "role"],
  relations: {
    viewer: { type: "direct" },
    assignee: { type: "group" },
  },
  actionToRelations: { view: ["viewer"] },
});

describe("nonSubjectTypes filtering in listSubjects", () => {
  it("excludes non-subject (e.g. role) objects from listSubjects results", async () => {
    const authz = new AuthSystem({
      storage: new InMemoryStorageAdapter(),
      schema: nonSubjectSchema,
      nonSubjectTypes: ["role"],
    });
    // A role object holds the viewer grant; a user is assigned to the role.
    await authz.allow({
      who: { type: "role", id: "editors" },
      toBe: "viewer",
      onWhat: { type: "document", id: "d1" },
    });
    await authz.addMember({
      member: { type: "user", id: "alice" },
      group: { type: "role", id: "editors" },
      as: "assignee",
    });

    const subjects = await authz.listSubjects({
      canThey: "view",
      onWhat: { type: "document", id: "d1" },
    });
    const keys = subjects.map((s) => `${s.type}:${s.id}`);
    assert.ok(keys.includes("user:alice"), "the real user must be returned");
    assert.ok(
      !keys.some((k) => k.startsWith("role:")),
      "role objects must not leak as subjects",
    );
  });

  it("still returns non-subject types when ofType explicitly requests them", async () => {
    const authz = new AuthSystem({
      storage: new InMemoryStorageAdapter(),
      schema: nonSubjectSchema,
      nonSubjectTypes: ["role"],
    });
    await authz.allow({
      who: { type: "role", id: "editors" },
      toBe: "viewer",
      onWhat: { type: "document", id: "d1" },
    });
    const subjects = await authz.listSubjects({
      canThey: "view",
      onWhat: { type: "document", id: "d1" },
      ofType: "role",
    });
    assert.deepEqual(
      subjects.map((s) => `${s.type}:${s.id}`),
      ["role:editors"],
    );
  });
});

describe("wildcard membership (everyone) through group recursion", () => {
  it("a wildcard group membership grants access to every subject of that type", async () => {
    const authz = new AuthSystem({
      storage: new InMemoryStorageAdapter(),
      schema: wildcardSchema,
    });
    await authz.allow({
      who: { type: "team", id: "everyone-team" },
      toBe: "viewer",
      onWhat: { type: "document", id: "d1" },
    });
    // Everyone is a member of the team.
    await authz.addMember({
      member: everyone("user"),
      group: { type: "team", id: "everyone-team" },
    });

    assert.equal(
      await authz.check({
        who: { type: "user", id: "anyone" },
        canThey: "view",
        onWhat: { type: "document", id: "d1" },
      }),
      true,
    );
  });

  it("explain reports a wildcard membership path", async () => {
    const authz = new AuthSystem({
      storage: new InMemoryStorageAdapter(),
      schema: wildcardSchema,
    });
    await authz.allow({
      who: { type: "team", id: "t" },
      toBe: "viewer",
      onWhat: { type: "document", id: "d1" },
    });
    await authz.addMember({
      member: everyone("user"),
      group: { type: "team", id: "t" },
    });
    const why = await authz.explain({
      who: { type: "user", id: "zoe" },
      canThey: "view",
      onWhat: { type: "document", id: "d1" },
    });
    assert.equal(why.allowed, true);
  });
});
