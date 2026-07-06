import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { InMemoryStorageAdapter } from "../polizy.in-memory.storage.ts";
import { AuthSystem } from "../polizy.ts";
import { defineSchema, everyone } from "../types.ts";

const schema = defineSchema({
  subjectTypes: ["user"],
  objectTypes: ["document", "folder", "group"],
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
});

type Subj = SchemaSubjectTypes<typeof schema>;
type Obj = SchemaObjectTypes<typeof schema>;

describe("explain-shapes", () => {
  let storage: InMemoryStorageAdapter<Subj, Obj>;
  let authz: AuthSystem<typeof schema>;

  beforeEach(() => {
    storage = new InMemoryStorageAdapter<Subj, Obj>();
    authz = new AuthSystem({ storage, schema });
  });

  it("1. Multi-hop nested group", async () => {
    // alice member g1, g1 member g2, g2 viewer doc -> explain(alice, view, doc)
    await authz.allow({
      who: { type: "group", id: "g2" },
      toBe: "viewer",
      onWhat: { type: "document", id: "doc" },
    });
    await authz.addMember({
      member: { type: "group", id: "g1" },
      group: { type: "group", id: "g2" },
    });
    await authz.addMember({
      member: { type: "user", id: "alice" },
      group: { type: "group", id: "g1" },
    });

    const r = await authz.explain({
      who: { type: "user", id: "alice" },
      canThey: "view",
      onWhat: { type: "document", id: "doc" },
    });

    assert.equal(r.allowed, true);
    assert.deepEqual(r.via, {
      kind: "group",
      relation: "member",
      through: { type: "group", id: "g1" },
      via: {
        kind: "group",
        relation: "member",
        through: { type: "group", id: "g2" },
        via: {
          kind: "direct",
          relation: "viewer",
        },
      },
    });
  });

  it("2. Hierarchy + group combined", async () => {
    // alice member team, team viewer folder, doc parent folder (hierarchyPropagation view->view)
    await authz.allow({
      who: { type: "group", id: "team" },
      toBe: "viewer",
      onWhat: { type: "folder", id: "folder" },
    });
    await authz.addMember({
      member: { type: "user", id: "alice" },
      group: { type: "group", id: "team" },
    });
    await authz.setParent({
      child: { type: "document", id: "doc" },
      parent: { type: "folder", id: "folder" },
    });

    const r = await authz.explain({
      who: { type: "user", id: "alice" },
      canThey: "view",
      onWhat: { type: "document", id: "doc" },
    });

    assert.equal(r.allowed, true);
    // The nesting (group wrapping hierarchy wrapping direct) comes from the engine's resolution order: direct, then groups, then hierarchy.
    assert.deepEqual(r.via, {
      kind: "group",
      relation: "member",
      through: { type: "group", id: "team" },
      via: {
        kind: "hierarchy",
        relation: "parent",
        parent: { type: "folder", id: "folder" },
        via: {
          kind: "direct",
          relation: "viewer",
        },
      },
    });
  });

  it("3. Field-level", async () => {
    // grant viewer on base "d1", explain(who, view, {document, "d1#title"})
    await authz.allow({
      who: { type: "user", id: "alice" },
      toBe: "viewer",
      onWhat: { type: "document", id: "d1" },
    });

    const r = await authz.explain({
      who: { type: "user", id: "alice" },
      canThey: "view",
      onWhat: { type: "document", id: "d1#title" },
    });

    assert.equal(r.allowed, true);
    assert.deepEqual(r.via, {
      kind: "field",
      base: { type: "document", id: "d1" },
      via: {
        kind: "direct",
        relation: "viewer",
      },
    });
  });

  it("4. Wildcard", async () => {
    // everyone("user") viewer doc -> explain(concrete user)
    await authz.allow({
      who: everyone("user"),
      toBe: "viewer",
      onWhat: { type: "document", id: "doc" },
    });

    const r = await authz.explain({
      who: { type: "user", id: "alice" },
      canThey: "view",
      onWhat: { type: "document", id: "doc" },
    });

    assert.equal(r.allowed, true);
    assert.deepEqual(r.via, {
      kind: "wildcard",
      relation: "viewer",
    });
  });

  it("5. Conditioned grant honored/denied", async () => {
    // a viewer grant with attributes [{attribute:"dept", operator:"eq", value:"eng"}]
    await authz.allow({
      who: { type: "user", id: "alice" },
      toBe: "viewer",
      onWhat: { type: "document", id: "doc" },
      when: {
        attributes: [{ attribute: "dept", operator: "eq", value: "eng" }],
      },
    });

    const rHonored = await authz.explain({
      who: { type: "user", id: "alice" },
      canThey: "view",
      onWhat: { type: "document", id: "doc" },
      context: { dept: "eng" },
    });

    const rDenied = await authz.explain({
      who: { type: "user", id: "alice" },
      canThey: "view",
      onWhat: { type: "document", id: "doc" },
      context: { dept: "sales" },
    });

    assert.equal(rHonored.allowed, true);
    assert.deepEqual(rHonored.via, {
      kind: "direct",
      relation: "viewer",
    });

    assert.equal(rDenied.allowed, false);
    assert.equal(rDenied.via, null);
  });

  it("6. Deny past the depth cap", async () => {
    // defaultCheckDepth 2, grant at the end of a 4-hop membership chain, maxDepthBehavior "deny" -> explain returns allowed: false, via: null.
    // Also with maxDepthBehavior "throw", explain does not throw on depth, unlike check.
    const shortCapAuthzThrow = new AuthSystem({
      storage: new InMemoryStorageAdapter<Subj, Obj>(),
      schema,
      defaultCheckDepth: 2,
      maxDepthBehavior: "throw",
    });

    const shortCapAuthzDeny = new AuthSystem({
      storage: new InMemoryStorageAdapter<Subj, Obj>(),
      schema,
      defaultCheckDepth: 2,
      maxDepthBehavior: "deny",
    });

    // 4-hop chain: alice member g1, g1 member g2, g2 member g3, g3 member g4, g4 viewer doc
    for (const authzObj of [shortCapAuthzThrow, shortCapAuthzDeny]) {
      await authzObj.allow({
        who: { type: "group", id: "g4" },
        toBe: "viewer",
        onWhat: { type: "document", id: "doc" },
      });
      await authzObj.addMember({
        member: { type: "group", id: "g3" },
        group: { type: "group", id: "g4" },
      });
      await authzObj.addMember({
        member: { type: "group", id: "g2" },
        group: { type: "group", id: "g3" },
      });
      await authzObj.addMember({
        member: { type: "group", id: "g1" },
        group: { type: "group", id: "g2" },
      });
      await authzObj.addMember({
        member: { type: "user", id: "alice" },
        group: { type: "group", id: "g1" },
      });
    }

    const rThrow = await shortCapAuthzThrow.explain({
      who: { type: "user", id: "alice" },
      canThey: "view",
      onWhat: { type: "document", id: "doc" },
    });

    const rDeny = await shortCapAuthzDeny.explain({
      who: { type: "user", id: "alice" },
      canThey: "view",
      onWhat: { type: "document", id: "doc" },
    });

    // explain never throws on depth, unlike check, even when maxDepthBehavior is "throw"
    assert.equal(rThrow.allowed, false);
    assert.equal(rThrow.via, null);

    assert.equal(rDeny.allowed, false);
    assert.equal(rDeny.via, null);
  });
});
