import { describe, test, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { AuthSystem } from "../polizy.ts";
import { InMemoryStorageAdapter } from "../polizy.in-memory.storage.ts";
import { defineSchema } from "../types.ts";

let storage: InMemoryStorageAdapter<any, any>;

describe("Authorization Service example scenarios", () => {
  describe("Examples", () => {
    describe("Example 3: Extended Leave Coverage", () => {
      const example3Schema = defineSchema({
        subjectTypes: ["user"],
        objectTypes: ["review"],
        relations: {
          owner: { type: "direct" },
          manager: { type: "direct" },
          viewer: { type: "direct" },
          editor: { type: "direct" },
        },
        actionToRelations: {
          view: ["viewer", "manager", "owner"],
          edit: ["editor", "manager", "owner"],
          manage: ["manager", "owner"],
          manage_permissions: ["manager", "owner"],
        },
      });

      let authz: AuthSystem<typeof example3Schema>;

      let now: Date;
      let threeMonthsLater: Date;
      let fourMonthsLater: Date;

      beforeEach(async () => {
        storage = new InMemoryStorageAdapter();
        authz = new AuthSystem({ storage, schema: example3Schema });

        await authz.allow({
          who: { type: "user", id: "jennifer1" },
          toBe: "owner",
          onWhat: { type: "review", id: "reviewId1" },
        });
        await authz.allow({
          who: { type: "user", id: "jennifer1" },
          toBe: "owner",
          onWhat: { type: "review", id: "reviewId2" },
        });

        now = new Date("2024-06-01T12:00:00.000Z");
        threeMonthsLater = new Date("2024-09-01T12:00:00.000Z");
        fourMonthsLater = new Date("2024-10-01T12:00:00.000Z");
        mock.timers.enable({
          apis: ["Date", "setTimeout", "setInterval", "setImmediate"],
          now: now.getTime(),
        });
      });

      afterEach(() => {
        mock.timers.reset();
      });

      test("should grant temporary access to covering manager (Michael)", async () => {
        const condition = { validSince: now, validUntil: threeMonthsLater };
        await authz.allow({
          who: { type: "user", id: "michael1" },
          toBe: "manager",
          onWhat: { type: "review", id: "reviewId1" },
          when: condition,
        });
        await authz.allow({
          who: { type: "user", id: "michael1" },
          toBe: "manager",
          onWhat: { type: "review", id: "reviewId2" },
          when: condition,
        });

        assert.ok(
          await authz.check({
            who: { type: "user", id: "michael1" },
            canThey: "manage",
            onWhat: { type: "review", id: "reviewId1" },
          }),
        );
        assert.ok(
          await authz.check({
            who: { type: "user", id: "michael1" },
            canThey: "manage",
            onWhat: { type: "review", id: "reviewId2" },
          }),
        );
      });

      test("should maintain original manager's (Jennifer) access unchanged", async () => {
        const condition = { validSince: now, validUntil: threeMonthsLater };
        await authz.allow({
          who: { type: "user", id: "michael1" },
          toBe: "manager",
          onWhat: { type: "review", id: "reviewId1" },
          when: condition,
        });

        assert.ok(
          await authz.check({
            who: { type: "user", id: "jennifer1" },
            canThey: "manage",
            onWhat: { type: "review", id: "reviewId1" },
          }),
        );

        const canMichaelManage = await authz.check({
          who: { type: "user", id: "michael1" },
          canThey: "manage_permissions",
          onWhat: { type: "review", id: "reviewId1" },
        });
        assert.ok(canMichaelManage);

        assert.ok(
          await authz.check({
            who: { type: "user", id: "jennifer1" },
            canThey: "manage",
            onWhat: { type: "review", id: "reviewId1" },
          }),
        );
      });

      test("should automatically expire Michael's access after three months", async () => {
        const condition = { validSince: now, validUntil: threeMonthsLater };
        await authz.allow({
          who: { type: "user", id: "michael1" },
          toBe: "manager",
          onWhat: { type: "review", id: "reviewId1" },
          when: condition,
        });

        mock.timers.setTime(new Date("2024-07-01T12:00:00.000Z").getTime());
        assert.ok(
          await authz.check({
            who: { type: "user", id: "michael1" },
            canThey: "manage",
            onWhat: { type: "review", id: "reviewId1" },
          }),
        );

        mock.timers.setTime(threeMonthsLater.getTime());
        assert.strictEqual(
          await authz.check({
            who: { type: "user", id: "michael1" },
            canThey: "manage",
            onWhat: { type: "review", id: "reviewId1" },
          }),
          false,
        );

        mock.timers.setTime(fourMonthsLater.getTime());
        assert.strictEqual(
          await authz.check({
            who: { type: "user", id: "michael1" },
            canThey: "manage",
            onWhat: { type: "review", id: "reviewId1" },
          }),
          false,
        );
      });

      test("should block Michael's access after expiration date", async () => {
        const condition = { validSince: now, validUntil: threeMonthsLater };
        await authz.allow({
          who: { type: "user", id: "michael1" },
          toBe: "manager",
          onWhat: { type: "review", id: "reviewId1" },
          when: condition,
        });

        mock.timers.setTime(fourMonthsLater.getTime());

        assert.strictEqual(
          await authz.check({
            who: { type: "user", id: "michael1" },
            canThey: "manage",
            onWhat: { type: "review", id: "reviewId1" },
          }),
          false,
        );

        const canMichaelGrantExpired = await authz.check({
          who: { type: "user", id: "michael1" },
          canThey: "manage_permissions",
          onWhat: { type: "review", id: "reviewId1" },
        });
        assert.strictEqual(canMichaelGrantExpired, false);
      });

      test("should handle multiple reviews under temporary coverage", async () => {
        const condition = { validSince: now, validUntil: threeMonthsLater };
        await authz.allow({
          who: { type: "user", id: "michael1" },
          toBe: "manager",
          onWhat: { type: "review", id: "reviewId1" },
          when: condition,
        });
        await authz.allow({
          who: { type: "user", id: "michael1" },
          toBe: "manager",
          onWhat: { type: "review", id: "reviewId2" },
          when: condition,
        });

        mock.timers.setTime(new Date("2024-07-01T12:00:00.000Z").getTime());
        assert.ok(
          await authz.check({
            who: { type: "user", id: "michael1" },
            canThey: "manage",
            onWhat: { type: "review", id: "reviewId1" },
          }),
        );
        assert.ok(
          await authz.check({
            who: { type: "user", id: "michael1" },
            canThey: "manage",
            onWhat: { type: "review", id: "reviewId2" },
          }),
        );

        mock.timers.setTime(fourMonthsLater.getTime());
        assert.strictEqual(
          await authz.check({
            who: { type: "user", id: "michael1" },
            canThey: "manage",
            onWhat: { type: "review", id: "reviewId1" },
          }),
          false,
        );
        assert.strictEqual(
          await authz.check({
            who: { type: "user", id: "michael1" },
            canThey: "manage",
            onWhat: { type: "review", id: "reviewId2" },
          }),
          false,
        );

        assert.ok(
          await authz.check({
            who: { type: "user", id: "jennifer1" },
            canThey: "manage",
            onWhat: { type: "review", id: "reviewId1" },
          }),
        );
        assert.ok(
          await authz.check({
            who: { type: "user", id: "jennifer1" },
            canThey: "manage",
            onWhat: { type: "review", id: "reviewId2" },
          }),
        );
      });
    });
  });
});
