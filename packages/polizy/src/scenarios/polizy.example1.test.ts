import assert from "node:assert/strict";
import { beforeEach, describe, mock, test } from "node:test";
import { InMemoryStorageAdapter } from "../polizy.in-memory.storage.ts";
import { AuthSystem } from "../polizy.ts";
import { defineSchema } from "../types.ts";

let storage: InMemoryStorageAdapter<any, any>;

describe("Authorization Service example scenarios", () => {
  describe("Examples", () => {
    describe("Example 1: Performance Review Setup", () => {
      const example1Schema = defineSchema({
        subjectTypes: ["user"],
        objectTypes: ["review"],
        relations: {
          owner: { type: "direct" },
          viewer: { type: "direct" },
          editor: { type: "direct" },
        },
        actionToRelations: {
          view: ["viewer", "editor", "owner"],
          edit: ["editor", "owner"],
          manage: ["owner"],
          manage_permissions: ["owner"],
        },
      });

      type ExampleAuthSystem = AuthSystem<typeof example1Schema>;

      let authz: ExampleAuthSystem;

      beforeEach(() => {
        storage = new InMemoryStorageAdapter();

        authz = new AuthSystem({ storage, schema: example1Schema });
        mock.reset();
        mock.timers.reset();
      });

      test("should set up initial certificate with correct permissions", async () => {
        await authz.allow({
          who: { type: "user", id: "manager1" },
          toBe: "owner",
          onWhat: { type: "review", id: "cert1" },
        });
        await authz.allow({
          who: {
            type: "user",
            id: "employee1",
          },
          toBe: "viewer",
          onWhat: { type: "review", id: "cert1#strengths" },
        });

        await assert.doesNotReject(
          authz.check({
            who: { type: "user", id: "manager1" },
            canThey: "manage",
            onWhat: { type: "review", id: "cert1" },
          }),
          "Manager should be able to manage",
        );
        assert.ok(
          await authz.check({
            who: { type: "user", id: "manager1" },
            canThey: "manage",
            onWhat: { type: "review", id: "cert1" },
          }),
        );

        await assert.doesNotReject(
          authz.check({
            who: {
              type: "user",
              id: "employee1",
            },
            canThey: "view",
            onWhat: { type: "review", id: "cert1#strengths" },
          }),
          "Employee should be able to view basic info",
        );
        assert.ok(
          await authz.check({
            who: {
              type: "user",
              id: "employee1",
            },
            canThey: "view",
            onWhat: { type: "review", id: "cert1#strengths" },
          }),
        );

        await assert.doesNotReject(
          authz.check({
            who: {
              type: "user",
              id: "employee1",
            },
            canThey: "edit",
            onWhat: { type: "review", id: "cert1#strengths" },
          }),
          "Employee should not be able to edit basic info initially",
        );
        assert.strictEqual(
          await authz.check({
            who: {
              type: "user",
              id: "employee1",
            },
            canThey: "edit",
            onWhat: { type: "review", id: "cert1#strengths" },
          }),
          false,
        );

        await assert.doesNotReject(
          authz.check({
            who: {
              type: "user",
              id: "employee1",
            },
            canThey: "view",
            onWhat: { type: "review", id: "cert1#strengths" },
          }),
          "Employee should be able to view strengths initially",
        );
        assert.ok(
          await authz.check({
            who: {
              type: "user",
              id: "employee1",
            },
            canThey: "view",
            onWhat: { type: "review", id: "cert1#strengths" },
          }),
        );

        await assert.doesNotReject(
          authz.check({
            who: {
              type: "user",
              id: "employee1",
            },
            canThey: "view",
            onWhat: { type: "review", id: "cert1" },
          }),
          "Employee should not be able to view whole cert initially",
        );
        assert.strictEqual(
          await authz.check({
            who: {
              type: "user",
              id: "employee1",
            },
            canThey: "view",
            onWhat: { type: "review", id: "cert1" },
          }),
          false,
        );
      });

      test("should prevent employee from editing before being granted permission", async () => {
        await authz.allow({
          who: { type: "user", id: "manager1" },
          toBe: "owner",
          onWhat: { type: "review", id: "cert1" },
        });
        await authz.allow({
          who: {
            type: "user",
            id: "employee1",
          },
          toBe: "viewer",
          onWhat: { type: "review", id: "cert1#strengths" },
        });

        await assert.doesNotReject(
          authz.check({
            who: {
              type: "user",
              id: "employee1",
            },
            canThey: "edit",
            onWhat: { type: "review", id: "cert1#strengths" },
          }),
          "Employee should not be able to edit basic info",
        );
        assert.strictEqual(
          await authz.check({
            who: {
              type: "user",
              id: "employee1",
            },
            canThey: "edit",
            onWhat: { type: "review", id: "cert1#strengths" },
          }),
          false,
        );
      });

      test("should allow manager to grant additional permissions to employee", async () => {
        await authz.allow({
          who: { type: "user", id: "manager1" },
          toBe: "owner",
          onWhat: { type: "review", id: "cert1" },
        });
        await authz.allow({
          who: {
            type: "user",
            id: "employee1",
          },
          toBe: "viewer",
          onWhat: { type: "review", id: "cert1#strengths" },
        });
        await assert.doesNotReject(
          authz.check({
            who: {
              type: "user",
              id: "employee1",
            },
            canThey: "view",
            onWhat: { type: "review", id: "cert1#strengths" },
          }),
        );
        assert.ok(
          await authz.check({
            who: {
              type: "user",
              id: "employee1",
            },
            canThey: "view",
            onWhat: { type: "review", id: "cert1#strengths" },
          }),
          "Employee should view strengths initially",
        );

        await authz.allow({
          who: { type: "user", id: "employee1" },
          toBe: "editor",
          onWhat: { type: "review", id: "cert1#strengths" },
        });

        await assert.doesNotReject(
          authz.check({
            who: {
              type: "user",
              id: "employee1",
            },
            canThey: "view",
            onWhat: { type: "review", id: "cert1#strengths" },
          }),
          "Employee should now view strengths",
        );
        assert.ok(
          await authz.check({
            who: {
              type: "user",
              id: "employee1",
            },
            canThey: "view",
            onWhat: { type: "review", id: "cert1#strengths" },
          }),
        );
        await assert.doesNotReject(
          authz.check({
            who: {
              type: "user",
              id: "employee1",
            },
            canThey: "edit",
            onWhat: { type: "review", id: "cert1#strengths" },
          }),
          "Employee should now be able to edit strengths",
        );
        assert.ok(
          await authz.check({
            who: {
              type: "user",
              id: "employee1",
            },
            canThey: "edit",
            onWhat: { type: "review", id: "cert1#strengths" },
          }),
        );
      });

      test("should prevent unauthorized users from granting permissions", async () => {
        await authz.allow({
          who: { type: "user", id: "manager1" },
          toBe: "owner",
          onWhat: { type: "review", id: "cert1" },
        });
        await authz.allow({
          who: {
            type: "user",
            id: "employee1",
          },
          toBe: "viewer",
          onWhat: { type: "review", id: "cert1#strengths" },
        });

        await assert.doesNotReject(
          authz.check({
            who: {
              type: "user",
              id: "stranger",
            },
            canThey: "manage_permissions",
            onWhat: { type: "review", id: "cert1" },
          }),
          "Unauthorized user check should not throw",
        );
        const canUnauthorizedGrant = await authz.check({
          who: {
            type: "user",
            id: "stranger",
          },
          canThey: "manage_permissions",
          onWhat: { type: "review", id: "cert1" },
        });
        assert.strictEqual(
          canUnauthorizedGrant,
          false,
          "Unauthorized user cannot grant permissions",
        );

        await assert.doesNotReject(
          authz.check({
            who: {
              type: "user",
              id: "employee1",
            },
            canThey: "manage",
            onWhat: { type: "review", id: "cert1" },
          }),
        );
        assert.strictEqual(
          await authz.check({
            who: {
              type: "user",
              id: "employee1",
            },
            canThey: "manage",
            onWhat: { type: "review", id: "cert1" },
          }),
          false,
          "Employee cannot manage cert",
        );
        await assert.doesNotReject(
          authz.check({
            who: {
              type: "user",
              id: "employee1",
            },
            canThey: "view",
            onWhat: { type: "review", id: "cert1#strengths" },
          }),
        );
        assert.ok(
          await authz.check({
            who: {
              type: "user",
              id: "employee1",
            },
            canThey: "view",
            onWhat: { type: "review", id: "cert1#strengths" },
          }),
          "Employee can still view basic info",
        );
      });
    });
  });
});
