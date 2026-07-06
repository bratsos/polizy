import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MaxDepthExceededError } from "../errors.ts";
import { InMemoryStorageAdapter } from "../polizy.in-memory.storage.ts";
import { AuthSystem } from "../polizy.ts";
import { defineSchema } from "../types.ts";

describe("engine regressions", () => {
  describe("hierarchy-cycle termination", () => {
    const schema = defineSchema({
      relations: {
        owner: { type: "direct" },
        parent: { type: "hierarchy" },
      },
      actionToRelations: {
        view: ["owner"],
      },
      hierarchyPropagation: {
        view: ["view"],
      },
      subjectTypes: ["user"],
      objectTypes: ["folder"],
    });

    const alice = { type: "user" as const, id: "alice" };
    const bob = { type: "user" as const, id: "bob" };
    const folderA = { type: "folder" as const, id: "a" };
    const folderB = { type: "folder" as const, id: "b" };

    it("terminates hierarchy cycles correctly", async () => {
      const storage = new InMemoryStorageAdapter<any, any>();
      const sysDeny = new AuthSystem({
        schema,
        storage,
        defaultCheckDepth: 5,
        maxDepthBehavior: "deny",
      });

      // folder:a parent folder:b
      await sysDeny.setParent({ child: folderA, parent: folderB });
      // folder:b parent folder:a
      await sysDeny.setParent({ child: folderB, parent: folderA });
      // alice owner of folder:b
      await sysDeny.allow({ who: alice, toBe: "owner", onWhat: folderB });

      // In deny mode assert:
      // check(alice, view, folder:a) === true
      const checkA = await sysDeny.check({
        who: alice,
        canThey: "view",
        onWhat: folderA,
      });
      assert.equal(checkA, true);

      // listSubjects(view, folder:a) includes user:alice
      const subjects = await sysDeny.listSubjects({
        canThey: "view",
        onWhat: folderA,
      });
      const subKeys = subjects.map((s) => `${s.type}:${s.id}`);
      assert.ok(subKeys.includes("user:alice"));

      // listAccessibleObjects(alice, "folder") lists exactly a and b
      const objects = await sysDeny.listAccessibleObjects({
        who: alice,
        ofType: "folder",
      });
      const objIds = objects.accessible.map((a) => a.object.id).sort();
      assert.deepEqual(objIds, ["a", "b"]);

      // explain(bob, view, folder:a) -> allowed:false
      const explanation = await sysDeny.explain({
        who: bob,
        canThey: "view",
        onWhat: folderA,
      });
      assert.equal(explanation.allowed, false);

      // Then with maxDepthBehavior: "throw" (fresh AuthSystem, same storage)
      const sysThrow = new AuthSystem({
        schema,
        storage,
        defaultCheckDepth: 5,
        maxDepthBehavior: "throw",
      });

      // check(alice, view, folder:a) resolves true WITHOUT throwing
      let didThrow = false;
      let checkThrowResult = false;
      try {
        checkThrowResult = await sysThrow.check({
          who: alice,
          canThey: "view",
          onWhat: folderA,
        });
      } catch (e) {
        didThrow = true;
      }
      assert.equal(
        didThrow,
        false,
        "Should not throw on hierarchy cycle within depth cap",
      );
      assert.equal(checkThrowResult, true, "Should resolve true");
    });
  });

  describe("exact depth-cap boundary", () => {
    const schema = defineSchema({
      relations: {
        viewer: { type: "direct" },
        member: { type: "group" },
        parent: { type: "hierarchy" },
      },
      actionToRelations: {
        view: ["viewer"],
      },
      hierarchyPropagation: {
        view: ["view"],
      },
      subjectTypes: ["user"],
      objectTypes: ["document", "team"],
    });

    const alice = { type: "user" as const, id: "alice" };
    const g1 = { type: "team" as const, id: "g1" };
    const g2 = { type: "team" as const, id: "g2" };
    const g3 = { type: "team" as const, id: "g3" };
    const g4 = { type: "team" as const, id: "g4" };
    const doc = { type: "document" as const, id: "doc" };

    it("evaluates pure group chain at depth boundary", async () => {
      const storage = new InMemoryStorageAdapter<any, any>();
      const sysDeny = new AuthSystem({
        schema,
        storage,
        defaultCheckDepth: 3,
        maxDepthBehavior: "deny",
      });

      // Pure group chain: alice -> g1 -> g2 -> g3 (3 hops)
      await sysDeny.addMember({ member: alice, group: g1 });
      await sysDeny.addMember({ member: g1, group: g2 });
      await sysDeny.addMember({ member: g2, group: g3 });
      await sysDeny.allow({ who: g3, toBe: "viewer", onWhat: doc });

      // 3 hops allowed
      assert.equal(
        await sysDeny.check({ who: alice, canThey: "view", onWhat: doc }),
        true,
      );

      const subs3 = await sysDeny.listSubjects({
        canThey: "view",
        onWhat: doc,
      });
      assert.ok(subs3.some((s) => s.type === "user" && s.id === "alice"));

      const objs3 = await sysDeny.listAccessibleObjects({
        who: alice,
        ofType: "document",
      });
      assert.ok(objs3.accessible.some((a) => a.object.id === "doc"));

      // Add one more link (4 hops)
      await sysDeny.addMember({ member: g3, group: g4 });
      await sysDeny.disallowAllMatching({
        who: g3,
        was: "viewer",
        onWhat: doc,
      });
      await sysDeny.allow({ who: g4, toBe: "viewer", onWhat: doc });

      // Now path is: alice -> g1 -> g2 -> g3 -> g4 (4 hops) -> viewer of doc
      assert.equal(
        await sysDeny.check({ who: alice, canThey: "view", onWhat: doc }),
        false,
      );

      const subs4 = await sysDeny.listSubjects({
        canThey: "view",
        onWhat: doc,
      });
      assert.ok(!subs4.some((s) => s.type === "user" && s.id === "alice"));

      const objs4 = await sysDeny.listAccessibleObjects({
        who: alice,
        ofType: "document",
      });
      assert.ok(!objs4.accessible.some((a) => a.object.id === "doc"));

      // With throw mode, 4 hops should throw MaxDepthExceededError
      const sysThrow = new AuthSystem({
        schema,
        storage,
        defaultCheckDepth: 3,
        maxDepthBehavior: "throw",
      });
      await assert.rejects(
        () => sysThrow.check({ who: alice, canThey: "view", onWhat: doc }),
        MaxDepthExceededError,
      );
    });

    it("evaluates pure hierarchy chain at depth boundary", async () => {
      const schemaHier = defineSchema({
        relations: {
          viewer: { type: "direct" },
          parent: { type: "hierarchy" },
        },
        actionToRelations: {
          view: ["viewer"],
        },
        hierarchyPropagation: {
          view: ["view"],
        },
        subjectTypes: ["user"],
        objectTypes: ["document"],
      });

      const storage = new InMemoryStorageAdapter<any, any>();
      const sysDeny = new AuthSystem({
        schema: schemaHier,
        storage,
        defaultCheckDepth: 3,
        maxDepthBehavior: "deny",
      });

      const d1 = { type: "document" as const, id: "d1" };
      const d2 = { type: "document" as const, id: "d2" };
      const d3 = { type: "document" as const, id: "d3" };
      const d4 = { type: "document" as const, id: "d4" };
      const d5 = { type: "document" as const, id: "d5" };

      // pure hierarchy chain: d1 parent d2 parent d3 parent d4 (3 hops)
      await sysDeny.setParent({ child: d1, parent: d2 });
      await sysDeny.setParent({ child: d2, parent: d3 });
      await sysDeny.setParent({ child: d3, parent: d4 });
      await sysDeny.allow({ who: alice, toBe: "viewer", onWhat: d4 });

      // 3 hops allowed (d1 inherits view from d4)
      assert.equal(
        await sysDeny.check({ who: alice, canThey: "view", onWhat: d1 }),
        true,
      );

      const subs3 = await sysDeny.listSubjects({ canThey: "view", onWhat: d1 });
      assert.ok(subs3.some((s) => s.type === "user" && s.id === "alice"));

      const objs3 = await sysDeny.listAccessibleObjects({
        who: alice,
        ofType: "document",
      });
      assert.ok(objs3.accessible.some((a) => a.object.id === "d1"));

      // Add one more link (4 hops)
      await sysDeny.setParent({ child: d4, parent: d5 });
      await sysDeny.disallowAllMatching({
        who: alice,
        was: "viewer",
        onWhat: d4,
      });
      await sysDeny.allow({ who: alice, toBe: "viewer", onWhat: d5 });

      // Now path is: d1 -> d2 -> d3 -> d4 -> d5 (4 hops)
      assert.equal(
        await sysDeny.check({ who: alice, canThey: "view", onWhat: d1 }),
        false,
      );

      const subs4 = await sysDeny.listSubjects({ canThey: "view", onWhat: d1 });
      assert.ok(!subs4.some((s) => s.type === "user" && s.id === "alice"));

      const objs4 = await sysDeny.listAccessibleObjects({
        who: alice,
        ofType: "document",
      });
      assert.ok(!objs4.accessible.some((a) => a.object.id === "d1"));

      // With throw mode, 4 hops should throw MaxDepthExceededError
      const sysThrow = new AuthSystem({
        schema: schemaHier,
        storage,
        defaultCheckDepth: 3,
        maxDepthBehavior: "throw",
      });
      await assert.rejects(
        () => sysThrow.check({ who: alice, canThey: "view", onWhat: d1 }),
        MaxDepthExceededError,
      );
    });
  });
});
