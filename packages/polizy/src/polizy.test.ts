import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";

import { AuthSystem } from "./polizy.ts";
import { InMemoryStorageAdapter } from "./polizy.in-memory.storage.ts";
import type { StorageAdapter } from "./polizy.storage.ts";
import { defineSchema } from "./types.ts";
import { ConfigurationError } from "./errors.ts";

type TestSubjectType = "user" | "group";
type TestObjectType = "doc" | "folder" | "org" | "group" | "system";

describe("AuthSystem Core Tests", () => {
  let storage: InMemoryStorageAdapter<TestSubjectType, TestObjectType>;
  let authSystem: AuthSystem<any>;

  const commonSchema = defineSchema({
    relations: {
      member: { type: "group" },
      co_owner: { type: "group" },
      parent: { type: "hierarchy" },
      editor: { type: "direct" },
      viewer: { type: "direct" },
      owner: { type: "direct" },
      manager: { type: "direct" },
    },
    actionToRelations: {
      edit: ["editor", "owner", "manager"],
      view: ["viewer", "editor", "owner", "manager"],
      delete: ["owner"],
      read: ["member"],
    },
    hierarchyPropagation: {
      view: ["view"],
      edit: ["edit"],
      delete: ["delete"],
      read: [],
    },
    subjectTypes: ["user", "group"],
    objectTypes: ["doc", "folder", "org", "group", "system"],
  });

  beforeEach(() => {
    storage = new InMemoryStorageAdapter<TestSubjectType, TestObjectType>();
    authSystem = new AuthSystem({ storage, schema: commonSchema });
    mock.reset();
    mock.timers.reset();
  });

  describe("Constructor", () => {
    const minimalSchema = defineSchema({
      relations: {},
      actionToRelations: {},
    });

    it("should initialize successfully with valid config", () => {
      const authSystem = new AuthSystem<typeof minimalSchema>({
        storage,
        schema: minimalSchema,
      });
      assert.ok(authSystem instanceof AuthSystem);
    });

    it("should throw ConfigurationError if storage adapter is missing", () => {
      assert.throws(
        () =>
          new AuthSystem<typeof minimalSchema>({
            storage: null as unknown as StorageAdapter,
            schema: minimalSchema,
          }),
        (err: unknown) =>
          err instanceof ConfigurationError &&
          err.message === "Storage adapter is required.",
        "Expected ConfigurationError for missing storage adapter",
      );
    });

    it("should throw ConfigurationError if schema is missing", () => {
      assert.throws(
        () =>
          new AuthSystem({
            storage,
            // @ts-expect-error
            schema: null,
          }),
        (err: unknown) =>
          err instanceof ConfigurationError &&
          err.message === "Authorization schema is required.",
        "Expected ConfigurationError for missing schema",
      );
    });
  });

  describe("check - Core Logic", () => {
    describe("Direct Relations", () => {
      const schema = defineSchema({
        relations: {
          editor: { type: "direct" },
          viewer: { type: "direct" },
        },
        actionToRelations: {
          edit: ["editor"],
          view: ["viewer", "editor"],
        },
      });
      let authSystem: AuthSystem<typeof schema>;

      beforeEach(() => {
        authSystem = new AuthSystem({ storage, schema });
      });

      it("should return true if subject has direct relation required by action", async () => {
        await authSystem.allow({
          who: { type: "user", id: "alice" },
          toBe: "editor",
          onWhat: { type: "doc", id: "doc1" },
        });
        const result = authSystem.check({
          who: { type: "user", id: "alice" },
          canThey: "edit",
          onWhat: { type: "doc", id: "doc1" },
        });
        await assert.doesNotReject(result);
        assert.strictEqual(await result, true);
      });

      it("should return true if subject has *one of* the direct relations required by action", async () => {
        await authSystem.allow({
          who: { type: "user", id: "alice" },
          toBe: "viewer",
          onWhat: { type: "doc", id: "doc1" },
        });
        let result = authSystem.check({
          who: { type: "user", id: "alice" },
          canThey: "view",
          onWhat: { type: "doc", id: "doc1" },
        });
        await assert.doesNotReject(result);
        assert.strictEqual(await result, true);

        await authSystem.disallowAllMatching({
          who: { type: "user", id: "alice" },
          was: "viewer",
          onWhat: { type: "doc", id: "doc1" },
        });
        await authSystem.allow({
          who: { type: "user", id: "bob" },
          toBe: "editor",
          onWhat: { type: "doc", id: "doc1" },
        });
        result = authSystem.check({
          who: { type: "user", id: "bob" },
          canThey: "view",
          onWhat: { type: "doc", id: "doc1" },
        });
        await assert.doesNotReject(result);
        assert.strictEqual(await result, true);
      });

      it("should return false if subject lacks direct relation required by action", async () => {
        await authSystem.allow({
          who: { type: "user", id: "alice" },
          toBe: "viewer",
          onWhat: { type: "doc", id: "doc1" },
        });
        const result = authSystem.check({
          who: { type: "user", id: "alice" },
          canThey: "edit",
          onWhat: { type: "doc", id: "doc1" },
        });
        await assert.doesNotReject(result);
        assert.strictEqual(await result, false);
      });

      it("should return false if subject has no relations on the object", async () => {
        const result = authSystem.check({
          who: { type: "user", id: "alice" },
          canThey: "view",
          onWhat: { type: "doc", id: "doc1" },
        });
        await assert.doesNotReject(result);
        assert.strictEqual(await result, false);
      });
    });

    describe("Group Relations", () => {
      const schema = defineSchema({
        relations: {
          member: { type: "group" },
          co_owner: { type: "group" },
          editor: { type: "direct" },
          owner: { type: "direct" },
        },
        actionToRelations: {
          edit: ["editor", "owner"],
          delete: ["owner"],
        },
      });
      let authSystem: AuthSystem<typeof schema>;

      beforeEach(async () => {
        authSystem = new AuthSystem({ storage, schema });
        await authSystem.addMember({
          member: { type: "user", id: "alice" },
          group: { type: "group", id: "devs" },
        });
        await authSystem.allow({
          who: { type: "group", id: "devs" },
          toBe: "editor",
          onWhat: { type: "doc", id: "doc1" },
        });
        await authSystem.allow({
          who: { type: "user", id: "bob" },
          toBe: "co_owner",
          onWhat: { type: "group", id: "admins" },
        });
        await authSystem.allow({
          who: { type: "group", id: "admins" },
          toBe: "owner",
          onWhat: { type: "doc", id: "doc2" },
        });
      });

      it("should return true if subject is in a group that has the required relation", async () => {
        const result = authSystem.check({
          who: { type: "user", id: "alice" },
          canThey: "edit",
          onWhat: { type: "doc", id: "doc1" },
        });
        await assert.doesNotReject(result);
        assert.strictEqual(await result, true);
      });

      it("should return true checking via different group relation type", async () => {
        const result = authSystem.check({
          who: { type: "user", id: "bob" },
          canThey: "delete",
          onWhat: { type: "doc", id: "doc2" },
        });
        await assert.doesNotReject(result);
        assert.strictEqual(await result, true);
      });

      it("should return false if subject is in a group, but group lacks permission", async () => {
        const result = authSystem.check({
          who: { type: "user", id: "alice" },
          canThey: "delete",
          onWhat: { type: "doc", id: "doc1" },
        });
        await assert.doesNotReject(result);
        assert.strictEqual(await result, false);
      });

      it("should return false if subject is not in the relevant group", async () => {
        const result = authSystem.check({
          who: { type: "user", id: "bob" },
          canThey: "edit",
          onWhat: { type: "doc", id: "doc1" },
        });
        await assert.doesNotReject(result);
        assert.strictEqual(await result, false);
      });

      it("should handle nested groups", async () => {
        await authSystem.addMember({
          member: { type: "group", id: "frontend" },
          group: { type: "group", id: "devs" },
        });
        await authSystem.addMember({
          member: { type: "user", id: "charlie" },
          group: { type: "group", id: "frontend" },
        });

        const result = authSystem.check({
          who: { type: "user", id: "charlie" },
          canThey: "edit",
          onWhat: { type: "doc", id: "doc1" },
        });
        await assert.doesNotReject(result);
        assert.strictEqual(await result, true);
      });
    });

    describe("Hierarchy Relations", () => {
      const schema = defineSchema({
        relations: {
          parent: { type: "hierarchy" },
          viewer: { type: "direct" },
          owner: { type: "direct" },
          manager: { type: "direct" },
        },
        actionToRelations: {
          view: ["viewer", "owner", "manager"],
          edit: ["owner", "manager"],
          delete: ["owner"],
        },
        hierarchyPropagation: {
          view: ["view"],
          edit: ["edit"],
          delete: ["delete"],
        },
      });
      let authSystem: AuthSystem<typeof schema>;

      beforeEach(async () => {
        authSystem = new AuthSystem({ storage, schema });
        await authSystem.setParent({
          child: { type: "doc", id: "doc1" },
          parent: { type: "folder", id: "folderA" },
        });
        await authSystem.setParent({
          child: { type: "folder", id: "folderA" },
          parent: { type: "org", id: "main" },
        });

        await authSystem.allow({
          who: { type: "user", id: "alice" },
          toBe: "viewer",
          onWhat: { type: "folder", id: "folderA" },
        });
        await authSystem.allow({
          who: { type: "user", id: "bob" },
          toBe: "owner",
          onWhat: { type: "org", id: "main" },
        });
        await authSystem.allow({
          who: { type: "user", id: "charlie" },
          toBe: "manager",
          onWhat: { type: "folder", id: "folderA" },
        });
      });

      it("should return true if subject has permission on direct parent (via propagation rule)", async () => {
        const result = authSystem.check({
          who: { type: "user", id: "alice" },
          canThey: "view",
          onWhat: { type: "doc", id: "doc1" },
        });
        await assert.doesNotReject(result);
        assert.strictEqual(await result, true);
      });

      it("should return true if subject has permission on ancestor (multi-level)", async () => {
        const result = authSystem.check({
          who: { type: "user", id: "bob" },
          canThey: "view",
          onWhat: { type: "doc", id: "doc1" },
        });
        await assert.doesNotReject(result);
        assert.strictEqual(await result, true);
      });

      it("should return true based on specific hierarchy propagation rule (owner)", async () => {
        let result = authSystem.check({
          who: { type: "user", id: "bob" },
          canThey: "edit",
          onWhat: { type: "doc", id: "doc1" },
        });
        await assert.doesNotReject(result);
        assert.strictEqual(await result, true);

        result = authSystem.check({
          who: { type: "user", id: "bob" },
          canThey: "delete",
          onWhat: { type: "doc", id: "doc1" },
        });
        await assert.doesNotReject(result);
        assert.strictEqual(await result, true);
      });

      it("should return true based on specific hierarchy propagation rule (manager)", async () => {
        const result = authSystem.check({
          who: { type: "user", id: "charlie" },
          canThey: "edit",
          onWhat: { type: "doc", id: "doc1" },
        });
        await assert.doesNotReject(result);
        assert.strictEqual(await result, true);
      });

      it("should return false if subject has permission on parent, but propagation rule does not allow it", async () => {
        let result = authSystem.check({
          who: { type: "user", id: "alice" },
          canThey: "delete",
          onWhat: { type: "doc", id: "doc1" },
        });
        await assert.doesNotReject(result);
        assert.strictEqual(await result, false);

        result = authSystem.check({
          who: { type: "user", id: "charlie" },
          canThey: "delete",
          onWhat: { type: "doc", id: "doc1" },
        });
        await assert.doesNotReject(result);
        assert.strictEqual(await result, false);
      });

      it("should return false if subject lacks permission on relevant ancestors", async () => {
        const result = authSystem.check({
          who: { type: "user", id: "charlie" },
          canThey: "delete",
          onWhat: { type: "doc", id: "doc1" },
        });
        await assert.doesNotReject(result);
        assert.strictEqual(await result, false);
      });

      it("should prioritize direct permission over hierarchy", async () => {
        await authSystem.allow({
          who: { type: "user", id: "alice" },
          toBe: "owner",
          onWhat: { type: "doc", id: "doc1" },
        });

        let result = authSystem.check({
          who: { type: "user", id: "alice" },
          canThey: "edit",
          onWhat: { type: "doc", id: "doc1" },
        });
        await assert.doesNotReject(result);
        assert.strictEqual(await result, true);

        result = authSystem.check({
          who: { type: "user", id: "alice" },
          canThey: "delete",
          onWhat: { type: "doc", id: "doc1" },
        });
        await assert.doesNotReject(result);
        assert.strictEqual(await result, true);
      });
    });

    describe("Combined Relations (Group + Hierarchy)", () => {
      const schema = defineSchema({
        relations: {
          member: { type: "group" },
          parent: { type: "hierarchy" },
          viewer: { type: "direct" },
          owner: { type: "direct" },
        },
        actionToRelations: {
          view: ["viewer", "owner"],
          edit: ["owner"],
        },
        hierarchyPropagation: {
          view: ["view"],
          edit: ["edit"],
        },
      });
      let authSystem: AuthSystem<typeof schema>;

      beforeEach(async () => {
        authSystem = new AuthSystem({ storage, schema });
        await authSystem.setParent({
          child: { type: "doc", id: "doc1" },
          parent: { type: "folder", id: "folderA" },
        });
        await authSystem.addMember({
          member: { type: "user", id: "alice" },
          group: { type: "group", id: "devs" },
        });
        await authSystem.allow({
          who: { type: "group", id: "devs" },
          toBe: "viewer",
          onWhat: { type: "folder", id: "folderA" },
        });
        await authSystem.addMember({
          member: { type: "user", id: "bob" },
          group: { type: "group", id: "admins" },
        });
        await authSystem.allow({
          who: { type: "group", id: "admins" },
          toBe: "owner",
          onWhat: { type: "folder", id: "folderA" },
        });
      });

      it("should return true: Subject -> Group -> Parent Relation -> Permission (via prop rule)", async () => {
        const result = authSystem.check({
          who: { type: "user", id: "alice" },
          canThey: "view",
          onWhat: { type: "doc", id: "doc1" },
        });
        await assert.doesNotReject(result);
        assert.strictEqual(await result, true);
      });

      it("should return true: Subject -> Group -> Parent Relation -> Permission (via prop rule)", async () => {
        const result = authSystem.check({
          who: { type: "user", id: "bob" },
          canThey: "edit",
          onWhat: { type: "doc", id: "doc1" },
        });
        await assert.doesNotReject(result);
        assert.strictEqual(await result, true);
      });

      it("should return false if group lacks appropriate permission on parent for propagation", async () => {
        const result = authSystem.check({
          who: { type: "user", id: "alice" },
          canThey: "edit",
          onWhat: { type: "doc", id: "doc1" },
        });
        await assert.doesNotReject(result);
        assert.strictEqual(await result, false);
      });
    });

    describe("Conditions (Time Validity)", () => {
      const schema = defineSchema({
        relations: {
          member: { type: "group" },
          parent: { type: "hierarchy" },
          viewer: { type: "direct" },
        },
        actionToRelations: {
          view: ["viewer"],
        },
        hierarchyPropagation: {
          view: ["view"],
        },
      });
      let authSystem: AuthSystem<typeof schema>;
      const now = Date.now();
      const oneHour = 3600 * 1000;
      const pastDate = new Date(now - oneHour);
      const futureDate = new Date(now + oneHour);
      const currentDate = new Date(now);

      beforeEach(() => {
        authSystem = new AuthSystem({ storage, schema });

        mock.timers.enable({ apis: ["Date"], now: currentDate });
      });

      afterEach(() => {
        mock.timers.reset();
      });

      it("should allow access if direct relation condition is valid (within range)", async () => {
        await authSystem.allow({
          who: { type: "user", id: "alice" },
          toBe: "viewer",
          onWhat: { type: "doc", id: "d1" },
          when: { validSince: pastDate, validUntil: futureDate },
        });
        const result = await authSystem.check({
          who: { type: "user", id: "alice" },
          canThey: "view",
          onWhat: { type: "doc", id: "d1" },
        });
        assert.strictEqual(result, true);
      });

      it("should deny access if direct relation condition validSince is in the future", async () => {
        await authSystem.allow({
          who: { type: "user", id: "alice" },
          toBe: "viewer",
          onWhat: { type: "doc", id: "d1" },
          when: { validSince: futureDate },
        });
        const result = await authSystem.check({
          who: { type: "user", id: "alice" },
          canThey: "view",
          onWhat: { type: "doc", id: "d1" },
        });
        assert.strictEqual(result, false);
      });

      it("should deny access if direct relation condition validUntil has passed", async () => {
        await authSystem.allow({
          who: { type: "user", id: "alice" },
          toBe: "viewer",
          onWhat: { type: "doc", id: "d1" },
          when: { validUntil: pastDate },
        });
        const result = await authSystem.check({
          who: { type: "user", id: "alice" },
          canThey: "view",
          onWhat: { type: "doc", id: "d1" },
        });
        assert.strictEqual(result, false);
      });

      it("should deny access if group membership condition has expired", async () => {
        await authSystem.addMember({
          member: { type: "user", id: "alice" },
          group: { type: "group", id: "devs" },
          condition: { validUntil: pastDate },
        });
        await authSystem.allow({
          who: { type: "group", id: "devs" },
          toBe: "viewer",
          onWhat: { type: "doc", id: "d1" },
        });
        const result = await authSystem.check({
          who: { type: "user", id: "alice" },
          canThey: "view",
          onWhat: { type: "doc", id: "d1" },
        });
        assert.strictEqual(result, false);
      });

      it("should deny access if group permission condition has expired", async () => {
        await authSystem.addMember({
          member: { type: "user", id: "alice" },
          group: { type: "group", id: "devs" },
        });
        await authSystem.allow({
          who: { type: "group", id: "devs" },
          toBe: "viewer",
          onWhat: { type: "doc", id: "d1" },
          when: { validUntil: pastDate },
        });
        const result = await authSystem.check({
          who: { type: "user", id: "alice" },
          canThey: "view",
          onWhat: { type: "doc", id: "d1" },
        });
        assert.strictEqual(result, false);
      });

      it("should deny access if hierarchy parent relation condition has expired", async () => {
        await authSystem.setParent({
          child: { type: "doc", id: "d3" },
          parent: { type: "folder", id: "f2" },
          condition: { validUntil: pastDate },
        });
        await authSystem.allow({
          who: { type: "user", id: "alice" },
          toBe: "viewer",
          onWhat: { type: "folder", id: "f2" },
        });
        const result = await authSystem.check({
          who: { type: "user", id: "alice" },
          canThey: "view",
          onWhat: { type: "doc", id: "d3" },
        });
        assert.strictEqual(result, false);
      });

      it("should deny access if permission on parent condition has expired", async () => {
        await authSystem.setParent({
          child: { type: "doc", id: "d3" },
          parent: { type: "folder", id: "f2" },
        });
        await authSystem.allow({
          who: { type: "user", id: "alice" },
          toBe: "viewer",
          onWhat: { type: "folder", id: "f2" },
          when: { validUntil: pastDate },
        });
        const result = await authSystem.check({
          who: { type: "user", id: "alice" },
          canThey: "view",
          onWhat: { type: "doc", id: "d3" },
        });
        assert.strictEqual(result, false);
      });

      it("should allow access if one path is valid even if another has expired condition", async () => {
        await authSystem.allow({
          who: { type: "user", id: "alice" },
          toBe: "viewer",
          onWhat: { type: "doc", id: "d4" },
        });
        await authSystem.addMember({
          member: { type: "user", id: "alice" },
          group: { type: "group", id: "devs" },
          condition: { validUntil: pastDate },
        });
        await authSystem.allow({
          who: { type: "group", id: "devs" },
          toBe: "viewer",
          onWhat: { type: "doc", id: "d4" },
        });

        const result = await authSystem.check({
          who: { type: "user", id: "alice" },
          canThey: "view",
          onWhat: { type: "doc", id: "d4" },
        });
        assert.strictEqual(result, true);
      });
    });

    describe("Field-Specific Permissions", () => {
      const schema = defineSchema({
        relations: { viewer: { type: "direct" } },
        actionToRelations: { view: ["viewer"] },
      });
      let authSystem: AuthSystem<typeof schema>;

      beforeEach(async () => {
        authSystem = new AuthSystem({ storage, schema });

        await authSystem.allow({
          who: { type: "user", id: "alice" },
          toBe: "viewer",
          onWhat: { type: "doc", id: "doc1#fieldA" },
        });

        await authSystem.allow({
          who: { type: "user", id: "bob" },
          toBe: "viewer",
          onWhat: { type: "doc", id: "doc2" },
        });
      });

      it("should grant access based on specific field permission", async () => {
        const result = await authSystem.check({
          who: { type: "user", id: "alice" },
          canThey: "view",
          onWhat: { type: "doc", id: "doc1#fieldA" },
        });
        assert.strictEqual(result, true);
      });

      it("should deny access to different field when only specific field permission exists", async () => {
        const result = await authSystem.check({
          who: { type: "user", id: "alice" },
          canThey: "view",
          onWhat: { type: "doc", id: "doc1#fieldB" },
        });
        assert.strictEqual(result, false);
      });

      it("should deny access to wildcard object when only specific field permission exists", async () => {
        const result = await authSystem.check({
          who: { type: "user", id: "alice" },
          canThey: "view",
          onWhat: { type: "doc", id: "doc1" },
        });
        assert.strictEqual(result, false);
      });

      it("should grant access to specific field based on wildcard permission", async () => {
        let result = await authSystem.check({
          who: { type: "user", id: "bob" },
          canThey: "view",
          onWhat: { type: "doc", id: "doc2#fieldA" },
        });
        assert.strictEqual(result, true);

        await authSystem.allow({
          who: { type: "user", id: "charlie" },
          toBe: "viewer",
          onWhat: { type: "doc", id: "doc3#fieldX" },
        });
        await authSystem.allow({
          who: { type: "user", id: "david" },
          toBe: "viewer",
          onWhat: { type: "doc", id: "doc3" },
        });

        result = await authSystem.check({
          who: { type: "user", id: "david" },
          canThey: "view",
          onWhat: { type: "doc", id: "doc3#fieldX" },
        });
        assert.strictEqual(result, true);
      });

      it("should grant access to wildcard based on wildcard permission", async () => {
        const result = await authSystem.check({
          who: { type: "user", id: "bob" },
          canThey: "view",
          onWhat: { type: "doc", id: "doc2" },
        });
        assert.strictEqual(result, true);
      });

      it("should check specific field first, then fallback to wildcard", async () => {
        await authSystem.allow({
          who: { type: "user", id: "alice" },
          toBe: "viewer",
          onWhat: { type: "doc", id: "doc1" },
        });

        let result = await authSystem.check({
          who: { type: "user", id: "alice" },
          canThey: "view",
          onWhat: { type: "doc", id: "doc1#fieldA" },
        });
        assert.strictEqual(result, true);

        result = await authSystem.check({
          who: { type: "user", id: "alice" },
          canThey: "view",
          onWhat: { type: "doc", id: "doc1#fieldB" },
        });
        assert.strictEqual(result, true);

        result = await authSystem.check({
          who: { type: "user", id: "alice" },
          canThey: "view",
          onWhat: { type: "doc", id: "doc1" },
        });
        assert.strictEqual(result, true);
      });

      it("should work with custom field separator", async () => {
        const customSeparator = ":";
        const authSystemCustom = new AuthSystem({
          storage,
          schema,
          fieldSeparator: customSeparator,
        });
        await authSystemCustom.allow({
          who: { type: "user", id: "eve" },
          toBe: "viewer",
          onWhat: { type: "doc", id: `doc4${customSeparator}fieldZ` },
        });
        await authSystemCustom.allow({
          who: { type: "user", id: "frank" },
          toBe: "viewer",
          onWhat: { type: "doc", id: `doc5${customSeparator}fieldW` },
        });

        let result = await authSystemCustom.check({
          who: { type: "user", id: "eve" },
          canThey: "view",
          onWhat: { type: "doc", id: `doc4${customSeparator}fieldZ` },
        });
        assert.strictEqual(result, true);

        result = await authSystemCustom.check({
          who: { type: "user", id: "eve" },
          canThey: "view",
          onWhat: { type: "doc", id: `doc4${customSeparator}fieldY` },
        });
        assert.strictEqual(result, false);

        result = await authSystemCustom.check({
          who: { type: "user", id: "eve" },
          canThey: "view",
          onWhat: { type: "doc", id: "doc4" },
        });
        assert.strictEqual(result, false);

        result = await authSystemCustom.check({
          who: { type: "user", id: "frank" },
          canThey: "view",
          onWhat: { type: "doc", id: `doc5${customSeparator}fieldW` },
        });
        assert.strictEqual(result, true);
      });
    });

    describe("Action/Relation Mapping & Unknowns", () => {
      const schema = defineSchema({
        relations: { viewer: { type: "direct" } },
        actionToRelations: {
          view: ["viewer"],
          comment: [],
        },
      });
      let authSystem: AuthSystem<typeof schema>;

      beforeEach(async () => {
        authSystem = new AuthSystem({ storage, schema });
        await authSystem.allow({
          who: { type: "user", id: "alice" },
          toBe: "viewer",
          onWhat: { type: "doc", id: "doc1" },
        });
      });

      it("should return false if action is not defined in actionToRelations", async () => {
        const result = await authSystem.check({
          who: { type: "user", id: "alice" },
          // @ts-expect-error
          canThey: "edit",
          onWhat: { type: "doc", id: "doc1" },
        });
        assert.strictEqual(result, false);
      });

      it("should return false if action defined but has empty relations array", async () => {
        const result = await authSystem.check({
          who: { type: "user", id: "alice" },
          canThey: "comment",
          onWhat: { type: "doc", id: "doc1" },
        });
        assert.strictEqual(result, false);
      });
    });
  });

  describe("listTuples", () => {
    const schema = defineSchema({
      relations: {
        member: { type: "group" },
        viewer: { type: "direct" },
        editor: { type: "direct" },
        owner: { type: "direct" },
      },
      actionToRelations: {
        view: ["viewer", "editor", "owner"],
        edit: ["editor", "owner"],
        delete: ["owner"],
      },
    });
    let authSystem: AuthSystem<typeof schema>;

    beforeEach(async () => {
      authSystem = new AuthSystem({ storage, schema });

      // Set up test data with multiple tuples
      // Alice: viewer on doc1, editor on doc2
      await authSystem.allow({
        who: { type: "user", id: "alice" },
        toBe: "viewer",
        onWhat: { type: "doc", id: "doc1" },
      });
      await authSystem.allow({
        who: { type: "user", id: "alice" },
        toBe: "editor",
        onWhat: { type: "doc", id: "doc2" },
      });

      // Bob: editor on doc1, owner on doc3
      await authSystem.allow({
        who: { type: "user", id: "bob" },
        toBe: "editor",
        onWhat: { type: "doc", id: "doc1" },
      });
      await authSystem.allow({
        who: { type: "user", id: "bob" },
        toBe: "owner",
        onWhat: { type: "doc", id: "doc3" },
      });

      // Charlie: member of devs group
      await authSystem.addMember({
        member: { type: "user", id: "charlie" },
        group: { type: "group", id: "devs" },
      });

      // Group devs: viewer on doc3
      await authSystem.allow({
        who: { type: "group", id: "devs" },
        toBe: "viewer",
        onWhat: { type: "doc", id: "doc3" },
      });
    });

    it("should list all tuples when no filter provided", async () => {
      const tuples = await authSystem.listTuples({});
      // alice:viewer:doc1, alice:editor:doc2, bob:editor:doc1, bob:owner:doc3,
      // charlie:member:devs, devs:viewer:doc3
      assert.strictEqual(tuples.length, 6);
    });

    it("should filter by subject", async () => {
      const tuples = await authSystem.listTuples({
        subject: { type: "user", id: "alice" },
      });
      assert.strictEqual(tuples.length, 2);
      assert.ok(
        tuples.every(
          (t) => t.subject.type === "user" && t.subject.id === "alice",
        ),
      );
    });

    it("should filter by relation", async () => {
      const tuples = await authSystem.listTuples({
        relation: "editor",
      });
      assert.strictEqual(tuples.length, 2);
      assert.ok(tuples.every((t) => t.relation === "editor"));
    });

    it("should filter by object", async () => {
      const tuples = await authSystem.listTuples({
        object: { type: "doc", id: "doc1" },
      });
      assert.strictEqual(tuples.length, 2);
      assert.ok(
        tuples.every(
          (t) => t.object.type === "doc" && t.object.id === "doc1",
        ),
      );
    });

    it("should apply pagination with limit", async () => {
      const tuples = await authSystem.listTuples({}, { limit: 2 });
      assert.strictEqual(tuples.length, 2);
    });

    it("should apply pagination with offset", async () => {
      const allTuples = await authSystem.listTuples({});
      const offsetTuples = await authSystem.listTuples({}, { offset: 2 });
      assert.strictEqual(offsetTuples.length, allTuples.length - 2);
      assert.deepStrictEqual(offsetTuples, allTuples.slice(2));
    });

    it("should apply pagination with limit and offset", async () => {
      const allTuples = await authSystem.listTuples({});
      const paginatedTuples = await authSystem.listTuples(
        {},
        { limit: 2, offset: 1 },
      );
      assert.strictEqual(paginatedTuples.length, 2);
      assert.deepStrictEqual(paginatedTuples, allTuples.slice(1, 3));
    });

    it("should return empty array when no matches", async () => {
      const tuples = await authSystem.listTuples({
        subject: { type: "user", id: "nonexistent" },
      });
      assert.strictEqual(tuples.length, 0);
      assert.deepStrictEqual(tuples, []);
    });
  });
});
