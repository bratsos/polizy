import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { InMemoryStorageAdapter } from "../polizy.in-memory.storage.ts";
import { AuthSystem } from "../polizy.ts";
import { defineSchema, type ExplainNode, everyone } from "../types.ts";

const schema = defineSchema({
  subjectTypes: ["user"],
  objectTypes: ["document", "folder", "group"],
  relations: {
    viewer: { type: "direct" },
    member: { type: "group" },
    parent: { type: "hierarchy" },
  },
  actionToRelations: { view: ["viewer", "member"] },
  hierarchyPropagation: { view: ["view"] },
});

const alice = { type: "user" as const, id: "alice" };
const doc = { type: "document" as const, id: "doc" };
const folder = { type: "folder" as const, id: "f" };
const team = { type: "group" as const, id: "team" };
const when = {
  attributes: [{ attribute: "dept", operator: "eq" as const, value: "eng" }],
};

const setup = () =>
  new AuthSystem({ storage: new InMemoryStorageAdapter(), schema });

const via = async (
  authz: ReturnType<typeof setup>,
  context?: Record<string, unknown>,
  options?: Parameters<ReturnType<typeof setup>["explain"]>[1],
): Promise<ExplainNode> => {
  const r = await authz.explain(
    { who: alice, canThey: "view", onWhat: doc, context },
    options,
  );
  assert.ok(r.via);
  return r.via;
};

describe("explain reports the tuple each node relied on", () => {
  it("direct: the grant tuple, with its condition", async () => {
    const authz = setup();
    const grant = await authz.allow({
      who: alice,
      toBe: "viewer",
      onWhat: doc,
      when,
    });
    const node = await via(authz, { dept: "eng" });
    assert.equal(node.kind, "direct");
    assert.equal(node.tuple.id, grant.id);
    assert.deepEqual(node.tuple.subject, alice);
    assert.equal(node.tuple.relation, "viewer");
    assert.deepEqual(node.tuple.object, doc);
    assert.deepEqual(node.tuple.condition, when);
  });

  it("wildcard: the everyone(type) grant tuple", async () => {
    const authz = setup();
    const grant = await authz.allow({
      who: everyone("user"),
      toBe: "viewer",
      onWhat: doc,
    });
    const node = await via(authz);
    assert.equal(node.kind, "wildcard");
    assert.equal(node.tuple.id, grant.id);
    assert.deepEqual(node.tuple.subject, everyone("user"));
    assert.equal(node.tuple.relation, "viewer");
    assert.deepEqual(node.tuple.object, doc);
  });

  it("group: the membership tuple, and the grant it reached", async () => {
    const authz = setup();
    const grant = await authz.allow({
      who: team,
      toBe: "viewer",
      onWhat: doc,
    });
    const membership = await authz.addMember({
      member: alice,
      group: team,
      condition: when,
    });
    const node = await via(authz, { dept: "eng" });
    assert.equal(node.kind, "group");
    assert.equal(node.tuple.id, membership.id);
    assert.deepEqual(node.tuple.subject, alice);
    assert.equal(node.tuple.relation, "member");
    assert.deepEqual(node.tuple.object, team);
    assert.deepEqual(node.tuple.condition, when);
    assert.equal(node.via.kind, "direct");
    assert.equal(node.via.tuple.id, grant.id);
  });

  it("hierarchy: the parent-link tuple, and the grant it reached", async () => {
    const authz = setup();
    const grant = await authz.allow({
      who: alice,
      toBe: "viewer",
      onWhat: folder,
    });
    const link = await authz.setParent({
      child: doc,
      parent: folder,
      condition: when,
    });
    const node = await via(authz, { dept: "eng" });
    assert.equal(node.kind, "hierarchy");
    assert.equal(node.tuple.id, link.id);
    assert.deepEqual(node.tuple.subject, doc);
    assert.equal(node.tuple.relation, "parent");
    assert.deepEqual(node.tuple.object, folder);
    assert.deepEqual(node.tuple.condition, when);
    assert.equal(node.via.kind, "direct");
    assert.equal(node.via.tuple.id, grant.id);
  });

  it("contextual: the synthetic ctx:N id", async () => {
    const authz = setup();
    const node = await via(authz, undefined, {
      contextualTuples: [
        { subject: alice, relation: "viewer", object: folder },
        { subject: alice, relation: "viewer", object: doc },
      ],
    });
    assert.equal(node.kind, "direct");
    assert.equal(node.tuple.id, "ctx:1");
    assert.deepEqual(node.tuple.subject, alice);
    assert.deepEqual(node.tuple.object, doc);
  });

  it("a re-grant does not change a tuple explain() already returned", async () => {
    const authz = setup();
    await authz.allow({ who: alice, toBe: "viewer", onWhat: doc, when });
    const before = await via(authz, { dept: "eng" });
    const later = { validUntil: new Date(Date.now() + 60_000) };
    await authz.allow({ who: alice, toBe: "viewer", onWhat: doc, when: later });
    assert.equal(before.kind, "direct");
    assert.deepEqual(before.tuple.condition, when);
  });
});
