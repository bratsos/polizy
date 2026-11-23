import { definePrismaConfig } from "@prisma/cli-engine";
import { defineConfig as ormConfig } from "@prisma/orm-postgres/config";

const url = process.env.POLIZY_TEST_POSTGRES_URL;
if (!url)
  throw new Error(
    "Set POLIZY_TEST_POSTGRES_URL to a disposable test database.",
  );

export default definePrismaConfig({
  orm: ormConfig({
    contract: "./src/prisma/contract.prisma",
    db: { connection: url },
  }),
});
