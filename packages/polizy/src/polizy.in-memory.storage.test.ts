import { describe } from "node:test";
import { InMemoryStorageAdapter } from "./polizy.in-memory.storage.ts";

import {
  defineStorageAdapterTestSuite,
  type StorageAdapterTestContext,
  type TestSubject as SharedTestSubject,
  type TestObject as SharedTestObject,
} from "./polizy.storage.shared-tests.ts";

describe("InMemoryStorageAdapter Tests", () => {
  const inMemoryTestContext: StorageAdapterTestContext = {
    getAdapter: async () => {
      return new InMemoryStorageAdapter<SharedTestSubject, SharedTestObject>();
    },
  };

  defineStorageAdapterTestSuite("InMemoryStorageAdapter", inMemoryTestContext);
});
