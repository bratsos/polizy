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
        fieldLevelObjects: ["review"],
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
        storage = new InMemoryStorageAdapter<any, any>();

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

        const managerCanManage = await authz.check({
          who: { type: "user", id: "manager1" },
          canThey: "manage",
          onWhat: { type: "review", id: "cert1" },
        });
        assert.ok(managerCanManage, "Manager should be able to manage");

        const employeeCanViewStrengthsInit = await authz.check({
          who: {
            type: "user",
            id: "employee1",
          },
          canThey: "view",
          onWhat: { type: "review", id: "cert1#strengths" },
        });
        assert.ok(
          employeeCanViewStrengthsInit,
          "Employee should be able to view basic info",
        );

        const employeeCanEditStrengthsInit = await authz.check({
          who: {
            type: "user",
            id: "employee1",
          },
          canThey: "edit",
          onWhat: { type: "review", id: "cert1#strengths" },
        });
        assert.strictEqual(
          employeeCanEditStrengthsInit,
          false,
          "Employee should not be able to edit basic info initially",
        );

        const employeeCanViewStrengthsInit2 = await authz.check({
          who: {
            type: "user",
            id: "employee1",
          },
          canThey: "view",
          onWhat: { type: "review", id: "cert1#strengths" },
        });
        assert.ok(
          employeeCanViewStrengthsInit2,
          "Employee should be able to view strengths initially",
        );

        const employeeCanViewCertInit = await authz.check({
          who: {
            type: "user",
            id: "employee1",
          },
          canThey: "view",
          onWhat: { type: "review", id: "cert1" },
        });
        assert.strictEqual(
          employeeCanViewCertInit,
          false,
          "Employee should not be able to view whole cert initially",
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

        const employeeCanEditStrengthsPrev = await authz.check({
          who: {
            type: "user",
            id: "employee1",
          },
          canThey: "edit",
          onWhat: { type: "review", id: "cert1#strengths" },
        });
        assert.strictEqual(
          employeeCanEditStrengthsPrev,
          false,
          "Employee should not be able to edit basic info",
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
        const employeeCanViewStrengthsBeforeGrant = await authz.check({
          who: {
            type: "user",
            id: "employee1",
          },
          canThey: "view",
          onWhat: { type: "review", id: "cert1#strengths" },
        });
        assert.ok(
          employeeCanViewStrengthsBeforeGrant,
          "Employee should view strengths initially",
        );

        await authz.allow({
          who: { type: "user", id: "employee1" },
          toBe: "editor",
          onWhat: { type: "review", id: "cert1#strengths" },
        });

        const employeeCanViewStrengthsAfterGrant = await authz.check({
          who: {
            type: "user",
            id: "employee1",
          },
          canThey: "view",
          onWhat: { type: "review", id: "cert1#strengths" },
        });
        assert.ok(
          employeeCanViewStrengthsAfterGrant,
          "Employee should now view strengths",
        );
        const employeeCanEditStrengthsAfterGrant = await authz.check({
          who: {
            type: "user",
            id: "employee1",
          },
          canThey: "edit",
          onWhat: { type: "review", id: "cert1#strengths" },
        });
        assert.ok(
          employeeCanEditStrengthsAfterGrant,
          "Employee should now be able to edit strengths",
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

        const employeeCanManageCert = await authz.check({
          who: {
            type: "user",
            id: "employee1",
          },
          canThey: "manage",
          onWhat: { type: "review", id: "cert1" },
        });
        assert.strictEqual(
          employeeCanManageCert,
          false,
          "Employee cannot manage cert",
        );
        const employeeCanViewStrengthsFinal = await authz.check({
          who: {
            type: "user",
            id: "employee1",
          },
          canThey: "view",
          onWhat: { type: "review", id: "cert1#strengths" },
        });
        assert.ok(
          employeeCanViewStrengthsFinal,
          "Employee can still view basic info",
        );
      });
    });
  });
});
