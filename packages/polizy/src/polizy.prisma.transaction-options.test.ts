import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PrismaAdapter } from "./polizy.prisma.storage.ts";

describe("PrismaAdapter transactionOptions unit tests", () => {
  it("should record transaction options correctly", async () => {
    let recordedOptions: any = null;
    let callCount = 0;

    const mockPrisma = {
      async $transaction(arg1: any, arg2?: any) {
        callCount++;
        if (typeof arg1 === "function") {
          recordedOptions = arg2;
          const mockTx = {
            polizyTuple: {
              findMany: async () => [],
            },
          };
          return arg1(mockTx);
        }
        throw new Error("Expected function call to $transaction");
      },
      polizyTuple: {
        upsert: () => {},
        deleteMany: async () => ({ count: 0 }),
        findMany: async () => [],
      },
    };

    // Case (a): both snapshotIsolationLevel and transactionOptions
    const adapterA = PrismaAdapter(mockPrisma as any, {
      snapshotIsolationLevel: "RepeatableRead",
      transactionOptions: { timeout: 30000, maxWait: 5000 },
    });

    assert.ok(adapterA.withSnapshot);
    await adapterA.withSnapshot(async (reader) => {
      await reader.findTuples({});
    });

    assert.strictEqual(callCount, 1);
    assert.deepStrictEqual(recordedOptions, {
      isolationLevel: "RepeatableRead",
      timeout: 30000,
      maxWait: 5000,
    });

    // Reset recorded state
    recordedOptions = null;
    callCount = 0;

    // Case (b): ONLY transactionOptions
    const adapterB = PrismaAdapter(mockPrisma as any, {
      transactionOptions: { timeout: 30000, maxWait: 5000 },
    });

    assert.ok(adapterB.withSnapshot);
    await adapterB.withSnapshot(async (reader) => {
      await reader.findTuples({});
    });

    assert.strictEqual(callCount, 1);
    assert.ok(recordedOptions);
    assert.strictEqual(recordedOptions.timeout, 30000);
    assert.strictEqual(recordedOptions.maxWait, 5000);
    assert.strictEqual("isolationLevel" in recordedOptions, false);

    // Reset recorded state
    recordedOptions = null;
    callCount = 0;

    // Case (c): NO options
    const adapterC = PrismaAdapter(mockPrisma as any);

    assert.ok(adapterC.withSnapshot);
    await adapterC.withSnapshot(async (reader) => {
      await reader.findTuples({});
    });

    assert.strictEqual(callCount, 1);
    assert.strictEqual(recordedOptions, undefined);
  });
});
