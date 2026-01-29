import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { AuthSystem } from "./polizy.ts";
import { InMemoryStorageAdapter } from "./polizy.in-memory.storage.ts";
import { defineSchema } from "./types.ts";
import { SchemaError, ConfigurationError } from "./errors.ts";

describe("AuthSystem Error Handling", () => {
  describe("writeTuple() errors", () => {
    it("should throw SchemaError when relation is not defined in schema", async () => {
      const schema = defineSchema({
        relations: { viewer: { type: "direct" } },
        actionToRelations: { view: ["viewer"] },
      });
      const storage = new InMemoryStorageAdapter();
      const authz = new AuthSystem({ storage, schema });

      await assert.rejects(
        async () => {
          await authz.allow({
            who: { type: "user", id: "alice" },
            // @ts-expect-error - intentionally using invalid relation
            toBe: "nonexistent_relation",
            onWhat: { type: "doc", id: "doc1" },
          });
        },
        (err: Error) => {
          return err instanceof SchemaError &&
            err.message.includes("nonexistent_relation") &&
            err.message.includes("not defined");
        },
        "Should throw SchemaError for undefined relation"
      );
    });
  });

  describe("addMember() errors", () => {
    it("should throw SchemaError when schema has no group relation", async () => {
      const schema = defineSchema({
        relations: { viewer: { type: "direct" } },
        actionToRelations: { view: ["viewer"] },
      });
      const storage = new InMemoryStorageAdapter();
      const authz = new AuthSystem({ storage, schema });

      await assert.rejects(
        async () => {
          await authz.addMember({
            member: { type: "user", id: "alice" },
            group: { type: "group", id: "team1" },
          });
        },
        (err: Error) => {
          return err instanceof SchemaError &&
            err.message.includes("group");
        },
        "Should throw SchemaError when no group relation defined"
      );
    });
  });

  describe("setParent() errors", () => {
    it("should throw SchemaError when schema has no hierarchy relation", async () => {
      const schema = defineSchema({
        relations: { viewer: { type: "direct" } },
        actionToRelations: { view: ["viewer"] },
      });
      const storage = new InMemoryStorageAdapter();
      const authz = new AuthSystem({ storage, schema });

      await assert.rejects(
        async () => {
          await authz.setParent({
            child: { type: "doc", id: "doc1" },
            parent: { type: "folder", id: "folder1" },
          });
        },
        (err: Error) => {
          return err instanceof SchemaError &&
            err.message.includes("hierarchy");
        },
        "Should throw SchemaError when no hierarchy relation defined"
      );
    });
  });

  describe("removeParent() errors", () => {
    it("should throw SchemaError when schema has no hierarchy relation", async () => {
      const schema = defineSchema({
        relations: { viewer: { type: "direct" } },
        actionToRelations: { view: ["viewer"] },
      });
      const storage = new InMemoryStorageAdapter();
      const authz = new AuthSystem({ storage, schema });

      await assert.rejects(
        async () => {
          await authz.removeParent({
            child: { type: "doc", id: "doc1" },
            parent: { type: "folder", id: "folder1" },
          });
        },
        (err: Error) => {
          return err instanceof SchemaError &&
            err.message.includes("hierarchy");
        },
        "Should throw SchemaError when no hierarchy relation defined"
      );
    });
  });

  describe("removeMember() errors", () => {
    it("should throw SchemaError when schema has no group relation", async () => {
      const noGroupSchema = defineSchema({
        relations: {
          viewer: { type: "direct" },
        },
        actionToRelations: {
          view: ["viewer"],
        },
      });

      const storage = new InMemoryStorageAdapter();
      const authz = new AuthSystem({ storage, schema: noGroupSchema });

      await assert.rejects(
        async () => {
          await authz.removeMember({
            member: { type: "user", id: "alice" },
            group: { type: "group", id: "engineering" },
          });
        },
        (err: Error) => {
          assert.ok(err instanceof SchemaError, "Should be SchemaError");
          assert.ok(err.message.includes("group"), "Message should mention 'group'");
          return true;
        }
      );
    });
  });

  describe("disallowAllMatching() with empty filter", () => {
    it("should return 0 when called with empty filter", async () => {
      const schema = defineSchema({
        relations: { viewer: { type: "direct" } },
        actionToRelations: { view: ["viewer"] },
      });
      const storage = new InMemoryStorageAdapter();
      const authz = new AuthSystem({ storage, schema });

      // Add a tuple first
      await authz.allow({
        who: { type: "user", id: "alice" },
        toBe: "viewer",
        onWhat: { type: "doc", id: "doc1" },
      });

      // Empty filter should not delete anything
      const result = await authz.disallowAllMatching({});

      assert.strictEqual(result, 0, "Should return 0 for empty filter");

      // Verify the tuple still exists
      const canView = await authz.check({
        who: { type: "user", id: "alice" },
        canThey: "view",
        onWhat: { type: "doc", id: "doc1" },
      });
      assert.strictEqual(canView, true, "Tuple should still exist");
    });
  });
});
