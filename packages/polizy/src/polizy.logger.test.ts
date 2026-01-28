import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AuthSystem } from "./polizy.ts";
import { InMemoryStorageAdapter } from "./polizy.in-memory.storage.ts";
import { defineSchema } from "./types.ts";

describe("AuthSystem Logger Configuration", () => {
  const schema = defineSchema({
    relations: {
      viewer: { type: "direct" },
    },
    actionToRelations: {
      view: ["viewer"],
    },
  });

  it("should use custom logger for warnings", async () => {
    const warnings: string[] = [];
    const customLogger = {
      warn: (msg: string) => warnings.push(msg),
    };

    const storage = new InMemoryStorageAdapter();
    const authz = new AuthSystem({
      storage,
      schema,
      logger: customLogger,
    });

    // Trigger a warning by calling disallowAllMatching with empty filter
    await authz.disallowAllMatching({});

    assert.strictEqual(warnings.length, 1, "Should have logged one warning");
    assert.ok(
      warnings[0].includes("empty filter"),
      "Warning should mention empty filter"
    );
  });

  it("should use console.warn by default when no logger provided", async () => {
    const storage = new InMemoryStorageAdapter();
    const authz = new AuthSystem({ storage, schema });

    // This should not throw - just uses console.warn internally
    const result = await authz.disallowAllMatching({});
    assert.strictEqual(result, 0);
  });

  it("should log max depth exceeded via custom logger", async () => {
    const warnings: string[] = [];
    const customLogger = {
      warn: (msg: string) => warnings.push(msg),
    };

    const deepSchema = defineSchema({
      relations: {
        member: { type: "group" },
        viewer: { type: "direct" },
      },
      actionToRelations: {
        view: ["viewer"],
      },
    });

    const storage = new InMemoryStorageAdapter();
    const authz = new AuthSystem({
      storage,
      schema: deepSchema,
      defaultCheckDepth: 2,
      logger: customLogger,
    });

    // Create a group chain deeper than maxDepth
    await authz.addMember({ member: { type: "user", id: "alice" }, group: { type: "group", id: "g1" } });
    await authz.addMember({ member: { type: "group", id: "g1" }, group: { type: "group", id: "g2" } });
    await authz.addMember({ member: { type: "group", id: "g2" }, group: { type: "group", id: "g3" } });
    await authz.addMember({ member: { type: "group", id: "g3" }, group: { type: "group", id: "g4" } });
    await authz.allow({ who: { type: "group", id: "g4" }, toBe: "viewer", onWhat: { type: "doc", id: "doc1" } });

    // This should hit max depth and log a warning
    await authz.check({
      who: { type: "user", id: "alice" },
      canThey: "view",
      onWhat: { type: "doc", id: "doc1" },
    });

    assert.ok(
      warnings.some(w => w.includes("exceeded maximum depth")),
      "Should log max depth warning"
    );
  });
});
