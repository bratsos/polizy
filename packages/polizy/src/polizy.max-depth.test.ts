import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MaxDepthExceededError } from "./errors.ts";
import { InMemoryStorageAdapter } from "./polizy.in-memory.storage.ts";
import { AuthSystem } from "./polizy.ts";
import { defineSchema } from "./types.ts";

describe("AuthSystem throwOnMaxDepth Option", () => {
  const schema = defineSchema({
    relations: {
      member: { type: "group" },
      viewer: { type: "direct" },
    },
    actionToRelations: {
      view: ["viewer"],
    },
  });

  it("should throw MaxDepthExceededError when throwOnMaxDepth is true", async () => {
    const storage = new InMemoryStorageAdapter();
    const authz = new AuthSystem({
      storage,
      schema,
      defaultCheckDepth: 2,
      throwOnMaxDepth: true,
    });

    // Create a group chain deeper than maxDepth
    await authz.addMember({
      member: { type: "user", id: "alice" },
      group: { type: "group", id: "g1" },
    });
    await authz.addMember({
      member: { type: "group", id: "g1" },
      group: { type: "group", id: "g2" },
    });
    await authz.addMember({
      member: { type: "group", id: "g2" },
      group: { type: "group", id: "g3" },
    });
    await authz.addMember({
      member: { type: "group", id: "g3" },
      group: { type: "group", id: "g4" },
    });
    await authz.allow({
      who: { type: "group", id: "g4" },
      toBe: "viewer",
      onWhat: { type: "doc", id: "doc1" },
    });

    await assert.rejects(
      async () => {
        await authz.check({
          who: { type: "user", id: "alice" },
          canThey: "view",
          onWhat: { type: "doc", id: "doc1" },
        });
      },
      (err: Error) => {
        assert.ok(
          err instanceof MaxDepthExceededError,
          "Should be MaxDepthExceededError",
        );
        assert.strictEqual(err.action, "view");
        assert.strictEqual(err.object.type, "doc");
        assert.strictEqual(err.object.id, "doc1");
        return true;
      },
    );
  });

  it("should return false by default when max depth exceeded (backwards compatible)", async () => {
    const storage = new InMemoryStorageAdapter();
    const authz = new AuthSystem({
      storage,
      schema,
      defaultCheckDepth: 2,
      // throwOnMaxDepth NOT set - should default to false
    });

    // Same deep group chain
    await authz.addMember({
      member: { type: "user", id: "alice" },
      group: { type: "group", id: "g1" },
    });
    await authz.addMember({
      member: { type: "group", id: "g1" },
      group: { type: "group", id: "g2" },
    });
    await authz.addMember({
      member: { type: "group", id: "g2" },
      group: { type: "group", id: "g3" },
    });
    await authz.addMember({
      member: { type: "group", id: "g3" },
      group: { type: "group", id: "g4" },
    });
    await authz.allow({
      who: { type: "group", id: "g4" },
      toBe: "viewer",
      onWhat: { type: "doc", id: "doc1" },
    });

    // Should NOT throw, just return false
    const result = await authz.check({
      who: { type: "user", id: "alice" },
      canThey: "view",
      onWhat: { type: "doc", id: "doc1" },
    });

    assert.strictEqual(result, false);
  });
});
