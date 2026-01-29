import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, mock, test } from "node:test";
import { InMemoryStorageAdapter } from "../polizy.in-memory.storage.ts";
import { AuthSystem } from "../polizy.ts";
import { defineSchema } from "../types.ts";

let storage: InMemoryStorageAdapter<any, any>;

describe("Authorization Service example scenarios", () => {
  describe("Examples", () => {
    describe("Example 6: Step-by-Step Review Process", () => {
      const example6Schema = defineSchema({
        subjectTypes: ["user"],
        objectTypes: ["review"],
        relations: {
          owner: { type: "direct" },
          employee: { type: "direct" },
          viewer: { type: "direct" },
          editor: { type: "direct" },
          peer_reviewer: { type: "direct" },
          hr_finalizer: { type: "direct" },
        },
        actionToRelations: {
          view: ["viewer", "editor", "owner", "peer_reviewer", "hr_finalizer"],
          edit: ["editor", "owner", "peer_reviewer", "hr_finalizer"],
          manage: ["owner"],
          manage_permissions: ["owner"],
          edit_self_assessment: ["editor", "owner", "employee"],
          edit_manager_assessment: ["owner"],
          edit_peer_feedback: ["peer_reviewer", "owner"],
          edit_hr_assessment: ["hr_finalizer", "owner"],
          finalize_review: ["hr_finalizer", "owner"],
        },
      });

      let authz: AuthSystem<typeof example6Schema>;
      let now: Date;
      let peerEndDate: Date;

      beforeEach(async () => {
        storage = new InMemoryStorageAdapter();
        authz = new AuthSystem({ storage, schema: example6Schema });
        await authz.allow({
          who: { type: "user", id: "manager1" },
          toBe: "owner",
          onWhat: { type: "review", id: "review1" },
        });
        await authz.allow({
          who: { type: "user", id: "anna1" },
          toBe: "employee",
          onWhat: { type: "review", id: "review1" },
        });

        now = new Date("2024-06-01T12:00:00.000Z");
        peerEndDate = new Date("2024-06-15T12:00:00.000Z");
        mock.timers.enable({ apis: ["Date"], now: now.getTime() });
      });

      afterEach(() => {
        mock.timers.reset();
      });

      test("should grant initial limited visibility to employee (Anna)", async () => {
        await authz.allow({
          who: { type: "user", id: "anna1" },
          toBe: "viewer",
          onWhat: { type: "review", id: "review1#basic_info" },
        });
        await authz.allow({
          who: { type: "user", id: "anna1" },
          toBe: "viewer",
          onWhat: { type: "review", id: "review1#objectives" },
        });

        assert.ok(
          await authz.check({
            who: { type: "user", id: "anna1" },
            canThey: "view",
            onWhat: { type: "review", id: "review1#basic_info" },
          }),
        );
        assert.ok(
          await authz.check({
            who: { type: "user", id: "anna1" },
            canThey: "view",
            onWhat: { type: "review", id: "review1#objectives" },
          }),
        );
        assert.strictEqual(
          await authz.check({
            who: { type: "user", id: "anna1" },
            canThey: "view",
            onWhat: { type: "review", id: "review1#self_assessment" },
          }),
          false,
        );
        assert.strictEqual(
          await authz.check({
            who: { type: "user", id: "anna1" },
            canThey: "edit",
            onWhat: { type: "review", id: "review1#basic_info" },
          }),
          false,
        );
      });

      test("should enable self-assessment section when appropriate", async () => {
        await authz.allow({
          who: { type: "user", id: "anna1" },
          toBe: "viewer",
          onWhat: { type: "review", id: "review1#basic_info" },
        });

        await authz.allow({
          who: { type: "user", id: "anna1" },
          toBe: "editor",
          onWhat: { type: "review", id: "review1#self_assessment" },
        });

        assert.ok(
          await authz.check({
            who: { type: "user", id: "anna1" },
            canThey: "view",
            onWhat: { type: "review", id: "review1#self_assessment" },
          }),
        );
        assert.ok(
          await authz.check({
            who: { type: "user", id: "anna1" },
            canThey: "edit",
            onWhat: { type: "review", id: "review1#self_assessment" },
          }),
        );
        assert.ok(
          await authz.check({
            who: { type: "user", id: "anna1" },
            canThey: "edit_self_assessment",
            onWhat: { type: "review", id: "review1#self_assessment" },
          }),
        );

        assert.strictEqual(
          await authz.check({
            who: { type: "user", id: "anna1" },
            canThey: "view",
            onWhat: { type: "review", id: "review1#manager_assessment" },
          }),
          false,
        );
      });

      test("should grant manager access after self-assessment completion (concept)", async () => {
        assert.ok(
          await authz.check({
            who: { type: "user", id: "manager1" },
            canThey: "edit_manager_assessment",
            onWhat: { type: "review", id: "review1#manager_assessment" },
          }),
        );

        await authz.allow({
          who: { type: "user", id: "anna1" },
          toBe: "editor",
          onWhat: { type: "review", id: "review1#self_assessment" },
        });

        assert.strictEqual(
          await authz.check({
            who: { type: "user", id: "anna1" },
            canThey: "view",
            onWhat: { type: "review", id: "review1#manager_assessment" },
          }),
          false,
        );
      });

      test("should grant temporary peer reviewer access", async () => {
        await authz.allow({
          who: { type: "user", id: "anna1" },
          toBe: "viewer",
          onWhat: { type: "review", id: "review1#self_assessment" },
        });

        const condition = { validSince: now, validUntil: peerEndDate };
        await authz.allow({
          who: { type: "user", id: "peer1" },
          toBe: "peer_reviewer",
          onWhat: { type: "review", id: "review1#peer_feedback" },
          when: condition,
        });
        await authz.allow({
          who: { type: "user", id: "peer1" },
          toBe: "viewer",
          onWhat: { type: "review", id: "review1#self_assessment" },
          when: condition,
        });

        mock.timers.setTime(new Date("2024-06-10T12:00:00.000Z").getTime());
        assert.ok(
          await authz.check({
            who: { type: "user", id: "peer1" },
            canThey: "edit_peer_feedback",
            onWhat: { type: "review", id: "review1#peer_feedback" },
          }),
        );
        assert.ok(
          await authz.check({
            who: { type: "user", id: "peer1" },
            canThey: "view",
            onWhat: { type: "review", id: "review1#self_assessment" },
          }),
        );
        assert.strictEqual(
          await authz.check({
            who: { type: "user", id: "peer1" },
            canThey: "view",
            onWhat: { type: "review", id: "review1#manager_assessment" },
          }),
          false,
        );

        mock.timers.setTime(new Date("2024-06-16T12:00:00.000Z").getTime());
        assert.strictEqual(
          await authz.check({
            who: { type: "user", id: "peer1" },
            canThey: "edit_peer_feedback",
            onWhat: { type: "review", id: "review1#peer_feedback" },
          }),
          false,
        );
        assert.strictEqual(
          await authz.check({
            who: { type: "user", id: "peer1" },
            canThey: "view",
            onWhat: { type: "review", id: "review1#self_assessment" },
          }),
          false,
        );
      });

      test("should grant final HR access", async () => {
        await authz.allow({
          who: { type: "user", id: "hr1" },
          toBe: "viewer",
          onWhat: { type: "review", id: "review1" },
        });
        await authz.allow({
          who: { type: "user", id: "hr1" },
          toBe: "hr_finalizer",
          onWhat: { type: "review", id: "review1" },
        });

        assert.ok(
          await authz.check({
            who: { type: "user", id: "hr1" },
            canThey: "view",
            onWhat: { type: "review", id: "review1" },
          }),
        );
        assert.ok(
          await authz.check({
            who: { type: "user", id: "hr1" },
            canThey: "view",
            onWhat: { type: "review", id: "review1#self_assessment" },
          }),
        );
        assert.ok(
          await authz.check({
            who: { type: "user", id: "hr1" },
            canThey: "view",
            onWhat: { type: "review", id: "review1#manager_assessment" },
          }),
        );
        assert.ok(
          await authz.check({
            who: { type: "user", id: "hr1" },
            canThey: "edit_hr_assessment",
            onWhat: { type: "review", id: "review1#hr_assessment" },
          }),
        );
        assert.ok(
          await authz.check({
            who: { type: "user", id: "hr1" },
            canThey: "finalize_review",
            onWhat: { type: "review", id: "review1" },
          }),
        );
        assert.strictEqual(
          await authz.check({
            who: { type: "user", id: "hr1" },
            canThey: "edit_manager_assessment",
            onWhat: { type: "review", id: "review1#manager_assessment" },
          }),
          false,
        );
      });

      test("should block access to sections not yet available", async () => {
        await authz.allow({
          who: { type: "user", id: "anna1" },
          toBe: "viewer",
          onWhat: { type: "review", id: "review1#basic_info" },
        });

        assert.strictEqual(
          await authz.check({
            who: { type: "user", id: "anna1" },
            canThey: "view",
            onWhat: { type: "review", id: "review1#self_assessment" },
          }),
          false,
        );
        assert.strictEqual(
          await authz.check({
            who: { type: "user", id: "anna1" },
            canThey: "edit",
            onWhat: { type: "review", id: "review1#self_assessment" },
          }),
          false,
        );
        assert.strictEqual(
          await authz.check({
            who: { type: "user", id: "anna1" },
            canThey: "view",
            onWhat: { type: "review", id: "review1#manager_assessment" },
          }),
          false,
        );
        assert.strictEqual(
          await authz.check({
            who: { type: "user", id: "anna1" },
            canThey: "view",
            onWhat: { type: "review", id: "review1#peer_feedback" },
          }),
          false,
        );

        const canAnnaGrant = await authz.check({
          who: { type: "user", id: "anna1" },
          canThey: "manage_permissions",
          onWhat: { type: "review", id: "review1" },
        });
        assert.strictEqual(canAnnaGrant, false);
      });
    });
  });
});
