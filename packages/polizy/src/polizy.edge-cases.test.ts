import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { AuthSystem } from "./polizy.ts";
import { InMemoryStorageAdapter } from "./polizy.in-memory.storage.ts";
import { defineSchema } from "./types.ts";

describe("Edge Cases", () => {
  describe("Circular Group Membership", () => {
    const schema = defineSchema({
      relations: {
        member: { type: "group" },
        viewer: { type: "direct" },
      },
      actionToRelations: {
        view: ["viewer"],
      },
    });

    let storage: InMemoryStorageAdapter;
    let authz: AuthSystem<typeof schema>;

    beforeEach(() => {
      storage = new InMemoryStorageAdapter();
      authz = new AuthSystem({ storage, schema });
    });

    it("should not hang on self-referential group membership (A is member of A)", async () => {
      // Group A is a member of itself - this should not cause infinite loop
      await authz.addMember({
        member: { type: "group", id: "groupA" },
        group: { type: "group", id: "groupA" },
      });

      // Give groupA viewer permission
      await authz.allow({
        who: { type: "group", id: "groupA" },
        toBe: "viewer",
        onWhat: { type: "doc", id: "doc1" },
      });

      // Add a user to groupA
      await authz.addMember({
        member: { type: "user", id: "alice" },
        group: { type: "group", id: "groupA" },
      });

      // This should complete without hanging
      const result = await authz.check({
        who: { type: "user", id: "alice" },
        canThey: "view",
        onWhat: { type: "doc", id: "doc1" },
      });

      assert.strictEqual(result, true);
    });

    it("should not hang on circular group chain (A -> B -> C -> A)", async () => {
      // Create circular chain: A -> B -> C -> A
      await authz.addMember({
        member: { type: "group", id: "groupA" },
        group: { type: "group", id: "groupB" },
      });
      await authz.addMember({
        member: { type: "group", id: "groupB" },
        group: { type: "group", id: "groupC" },
      });
      await authz.addMember({
        member: { type: "group", id: "groupC" },
        group: { type: "group", id: "groupA" },
      });

      // Give groupC viewer permission
      await authz.allow({
        who: { type: "group", id: "groupC" },
        toBe: "viewer",
        onWhat: { type: "doc", id: "doc1" },
      });

      // Add user to groupA
      await authz.addMember({
        member: { type: "user", id: "bob" },
        group: { type: "group", id: "groupA" },
      });

      // This should complete without hanging and find the permission via A -> B -> C
      const result = await authz.check({
        who: { type: "user", id: "bob" },
        canThey: "view",
        onWhat: { type: "doc", id: "doc1" },
      });

      assert.strictEqual(result, true);
    });

    it("should return false for circular groups without matching permission", async () => {
      // Create circular chain without any viewer permissions
      await authz.addMember({
        member: { type: "group", id: "groupX" },
        group: { type: "group", id: "groupY" },
      });
      await authz.addMember({
        member: { type: "group", id: "groupY" },
        group: { type: "group", id: "groupX" },
      });

      await authz.addMember({
        member: { type: "user", id: "charlie" },
        group: { type: "group", id: "groupX" },
      });

      // No permissions granted, should return false without hanging
      const result = await authz.check({
        who: { type: "user", id: "charlie" },
        canThey: "view",
        onWhat: { type: "doc", id: "doc1" },
      });

      assert.strictEqual(result, false);
    });
  });

  describe("Max Depth Limits", () => {
    const schema = defineSchema({
      relations: {
        member: { type: "group" },
        viewer: { type: "direct" },
      },
      actionToRelations: {
        view: ["viewer"],
      },
    });

    it("should respect default depth limit of 10", async () => {
      const storage = new InMemoryStorageAdapter();
      const authz = new AuthSystem({ storage, schema });

      // Create a chain of 12 nested groups (exceeds default depth of 10)
      const groupCount = 12;
      for (let i = 0; i < groupCount - 1; i++) {
        await authz.addMember({
          member: { type: "group", id: `group${i}` },
          group: { type: "group", id: `group${i + 1}` },
        });
      }

      // Add user to first group
      await authz.addMember({
        member: { type: "user", id: "alice" },
        group: { type: "group", id: "group0" },
      });

      // Give last group viewer permission
      await authz.allow({
        who: { type: "group", id: `group${groupCount - 1}` },
        toBe: "viewer",
        onWhat: { type: "doc", id: "doc1" },
      });

      // Should return false because depth exceeds default limit of 10
      const result = await authz.check({
        who: { type: "user", id: "alice" },
        canThey: "view",
        onWhat: { type: "doc", id: "doc1" },
      });

      assert.strictEqual(result, false);
    });

    it("should allow access within default depth limit", async () => {
      const storage = new InMemoryStorageAdapter();
      const authz = new AuthSystem({ storage, schema });

      // Create a chain of 8 nested groups (within default depth of 10)
      const groupCount = 8;
      for (let i = 0; i < groupCount - 1; i++) {
        await authz.addMember({
          member: { type: "group", id: `group${i}` },
          group: { type: "group", id: `group${i + 1}` },
        });
      }

      // Add user to first group
      await authz.addMember({
        member: { type: "user", id: "bob" },
        group: { type: "group", id: "group0" },
      });

      // Give last group viewer permission
      await authz.allow({
        who: { type: "group", id: `group${groupCount - 1}` },
        toBe: "viewer",
        onWhat: { type: "doc", id: "doc1" },
      });

      // Should return true because depth is within limit
      const result = await authz.check({
        who: { type: "user", id: "bob" },
        canThey: "view",
        onWhat: { type: "doc", id: "doc1" },
      });

      assert.strictEqual(result, true);
    });

    it("should respect custom depth limit", async () => {
      const storage = new InMemoryStorageAdapter();
      const authz = new AuthSystem({
        storage,
        schema,
        defaultCheckDepth: 3,
      });

      // Create a chain of 5 nested groups (exceeds custom depth of 3)
      for (let i = 0; i < 4; i++) {
        await authz.addMember({
          member: { type: "group", id: `group${i}` },
          group: { type: "group", id: `group${i + 1}` },
        });
      }

      // Add user to first group
      await authz.addMember({
        member: { type: "user", id: "charlie" },
        group: { type: "group", id: "group0" },
      });

      // Give last group viewer permission
      await authz.allow({
        who: { type: "group", id: "group4" },
        toBe: "viewer",
        onWhat: { type: "doc", id: "doc1" },
      });

      // Should return false because depth exceeds custom limit of 3
      const result = await authz.check({
        who: { type: "user", id: "charlie" },
        canThey: "view",
        onWhat: { type: "doc", id: "doc1" },
      });

      assert.strictEqual(result, false);
    });

    it("should allow access with custom depth limit when within bounds", async () => {
      const storage = new InMemoryStorageAdapter();
      const authz = new AuthSystem({
        storage,
        schema,
        defaultCheckDepth: 5,
      });

      // Create a chain of 3 nested groups (within custom depth of 5)
      for (let i = 0; i < 2; i++) {
        await authz.addMember({
          member: { type: "group", id: `group${i}` },
          group: { type: "group", id: `group${i + 1}` },
        });
      }

      // Add user to first group
      await authz.addMember({
        member: { type: "user", id: "dave" },
        group: { type: "group", id: "group0" },
      });

      // Give last group viewer permission
      await authz.allow({
        who: { type: "group", id: "group2" },
        toBe: "viewer",
        onWhat: { type: "doc", id: "doc1" },
      });

      // Should return true because depth is within custom limit
      const result = await authz.check({
        who: { type: "user", id: "dave" },
        canThey: "view",
        onWhat: { type: "doc", id: "doc1" },
      });

      assert.strictEqual(result, true);
    });
  });

  describe("Field Separator Edge Cases", () => {
    it("should handle multiple separators in ID (uses last separator)", async () => {
      const schema = defineSchema({
        relations: { viewer: { type: "direct" } },
        actionToRelations: { view: ["viewer"] },
      });
      const storage = new InMemoryStorageAdapter();
      const authz = new AuthSystem({ storage, schema });

      // Grant permission on doc with multiple separators
      await authz.allow({
        who: { type: "user", id: "alice" },
        toBe: "viewer",
        onWhat: { type: "doc", id: "doc1#section1#field1" },
      });

      // Should match exact ID
      const exactMatch = await authz.check({
        who: { type: "user", id: "alice" },
        canThey: "view",
        onWhat: { type: "doc", id: "doc1#section1#field1" },
      });
      assert.strictEqual(exactMatch, true, "Should match exact ID");

      // Should NOT match partial path (uses last separator)
      const partialMatch = await authz.check({
        who: { type: "user", id: "alice" },
        canThey: "view",
        onWhat: { type: "doc", id: "doc1#section1" },
      });
      assert.strictEqual(partialMatch, false, "Should not match partial path");
    });

    it("should grant access to nested field when parent permission exists", async () => {
      const schema = defineSchema({
        relations: { viewer: { type: "direct" } },
        actionToRelations: { view: ["viewer"] },
      });
      const storage = new InMemoryStorageAdapter();
      const authz = new AuthSystem({ storage, schema });

      // Grant permission on parent
      await authz.allow({
        who: { type: "user", id: "bob" },
        toBe: "viewer",
        onWhat: { type: "doc", id: "doc1#section1" },
      });

      // Should grant access to nested field via parent
      const nestedAccess = await authz.check({
        who: { type: "user", id: "bob" },
        canThey: "view",
        onWhat: { type: "doc", id: "doc1#section1#field1" },
      });
      assert.strictEqual(nestedAccess, true, "Should access nested via parent");
    });

    it("should handle separator at start of ID", async () => {
      const schema = defineSchema({
        relations: { viewer: { type: "direct" } },
        actionToRelations: { view: ["viewer"] },
      });
      const storage = new InMemoryStorageAdapter();
      const authz = new AuthSystem({ storage, schema });

      // Grant permission on ID starting with separator
      await authz.allow({
        who: { type: "user", id: "charlie" },
        toBe: "viewer",
        onWhat: { type: "doc", id: "#leadingSeparator" },
      });

      const result = await authz.check({
        who: { type: "user", id: "charlie" },
        canThey: "view",
        onWhat: { type: "doc", id: "#leadingSeparator" },
      });
      assert.strictEqual(result, true);
    });

    it("should handle custom separator correctly", async () => {
      const schema = defineSchema({
        relations: { viewer: { type: "direct" } },
        actionToRelations: { view: ["viewer"] },
      });
      const storage = new InMemoryStorageAdapter();
      const authz = new AuthSystem({
        storage,
        schema,
        fieldSeparator: "::",
      });

      // Grant permission on parent with custom separator
      await authz.allow({
        who: { type: "user", id: "dave" },
        toBe: "viewer",
        onWhat: { type: "doc", id: "doc1" },
      });

      // Should grant access to field using custom separator
      const result = await authz.check({
        who: { type: "user", id: "dave" },
        canThey: "view",
        onWhat: { type: "doc", id: "doc1::fieldA" },
      });
      assert.strictEqual(result, true);
    });

    it("should not confuse default separator with custom separator", async () => {
      const schema = defineSchema({
        relations: { viewer: { type: "direct" } },
        actionToRelations: { view: ["viewer"] },
      });
      const storage = new InMemoryStorageAdapter();
      const authz = new AuthSystem({
        storage,
        schema,
        fieldSeparator: "::",
      });

      // Grant permission on doc with default separator in ID (should be treated as literal)
      await authz.allow({
        who: { type: "user", id: "eve" },
        toBe: "viewer",
        onWhat: { type: "doc", id: "doc1#notAField" },
      });

      // The # should be treated as part of the ID, not as field separator
      const exactMatch = await authz.check({
        who: { type: "user", id: "eve" },
        canThey: "view",
        onWhat: { type: "doc", id: "doc1#notAField" },
      });
      assert.strictEqual(exactMatch, true);

      // Should NOT match without the # since it's part of the ID
      const withoutHash = await authz.check({
        who: { type: "user", id: "eve" },
        canThey: "view",
        onWhat: { type: "doc", id: "doc1" },
      });
      assert.strictEqual(withoutHash, false);
    });

    it("should handle empty field name after separator", async () => {
      const schema = defineSchema({
        relations: { viewer: { type: "direct" } },
        actionToRelations: { view: ["viewer"] },
      });
      const storage = new InMemoryStorageAdapter();
      const authz = new AuthSystem({ storage, schema });

      // Grant permission with empty field name
      await authz.allow({
        who: { type: "user", id: "frank" },
        toBe: "viewer",
        onWhat: { type: "doc", id: "doc1#" },
      });

      const result = await authz.check({
        who: { type: "user", id: "frank" },
        canThey: "view",
        onWhat: { type: "doc", id: "doc1#" },
      });
      assert.strictEqual(result, true);
    });
  });

  describe("Empty and Special Character IDs", () => {
    const schema = defineSchema({
      relations: {
        member: { type: "group" },
        viewer: { type: "direct" },
      },
      actionToRelations: {
        view: ["viewer"],
      },
    });

    let storage: InMemoryStorageAdapter;
    let authz: AuthSystem<typeof schema>;

    beforeEach(() => {
      storage = new InMemoryStorageAdapter();
      authz = new AuthSystem({ storage, schema });
    });

    it("should handle empty string IDs", async () => {
      await authz.allow({
        who: { type: "user", id: "" },
        toBe: "viewer",
        onWhat: { type: "doc", id: "" },
      });

      const result = await authz.check({
        who: { type: "user", id: "" },
        canThey: "view",
        onWhat: { type: "doc", id: "" },
      });
      assert.strictEqual(result, true);
    });

    it("should handle Unicode characters in IDs", async () => {
      await authz.allow({
        who: { type: "user", id: "用户123" },
        toBe: "viewer",
        onWhat: { type: "doc", id: "文档456" },
      });

      const result = await authz.check({
        who: { type: "user", id: "用户123" },
        canThey: "view",
        onWhat: { type: "doc", id: "文档456" },
      });
      assert.strictEqual(result, true);
    });

    it("should handle emoji in IDs", async () => {
      await authz.allow({
        who: { type: "user", id: "alice🎉" },
        toBe: "viewer",
        onWhat: { type: "doc", id: "doc📄" },
      });

      const result = await authz.check({
        who: { type: "user", id: "alice🎉" },
        canThey: "view",
        onWhat: { type: "doc", id: "doc📄" },
      });
      assert.strictEqual(result, true);
    });

    it("should handle special characters in IDs", async () => {
      const specialChars = "user!@$%^&*()[]{}|\\;',./`~";
      const docSpecialChars = "doc!@$%^&*()[]{}|\\;',./`~";

      await authz.allow({
        who: { type: "user", id: specialChars },
        toBe: "viewer",
        onWhat: { type: "doc", id: docSpecialChars },
      });

      const result = await authz.check({
        who: { type: "user", id: specialChars },
        canThey: "view",
        onWhat: { type: "doc", id: docSpecialChars },
      });
      assert.strictEqual(result, true);
    });

    it("should handle whitespace in IDs", async () => {
      await authz.allow({
        who: { type: "user", id: "user with spaces" },
        toBe: "viewer",
        onWhat: { type: "doc", id: "doc\twith\ttabs" },
      });

      const result = await authz.check({
        who: { type: "user", id: "user with spaces" },
        canThey: "view",
        onWhat: { type: "doc", id: "doc\twith\ttabs" },
      });
      assert.strictEqual(result, true);
    });

    it("should handle newlines in IDs", async () => {
      await authz.allow({
        who: { type: "user", id: "user\nwith\nnewlines" },
        toBe: "viewer",
        onWhat: { type: "doc", id: "doc\r\nwith\r\ncrlf" },
      });

      const result = await authz.check({
        who: { type: "user", id: "user\nwith\nnewlines" },
        canThey: "view",
        onWhat: { type: "doc", id: "doc\r\nwith\r\ncrlf" },
      });
      assert.strictEqual(result, true);
    });

    it("should handle very long IDs", async () => {
      const longId = "a".repeat(10000);
      const longDocId = "b".repeat(10000);

      await authz.allow({
        who: { type: "user", id: longId },
        toBe: "viewer",
        onWhat: { type: "doc", id: longDocId },
      });

      const result = await authz.check({
        who: { type: "user", id: longId },
        canThey: "view",
        onWhat: { type: "doc", id: longDocId },
      });
      assert.strictEqual(result, true);
    });

    it("should distinguish similar IDs with different special characters", async () => {
      await authz.allow({
        who: { type: "user", id: "alice" },
        toBe: "viewer",
        onWhat: { type: "doc", id: "doc1" },
      });

      // Should not match similar but different IDs
      const resultWithSpace = await authz.check({
        who: { type: "user", id: "alice " },
        canThey: "view",
        onWhat: { type: "doc", id: "doc1" },
      });
      assert.strictEqual(resultWithSpace, false);

      const resultWithUnicode = await authz.check({
        who: { type: "user", id: "аlice" }, // Cyrillic 'а' instead of Latin 'a'
        canThey: "view",
        onWhat: { type: "doc", id: "doc1" },
      });
      assert.strictEqual(resultWithUnicode, false);
    });
  });
});
