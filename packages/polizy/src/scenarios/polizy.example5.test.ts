import { describe, test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { AuthSystem } from "../polizy.ts";
import { InMemoryStorageAdapter } from "../polizy.in-memory.storage.ts";
import { defineSchema } from "../types.ts";

let storage: InMemoryStorageAdapter<any, any>;

describe("Authorization Service example scenarios", () => {
  describe("Examples", () => {
    describe("Example 5: Emergency Access Removal", () => {
      const example5Schema = defineSchema({
        subjectTypes: ["user", "group"],
        objectTypes: ["review", "group", "system"],
        relations: {
          owner: { type: "direct" },
          viewer: { type: "direct" },
          editor: { type: "direct" },
          member: { type: "group" },
          admin: { type: "direct" },
        },
        actionToRelations: {
          view: ["viewer", "editor", "owner", "admin"],
          edit: ["editor", "owner", "admin"],
          manage: ["owner", "admin"],
          manage_permissions: ["owner", "admin"],
          manage_membership: ["owner", "admin"],
          administer_system: ["admin"],
        },
      });

      let authz: AuthSystem<typeof example5Schema>;

      beforeEach(async () => {
        storage = new InMemoryStorageAdapter();
        authz = new AuthSystem({ storage, schema: example5Schema });

        await authz.allow({
          who: { type: "user", id: "admin1" },
          toBe: "admin",
          onWhat: { type: "system", id: "root" },
        });
        await authz.allow({
          who: { type: "user", id: "tom1" },
          toBe: "owner",
          onWhat: { type: "review", id: "tom-review1" },
        });
        await authz.allow({
          who: { type: "user", id: "tom1" },
          toBe: "editor",
          onWhat: { type: "review", id: "tom-review2" },
        });

        await authz.allow({
          who: { type: "user", id: "admin1" },
          toBe: "owner",
          onWhat: { type: "group", id: "department-group" },
        });
        await authz.allow({
          who: { type: "user", id: "admin1" },
          toBe: "owner",
          onWhat: { type: "group", id: "project-group" },
        });
        await authz.addMember({
          member: { type: "user", id: "tom1" },
          group: { type: "group", id: "department-group" },
        });
        await authz.addMember({
          member: { type: "user", id: "tom1" },
          group: { type: "group", id: "project-group" },
        });
        await authz.allow({
          who: { type: "group", id: "department-group" },
          toBe: "viewer",
          onWhat: { type: "review", id: "other-review" },
        });
      });

      test("should immediately revoke all of Tom's direct access", async () => {
        assert.ok(
          await authz.check({
            who: { type: "user", id: "tom1" },
            canThey: "manage",
            onWhat: { type: "review", id: "tom-review1" },
          }),
        );
        assert.ok(
          await authz.check({
            who: { type: "user", id: "tom1" },
            canThey: "edit",
            onWhat: { type: "review", id: "tom-review2" },
          }),
        );

        const revokedCount = await authz.disallowAllMatching({
          who: { type: "user", id: "tom1" },
        });

        assert.strictEqual(
          revokedCount,
          4,
          "Expected all 4 relations for tom1 to be revoked",
        );

        assert.strictEqual(
          await authz.check({
            who: { type: "user", id: "tom1" },
            canThey: "manage",
            onWhat: { type: "review", id: "tom-review1" },
          }),
          false,
        );
        assert.strictEqual(
          await authz.check({
            who: { type: "user", id: "tom1" },
            canThey: "edit",
            onWhat: { type: "review", id: "tom-review2" },
          }),
          false,
        );

        assert.strictEqual(
          await authz.check({
            who: { type: "user", id: "tom1" },
            canThey: "view",
            onWhat: { type: "review", id: "other-review" },
          }),
          false,
          "Inherited access should be gone after removing all tom1 tuples",
        );
      });

      test("should revoke all of Tom's inherited access via group removal", async () => {
        assert.ok(
          await authz.check({
            who: { type: "user", id: "tom1" },
            canThey: "view",
            onWhat: { type: "review", id: "other-review" },
          }),
        );

        const membershipTuples = await authz.listTuples({
          subject: { type: "user", id: "tom1" },
          relation: "member",
        });
        const tomsGroups = membershipTuples.map((t) => t.object);
        assert.deepStrictEqual(
          tomsGroups.sort((a, b) => a.id.localeCompare(b.id)),
          [
            { type: "group", id: "department-group" },
            { type: "group", id: "project-group" },
          ].sort((a, b) => a.id.localeCompare(b.id)),
          "Tom should be in department and project groups",
        );

        let revokedMemberships = 0;
        for (const group of tomsGroups) {
          const canAdminManageMembers = await authz.check({
            who: { type: "user", id: "admin1" },
            canThey: "manage_membership",
            onWhat: group,
          });
          assert.ok(
            canAdminManageMembers,
            `Admin should be able to manage members of ${group.id}`,
          );
          if (canAdminManageMembers) {
            revokedMemberships += await authz.removeMember({
              member: { type: "user", id: "tom1" },
              group: group,
            });
          }
        }
        assert.strictEqual(
          revokedMemberships,
          2,
          "Expected 2 memberships revoked",
        );

        assert.strictEqual(
          await authz.check({
            who: { type: "user", id: "tom1" },
            canThey: "view",
            onWhat: { type: "review", id: "other-review" },
          }),
          false,
        );
      });

      test("should transfer owned reviews to other managers", async () => {
        assert.ok(
          await authz.check({
            who: { type: "user", id: "tom1" },
            canThey: "manage",
            onWhat: { type: "review", id: "tom-review1" },
          }),
        );
        assert.strictEqual(
          await authz.check({
            who: { type: "user", id: "maevious" },
            canThey: "manage",
            onWhat: { type: "review", id: "tom-review1" },
          }),
          false,
        );

        await authz.allow({
          who: { type: "user", id: "maevious" },
          toBe: "owner",
          onWhat: { type: "review", id: "tom-review1" },
        });
        await authz.allow({
          who: { type: "user", id: "maevious" },
          toBe: "owner",
          onWhat: { type: "review", id: "tom-review2" },
        });

        await authz.disallowAllMatching({
          who: { type: "user", id: "tom1" },
          was: "owner",
          onWhat: { type: "review", id: "tom-review1" },
        });

        await authz.disallowAllMatching({
          who: { type: "user", id: "tom1" },
          was: "editor",
          onWhat: { type: "review", id: "tom-review2" },
        });

        assert.ok(
          await authz.check({
            who: { type: "user", id: "maevious" },
            canThey: "manage",
            onWhat: { type: "review", id: "tom-review1" },
          }),
        );
        assert.ok(
          await authz.check({
            who: { type: "user", id: "maevious" },
            canThey: "view",
            onWhat: { type: "review", id: "tom-review1" },
          }),
        );
        assert.ok(
          await authz.check({
            who: { type: "user", id: "maevious" },
            canThey: "manage",
            onWhat: { type: "review", id: "tom-review2" },
          }),
        );

        assert.strictEqual(
          await authz.check({
            who: { type: "user", id: "tom1" },
            canThey: "manage",
            onWhat: { type: "review", id: "tom-review1" },
          }),
          false,
        );
        assert.strictEqual(
          await authz.check({
            who: { type: "user", id: "tom1" },
            canThey: "view",
            onWhat: { type: "review", id: "tom-review1" },
          }),
          false,
        );
        assert.strictEqual(
          await authz.check({
            who: { type: "user", id: "tom1" },
            canThey: "edit",
            onWhat: { type: "review", id: "tom-review2" },
          }),
          false,
        );
        assert.strictEqual(
          await authz.check({
            who: { type: "user", id: "tom1" },
            canThey: "view",
            onWhat: { type: "review", id: "tom-review2" },
          }),
          false,
        );
      });

      test("should block all future access attempts by removed user after full deletion", async () => {
        await authz.disallowAllMatching({ who: { type: "user", id: "tom1" } });

        assert.strictEqual(
          await authz.check({
            who: { type: "user", id: "tom1" },
            canThey: "view",
            onWhat: { type: "review", id: "tom-review1" },
          }),
          false,
        );
        assert.strictEqual(
          await authz.check({
            who: { type: "user", id: "tom1" },
            canThey: "view",
            onWhat: { type: "review", id: "tom-review2" },
          }),
          false,
        );
        assert.strictEqual(
          await authz.check({
            who: { type: "user", id: "tom1" },
            canThey: "view",
            onWhat: { type: "review", id: "other-review" },
          }),
          false,
        );

        const canTomGrant = await authz.check({
          who: { type: "user", id: "tom1" },
          canThey: "manage_permissions",
          onWhat: { type: "review", id: "tom-review1" },
        });
        assert.strictEqual(canTomGrant, false);

        await authz.allow({
          who: { type: "user", id: "tom1" },
          toBe: "viewer",
          onWhat: { type: "review", id: "other-review" },
        });

        assert.ok(
          await authz.check({
            who: { type: "user", id: "tom1" },
            canThey: "view",
            onWhat: { type: "review", id: "other-review" },
          }),
        );
        assert.strictEqual(
          await authz.check({
            who: { type: "user", id: "tom1" },
            canThey: "edit",
            onWhat: { type: "review", id: "other-review" },
          }),
          false,
        );
      });
    });
  });
});
