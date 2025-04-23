import { describe, before, after } from "node:test";
import { PrismaClient } from "../prisma/client-generated/index.js";
import { execSync } from "node:child_process";
import { PrismaAdapter } from "./polizy.prisma.storage.ts";

import {
  defineStorageAdapterTestSuite,
  type StorageAdapterTestContext,
  type TestSubject as SharedTestSubject,
  type TestObject as SharedTestObject,
} from "./polizy.storage.shared-tests.ts";

const setupTestDatabase = () => {
  try {
    console.log("Resetting test database...");
    execSync("pnpm prisma migrate reset --force", { stdio: "inherit" });
    execSync("prisma db push --force-reset", { stdio: "inherit" });
    execSync("pnpm prisma generate", { stdio: "inherit" });
    console.log("Test database reset successfully.");
  } catch (error) {
    console.error("Failed to reset test database:", error);
    throw new Error(
      "Database setup failed. Ensure DATABASE_URL is set correctly and Prisma CLI is available.",
    );
  }
};

describe("PrismaStorageAdapter Tests", () => {
  let prisma: PrismaClient;

  before(() => {
    if (!process.env.DATABASE_URL) {
      throw new Error(
        "DATABASE_URL environment variable is not set for testing.",
      );
    }

    prisma = new PrismaClient();
    setupTestDatabase();
  });

  after(async () => {
    await prisma.$disconnect();
  });

  const prismaTestContext: StorageAdapterTestContext = {
    getAdapter: async () => {
      // @ts-ignore
      return PrismaAdapter<SharedTestSubject, SharedTestObject>(prisma);
    },
    cleanup: async () => {
      await prisma.polizyTuple.deleteMany({});
    },
  };

  defineStorageAdapterTestSuite("PrismaStorageAdapter", prismaTestContext);
});
