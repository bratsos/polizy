import { describe, test, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { AuthSystem } from "../polizy.ts";
import { InMemoryStorageAdapter } from "../polizy.in-memory.storage.ts";
import { defineSchema } from "../types.ts";

let storage: InMemoryStorageAdapter<any, any>;

describe("Authorization Service example scenarios", () => {
  describe("Examples", () => {
    describe("Example 8: Department Reorganization", () => {
      const example8Schema = defineSchema({
        subjectTypes: ["user", "group"],
        objectTypes: ["review", "group", "system"],
        relations: {
          owner: { type: "direct" },
          lead: { type: "direct" },
          member: { type: "group" },
          viewer: { type: "direct" },
          editor: { type: "direct" },
          manager: { type: "direct" },
          admin: { type: "direct" },
        },
        actionToRelations: {
          view: ["viewer", "editor", "owner", "lead", "manager", "admin"],
          edit: ["editor", "owner", "lead", "manager", "admin"],
          manage: ["owner", "lead", "manager", "admin"],
          manage_permissions: ["owner", "admin"],
          manage_membership: ["owner", "lead", "admin"],
          administer_system: ["admin"],
        },
      });

      let authz: AuthSystem<typeof example8Schema>;

      let transitionStart: Date;

      beforeEach(async () => {
        storage = new InMemoryStorageAdapter();
        authz = new AuthSystem({ storage, schema: example8Schema });

        await authz.allow({
          who: { type: "user", id: "admin1" },
          toBe: "admin",
          onWhat: { type: "system", id: "root" },
        });
        await authz.allow({
          who: { type: "user", id: "frontend-lead" },
          toBe: "lead",
          onWhat: { type: "group", id: "frontend-team" },
        });
        await authz.allow({
          who: { type: "user", id: "backend-lead" },
          toBe: "lead",
          onWhat: { type: "group", id: "backend-team" },
        });
        await authz.allow({
          who: { type: "user", id: "frontend-lead" },
          toBe: "owner",
          onWhat: { type: "review", id: "fe-review1" },
        });
        await authz.allow({
          who: { type: "user", id: "backend-lead" },
          toBe: "owner",
          onWhat: { type: "review", id: "be-review1" },
        });
        await authz.allow({
          who: { type: "user", id: "frontend-lead" },
          toBe: "owner",
          onWhat: { type: "review", id: "fe-done1" },
        });
        await authz.allow({
          who: { type: "user", id: "backend-lead" },
          toBe: "owner",
          onWhat: { type: "review", id: "be-done1" },
        });
        await authz.addMember({
          member: { type: "user", id: "fe-eng1" },
          group: { type: "group", id: "frontend-team" },
        });
        await authz.addMember({
          member: { type: "user", id: "be-eng1" },
          group: { type: "group", id: "backend-team" },
        });
        await authz.allow({
          who: { type: "group", id: "frontend-team" },
          toBe: "viewer",
          onWhat: { type: "review", id: "fe-review1" },
        });
        await authz.allow({
          who: { type: "group", id: "backend-team" },
          toBe: "viewer",
          onWhat: { type: "review", id: "be-review1" },
        });

        transitionStart = new Date("2024-07-01T00:00:00.000Z");
        mock.timers.enable({
          apis: ["Date"],
          now: new Date("2024-06-01T00:00:00.000Z").getTime(),
        });
      });

      afterEach(() => {
        mock.timers.reset();
      });

      test("should verify initial team permissions", async () => {
        assert.ok(
          await authz.check({
            who: { type: "user", id: "frontend-lead" },
            canThey: "manage",
            onWhat: { type: "review", id: "fe-review1" },
          }),
          "FE Lead manage FE review",
        );
        assert.ok(
          await authz.check({
            who: { type: "user", id: "backend-lead" },
            canThey: "manage",
            onWhat: { type: "review", id: "be-review1" },
          }),
          "BE Lead manage BE review",
        );
        assert.ok(
          await authz.check({
            who: { type: "user", id: "fe-eng1" },
            canThey: "view",
            onWhat: { type: "review", id: "fe-review1" },
          }),
          "FE Eng view FE review",
        );
        assert.ok(
          await authz.check({
            who: { type: "user", id: "be-eng1" },
            canThey: "view",
            onWhat: { type: "review", id: "be-review1" },
          }),
          "BE Eng view BE review",
        );
        assert.strictEqual(
          await authz.check({
            who: { type: "user", id: "fe-eng1" },
            canThey: "view",
            onWhat: { type: "review", id: "be-review1" },
          }),
          false,
          "FE Eng cannot view BE review",
        );
        assert.strictEqual(
          await authz.check({
            who: { type: "user", id: "be-eng1" },
            canThey: "view",
            onWhat: { type: "review", id: "fe-review1" },
          }),
          false,
          "BE Eng cannot view FE review",
        );
      });

      test("should handle bulk permission updates for team mergers", async () => {
        await authz.allow({
          who: { type: "user", id: "engineering-lead" },
          toBe: "lead",
          onWhat: { type: "group", id: "engineering-team" },
        });

        await authz.removeMember({
          member: { type: "user", id: "fe-eng1" },
          group: { type: "group", id: "frontend-team" },
        });
        await authz.removeMember({
          member: { type: "user", id: "be-eng1" },
          group: { type: "group", id: "backend-team" },
        });
        await authz.addMember({
          member: { type: "user", id: "fe-eng1" },
          group: { type: "group", id: "engineering-team" },
        });
        await authz.addMember({
          member: { type: "user", id: "be-eng1" },
          group: { type: "group", id: "engineering-team" },
        });

        await authz.allow({
          who: { type: "group", id: "engineering-team" },
          toBe: "viewer",
          onWhat: { type: "review", id: "fe-review1" },
        });
        await authz.allow({
          who: { type: "group", id: "engineering-team" },
          toBe: "viewer",
          onWhat: { type: "review", id: "be-review1" },
        });

        await authz.disallowAllMatching({
          who: { type: "group", id: "frontend-team" },
          was: "viewer",
          onWhat: { type: "review", id: "fe-review1" },
        });

        await authz.disallowAllMatching({
          who: { type: "group", id: "backend-team" },
          was: "viewer",
          onWhat: { type: "review", id: "be-review1" },
        });

        assert.ok(
          await authz.check({
            who: { type: "user", id: "fe-eng1" },
            canThey: "view",
            onWhat: { type: "review", id: "fe-review1" },
          }),
          "FE Eng view FE review (via Eng team)",
        );
        assert.ok(
          await authz.check({
            who: { type: "user", id: "fe-eng1" },
            canThey: "view",
            onWhat: { type: "review", id: "be-review1" },
          }),
          "FE Eng view BE review (via Eng team)",
        );
        assert.ok(
          await authz.check({
            who: { type: "user", id: "be-eng1" },
            canThey: "view",
            onWhat: { type: "review", id: "fe-review1" },
          }),
          "BE Eng view FE review (via Eng team)",
        );
        assert.ok(
          await authz.check({
            who: { type: "user", id: "be-eng1" },
            canThey: "view",
            onWhat: { type: "review", id: "be-review1" },
          }),
          "BE Eng view BE review (via Eng team)",
        );
      });

      test("should transfer review ownership during restructuring", async () => {
        assert.ok(
          await authz.check({
            who: { type: "user", id: "frontend-lead" },
            canThey: "manage",
            onWhat: { type: "review", id: "fe-review1" },
          }),
        );
        assert.ok(
          await authz.check({
            who: { type: "user", id: "backend-lead" },
            canThey: "manage",
            onWhat: { type: "review", id: "be-review1" },
          }),
        );
        assert.strictEqual(
          await authz.check({
            who: { type: "user", id: "engineering-lead" },
            canThey: "manage",
            onWhat: { type: "review", id: "fe-review1" },
          }),
          false,
        );

        await authz.allow({
          who: { type: "user", id: "engineering-lead" },
          toBe: "owner",
          onWhat: { type: "review", id: "fe-review1" },
        });
        await authz.allow({
          who: { type: "user", id: "engineering-lead" },
          toBe: "owner",
          onWhat: { type: "review", id: "be-review1" },
        });

        await authz.disallowAllMatching({
          who: { type: "user", id: "frontend-lead" },
          was: "owner",
          onWhat: { type: "review", id: "fe-review1" },
        });

        await authz.disallowAllMatching({
          who: { type: "user", id: "backend-lead" },
          was: "owner",
          onWhat: { type: "review", id: "be-review1" },
        });
        await authz.allow({
          who: { type: "user", id: "frontend-lead" },
          toBe: "viewer",
          onWhat: { type: "review", id: "fe-review1" },
        });
        await authz.allow({
          who: { type: "user", id: "backend-lead" },
          toBe: "viewer",
          onWhat: { type: "review", id: "be-review1" },
        });

        assert.ok(
          await authz.check({
            who: { type: "user", id: "engineering-lead" },
            canThey: "manage",
            onWhat: { type: "review", id: "fe-review1" },
          }),
          "New Eng Lead manage FE review",
        );
        assert.ok(
          await authz.check({
            who: { type: "user", id: "engineering-lead" },
            canThey: "manage",
            onWhat: { type: "review", id: "be-review1" },
          }),
          "New Eng Lead manage BE review",
        );

        assert.strictEqual(
          await authz.check({
            who: { type: "user", id: "frontend-lead" },
            canThey: "manage",
            onWhat: { type: "review", id: "fe-review1" },
          }),
          false,
          "Old FE Lead cannot manage FE review",
        );
        assert.strictEqual(
          (
            await authz.listTuples({
              subject: { type: "user", id: "frontend-lead" },
              relation: "owner",
              object: { type: "review", id: "fe-review1" },
            })
          ).length,
          0,
          "Old FE Lead owner tuple removed",
        );
        assert.ok(
          await authz.check({
            who: { type: "user", id: "frontend-lead" },
            canThey: "view",
            onWhat: { type: "review", id: "fe-review1" },
          }),
          "Old FE Lead can view FE review",
        );

        assert.strictEqual(
          await authz.check({
            who: { type: "user", id: "backend-lead" },
            canThey: "manage",
            onWhat: { type: "review", id: "be-review1" },
          }),
          false,
          "Old BE Lead cannot manage BE review",
        );
        assert.ok(
          await authz.check({
            who: { type: "user", id: "backend-lead" },
            canThey: "view",
            onWhat: { type: "review", id: "be-review1" },
          }),
          "Old BE Lead can view BE review",
        );
      });

      test("should maintain historical access for completed reviews", async () => {
        assert.ok(
          await authz.check({
            who: { type: "user", id: "frontend-lead" },
            canThey: "manage",
            onWhat: { type: "review", id: "fe-done1" },
          }),
          "Old FE Lead manage historical FE review",
        );
        assert.ok(
          await authz.check({
            who: { type: "user", id: "backend-lead" },
            canThey: "manage",
            onWhat: { type: "review", id: "be-done1" },
          }),
          "Old BE Lead manage historical BE review",
        );
        assert.strictEqual(
          await authz.check({
            who: { type: "user", id: "engineering-lead" },
            canThey: "view",
            onWhat: { type: "review", id: "fe-done1" },
          }),
          false,
          "New Eng Lead cannot view historical FE review initially",
        );

        await authz.allow({
          who: { type: "user", id: "engineering-lead" },
          toBe: "viewer",
          onWhat: { type: "review", id: "fe-done1" },
        });
        await authz.allow({
          who: { type: "user", id: "engineering-lead" },
          toBe: "viewer",
          onWhat: { type: "review", id: "be-done1" },
        });

        assert.ok(
          await authz.check({
            who: { type: "user", id: "frontend-lead" },
            canThey: "manage",
            onWhat: { type: "review", id: "fe-done1" },
          }),
          "Old FE Lead still manages historical FE review",
        );
        assert.ok(
          await authz.check({
            who: { type: "user", id: "backend-lead" },
            canThey: "manage",
            onWhat: { type: "review", id: "be-done1" },
          }),
          "Old BE Lead still manages historical BE review",
        );

        assert.ok(
          await authz.check({
            who: { type: "user", id: "engineering-lead" },
            canThey: "view",
            onWhat: { type: "review", id: "fe-done1" },
          }),
          "New Eng Lead can view historical FE review",
        );
        assert.ok(
          await authz.check({
            who: { type: "user", id: "engineering-lead" },
            canThey: "view",
            onWhat: { type: "review", id: "be-done1" },
          }),
          "New Eng Lead can view historical BE review",
        );
        assert.strictEqual(
          await authz.check({
            who: { type: "user", id: "engineering-lead" },
            canThey: "manage",
            onWhat: { type: "review", id: "fe-done1" },
          }),
          false,
          "New Eng Lead cannot manage historical FE review",
        );
      });

      test("should handle team lead transitions and delegation with time conditions", async () => {
        const condition = { validSince: transitionStart };
        await authz.allow({
          who: { type: "user", id: "engineering-lead" },
          toBe: "owner",
          onWhat: { type: "review", id: "fe-review1" },
          when: condition,
        });

        assert.strictEqual(
          await authz.check({
            who: { type: "user", id: "engineering-lead" },
            canThey: "manage",
            onWhat: { type: "review", id: "fe-review1" },
          }),
          false,
          "Eng Lead cannot manage before transition",
        );

        mock.timers.setTime(new Date("2024-07-02T00:00:00.000Z").getTime());

        assert.ok(
          await authz.check({
            who: { type: "user", id: "engineering-lead" },
            canThey: "manage",
            onWhat: { type: "review", id: "fe-review1" },
          }),
          "Eng Lead can manage after transition",
        );

        const canEngLeadDelegate = await authz.check({
          who: { type: "user", id: "engineering-lead" },
          canThey: "manage_permissions",
          onWhat: { type: "review", id: "fe-review1" },
        });
        assert.ok(
          canEngLeadDelegate,
          "Engineering lead should be able to manage permissions as owner after transition",
        );

        if (canEngLeadDelegate) {
          await authz.allow({
            who: { type: "user", id: "new-eng1" },
            toBe: "viewer",
            onWhat: { type: "review", id: "fe-review1" },
          });
        }

        assert.ok(
          await authz.check({
            who: { type: "user", id: "new-eng1" },
            canThey: "view",
            onWhat: { type: "review", id: "fe-review1" },
          }),
          "Delegated access to newEng1 works",
        );

        await authz.disallowAllMatching({
          who: { type: "user", id: "frontend-lead" },
          was: "owner",
          onWhat: { type: "review", id: "fe-review1" },
        });

        assert.strictEqual(
          await authz.check({
            who: { type: "user", id: "frontend-lead" },
            canThey: "manage",
            onWhat: { type: "review", id: "fe-review1" },
          }),
          false,
          "Old FE Lead cannot manage after ownership revoked",
        );
      });
    });
  });
});
