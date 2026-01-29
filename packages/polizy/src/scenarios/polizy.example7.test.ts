import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import { InMemoryStorageAdapter } from "../polizy.in-memory.storage.ts";
import { AuthSystem } from "../polizy.ts";
import { defineSchema } from "../types.ts";

let storage: InMemoryStorageAdapter<any, any>;

describe("Authorization Service example scenarios", () => {
  describe("Examples", () => {
    describe("Example 7: Cross-Team Review Collaboration", () => {
      const example7Schema = defineSchema({
        subjectTypes: ["user", "group"],
        objectTypes: ["review", "group"],
        relations: {
          owner: { type: "direct" },
          lead: { type: "direct" },
          member: { type: "group" },
          editor: { type: "direct" },
          viewer: { type: "direct" },
          cross_team_viewer: { type: "direct" },
          cross_team_editor: { type: "direct" },
        },
        actionToRelations: {
          view: [
            "viewer",
            "editor",
            "owner",
            "lead",
            "cross_team_viewer",
            "cross_team_editor",
          ],
          edit: ["editor", "owner", "lead", "cross_team_editor"],
          manage: ["owner", "lead"],
          manage_permissions: ["owner", "lead"],
          manage_membership: ["owner", "lead"],
        },
      });

      let authz: AuthSystem<typeof example7Schema>;

      beforeEach(async () => {
        storage = new InMemoryStorageAdapter();
        authz = new AuthSystem({ storage, schema: example7Schema });

        await authz.allow({
          who: { type: "user", id: "kate1" },
          toBe: "lead",
          onWhat: { type: "group", id: "product-team" },
        });
        await authz.allow({
          who: { type: "user", id: "kate1" },
          toBe: "lead",
          onWhat: { type: "group", id: "design-team" },
        });
        await authz.allow({
          who: { type: "user", id: "kate1" },
          toBe: "lead",
          onWhat: { type: "group", id: "security-team" },
        });
        await authz.allow({
          who: { type: "user", id: "productLeadId" },
          toBe: "owner",
          onWhat: { type: "review", id: "productReviewId" },
        });
        await authz.addMember({
          member: { type: "user", id: "productMember1" },
          group: { type: "group", id: "product-team" },
        });
        await authz.addMember({
          member: { type: "user", id: "productMember2" },
          group: { type: "group", id: "product-team" },
        });
        await authz.addMember({
          member: { type: "user", id: "designMember1" },
          group: { type: "group", id: "design-team" },
        });
        await authz.addMember({
          member: { type: "user", id: "securityMember1" },
          group: { type: "group", id: "security-team" },
        });
      });

      test("should grant correct access levels for Kate across teams", async () => {
        await authz.allow({
          who: { type: "group", id: "product-team" },
          toBe: "editor",
          onWhat: { type: "review", id: "productReviewId#cross_team_projects" },
        });
        await authz.allow({
          who: { type: "group", id: "design-team" },
          toBe: "editor",
          onWhat: { type: "review", id: "productReviewId#cross_team_projects" },
        });

        await authz.allow({
          who: { type: "user", id: "kate1" },
          toBe: "lead",
          onWhat: { type: "review", id: "productReviewId" },
        });

        assert.ok(
          await authz.check({
            who: { type: "user", id: "kate1" },
            canThey: "edit",
            onWhat: {
              type: "review",
              id: "productReviewId#cross_team_projects",
            },
          }),
        );
        assert.ok(
          await authz.check({
            who: { type: "user", id: "kate1" },
            canThey: "manage",
            onWhat: { type: "review", id: "productReviewId" },
          }),
        );
      });

      test("should respect different team confidentiality requirements", async () => {
        await authz.allow({
          who: { type: "group", id: "security-team" },
          toBe: "cross_team_viewer",
          onWhat: { type: "review", id: "designReviewId#basic_info" },
        });
        await authz.allow({
          who: { type: "group", id: "design-team" },
          toBe: "cross_team_viewer",
          onWhat: { type: "review", id: "securityReviewId#basic_info" },
        });
        await authz.allow({
          who: { type: "group", id: "design-team" },
          toBe: "cross_team_viewer",
          onWhat: {
            type: "review",
            id: "securityReviewId#performance_metrics",
          },
        });

        assert.ok(
          await authz.check({
            who: { type: "user", id: "securityMember1" },
            canThey: "view",
            onWhat: { type: "review", id: "designReviewId#basic_info" },
          }),
        );
        assert.strictEqual(
          await authz.check({
            who: { type: "user", id: "securityMember1" },
            canThey: "view",
            onWhat: {
              type: "review",
              id: "designReviewId#other_section",
            },
          }),
          false,
        );

        assert.ok(
          await authz.check({
            who: { type: "user", id: "designMember1" },
            canThey: "view",
            onWhat: { type: "review", id: "securityReviewId#basic_info" },
          }),
        );
        assert.ok(
          await authz.check({
            who: { type: "user", id: "designMember1" },
            canThey: "view",
            onWhat: {
              type: "review",
              id: "securityReviewId#performance_metrics",
            },
          }),
        );
        assert.strictEqual(
          await authz.check({
            who: { type: "user", id: "designMember1" },
            canThey: "view",
            onWhat: {
              type: "review",
              id: "securityReviewId#confidential_section",
            },
          }),
          false,
        );
      });

      test("should manage shared vs private section permissions correctly", async () => {
        await authz.allow({
          who: { type: "group", id: "product-team" },
          toBe: "viewer",
          onWhat: { type: "review", id: "productReviewId#basic_info" },
        });
        await authz.allow({
          who: { type: "group", id: "design-team" },
          toBe: "viewer",
          onWhat: { type: "review", id: "productReviewId#basic_info" },
        });
        await authz.allow({
          who: { type: "group", id: "security-team" },
          toBe: "viewer",
          onWhat: { type: "review", id: "productReviewId#basic_info" },
        });

        await authz.allow({
          who: { type: "group", id: "product-team" },
          toBe: "editor",
          onWhat: { type: "review", id: "productReviewId#cross_team_projects" },
        });
        await authz.allow({
          who: { type: "group", id: "design-team" },
          toBe: "editor",
          onWhat: { type: "review", id: "productReviewId#cross_team_projects" },
        });
        await authz.allow({
          who: { type: "group", id: "security-team" },
          toBe: "viewer",
          onWhat: { type: "review", id: "productReviewId#cross_team_projects" },
        });

        await authz.allow({
          who: { type: "group", id: "product-team" },
          toBe: "editor",
          onWhat: { type: "review", id: "productReviewId#product_strategy" },
        });

        assert.ok(
          await authz.check({
            who: { type: "user", id: "productMember1" },
            canThey: "view",
            onWhat: { type: "review", id: "productReviewId#basic_info" },
          }),
          "Product member view basic",
        );
        assert.ok(
          await authz.check({
            who: { type: "user", id: "designMember1" },
            canThey: "view",
            onWhat: { type: "review", id: "productReviewId#basic_info" },
          }),
          "Design member view basic",
        );
        assert.ok(
          await authz.check({
            who: { type: "user", id: "securityMember1" },
            canThey: "view",
            onWhat: { type: "review", id: "productReviewId#basic_info" },
          }),
          "Security member view basic",
        );

        assert.ok(
          await authz.check({
            who: { type: "user", id: "productMember1" },
            canThey: "edit",
            onWhat: {
              type: "review",
              id: "productReviewId#cross_team_projects",
            },
          }),
          "Product member edit cross-team",
        );
        assert.ok(
          await authz.check({
            who: { type: "user", id: "designMember1" },
            canThey: "edit",
            onWhat: {
              type: "review",
              id: "productReviewId#cross_team_projects",
            },
          }),
          "Design member edit cross-team",
        );
        assert.strictEqual(
          await authz.check({
            who: { type: "user", id: "securityMember1" },
            canThey: "edit",
            onWhat: {
              type: "review",
              id: "productReviewId#cross_team_projects",
            },
          }),
          false,
          "Security member cannot edit cross-team",
        );
        assert.ok(
          await authz.check({
            who: { type: "user", id: "securityMember1" },
            canThey: "view",
            onWhat: {
              type: "review",
              id: "productReviewId#cross_team_projects",
            },
          }),
          "Security member view cross-team",
        );

        assert.ok(
          await authz.check({
            who: { type: "user", id: "productMember1" },
            canThey: "edit",
            onWhat: { type: "review", id: "productReviewId#product_strategy" },
          }),
          "Product member edit strategy",
        );
        assert.strictEqual(
          await authz.check({
            who: { type: "user", id: "designMember1" },
            canThey: "view",
            onWhat: { type: "review", id: "productReviewId#product_strategy" },
          }),
          false,
          "Design member cannot view strategy",
        );
        assert.strictEqual(
          await authz.check({
            who: { type: "user", id: "securityMember1" },
            canThey: "view",
            onWhat: { type: "review", id: "productReviewId#product_strategy" },
          }),
          false,
          "Security member cannot view strategy",
        );
      });

      test("should handle changes in team structures and permissions", async () => {
        await authz.allow({
          who: { type: "group", id: "product-team" },
          toBe: "editor",
          onWhat: { type: "review", id: "productReviewId" },
        });
        await authz.allow({
          who: { type: "group", id: "design-team" },
          toBe: "viewer",
          onWhat: { type: "review", id: "productReviewId" },
        });
        await authz.allow({
          who: { type: "group", id: "security-team" },
          toBe: "viewer",
          onWhat: { type: "review", id: "productReviewId" },
        });

        assert.ok(
          await authz.check({
            who: { type: "user", id: "productMember2" },
            canThey: "edit",
            onWhat: { type: "review", id: "productReviewId" },
          }),
          "Initial: Product member edit",
        );
        assert.ok(
          await authz.check({
            who: { type: "user", id: "securityMember1" },
            canThey: "view",
            onWhat: { type: "review", id: "productReviewId" },
          }),
          "Initial: Security member view",
        );
        assert.strictEqual(
          await authz.check({
            who: { type: "user", id: "securityMember1" },
            canThey: "edit",
            onWhat: { type: "review", id: "productReviewId" },
          }),
          false,
          "Initial: Security member cannot edit",
        );

        await authz.removeMember({
          member: { type: "user", id: "productMember2" },
          group: { type: "group", id: "product-team" },
        });
        await authz.addMember({
          member: { type: "user", id: "productMember2" },
          group: { type: "group", id: "design-team" },
        });

        assert.strictEqual(
          await authz.check({
            who: { type: "user", id: "productMember2" },
            canThey: "edit",
            onWhat: { type: "review", id: "productReviewId" },
          }),
          false,
          "After move: Former product member cannot edit",
        );
        assert.ok(
          await authz.check({
            who: { type: "user", id: "productMember2" },
            canThey: "view",
            onWhat: { type: "review", id: "productReviewId" },
          }),
          "After move: Now design member can view",
        );

        await authz.disallowAllMatching({
          who: { type: "group", id: "security-team" },
          was: "viewer",
          onWhat: { type: "review", id: "productReviewId" },
        });

        assert.strictEqual(
          await authz.check({
            who: { type: "user", id: "securityMember1" },
            canThey: "view",
            onWhat: { type: "review", id: "productReviewId" },
          }),
          false,
          "After revoke: Security member cannot view",
        );
      });
    });
  });
});
