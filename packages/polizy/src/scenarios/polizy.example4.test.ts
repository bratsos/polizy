import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import { InMemoryStorageAdapter } from "../polizy.in-memory.storage.ts";
import { AuthSystem } from "../polizy.ts";
import { defineSchema } from "../types.ts";

let storage: InMemoryStorageAdapter<any, any>;

describe("Authorization Service example scenarios", () => {
  describe("Examples", () => {
    describe("Example 4: HR Team Access Structure", () => {
      const example4Schema = defineSchema({
        subjectTypes: ["user", "group"],
        objectTypes: ["review", "group"],
        relations: {
          owner: { type: "direct" },
          manager: { type: "direct" },
          editor: { type: "direct" },
          viewer: { type: "direct" },
          member: { type: "group" },
        },
        actionToRelations: {
          view: ["viewer", "editor", "manager", "owner"],
          edit: ["editor", "manager", "owner"],
          manage: ["manager", "owner"],
          manage_permissions: ["owner", "manager"],
          manage_membership: ["owner"],
        },
      });

      let authz: AuthSystem<typeof example4Schema>;

      beforeEach(async () => {
        storage = new InMemoryStorageAdapter();
        authz = new AuthSystem({ storage, schema: example4Schema });

        await authz.allow({
          who: { type: "user", id: "admin1" },
          toBe: "owner",
          onWhat: { type: "group", id: "hr-team" },
        });
        await authz.allow({
          who: { type: "user", id: "admin1" },
          toBe: "owner",
          onWhat: { type: "group", id: "hr-senior-team" },
        });
      });

      test("should grant base view access to all HR team members", async () => {
        await authz.allow({
          who: { type: "group", id: "hr-team" },
          toBe: "viewer",
          onWhat: { type: "review", id: "reviewId1" },
        });
        await authz.allow({
          who: { type: "group", id: "hr-team" },
          toBe: "viewer",
          onWhat: { type: "review", id: "reviewId2" },
        });
        await authz.addMember({
          member: { type: "user", id: "hr-member1" },
          group: { type: "group", id: "hr-team" },
        });
        await authz.addMember({
          member: { type: "user", id: "hr-member2" },
          group: { type: "group", id: "hr-team" },
        });
        await authz.addMember({
          member: { type: "user", id: "leaving-hr-member" },
          group: { type: "group", id: "hr-team" },
        });

        assert.ok(
          await authz.check({
            who: { type: "user", id: "hr-member1" },
            canThey: "view",
            onWhat: { type: "review", id: "reviewId1" },
          }),
        );
        assert.ok(
          await authz.check({
            who: { type: "user", id: "hr-member2" },
            canThey: "view",
            onWhat: { type: "review", id: "reviewId2" },
          }),
        );

        assert.strictEqual(
          await authz.check({
            who: { type: "user", id: "hr-member1" },
            canThey: "edit",
            onWhat: { type: "review", id: "reviewId1" },
          }),
          false,
        );
        assert.strictEqual(
          await authz.check({
            who: { type: "user", id: "hr-member1" },
            canThey: "manage",
            onWhat: { type: "review", id: "reviewId1" },
          }),
          false,
        );

        assert.strictEqual(
          await authz.check({
            who: { type: "user", id: "regular1" },
            canThey: "view",
            onWhat: { type: "review", id: "reviewId1" },
          }),
          false,
        );
      });

      test("should grant elevated permissions to senior HR members (using parallel grants)", async () => {
        await authz.allow({
          who: { type: "group", id: "hr-team" },
          toBe: "viewer",
          onWhat: { type: "review", id: "reviewId1" },
        });
        await authz.allow({
          who: { type: "group", id: "hr-senior-team" },
          toBe: "editor",
          onWhat: { type: "review", id: "reviewId1" },
        });
        await authz.allow({
          who: { type: "group", id: "hr-senior-team" },
          toBe: "manager",
          onWhat: { type: "review", id: "reviewId2" },
        });

        await authz.addMember({
          member: { type: "user", id: "hr-member1" },
          group: { type: "group", id: "hr-team" },
        });
        await authz.addMember({
          member: { type: "user", id: "hr-senior1" },
          group: { type: "group", id: "hr-senior-team" },
        });

        assert.ok(
          await authz.check({
            who: { type: "user", id: "hr-member1" },
            canThey: "view",
            onWhat: { type: "review", id: "reviewId1" },
          }),
        );
        assert.strictEqual(
          await authz.check({
            who: { type: "user", id: "hr-member1" },
            canThey: "edit",
            onWhat: { type: "review", id: "reviewId1" },
          }),
          false,
        );
        assert.strictEqual(
          await authz.check({
            who: { type: "user", id: "hr-member1" },
            canThey: "manage",
            onWhat: { type: "review", id: "reviewId2" },
          }),
          false,
        );

        assert.ok(
          await authz.check({
            who: { type: "user", id: "hr-senior1" },
            canThey: "view",
            onWhat: { type: "review", id: "reviewId1" },
          }),
        );
        assert.ok(
          await authz.check({
            who: { type: "user", id: "hr-senior1" },
            canThey: "edit",
            onWhat: { type: "review", id: "reviewId1" },
          }),
        );
        assert.ok(
          await authz.check({
            who: { type: "user", id: "hr-senior1" },
            canThey: "manage",
            onWhat: { type: "review", id: "reviewId2" },
          }),
        );
        assert.ok(
          await authz.check({
            who: { type: "user", id: "hr-senior1" },
            canThey: "view",
            onWhat: { type: "review", id: "reviewId2" },
          }),
        );
      });

      test("should easily add new HR team member with correct permissions", async () => {
        await authz.allow({
          who: { type: "group", id: "hr-team" },
          toBe: "viewer",
          onWhat: { type: "review", id: "reviewId1" },
        });
        await authz.allow({
          who: { type: "group", id: "hr-team" },
          toBe: "viewer",
          onWhat: { type: "review", id: "reviewId2" },
        });

        await authz.addMember({
          member: { type: "user", id: "new-hr-member" },
          group: { type: "group", id: "hr-team" },
        });

        assert.ok(
          await authz.check({
            who: { type: "user", id: "new-hr-member" },
            canThey: "view",
            onWhat: { type: "review", id: "reviewId1" },
          }),
        );
        assert.ok(
          await authz.check({
            who: { type: "user", id: "new-hr-member" },
            canThey: "view",
            onWhat: { type: "review", id: "reviewId2" },
          }),
        );
        assert.strictEqual(
          await authz.check({
            who: { type: "user", id: "new-hr-member" },
            canThey: "edit",
            onWhat: { type: "review", id: "reviewId1" },
          }),
          false,
        );

        await authz.allow({
          who: { type: "group", id: "hr-team" },
          toBe: "viewer",
          onWhat: { type: "review", id: "newReview" },
        });

        assert.ok(
          await authz.check({
            who: { type: "user", id: "new-hr-member" },
            canThey: "view",
            onWhat: { type: "review", id: "newReview" },
          }),
        );
      });

      test("should block access when member leaves HR team", async () => {
        await authz.allow({
          who: { type: "group", id: "hr-team" },
          toBe: "viewer",
          onWhat: { type: "review", id: "reviewId1" },
        });
        await authz.addMember({
          member: { type: "user", id: "leaving-hr-member" },
          group: { type: "group", id: "hr-team" },
        });
        assert.ok(
          await authz.check({
            who: { type: "user", id: "leaving-hr-member" },
            canThey: "view",
            onWhat: { type: "review", id: "reviewId1" },
          }),
        );

        await authz.removeMember({
          member: { type: "user", id: "leaving-hr-member" },
          group: { type: "group", id: "hr-team" },
        });

        assert.strictEqual(
          await authz.check({
            who: { type: "user", id: "leaving-hr-member" },
            canThey: "view",
            onWhat: { type: "review", id: "reviewId1" },
          }),
          false,
        );

        await authz.addMember({
          member: { type: "user", id: "leaving-hr-member" },
          group: { type: "group", id: "hr-team" },
        });

        assert.ok(
          await authz.check({
            who: { type: "user", id: "leaving-hr-member" },
            canThey: "view",
            onWhat: { type: "review", id: "reviewId1" },
          }),
        );
      });
    });
  });
});
