import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { InMemoryStorageAdapter } from "../polizy.in-memory.storage.ts";
import { AuthSystem } from "../polizy.ts";
import { defineSchema, PUBLIC_ID } from "../types.ts";

const schema = defineSchema({
  subjectTypes: ["user"],
  objectTypes: ["document", "team"],
  relations: {
    viewer: { type: "direct" },
    member: { type: "group" },
  },
  actionToRelations: {
    view: ["viewer", "member"],
  },
  fieldLevelObjects: ["document"],
});

const everyone = <T extends string>(type: T) =>
  ({ type, id: PUBLIC_ID }) as { type: T; id: string };

describe("listSubjects field-level fallback with wildcard grants to group-acting types", () => {
  it("handles DIRECT wildcard grant and someoneCan / countSubjects / parity guard", async () => {
    const sys = new AuthSystem({
      schema,
      storage: new InMemoryStorageAdapter(),
      defaultCheckDepth: 5,
    });

    const alice = { type: "user" as const, id: "alice" };
    const bob = { type: "user" as const, id: "bob" };
    const eng = { type: "team" as const, id: "eng" };
    const doc1 = { type: "document" as const, id: "doc1" };

    // Setup: everyone("team") is viewer of doc1
    await sys.allow({
      who: everyone("team"),
      toBe: "viewer",
      onWhat: doc1,
    });

    // alice member of team:eng
    await sys.addMember({
      member: alice,
      group: eng,
    });

    // Case 1: DIRECT wildcard grant
    const checkAlice = await sys.check({
      who: alice,
      canThey: "view",
      onWhat: doc1,
    });
    assert.equal(checkAlice, true);

    const checkBob = await sys.check({
      who: bob,
      canThey: "view",
      onWhat: doc1,
    });
    assert.equal(checkBob, false);

    const checkEng = await sys.check({
      who: eng,
      canThey: "view",
      onWhat: doc1,
    });
    assert.equal(checkEng, true);

    const subjects = await sys.listSubjects({ canThey: "view", onWhat: doc1 });
    const subKeys = subjects.map((s) => `${s.type}:${s.id}`);

    assert.ok(
      subKeys.includes("user:alice"),
      "alice must be listed as user:alice",
    );
    assert.ok(subKeys.includes(`team:${PUBLIC_ID}`), "team:* must be listed");
    assert.ok(!subKeys.includes("user:bob"), "bob must not be listed");

    // Case 3: someoneCan with ofType
    const someone = await sys.someoneCan({
      canThey: "view",
      onWhat: doc1,
      ofType: "user",
    });
    assert.equal(someone, true, "someoneCan ofType: user must be true");

    // Case 4: countSubjects
    const count = await sys.countSubjects({ canThey: "view", onWhat: doc1 });
    assert.equal(count, subjects.length);

    // Case 5: Parity guard
    const testSubjects = [alice, bob, eng];
    for (const sub of testSubjects) {
      const isAllowed = await sys.check({
        who: sub,
        canThey: "view",
        onWhat: doc1,
      });
      const inList = subjects.some(
        (s) =>
          (s.type === sub.type && s.id === sub.id) ||
          (s.type === sub.type && s.id === PUBLIC_ID),
      );
      assert.equal(
        inList,
        isAllowed,
        `Parity check failed for ${sub.type}:${sub.id}`,
      );
    }
  });

  it("handles WILDCARD MEMBERSHIP variant", async () => {
    const sys = new AuthSystem({
      schema,
      storage: new InMemoryStorageAdapter(),
      defaultCheckDepth: 5,
    });

    const alice = { type: "user" as const, id: "alice" };
    const eng = { type: "team" as const, id: "eng" };
    const parent = { type: "team" as const, id: "parent" };
    const doc1 = { type: "document" as const, id: "doc1" };

    // everyone("team") is a member of group team:parent
    await sys.addMember({
      member: everyone("team"),
      group: parent,
    });

    // team:parent is viewer of doc1
    await sys.allow({
      who: parent,
      toBe: "viewer",
      onWhat: doc1,
    });

    // alice member of team:eng
    await sys.addMember({
      member: alice,
      group: eng,
    });

    const checkAlice = await sys.check({
      who: alice,
      canThey: "view",
      onWhat: doc1,
    });
    assert.equal(checkAlice, true);

    const subjects = await sys.listSubjects({ canThey: "view", onWhat: doc1 });
    const subKeys = subjects.map((s) => `${s.type}:${s.id}`);

    assert.ok(
      subKeys.includes("user:alice"),
      "alice must be listed via wildcard membership",
    );
  });

  it("handles nested-group depth", async () => {
    const sys = new AuthSystem({
      schema,
      storage: new InMemoryStorageAdapter(),
      defaultCheckDepth: 5,
    });

    const alice = { type: "user" as const, id: "alice" };
    const eng = { type: "team" as const, id: "eng" };
    const sub = { type: "team" as const, id: "sub" };
    const doc = { type: "document" as const, id: "doc" };

    // everyone("team") viewer doc
    await sys.allow({
      who: everyone("team"),
      toBe: "viewer",
      onWhat: doc,
    });

    // eng member sub
    await sys.addMember({
      member: eng,
      group: sub,
    });

    // alice member eng
    await sys.addMember({
      member: alice,
      group: eng,
    });

    const checkAlice = await sys.check({
      who: alice,
      canThey: "view",
      onWhat: doc,
    });
    assert.equal(checkAlice, true);

    const subjects = await sys.listSubjects({ canThey: "view", onWhat: doc });
    const subKeys = subjects.map((s) => `${s.type}:${s.id}`);

    assert.ok(
      subKeys.includes("user:alice"),
      "alice must be listed in nested wildcard grant",
    );
  });
});
