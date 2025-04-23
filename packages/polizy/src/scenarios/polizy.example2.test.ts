import { describe, test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { AuthSystem } from "../polizy.ts";
import { InMemoryStorageAdapter } from "../polizy.in-memory.storage.ts";
import { defineSchema } from "../types.ts";

let storage: InMemoryStorageAdapter<any, any>;

describe("Authorization Service example scenarios", () => {
  describe("Examples", () => {
    describe("Example 2: Multi-Person Certificate Review", () => {
      const example2Schema = defineSchema({
        subjectTypes: ["user"],
        objectTypes: ["review"],
        relations: {
          owner: { type: "direct" },
          tech_lead: { type: "direct" },
          project_lead: { type: "direct" },
          viewer: { type: "direct" },
          editor: { type: "direct" },
        },
        actionToRelations: {
          view: ["viewer", "editor", "tech_lead", "project_lead", "owner"],
          edit: ["editor", "tech_lead", "project_lead", "owner"],
          manage: ["owner"],
          manage_permissions: ["owner"],
          edit_technical_skills: ["tech_lead", "owner"],
          edit_leadership_skills: ["project_lead", "owner"],
        },
      });

      let authz: AuthSystem<typeof example2Schema>;

      beforeEach(async () => {
        storage = new InMemoryStorageAdapter();
        authz = new AuthSystem({ storage, schema: example2Schema });
        await authz.allow({
          who: { type: "user", id: "david1" },
          toBe: "owner",
          onWhat: { type: "review", id: "reviewCert1" },
        });
      });

      test("should grant full access to department head (David)", async () => {
        assert.ok(
          await authz.check({
            who: { type: "user", id: "david1" },
            canThey: "manage",
            onWhat: { type: "review", id: "reviewCert1" },
          }),
        );
        assert.ok(
          await authz.check({
            who: { type: "user", id: "david1" },
            canThey: "edit",
            onWhat: { type: "review", id: "reviewCert1#technical_skills" },
          }),
        );
        assert.ok(
          await authz.check({
            who: { type: "user", id: "david1" },
            canThey: "view",
            onWhat: { type: "review", id: "reviewCert1#leadership_skills" },
          }),
        );
      });

      test("should grant technical lead (Rachel) access to technical assessment only", async () => {
        await authz.allow({
          who: { type: "user", id: "rachel1" },
          toBe: "tech_lead",
          onWhat: { type: "review", id: "reviewCert1#technical_skills" },
        });
        await authz.allow({
          who: { type: "user", id: "rachel1" },
          toBe: "viewer",
          onWhat: { type: "review", id: "cert1#strengths" },
        });
        assert.ok(
          await authz.check({
            who: { type: "user", id: "rachel1" },
            canThey: "edit_technical_skills",
            onWhat: { type: "review", id: "reviewCert1#technical_skills" },
          }),
        );
        assert.ok(
          await authz.check({
            who: { type: "user", id: "rachel1" },
            canThey: "view",
            onWhat: { type: "review", id: "reviewCert1#technical_skills" },
          }),
        );
        assert.ok(
          await authz.check({
            who: { type: "user", id: "rachel1" },
            canThey: "view",
            onWhat: { type: "review", id: "cert1#strengths" },
          }),
        );

        assert.strictEqual(
          await authz.check({
            who: { type: "user", id: "rachel1" },
            canThey: "view",
            onWhat: { type: "review", id: "reviewCert1#leadership_skills" },
          }),
          false,
        );
        assert.strictEqual(
          await authz.check({
            who: { type: "user", id: "rachel1" },
            canThey: "edit_leadership_skills",
            onWhat: { type: "review", id: "reviewCert1#leadership_skills" },
          }),
          false,
        );
        assert.strictEqual(
          await authz.check({
            who: { type: "user", id: "rachel1" },
            canThey: "manage",
            onWhat: { type: "review", id: "reviewCert1" },
          }),
          false,
        );
      });

      test("should grant project lead (James) access to leadership assessment only", async () => {
        await authz.allow({
          who: { type: "user", id: "james1" },
          toBe: "project_lead",
          onWhat: { type: "review", id: "reviewCert1#leadership_skills" },
        });
        await authz.allow({
          who: { type: "user", id: "james1" },
          toBe: "viewer",
          onWhat: { type: "review", id: "cert1#strengths" },
        });

        assert.ok(
          await authz.check({
            who: { type: "user", id: "james1" },
            canThey: "edit_leadership_skills",
            onWhat: { type: "review", id: "reviewCert1#leadership_skills" },
          }),
        );
        assert.ok(
          await authz.check({
            who: { type: "user", id: "james1" },
            canThey: "view",
            onWhat: { type: "review", id: "reviewCert1#leadership_skills" },
          }),
        );
        assert.ok(
          await authz.check({
            who: { type: "user", id: "james1" },
            canThey: "view",
            onWhat: { type: "review", id: "cert1#strengths" },
          }),
        );

        assert.strictEqual(
          await authz.check({
            who: { type: "user", id: "james1" },
            canThey: "view",
            onWhat: { type: "review", id: "reviewCert1#technical_skills" },
          }),
          false,
        );
        assert.strictEqual(
          await authz.check({
            who: { type: "user", id: "james1" },
            canThey: "edit_technical_skills",
            onWhat: { type: "review", id: "reviewCert1#technical_skills" },
          }),
          false,
        );
        assert.strictEqual(
          await authz.check({
            who: { type: "user", id: "james1" },
            canThey: "manage",
            onWhat: { type: "review", id: "reviewCert1" },
          }),
          false,
        );
      });

      test("should allow Rachel and James to view each other's assessments if granted broad view", async () => {
        await authz.allow({
          who: { type: "user", id: "rachel1" },
          toBe: "tech_lead",
          onWhat: { type: "review", id: "reviewCert1#technical_skills" },
        });
        await authz.allow({
          who: { type: "user", id: "james1" },
          toBe: "project_lead",
          onWhat: { type: "review", id: "reviewCert1#leadership_skills" },
        });
        await authz.allow({
          who: { type: "user", id: "rachel1" },
          toBe: "viewer",
          onWhat: { type: "review", id: "reviewCert1" },
        });
        await authz.allow({
          who: { type: "user", id: "james1" },
          toBe: "viewer",
          onWhat: { type: "review", id: "reviewCert1" },
        });

        assert.ok(
          await authz.check({
            who: { type: "user", id: "rachel1" },
            canThey: "view",
            onWhat: { type: "review", id: "reviewCert1#leadership_skills" },
          }),
        );
        assert.ok(
          await authz.check({
            who: { type: "user", id: "james1" },
            canThey: "view",
            onWhat: { type: "review", id: "reviewCert1#technical_skills" },
          }),
        );
      });

      test("should block Rachel from editing leadership sections", async () => {
        await authz.allow({
          who: { type: "user", id: "rachel1" },
          toBe: "tech_lead",
          onWhat: { type: "review", id: "reviewCert1#technical_skills" },
        });
        await authz.allow({
          who: { type: "user", id: "rachel1" },
          toBe: "viewer",
          onWhat: { type: "review", id: "reviewCert1" },
        });

        assert.strictEqual(
          await authz.check({
            who: { type: "user", id: "rachel1" },
            canThey: "edit",
            onWhat: { type: "review", id: "reviewCert1#leadership_skills" },
          }),
          false,
        );
        assert.strictEqual(
          await authz.check({
            who: { type: "user", id: "rachel1" },
            canThey: "edit_leadership_skills",
            onWhat: { type: "review", id: "reviewCert1#leadership_skills" },
          }),
          false,
        );

        const canRachelGrant = await authz.check({
          who: { type: "user", id: "rachel1" },
          canThey: "manage_permissions",
          onWhat: { type: "review", id: "reviewCert1" },
        });
        assert.strictEqual(canRachelGrant, false);
      });

      test("should block James from editing technical sections", async () => {
        await authz.allow({
          who: { type: "user", id: "james1" },
          toBe: "project_lead",
          onWhat: { type: "review", id: "reviewCert1#leadership_skills" },
        });
        await authz.allow({
          who: { type: "user", id: "james1" },
          toBe: "viewer",
          onWhat: { type: "review", id: "reviewCert1" },
        });

        assert.strictEqual(
          await authz.check({
            who: { type: "user", id: "james1" },
            canThey: "edit",
            onWhat: { type: "review", id: "reviewCert1#technical_skills" },
          }),
          false,
        );
        assert.strictEqual(
          await authz.check({
            who: { type: "user", id: "james1" },
            canThey: "edit_technical_skills",
            onWhat: { type: "review", id: "reviewCert1#technical_skills" },
          }),
          false,
        );

        const canJamesGrant = await authz.check({
          who: { type: "user", id: "james1" },
          canThey: "manage_permissions",
          onWhat: { type: "review", id: "reviewCert1" },
        });
        assert.strictEqual(canJamesGrant, false);
      });

      test("should grant Maria limited initial access", async () => {
        await authz.allow({
          who: { type: "user", id: "maria1" },
          toBe: "viewer",
          onWhat: { type: "review", id: "cert1#strengths" },
        });

        assert.ok(
          await authz.check({
            who: { type: "user", id: "maria1" },
            canThey: "view",
            onWhat: { type: "review", id: "cert1#strengths" },
          }),
        );
        assert.strictEqual(
          await authz.check({
            who: { type: "user", id: "maria1" },
            canThey: "edit",
            onWhat: { type: "review", id: "cert1#strengths" },
          }),
          false,
        );
        assert.strictEqual(
          await authz.check({
            who: { type: "user", id: "maria1" },
            canThey: "view",
            onWhat: { type: "review", id: "reviewCert1#technical_skills" },
          }),
          false,
        );
        assert.strictEqual(
          await authz.check({
            who: { type: "user", id: "maria1" },
            canThey: "view",
            onWhat: { type: "review", id: "reviewCert1#leadership_skills" },
          }),
          false,
        );
        assert.strictEqual(
          await authz.check({
            who: { type: "user", id: "maria1" },
            canThey: "manage",
            onWhat: { type: "review", id: "reviewCert1" },
          }),
          false,
        );
      });

      test("should prevent non-managers from granting visibility to Maria", async () => {
        await authz.allow({
          who: { type: "user", id: "rachel1" },
          toBe: "tech_lead",
          onWhat: { type: "review", id: "reviewCert1#technical_skills" },
        });
        await authz.allow({
          who: { type: "user", id: "james1" },
          toBe: "project_lead",
          onWhat: { type: "review", id: "reviewCert1#leadership_skills" },
        });
        await authz.allow({
          who: { type: "user", id: "maria1" },
          toBe: "viewer",
          onWhat: { type: "review", id: "cert1#strengths" },
        });

        assert.strictEqual(
          await authz.check({
            who: { type: "user", id: "rachel1" },
            canThey: "manage_permissions",
            onWhat: { type: "review", id: "reviewCert1" },
          }),
          false,
        );
        assert.strictEqual(
          await authz.check({
            who: { type: "user", id: "james1" },
            canThey: "manage_permissions",
            onWhat: { type: "review", id: "reviewCert1" },
          }),
          false,
        );

        assert.strictEqual(
          await authz.check({
            who: { type: "user", id: "maria1" },
            canThey: "view",
            onWhat: { type: "review", id: "reviewCert1#technical_skills" },
          }),
          false,
        );
      });

      test("should allow David to grant full visibility to Maria after completion", async () => {
        await authz.allow({
          who: { type: "user", id: "maria1" },
          toBe: "viewer",
          onWhat: { type: "review", id: "cert1#strengths" },
        });

        await authz.allow({
          who: { type: "user", id: "maria1" },
          toBe: "viewer",
          onWhat: { type: "review", id: "reviewCert1" },
        });

        assert.ok(
          await authz.check({
            who: { type: "user", id: "maria1" },
            canThey: "view",
            onWhat: { type: "review", id: "cert1#strengths" },
          }),
        );
        assert.ok(
          await authz.check({
            who: { type: "user", id: "maria1" },
            canThey: "view",
            onWhat: { type: "review", id: "reviewCert1#technical_skills" },
          }),
        );
        assert.ok(
          await authz.check({
            who: { type: "user", id: "maria1" },
            canThey: "view",
            onWhat: { type: "review", id: "reviewCert1#leadership_skills" },
          }),
        );
        assert.strictEqual(
          await authz.check({
            who: { type: "user", id: "maria1" },
            canThey: "edit",
            onWhat: { type: "review", id: "reviewCert1#technical_skills" },
          }),
          false,
        );
        assert.strictEqual(
          await authz.check({
            who: { type: "user", id: "maria1" },
            canThey: "manage",
            onWhat: { type: "review", id: "reviewCert1" },
          }),
          false,
        );
      });
    });
  });
});
