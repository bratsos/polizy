import { test, describe, beforeEach } from "node:test";
import assert from "node:assert";
import { AuthSystem } from "../polizy.ts";
import { InMemoryStorageAdapter } from "../polizy.in-memory.storage.ts";
import { defineSchema } from "../types.ts";
import type { AccessibleObject } from "../types.ts";

const testSchema = defineSchema({
  subjectTypes: ["user", "team"],
  objectTypes: ["document", "folder", "project", "team"],
  relations: {
    owner: { type: "direct" },
    editor: { type: "direct" },
    viewer: { type: "direct" },
    member: { type: "group" },
    parent: { type: "hierarchy" },
    project_access: { type: "direct" },
  },
  actionToRelations: {
    view: ["viewer", "editor", "owner", "member", "project_access"],
    edit: ["editor", "owner"],
    delete: ["owner"],
    manage_members: ["owner"],
    view_project: ["project_access"],
  },
  hierarchyPropagation: {
    view: ["view"],
    edit: ["edit"],
    delete: [],
    manage_members: [],
    view_project: [],
  },
});

type TestSchema = typeof testSchema;

const sortAccessibleObjects = (result: AccessibleObject<TestSchema>[]) => {
  return result
    .map((item) => ({
      ...item,
      actions: [...item.actions].sort(),
    }))
    .sort((a, b) => {
      if (a.object.type !== b.object.type) {
        return a.object.type.localeCompare(b.object.type);
      }
      return a.object.id.localeCompare(b.object.id);
    });
};

