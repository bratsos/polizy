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

    it("findSubjects() should return subjects with specified relation to object", async () => {
      await adapter.write([
        {
          subject: { type: "user", id: "alice" },
          relation: "viewer",
          object: { type: "document", id: "doc1" },
        },
        {
          subject: { type: "user", id: "bob" },
          relation: "viewer",
          object: { type: "document", id: "doc1" },
        },
        {
          subject: { type: "group", id: "engineering" },
          relation: "viewer",
          object: { type: "document", id: "doc1" },
        },
        {
          subject: { type: "user", id: "charlie" },
          relation: "editor",
          object: { type: "document", id: "doc1" },
        },
        {
          subject: { type: "user", id: "dave" },
          relation: "viewer",
          object: { type: "document", id: "doc2" },
        },
      ]);

      const subjects = await adapter.findSubjects(
        { type: "document", id: "doc1" },
        "viewer",
      );

      assert.strictEqual(
        subjects.length,
        3,
        "Should find 3 subjects with viewer relation to doc1",
      );

      const subjectIds = subjects.map((s) => s.id).sort();
      assert.deepStrictEqual(
        subjectIds,
        ["alice", "bob", "engineering"],
        "Should return alice, bob, and engineering as viewers",
      );
    });

    it("findSubjects() should filter by subjectType", async () => {
      await adapter.write([
        {
          subject: { type: "user", id: "alice" },
          relation: "viewer",
          object: { type: "document", id: "doc1" },
        },
        {
          subject: { type: "user", id: "bob" },
          relation: "viewer",
          object: { type: "document", id: "doc1" },
        },
        {
          subject: { type: "group", id: "engineering" },
          relation: "viewer",
          object: { type: "document", id: "doc1" },
        },
        {
          subject: { type: "group", id: "marketing" },
          relation: "viewer",
          object: { type: "document", id: "doc1" },
        },
      ]);

      const userSubjects = await adapter.findSubjects(
        { type: "document", id: "doc1" },
        "viewer",
        { subjectType: "user" },
      );

      assert.strictEqual(
        userSubjects.length,
        2,
        "Should find only 2 user-type subjects",
      );

      const userIds = userSubjects.map((s) => s.id).sort();
      assert.deepStrictEqual(
        userIds,
        ["alice", "bob"],
        "Should return only alice and bob (users)",
      );

      userSubjects.forEach((s) => {
        assert.strictEqual(
          s.type,
          "user",
          "All returned subjects should be of type user",
        );
      });
    });

    it("findObjects() should return objects that subject has relation to", async () => {
      await adapter.write([
        {
          subject: { type: "user", id: "alice" },
          relation: "viewer",
          object: { type: "document", id: "doc1" },
        },
        {
          subject: { type: "user", id: "alice" },
          relation: "viewer",
          object: { type: "document", id: "doc2" },
        },
        {
          subject: { type: "user", id: "alice" },
          relation: "viewer",
          object: { type: "folder", id: "folder1" },
        },
        {
          subject: { type: "user", id: "alice" },
          relation: "editor",
          object: { type: "document", id: "doc3" },
        },
        {
          subject: { type: "user", id: "bob" },
          relation: "viewer",
          object: { type: "document", id: "doc4" },
        },
      ]);

      const objects = await adapter.findObjects(
        { type: "user", id: "alice" },
        "viewer",
      );

      assert.strictEqual(
        objects.length,
        3,
        "Should find 3 objects alice has viewer relation to",
      );

      const objectIds = objects.map((o) => o.id).sort();
      assert.deepStrictEqual(
        objectIds,
        ["doc1", "doc2", "folder1"],
        "Should return doc1, doc2, and folder1 as objects alice can view",
      );
    });

    it("findObjects() should filter by objectType", async () => {
      await adapter.write([
        {
          subject: { type: "user", id: "alice" },
          relation: "viewer",
          object: { type: "document", id: "doc1" },
        },
        {
          subject: { type: "user", id: "alice" },
          relation: "viewer",
          object: { type: "document", id: "doc2" },
        },
        {
          subject: { type: "user", id: "alice" },
          relation: "viewer",
          object: { type: "folder", id: "folder1" },
        },
        {
          subject: { type: "user", id: "alice" },
          relation: "viewer",
          object: { type: "folder", id: "folder2" },
        },
      ]);

      const documentObjects = await adapter.findObjects(
        { type: "user", id: "alice" },
        "viewer",
        { objectType: "document" },
      );

      assert.strictEqual(
        documentObjects.length,
        2,
        "Should find only 2 document-type objects",
      );

      const docIds = documentObjects.map((o) => o.id).sort();
      assert.deepStrictEqual(
        docIds,
        ["doc1", "doc2"],
        "Should return only doc1 and doc2 (documents)",
      );

      documentObjects.forEach((o) => {
        assert.strictEqual(
          o.type,
          "document",
          "All returned objects should be of type document",
        );
      });
    });

    it("write() should handle tuples with conditions", async () => {
      const futureDate = new Date(Date.now() + 86400000); // tomorrow
      const pastDate = new Date(Date.now() - 86400000); // yesterday

      const tuplesToWrite: InputTuple<TestSubject, TestObject>[] = [
        {
          subject: { type: "user", id: "tempUser" },
          relation: "viewer",
          object: { type: "document", id: "tempDoc" },
          condition: { validUntil: futureDate },
        },
        {
          subject: { type: "user", id: "scheduledUser" },
          relation: "editor",
          object: { type: "folder", id: "scheduledFolder" },
          condition: { validSince: pastDate, validUntil: futureDate },
        },
      ];

      const storedTuples = await adapter.write(tuplesToWrite);

      assert.strictEqual(
        storedTuples.length,
        2,
        "Should store both tuples with conditions",
      );

      const tempTuple = storedTuples.find((t) => t.subject.id === "tempUser");
      assert.ok(tempTuple, "Should find the tempUser tuple");
      assert.ok(tempTuple.condition, "tempUser tuple should have a condition");
      assert.ok(
        tempTuple.condition.validUntil,
        "tempUser tuple should have validUntil",
      );
      assert.strictEqual(
        tempTuple.condition.validUntil.getTime(),
        futureDate.getTime(),
        "validUntil should match the future date",
      );
      assert.strictEqual(
        tempTuple.condition.validSince,
        undefined,
        "tempUser tuple should not have validSince",
      );

      const scheduledTuple = storedTuples.find(
        (t) => t.subject.id === "scheduledUser",
      );
      assert.ok(scheduledTuple, "Should find the scheduledUser tuple");
      assert.ok(
        scheduledTuple.condition,
        "scheduledUser tuple should have a condition",
      );
      assert.ok(
        scheduledTuple.condition.validSince,
        "scheduledUser tuple should have validSince",
      );
      assert.ok(
        scheduledTuple.condition.validUntil,
        "scheduledUser tuple should have validUntil",
      );
      assert.strictEqual(
        scheduledTuple.condition.validSince.getTime(),
        pastDate.getTime(),
        "validSince should match the past date",
      );
      assert.strictEqual(
        scheduledTuple.condition.validUntil.getTime(),
        futureDate.getTime(),
        "validUntil should match the future date",
      );

      // Verify tuples can be retrieved with conditions intact
      const foundTuples = await adapter.findTuples({
        subject: { type: "user", id: "tempUser" },
      });
      assert.strictEqual(foundTuples.length, 1, "Should find tempUser tuple");
      assert.ok(foundTuples[0], "Should have found tuple");
      assert.ok(
        foundTuples[0].condition,
        "Retrieved tuple should have condition",
      );
      assert.ok(
        foundTuples[0].condition.validUntil,
        "Retrieved tuple should have validUntil",
      );
      assert.strictEqual(
        foundTuples[0].condition.validUntil.getTime(),
        futureDate.getTime(),
        "Retrieved validUntil should match",
      );
    });
  });
}
