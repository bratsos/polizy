import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import { InMemoryStorageAdapter } from "../polizy.in-memory.storage.ts";
import { AuthSystem } from "../polizy.ts";
import { defineSchema } from "../types.ts";

let storage: InMemoryStorageAdapter<any, any>;

describe("Authorization Service example scenarios", () => {
  describe("Examples", () => {
    describe("Example 9: Hierarchy Propagation (Folder/File Permissions)", () => {
      const example9Schema = defineSchema({
        subjectTypes: ["user", "file", "folder"],
        objectTypes: ["folder", "file"],
        relations: {
          childOf: { type: "hierarchy" },
          owner: { type: "direct" },
          viewer: { type: "direct" },
          editor: { type: "direct" },
        },
        actionToRelations: {
          view: ["viewer", "editor", "owner"],
          edit: ["editor", "owner"],
          manage: ["owner"],
        },
        hierarchyPropagation: {
          view: ["view"],
          edit: [],
          manage: [],
        },
      });

      let authz: AuthSystem<typeof example9Schema>;

      beforeEach(async () => {
        storage = new InMemoryStorageAdapter();
        authz = new AuthSystem({ storage, schema: example9Schema });

        await authz.allow({
          who: { type: "user", id: "alice" },
          toBe: "owner",
          onWhat: { type: "folder", id: "folderA" },
        });

        await authz.allow({
          who: { type: "file", id: "file1" },
          toBe: "childOf",
          onWhat: { type: "folder", id: "folderA" },
        });

        await authz.allow({
          who: { type: "file", id: "file2" },
          toBe: "childOf",
          onWhat: { type: "folder", id: "folderA" },
        });

        await authz.allow({
          who: { type: "folder", id: "subfolder1" },
          toBe: "childOf",
          onWhat: { type: "folder", id: "folderA" },
        });

        await authz.allow({
          who: { type: "file", id: "file3" },
          toBe: "childOf",
          onWhat: { type: "folder", id: "subfolder1" },
        });

        await authz.allow({
          who: { type: "user", id: "bob" },
          toBe: "owner",
          onWhat: { type: "folder", id: "folderB" },
        });

        await authz.allow({
          who: { type: "file", id: "file4" },
          toBe: "childOf",
          onWhat: { type: "folder", id: "folderB" },
        });
      });

      test("should propagate 'viewer' permission from folder to file", async () => {
        await authz.allow({
          who: { type: "user", id: "charlie" },
          toBe: "viewer",
          onWhat: { type: "folder", id: "folderA" },
        });

        assert.ok(
          await authz.check({
            who: { type: "user", id: "charlie" },
            canThey: "view",
            onWhat: { type: "folder", id: "folderA" },
          }),
          "Charlie should view folderA directly",
        );

        assert.ok(
          await authz.check({
            who: { type: "user", id: "charlie" },
            canThey: "view",
            onWhat: { type: "file", id: "file1" },
          }),
          "Charlie should inherit view access to file1",
        );
        assert.strictEqual(
          await authz.check({
            who: { type: "user", id: "charlie" },
            canThey: "edit",
            onWhat: { type: "file", id: "file1" },
          }),
          false,
          "Charlie should NOT inherit edit access to file1",
        );

        assert.ok(
          await authz.check({
            who: { type: "user", id: "charlie" },
            canThey: "view",
            onWhat: { type: "file", id: "file2" },
          }),
          "Charlie should inherit view access to file2",
        );
        assert.strictEqual(
          await authz.check({
            who: { type: "user", id: "charlie" },
            canThey: "edit",
            onWhat: { type: "file", id: "file2" },
          }),
          false,
          "Charlie should NOT inherit edit access to file2",
        );
        assert.strictEqual(
          await authz.check({
            who: { type: "user", id: "charlie" },
            canThey: "manage",
            onWhat: { type: "folder", id: "folderA" },
          }),
          false,
          "Charlie should NOT be able to manage folderA",
        );
      });

      test("should propagate 'viewer' permission through multiple hierarchy levels", async () => {
        await authz.allow({
          who: { type: "user", id: "charlie" },
          toBe: "viewer",
          onWhat: { type: "folder", id: "folderA" },
        });

        assert.ok(
          await authz.check({
            who: { type: "user", id: "charlie" },
            canThey: "view",
            onWhat: { type: "folder", id: "subfolder1" },
          }),
          "Charlie should inherit view access to subfolder1",
        );
        assert.strictEqual(
          await authz.check({
            who: { type: "user", id: "charlie" },
            canThey: "edit",
            onWhat: { type: "folder", id: "subfolder1" },
          }),
          false,
          "Charlie should NOT inherit edit access to subfolder1",
        );

        assert.ok(
          await authz.check({
            who: { type: "user", id: "charlie" },
            canThey: "view",
            onWhat: { type: "file", id: "file3" },
          }),
          "Charlie should inherit view access to file3 through subfolder",
        );
        assert.strictEqual(
          await authz.check({
            who: { type: "user", id: "charlie" },
            canThey: "edit",
            onWhat: { type: "file", id: "file3" },
          }),
          false,
          "Charlie should NOT inherit edit access to file3",
        );
      });

      test("should NOT propagate non-hierarchical 'editor' permission", async () => {
        await authz.allow({
          who: { type: "user", id: "dave" },
          toBe: "editor",
          onWhat: { type: "folder", id: "folderA" },
        });

        assert.ok(
          await authz.check({
            who: { type: "user", id: "dave" },
            canThey: "edit",
            onWhat: { type: "folder", id: "folderA" },
          }),
          "Dave should edit folderA directly",
        );

        assert.ok(
          await authz.check({
            who: { type: "user", id: "dave" },
            canThey: "view",
            onWhat: { type: "folder", id: "folderA" },
          }),
          "Dave should also view folderA directly as editor",
        );

        assert.strictEqual(
          await authz.check({
            who: { type: "user", id: "dave" },
            canThey: "edit",
            onWhat: { type: "file", id: "file1" },
          }),
          false,
          "Dave should NOT inherit edit access to file1",
        );

        assert.ok(
          await authz.check({
            who: { type: "user", id: "dave" },
            canThey: "view",
            onWhat: { type: "file", id: "file1" },
          }),
          "Dave SHOULD inherit view access to file1 via editor relation on parent",
        );

        assert.strictEqual(
          await authz.check({
            who: { type: "user", id: "dave" },
            canThey: "edit",
            onWhat: { type: "file", id: "file3" },
          }),
          false,
          "Dave should NOT inherit edit access to file3",
        );

        assert.strictEqual(
          await authz.check({
            who: { type: "user", id: "dave" },
            canThey: "view",
            onWhat: { type: "file", id: "file3" },
          }),
          true,
          "Dave SHOULD inherit view access to file3 via editor relation on parent",
        );

        assert.strictEqual(
          await authz.check({
            who: { type: "user", id: "dave" },
            canThey: "manage",
            onWhat: { type: "folder", id: "folderA" },
          }),
          false,
          "Dave should NOT manage folderA",
        );
      });

      test("should allow direct permissions on child alongside propagated ones", async () => {
        await authz.allow({
          who: { type: "user", id: "charlie" },
          toBe: "viewer",
          onWhat: { type: "folder", id: "folderA" },
        });

        await authz.allow({
          who: { type: "user", id: "charlie" },
          toBe: "editor",
          onWhat: { type: "file", id: "file1" },
        });

        assert.ok(
          await authz.check({
            who: { type: "user", id: "charlie" },
            canThey: "view",
            onWhat: { type: "file", id: "file1" },
          }),
          "Charlie can view file1 (propagated)",
        );

        assert.ok(
          await authz.check({
            who: { type: "user", id: "charlie" },
            canThey: "edit",
            onWhat: { type: "file", id: "file1" },
          }),
          "Charlie can edit file1 (direct)",
        );

        assert.ok(
          await authz.check({
            who: { type: "user", id: "charlie" },
            canThey: "view",
            onWhat: { type: "file", id: "file2" },
          }),
          "Charlie can view file2 (propagated)",
        );

        assert.strictEqual(
          await authz.check({
            who: { type: "user", id: "charlie" },
            canThey: "manage",
            onWhat: { type: "file", id: "file1" },
          }),
          false,
          "Charlie should NOT manage file1",
        );

        assert.strictEqual(
          await authz.check({
            who: { type: "user", id: "charlie" },
            canThey: "edit",
            onWhat: { type: "file", id: "file2" },
          }),
          false,
          "Charlie cannot edit file2",
        );
        assert.strictEqual(
          await authz.check({
            who: { type: "user", id: "charlie" },
            canThey: "manage",
            onWhat: { type: "file", id: "file2" },
          }),
          false,
          "Charlie should NOT manage file2",
        );
      });

      test("should not propagate permissions across unrelated hierarchies", async () => {
        await authz.allow({
          who: { type: "user", id: "charlie" },
          toBe: "viewer",
          onWhat: { type: "folder", id: "folderA" },
        });

        assert.strictEqual(
          await authz.check({
            who: { type: "user", id: "charlie" },
            canThey: "view",
            onWhat: { type: "folder", id: "folderB" },
          }),
          false,
          "Charlie should not view folderB",
        );

        assert.strictEqual(
          await authz.check({
            who: { type: "user", id: "charlie" },
            canThey: "edit",
            onWhat: { type: "folder", id: "folderB" },
          }),
          false,
          "Charlie should not edit folderB",
        );

        assert.strictEqual(
          await authz.check({
            who: { type: "user", id: "charlie" },
            canThey: "view",
            onWhat: { type: "file", id: "file4" },
          }),
          false,
          "Charlie should not inherit view access to file4 in folderB",
        );

        assert.strictEqual(
          await authz.check({
            who: { type: "user", id: "charlie" },
            canThey: "edit",
            onWhat: { type: "file", id: "file4" },
          }),
          false,
          "Charlie should not inherit edit access to file4 in folderB",
        );
      });

      test("owner relation should grant propagated view action", async () => {
        await authz.allow({
          who: { type: "user", id: "eve" },
          toBe: "viewer",
          onWhat: { type: "folder", id: "folderA" },
        });

        assert.ok(
          await authz.check({
            who: { type: "user", id: "eve" },
            canThey: "view",
            onWhat: { type: "file", id: "file1" },
          }),
          "Eve should inherit view access to file1 via viewer relation",
        );

        assert.strictEqual(
          await authz.check({
            who: { type: "user", id: "eve" },
            canThey: "edit",
            onWhat: { type: "file", id: "file1" },
          }),
          false,
          "Eve should NOT inherit edit access to file1",
        );

        await authz.allow({
          who: { type: "user", id: "frank" },
          toBe: "owner",
          onWhat: { type: "folder", id: "folderA" },
        });

        assert.ok(
          await authz.check({
            who: { type: "user", id: "frank" },
            canThey: "view",
            onWhat: { type: "folder", id: "folderA" },
          }),
          "Frank can view folderA directly as owner",
        );

        assert.ok(
          await authz.check({
            who: { type: "user", id: "frank" },
            canThey: "manage",
            onWhat: { type: "folder", id: "folderA" },
          }),
          "Frank can manage folderA directly as owner",
        );

        assert.ok(
          await authz.check({
            who: { type: "user", id: "frank" },
            canThey: "view",
            onWhat: { type: "file", id: "file1" },
          }),
          "Frank SHOULD inherit view access to file1 via owner relation granting view on parent",
        );

        assert.strictEqual(
          await authz.check({
            who: { type: "user", id: "frank" },
            canThey: "edit",
            onWhat: { type: "file", id: "file1" },
          }),
          false,
          "Frank should NOT inherit edit access to file1 via owner relation",
        );
        assert.strictEqual(
          await authz.check({
            who: { type: "user", id: "frank" },
            canThey: "manage",
            onWhat: { type: "file", id: "file1" },
          }),
          false,
          "Frank should NOT inherit manage access to file1 via owner relation",
        );
      });
    });
  });
});