describe("AuthSystem.listAccessibleObjects", () => {
  let storage: InMemoryStorageAdapter<
    "user" | "team",
    "document" | "folder" | "project" | "team"
  >;
  let authz: AuthSystem<TestSchema>;

  const alice = { type: "user" as const, id: "alice" };
  const bob = { type: "user" as const, id: "bob" };
  const charlie = { type: "user" as const, id: "charlie" };
  const david = { type: "user" as const, id: "david" };
  const teamAlpha = { type: "team" as const, id: "alpha" };
  const teamBeta = { type: "team" as const, id: "beta" };

  const doc1 = { type: "document" as const, id: "doc1" };
  const doc2 = { type: "document" as const, id: "doc2" };
  const doc3 = { type: "document" as const, id: "doc3" };
  const doc4 = { type: "document" as const, id: "doc4" };
  const doc5 = { type: "document" as const, id: "doc5" };
  const doc6 = { type: "document" as const, id: "doc6" };
  const doc7 = { type: "document" as const, id: "doc7" };
  const doc8 = { type: "document" as const, id: "doc8" };
  const doc9_base = { type: "document" as const, id: "doc9" };
  const doc9_field = { type: "document" as const, id: "doc9#field" };

  const folderA = { type: "folder" as const, id: "folderA" };
  const folderB = { type: "folder" as const, id: "folderB" };
  const folderC = { type: "folder" as const, id: "folderC" };

  const projectX = { type: "project" as const, id: "projectX" };

  beforeEach(async () => {
    storage = new InMemoryStorageAdapter();
    authz = new AuthSystem({ storage, schema: testSchema });

    await authz.allow({ who: alice, toBe: "owner", onWhat: doc1 });
    await authz.allow({ who: bob, toBe: "viewer", onWhat: doc2 });
    await authz.allow({ who: charlie, toBe: "viewer", onWhat: doc7 });
    await authz.allow({ who: alice, toBe: "viewer", onWhat: folderA });
    await authz.allow({ who: alice, toBe: "viewer", onWhat: doc9_field });

    await authz.addMember({ member: charlie, group: teamAlpha });
    await authz.addMember({ member: david, group: teamBeta });
    await authz.addMember({ member: teamBeta, group: teamAlpha });
    await authz.allow({ who: teamAlpha, toBe: "editor", onWhat: doc3 });
    await authz.allow({ who: teamAlpha, toBe: "editor", onWhat: folderB });
    await authz.allow({ who: teamBeta, toBe: "viewer", onWhat: doc8 });
    await authz.allow({
      who: teamAlpha,
      toBe: "project_access",
      onWhat: projectX,
    });

    await authz.setParent({ child: doc4, parent: folderA });
    await authz.setParent({ child: doc5, parent: folderB });
    await authz.setParent({ child: folderC, parent: folderA });
  });

  test("listAccessibleObjects: Alice's documents", async () => {
    const result = await authz.listAccessibleObjects({
      who: alice,
      ofType: "document",
    });
    const expected = [
      {
        object: doc1,
        actions: [
          "delete" as const,
          "edit" as const,
          "manage_members" as const,
          "view" as const,
        ],
        parent: undefined,
      },
      { object: doc4, actions: ["view" as const], parent: folderA },
      { object: doc9_field, actions: ["view" as const], parent: undefined },
    ];
    assert.deepStrictEqual(
      sortAccessibleObjects(result.accessible),
      sortAccessibleObjects(expected),
      "Alice should list doc1(all), doc4(view), doc9#field(view)",
    );

    assert.ok(
      !result.accessible.some((item) => item.object.id === doc9_base.id),
      "Alice should NOT list doc9 base object when only field has permission",
    );
  });

  test("listAccessibleObjects: Bob's documents", async () => {
    const result = await authz.listAccessibleObjects({
      who: bob,
      ofType: "document",
    });
    const expected = [
      { object: doc2, actions: ["view" as const], parent: undefined },
    ];
    assert.deepStrictEqual(
      sortAccessibleObjects(result.accessible),
      sortAccessibleObjects(expected),
      "Bob should list doc2(view)",
    );

    assert.ok(
      !result.accessible.some((item) => item.object.id === doc6.id),
      "Bob should NOT list doc6",
    );
  });

  test("listAccessibleObjects: Charlie's documents", async () => {
    const result = await authz.listAccessibleObjects({
      who: charlie,
      ofType: "document",
    });
    const expected = [
      {
        object: doc3,
        actions: ["edit" as const, "view" as const],
        parent: undefined,
      },
      {
        object: doc5,
        actions: ["edit" as const, "view" as const],
        parent: folderB,
      },
      { object: doc7, actions: ["view" as const], parent: undefined },
    ];
    assert.deepStrictEqual(
      sortAccessibleObjects(result.accessible),
      sortAccessibleObjects(expected),
      "Charlie should list doc3(edit,view), doc5(edit,view), doc7(view)",
    );

    assert.ok(
      !result.accessible.some((item) => item.object.id === doc1.id),
      "Charlie should NOT list doc1",
    );
    assert.ok(
      !result.accessible.some((item) => item.object.id === doc6.id),
      "Charlie should NOT list doc6",
    );
  });

  test("listAccessibleObjects: David's documents (nested groups)", async () => {
    const result = await authz.listAccessibleObjects({
      who: david,
      ofType: "document",
    });
    const expected = [
      {
        object: doc3,
        actions: ["edit" as const, "view" as const],
        parent: undefined,
      },
      {
        object: doc5,
        actions: ["edit" as const, "view" as const],
        parent: folderB,
      },
      { object: doc8, actions: ["view" as const], parent: undefined },
    ];
    assert.deepStrictEqual(
      sortAccessibleObjects(result.accessible),
      sortAccessibleObjects(expected),
      "David should list doc3(edit,view), doc5(edit,view), doc8(view)",
    );

    assert.ok(
      !result.accessible.some((item) => item.object.id === doc6.id),
      "David should NOT list doc6",
    );
    assert.ok(
      !result.accessible.some((item) => item.object.id === doc7.id),
      "David should NOT list doc7",
    );
  });

  test("listAccessibleObjects: Alice's folders", async () => {
    const result = await authz.listAccessibleObjects({
      who: alice,
      ofType: "folder",
    });
    const expected = [
      { object: folderA, actions: ["view" as const], parent: undefined },
      { object: folderC, actions: ["view" as const], parent: folderA },
    ];
    assert.deepStrictEqual(
      sortAccessibleObjects(result.accessible),
      sortAccessibleObjects(expected),
      "Alice should list folderA(view), folderC(view)",
    );
  });

  test("listAccessibleObjects: Filter by specific action (Alice view document)", async () => {
    const result = await authz.listAccessibleObjects({
      who: alice,
      ofType: "document",
      canThey: "view",
    });

    const expected = [
      {
        object: doc1,
        actions: [
          "delete" as const,
          "edit" as const,
          "manage_members" as const,
          "view" as const,
        ],
        parent: undefined,
      },
      { object: doc4, actions: ["view" as const], parent: folderA },
      { object: doc9_field, actions: ["view" as const], parent: undefined },
    ];
    assert.deepStrictEqual(
      sortAccessibleObjects(result.accessible),
      sortAccessibleObjects(expected),
      "Alice should list doc1, doc4, doc9#field when filtering for 'view'",
    );
  });

  test("listAccessibleObjects: Filter by specific action (Alice delete document)", async () => {
    const result = await authz.listAccessibleObjects({
      who: alice,
      ofType: "document",
      canThey: "delete",
    });

    const expected = [
      {
        object: doc1,
        actions: [
          "delete" as const,
          "edit" as const,
          "manage_members" as const,
          "view" as const,
        ],
        parent: undefined,
      },
    ];
    assert.deepStrictEqual(
      sortAccessibleObjects(result.accessible),
      sortAccessibleObjects(expected),
      "Alice should list only doc1 when filtering for 'delete'",
    );
  });

  test("listAccessibleObjects: Filter by specific action (Charlie edit document)", async () => {
    const result = await authz.listAccessibleObjects({
      who: charlie,
      ofType: "document",
      canThey: "edit",
    });

    const expected = [
      {
        object: doc3,
        actions: ["edit" as const, "view" as const],
        parent: undefined,
      },
      {
        object: doc5,
        actions: ["edit" as const, "view" as const],
        parent: folderB,
      },
    ];
    assert.deepStrictEqual(
      sortAccessibleObjects(result.accessible),
      sortAccessibleObjects(expected),
      "Charlie should list doc3 and doc5 when filtering for 'edit'",
    );
  });

  test("listAccessibleObjects: No permissions", async () => {
    const result = await authz.listAccessibleObjects({
      who: bob,
      ofType: "folder",
    });
    assert.deepStrictEqual(result.accessible, [], "Bob should list no folders");
  });

  test("listAccessibleObjects: Different object type (Charlie view project)", async () => {
    const result = await authz.listAccessibleObjects({
      who: charlie,
      ofType: "project",
      canThey: "view_project",
    });
    const expected = [
      {
        object: projectX,
        actions: ["view" as const, "view_project" as const],
        parent: undefined,
      },
    ];
    assert.deepStrictEqual(
      sortAccessibleObjects(result.accessible),
      sortAccessibleObjects(expected),
      "Charlie should list projectX(view_project)",
    );
  });

  test("listAccessibleObjects: Empty result for non-existent user", async () => {
    const result = await authz.listAccessibleObjects({
      who: { type: "user", id: "unknown" },
      ofType: "document",
    });
    assert.deepStrictEqual(
      result.accessible,
      [],
      "Unknown user should list nothing",
    );
  });

  test("listAccessibleObjects: Empty result for non-existent action filter", async () => {
    const result = await authz.listAccessibleObjects({
      who: alice,
      canThey: "fly" as any,
      ofType: "document",
    });

    assert.deepStrictEqual(
      result.accessible,
      [],
      "Non-existent action filter should return empty list",
    );
  });

  test("listAccessibleObjects: Empty result for non-existent object type", async () => {
    const result = await authz.listAccessibleObjects({
      who: alice,
      ofType: "spaceship" as any,
    });
    assert.deepStrictEqual(
      result.accessible,
      [],
      "Non-existent object type should return empty list",
    );
  });
});
