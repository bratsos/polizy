import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { StorageAdapter } from "./polizy.storage";
import type { InputTuple } from "./types";

export type TestSubject = "user" | "document" | "group";
export type TestObject = "document" | "folder" | "group";

export interface StorageAdapterTestContext {
  getAdapter: () => Promise<StorageAdapter<TestSubject, TestObject>>;
  cleanup?: () => Promise<void>;
}

export function defineStorageAdapterTestSuite(
  adapterName: string,
  context: StorageAdapterTestContext,
) {
  describe(`${adapterName} Shared Tests`, () => {
    let adapter: StorageAdapter<TestSubject, TestObject>;

    beforeEach(async () => {
      adapter = await context.getAdapter();
    });

    afterEach(async () => {
      if (context.cleanup) {
        await context.cleanup();
      }
    });

    it("write() should add tuples and return them with IDs", async () => {
      const tuplesToWrite: InputTuple<TestSubject, TestObject>[] = [
        {
          subject: { type: "user", id: "alice" },
          relation: "owner",
          object: { type: "document", id: "doc1" },
        },
        {
          subject: { type: "user", id: "bob" },
          relation: "viewer",
          object: { type: "folder", id: "f1" },
        },
      ];
      const storedTuples = await adapter.write(tuplesToWrite);

      assert.strictEqual(
        storedTuples.length,
        tuplesToWrite.length,
        "Stored tuple count should match input count",
      );
      storedTuples.forEach((st, index) => {
        const inputTuple = tuplesToWrite[index];
        assert.ok(inputTuple, `Input tuple at index ${index} should exist`);
        assert.ok(st.id, `Stored tuple ${index} should have an ID`);
        assert.deepStrictEqual(
          st.subject,
          inputTuple.subject,
          `Subject mismatch for tuple ${index}`,
        );
        assert.strictEqual(
          st.relation,
          inputTuple.relation,
          `Relation mismatch for tuple ${index}`,
        );
        assert.deepStrictEqual(
          st.object,
          inputTuple.object,
          `Object mismatch for tuple ${index}`,
        );
        assert.strictEqual(
          st.condition,
          inputTuple.condition,
          `Condition mismatch for tuple ${index}`,
        );
      });

      const found = await adapter.findTuples({
        subject: { type: "user", id: "alice" },
        relation: "owner",
        object: { type: "document", id: "doc1" },
      });
      assert.strictEqual(
        found.length,
        1,
        "Should find exactly one tuple for alice",
      );
      const expectedTuple = storedTuples.find(
        (st) => st.subject.id === "alice",
      );
      assert.ok(
        expectedTuple,
        "Could not find expected tuple for alice among stored tuples",
      );
      assert.ok(found[0], "Expected found tuple at index 0");
      assert.deepStrictEqual(
        found[0],
        expectedTuple,
        "Found tuple should match stored tuple",
      );
    });

    it("findTuples() should filter correctly by various criteria", async () => {
      await adapter.write([
        {
          subject: { type: "user", id: "u1" },
          relation: "r1",
          object: { type: "document", id: "d1" },
        },
        {
          subject: { type: "user", id: "u1" },
          relation: "r2",
          object: { type: "document", id: "d1" },
        },
        {
          subject: { type: "user", id: "u2" },
          relation: "r1",
          object: { type: "document", id: "d1" },
        },
        {
          subject: { type: "user", id: "u1" },
          relation: "r1",
          object: { type: "folder", id: "f1" },
        },
      ]);

      let results = await adapter.findTuples({
        subject: { type: "user", id: "u1" },
      });
      assert.strictEqual(results.length, 3, "Filter by subject u1 failed");

      results = await adapter.findTuples({ relation: "r1" });
      assert.strictEqual(results.length, 3, "Filter by relation r1 failed");

      results = await adapter.findTuples({
        object: { type: "document", id: "d1" },
      });
      assert.strictEqual(results.length, 3, "Filter by object d1 failed");

      results = await adapter.findTuples({
        subject: { type: "user", id: "u1" },
        relation: "r1",
      });
      assert.strictEqual(
        results.length,
        2,
        "Filter by subject u1 and relation r1 failed",
      );

      results = await adapter.findTuples({
        subject: { type: "user", id: "u1" },
        relation: "r1",
        object: { type: "folder", id: "f1" },
      });
      assert.strictEqual(results.length, 1, "Filter by full tuple failed");
      assert.ok(results[0], "Expected result for full tuple filter");
      assert.strictEqual(
        results[0].object.id,
        "f1",
        "Full tuple filter returned wrong object",
      );

      results = await adapter.findTuples({
        subject: { type: "user", id: "u3" },
      });
      assert.strictEqual(
        results.length,
        0,
        "Filter for non-existent subject should return empty",
      );
    });

    it("delete() should remove single tuple matching all criteria", async () => {
      const written = await adapter.write([
        {
          subject: { type: "user", id: "del1" },
          relation: "owner",
          object: { type: "document", id: "docDel" },
        },
        {
          subject: { type: "user", id: "keep1" },
          relation: "viewer",
          object: { type: "document", id: "docKeep" },
        },
      ]);

      const tupleToDelete = written[0];
      assert.ok(tupleToDelete, "Failed to write tuple for deletion test");

      const deleteCount = await adapter.delete({
        who: tupleToDelete.subject,
        was: tupleToDelete.relation,
        onWhat: tupleToDelete.object,
      });
      assert.strictEqual(deleteCount, 1, "Should report 1 deleted tuple");

      const remaining = await adapter.findTuples({});
      assert.strictEqual(remaining.length, 1, "Should have 1 tuple remaining");
      assert.ok(remaining[0], "Expected remaining tuple");
      assert.strictEqual(
        remaining[0].subject.id,
        "keep1",
        "Incorrect tuple remained",
      );
    });

    it("delete() should remove multiple tuples matching partial criteria (who)", async () => {
      await adapter.write([
        {
          subject: { type: "user", id: "delMulti" },
          relation: "owner",
          object: { type: "document", id: "d1" },
        },
        {
          subject: { type: "user", id: "delMulti" },
          relation: "viewer",
          object: { type: "folder", id: "f1" },
        },
        {
          subject: { type: "user", id: "keepMulti" },
          relation: "editor",
          object: { type: "document", id: "d2" },
        },
      ]);

      const deleteCount = await adapter.delete({
        who: { type: "user", id: "delMulti" },
      });
      assert.strictEqual(
        deleteCount,
        2,
        "Should report 2 deleted tuples for user delMulti",
      );

      const remaining = await adapter.findTuples({});
      assert.strictEqual(
        remaining.length,
        1,
        "Should have 1 tuple remaining after multi-delete",
      );
      assert.ok(remaining[0], "Expected remaining tuple after multi-delete");
      assert.strictEqual(
        remaining[0].subject.id,
        "keepMulti",
        "Incorrect tuple remained after multi-delete",
      );
    });

    it("delete({ onWhat: ... }) should remove tuples where target is SUBJECT and OBJECT", async () => {
      const docId = "sdf";
      const folderId = "folder-test-1";
      const userId = "alice";

      await adapter.write([
        {
          subject: { type: "user", id: userId },
          relation: "owner",
          object: { type: "document", id: docId },
        },
        {
          subject: { type: "document", id: docId },
          relation: "parent",
          object: { type: "folder", id: folderId },
        },
        {
          subject: { type: "user", id: "bob" },
          relation: "viewer",
          object: { type: "folder", id: folderId },
        },
      ]);

      const deleteCount = await adapter.delete({
        onWhat: { type: "document", id: docId },
      });

      assert.strictEqual(deleteCount, 2, "Should report 2 deleted tuples");

      const remainingTuples = await adapter.findTuples({});
      assert.strictEqual(
        remainingTuples.length,
        1,
        "Should only have 1 tuple remaining",
      );

      const remaining = remainingTuples[0];
      assert.ok(remaining, "Expected a remaining tuple");
      assert.strictEqual(
        remaining.subject.id,
        "bob",
        "Remaining subject ID mismatch",
      );
      assert.strictEqual(
        remaining.relation,
        "viewer",
        "Remaining relation mismatch",
      );
      assert.strictEqual(
        remaining.object.id,
        folderId,
        "Remaining object ID mismatch",
      );
    });

    it("write() round-trips a Date condition as a Date (not a string)", async () => {
      const validUntil = new Date(Date.now() + 3_600_000);
      await adapter.write([
        {
          subject: { type: "user", id: "tina" },
          relation: "viewer",
          object: { type: "document", id: "timed" },
          condition: { validUntil },
        },
      ]);

      const found = await adapter.findTuples({
        subject: { type: "user", id: "tina" },
        relation: "viewer",
        object: { type: "document", id: "timed" },
      });
      assert.strictEqual(found.length, 1, "Should find the conditioned tuple");
      assert.ok(
        found[0]?.condition,
        "Condition should be present after round-trip",
      );
      assert.ok(
        found[0].condition.validUntil instanceof Date,
        "validUntil should be a Date instance, not a string",
      );
      assert.strictEqual(
        found[0].condition.validUntil.getTime(),
        validUntil.getTime(),
        "validUntil should survive the round-trip exactly",
      );
    });

    it("write() is idempotent on the (subject, relation, object) key", async () => {
      const tuple = {
        subject: { type: "user" as const, id: "ida" },
        relation: "viewer" as const,
        object: { type: "document" as const, id: "idoc" },
      };
      await adapter.write([tuple]);
      await adapter.write([
        { ...tuple, condition: { validUntil: new Date(Date.now() + 1000) } },
      ]);

      const all = await adapter.findTuples({
        subject: { type: "user", id: "ida" },
      });
      assert.strictEqual(
        all.length,
        1,
        "Re-writing the same tuple must not duplicate it",
      );
      assert.ok(
        all[0]?.condition?.validUntil,
        "Condition should reflect the latest write",
      );
    });

    it("delete({ who, was, onWhat }) does not over-delete when onWhat is also a subject", async () => {
      // removeParent(doc1, f1): must delete only doc1->f1, never f1->root.
      await adapter.write([
        {
          subject: { type: "document", id: "doc1" },
          relation: "parent",
          object: { type: "folder", id: "f1" },
        },
        {
          subject: { type: "folder", id: "f1" },
          relation: "parent",
          object: { type: "folder", id: "root" },
        },
      ]);

      const deleted = await adapter.delete({
        who: { type: "document", id: "doc1" },
        was: "parent",
        onWhat: { type: "folder", id: "f1" },
      });
      assert.strictEqual(deleted, 1, "Should delete exactly the doc1->f1 link");

      const f1Parent = await adapter.findTuples({
        subject: { type: "folder", id: "f1" },
        relation: "parent",
      });
      assert.strictEqual(
        f1Parent.length,
        1,
        "f1->root must survive removeParent(doc1, f1)",
      );
    });

    it("findTuples() supports limit/offset pagination in stable order", async () => {
      for (let i = 0; i < 5; i++) {
        await adapter.write([
          {
            subject: { type: "user", id: `p${i}` },
            relation: "viewer",
            object: { type: "document", id: "paged" },
          },
        ]);
      }
      const page = await adapter.findTuples(
        { object: { type: "document", id: "paged" } },
        { limit: 2, offset: 2 },
      );
      assert.strictEqual(
        page.length,
        2,
        "Should return exactly the requested page size",
      );
    });

    it("findTuples() with an explicitly-undefined condition filter returns tuples with and without conditions", async () => {
      const subject = { type: "user" as const, id: "cond-test-subject" };
      await adapter.write([
        {
          subject,
          relation: "viewer",
          object: { type: "document", id: "doc-with-cond" },
          condition: { validUntil: new Date(Date.now() + 3_600_000) },
        },
        {
          subject,
          relation: "viewer",
          object: { type: "document", id: "doc-without-cond" },
        },
      ]);

      const results = await adapter.findTuples({
        subject,
        condition: undefined,
      } as Partial<InputTuple<TestSubject, TestObject>>);

      assert.strictEqual(
        results.length,
        2,
        "Should return both tuples when condition is explicitly undefined",
      );
    });

    it("write() round-trips a full condition (validSince, validUntil, attributes)", async () => {
      const subject = { type: "user" as const, id: "full-cond-user" };
      const validSince = new Date(Date.now() - 3_600_000);
      const validUntil = new Date(Date.now() + 3_600_000);
      const attributes = [
        { attribute: "user.dept", operator: "eq" as const, value: "eng" },
        { attribute: "user.level", operator: "gte" as const, value: 3 },
        {
          attribute: "user.region",
          operator: "in" as const,
          value: ["eu", "us"],
        },
      ];
      await adapter.write([
        {
          subject,
          relation: "viewer",
          object: { type: "document", id: "full-cond-doc" },
          condition: { validSince, validUntil, attributes },
        },
      ]);

      const found = await adapter.findTuples({ subject });
      assert.strictEqual(found.length, 1, "Should find the conditioned tuple");
      const condition = found[0]?.condition;
      assert.ok(condition, "Condition should be present after round-trip");
      assert.ok(
        condition.validSince instanceof Date,
        "validSince should be a Date instance",
      );
      assert.ok(
        condition.validUntil instanceof Date,
        "validUntil should be a Date instance",
      );
      assert.strictEqual(
        condition.validSince.getTime(),
        validSince.getTime(),
        "validSince should survive the round-trip exactly",
      );
      assert.strictEqual(
        condition.validUntil.getTime(),
        validUntil.getTime(),
        "validUntil should survive the round-trip exactly",
      );
      assert.deepStrictEqual(
        condition.attributes,
        attributes,
        "attributes should survive the round-trip unchanged",
      );
    });

    it("write() without a condition keeps the existing condition on the same key", async () => {
      const subject = { type: "user" as const, id: "keep-cond-user" };
      const object = { type: "document" as const, id: "keep-cond-doc" };
      const validUntil = new Date(Date.now() + 3_600_000);
      await adapter.write([
        { subject, relation: "viewer", object, condition: { validUntil } },
      ]);
      await adapter.write([{ subject, relation: "viewer", object }]);

      const found = await adapter.findTuples({ subject, object });
      assert.strictEqual(
        found.length,
        1,
        "Re-write must not duplicate the tuple",
      );
      assert.ok(
        found[0]?.condition?.validUntil instanceof Date,
        "Existing condition should be kept when re-written without one",
      );
      assert.strictEqual(
        found[0].condition.validUntil.getTime(),
        validUntil.getTime(),
        "validUntil should match the original condition",
      );
    });

    it("findTuples() pagination is stable and complete", async () => {
      const object = { type: "document" as const, id: "pag-stable-doc" };
      for (let i = 0; i < 5; i++) {
        await adapter.write([
          {
            subject: { type: "user", id: `pag-u${i}` },
            relation: "viewer",
            object,
          },
        ]);
      }
      const filter = { object };
      const page1 = await adapter.findTuples(filter, { limit: 2, offset: 0 });
      const page2 = await adapter.findTuples(filter, { limit: 2, offset: 2 });
      const page3 = await adapter.findTuples(filter, { limit: 2, offset: 4 });

      assert.strictEqual(page1.length, 2, "Page 1 should have 2 tuples");
      assert.strictEqual(page2.length, 2, "Page 2 should have 2 tuples");
      assert.strictEqual(page3.length, 1, "Page 3 should have 1 tuple");

      const ids = [...page1, ...page2, ...page3].map((t) => t.id);
      assert.strictEqual(
        new Set(ids).size,
        ids.length,
        "No tuple id should appear on more than one page",
      );

      const all = await adapter.findTuples(filter);
      assert.deepStrictEqual(
        [...ids].sort(),
        all.map((t) => t.id).sort(),
        "Union of pages should equal the unpaginated result",
      );

      const page1Again = await adapter.findTuples(filter, {
        limit: 2,
        offset: 0,
      });
      assert.deepStrictEqual(
        page1Again.map((t) => t.id),
        page1.map((t) => t.id),
        "Re-reading page 1 should return the same ids in the same order",
      );
    });

    it("findTuples({}) returns every tuple", async () => {
      const written = await adapter.write([
        {
          subject: { type: "user", id: "all-u1" },
          relation: "viewer",
          object: { type: "document", id: "all-d1" },
        },
        {
          subject: { type: "group", id: "all-g1" },
          relation: "viewer",
          object: { type: "folder", id: "all-f1" },
        },
        {
          subject: { type: "user", id: "all-u2" },
          relation: "owner",
          object: { type: "group", id: "all-g2" },
        },
      ]);

      const all = await adapter.findTuples({});
      assert.strictEqual(
        all.length,
        3,
        "Empty filter should return all tuples",
      );
      assert.deepStrictEqual(
        all.map((t) => t.id).sort(),
        written.map((t) => t.id).sort(),
        "Empty filter should return the ids of every written tuple",
      );
    });

    it("findSubjects() and findObjects() return matching subjects and objects", async () => {
      await adapter.write([
        {
          subject: { type: "user", id: "fs-a" },
          relation: "viewer",
          object: { type: "document", id: "fs-d" },
        },
        {
          subject: { type: "user", id: "fs-b" },
          relation: "viewer",
          object: { type: "document", id: "fs-d" },
        },
        {
          subject: { type: "user", id: "fs-a" },
          relation: "viewer",
          object: { type: "document", id: "fs-e" },
        },
        {
          subject: { type: "group", id: "fs-g" },
          relation: "viewer",
          object: { type: "document", id: "fs-d" },
        },
      ]);

      const subjects = await adapter.findSubjects(
        { type: "document", id: "fs-d" },
        "viewer",
      );
      assert.deepStrictEqual(
        subjects.map((s) => `${s.type}:${s.id}`).sort(),
        ["group:fs-g", "user:fs-a", "user:fs-b"],
        "findSubjects should return user:a, user:b and group:g without duplicates",
      );

      const userSubjects = await adapter.findSubjects(
        { type: "document", id: "fs-d" },
        "viewer",
        { subjectType: "user" },
      );
      assert.deepStrictEqual(
        userSubjects.map((s) => `${s.type}:${s.id}`).sort(),
        ["user:fs-a", "user:fs-b"],
        "subjectType filter should return only the two users",
      );

      const objects = await adapter.findObjects(
        { type: "user", id: "fs-a" },
        "viewer",
      );
      assert.deepStrictEqual(
        objects.map((o) => `${o.type}:${o.id}`).sort(),
        ["document:fs-d", "document:fs-e"],
        "findObjects should return document:d and document:e",
      );

      const folderObjects = await adapter.findObjects(
        { type: "user", id: "fs-a" },
        "viewer",
        { objectType: "folder" },
      );
      assert.strictEqual(
        folderObjects.length,
        0,
        "objectType filter for folder should return nothing",
      );
    });

    it("withSnapshot() exposes a reader that sees written tuples (when implemented)", async () => {
      if (!adapter.withSnapshot) {
        return;
      }
      const subject = { type: "user" as const, id: "snap-user" };
      await adapter.write([
        {
          subject,
          relation: "viewer",
          object: { type: "document", id: "snap-doc" },
        },
      ]);

      const found = await adapter.withSnapshot(async (reader) =>
        reader.findTuples({ subject }),
      );
      assert.strictEqual(
        found.length,
        1,
        "Snapshot reader should see the tuple",
      );
      assert.strictEqual(
        found[0]?.object.id,
        "snap-doc",
        "Snapshot reader returned the wrong tuple",
      );
    });
  });
}
