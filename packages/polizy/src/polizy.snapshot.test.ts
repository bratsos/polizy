import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { InMemoryStorageAdapter } from "./polizy.in-memory.storage.ts";
import { AuthSystem } from "./polizy.ts";
import { defineSchema } from "./types.ts";

const U = (id: string) => ({ type: "user" as const, id });
const D = (id: string) => ({ type: "document" as const, id });

describe("withSnapshot (point-in-time reads)", () => {
  it("pins reads to a point in time without blocking writers", async () => {
    const adapter = new InMemoryStorageAdapter<"user", "document">();
    await adapter.write([
      { subject: U("alice"), relation: "viewer", object: D("1") },
    ]);

    const result = await adapter.withSnapshot(async (snap) => {
      const before = await snap.findTuples({ object: D("1") });
      // A concurrent writer mutates live storage mid-operation.
      await adapter.write([
        { subject: U("bob"), relation: "viewer", object: D("1") },
      ]);
      await adapter.delete({ who: U("alice"), onWhat: D("1") });
      const after = await snap.findTuples({ object: D("1") });
      return { before: before.length, after: after.length };
    });

    // The snapshot saw exactly one tuple throughout, despite the write+delete.
    assert.equal(result.before, 1);
    assert.equal(result.after, 1);

    // Live storage reflects the concurrent changes: alice gone, bob added.
    const live = await adapter.findTuples({ object: D("1") });
    assert.equal(live.length, 1);
    assert.equal(live[0]?.subject.id, "bob");
  });

  it("an updated condition mid-operation does not leak into the snapshot", async () => {
    const adapter = new InMemoryStorageAdapter<"user", "document">();
    const cond = { attributes: { region: { equals: "eu" } } };
    await adapter.write([
      {
        subject: U("alice"),
        relation: "viewer",
        object: D("1"),
        condition: cond,
      },
    ]);

    const snapCondition = await adapter.withSnapshot(async (snap) => {
      // Overwrite the stored condition while the snapshot is open.
      await adapter.write([
        {
          subject: U("alice"),
          relation: "viewer",
          object: D("1"),
          condition: { attributes: { region: { equals: "us" } } },
        },
      ]);
      const [tuple] = await snap.findTuples({ object: D("1") });
      return tuple?.condition;
    });

    assert.deepEqual(snapCondition, cond); // snapshot keeps the original
    const [liveTuple] = await adapter.findTuples({ object: D("1") });
    assert.deepEqual(liveTuple?.condition, {
      attributes: { region: { equals: "us" } },
    });
  });

  it("a consistency:strong check resolves against one snapshot", async () => {
    // consistency:"strong" routes the whole check through withSnapshot; this
    // asserts results are unchanged on the snapshot path.
    const schema = defineSchema({
      relations: {
        owner: { type: "direct" },
        viewer: { type: "direct" },
        parent: { type: "hierarchy" },
      },
      actionToRelations: { view: ["owner", "viewer"], edit: ["owner"] },
      hierarchyPropagation: { view: ["view"] },
    });
    const authz = new AuthSystem({
      schema,
      storage: new InMemoryStorageAdapter(),
    });
    await authz.allow({
      who: U("alice"),
      toBe: "owner",
      onWhat: { type: "folder", id: "f" },
    });
    await authz.setParent({
      child: D("1"),
      parent: { type: "folder", id: "f" },
    });

    assert.equal(
      await authz.check({
        who: U("alice"),
        canThey: "view",
        onWhat: D("1"),
        consistency: "strong",
      }),
      true,
    );
    assert.equal(
      await authz.check({
        who: U("bob"),
        canThey: "view",
        onWhat: D("1"),
        consistency: "strong",
      }),
      false,
    );
  });
});
