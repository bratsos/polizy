import assert from "node:assert/strict";
import { after, afterEach, describe, it } from "node:test";
import postgres from "@prisma/orm-postgres/runtime";
import { contractFromJson } from "@prisma/orm-postgres/static";
import { AuthSystem, defineSchema } from "polizy";
import { PrismaAdapter, PrismaRoleCatalog } from "polizy/prisma-storage";
import { defineStorageAdapterTestSuite } from "polizy/storage-tests";
import type { Contract } from "./prisma/contract.d.ts";
import contractJson from "./prisma/contract.json" with { type: "json" };

const db = postgres({
  contract: contractFromJson<Contract>(contractJson),
  url: process.env.POLIZY_TEST_POSTGRES_URL,
});

const clear = async () => {
  await db.execute(
    db.raw.sql`TRUNCATE "PolizyTuple", "PolizyRole"`.affectedCount().build(),
  );
};

after(async () => {
  await clear();
  await db.close();
});

defineStorageAdapterTestSuite("Prisma 8 (root client)", {
  getAdapter: async () =>
    PrismaAdapter(db, { snapshotIsolationLevel: "RepeatableRead" }),
  cleanup: clear,
});

const schema = defineSchema({
  subjectTypes: ["user"],
  objectTypes: ["property", "account"],
  relations: {
    manager: { type: "direct" },
    account_owner: { type: "direct" },
    parent: { type: "hierarchy" },
  },
  actionToRelations: { manage: ["manager", "account_owner"] },
  hierarchyPropagation: { manage: ["manage"] },
});

const alice = { type: "user" as const, id: "alice" };
const property = { type: "property" as const, id: "p1" };
const account = { type: "account" as const, id: "a1" };

describe("Prisma 8", () => {
  afterEach(clear);

  it("runs every query on the caller's transaction and offers no snapshot", async () => {
    await assert.rejects(
      db.transaction(async (tx) => {
        const adapter = PrismaAdapter(tx);
        assert.equal(adapter.withSnapshot, undefined);
        await adapter.write([
          { subject: alice, relation: "manager", object: property },
          { subject: alice, relation: "account_owner", object: account },
        ]);
        // Uncommitted writes are only visible on the same transaction.
        assert.equal((await adapter.findTuples({ subject: alice })).length, 2);
        assert.equal(await adapter.delete({ was: "account_owner" }), 1);
        throw new Error("roll back");
      }),
      /roll back/,
    );
    const left = await PrismaAdapter(db).findTuples({});
    assert.equal(left.length, 0, "the writes rolled back with the caller");
  });

  it("checks and explains through a transaction-bound adapter", async () => {
    await db.transaction(async (tx) => {
      const authz = new AuthSystem({ storage: PrismaAdapter(tx), schema });
      await authz.setParent({ child: property, parent: account });
      const grant = await authz.allow({
        who: alice,
        toBe: "account_owner",
        onWhat: account,
      });
      const request = {
        who: alice,
        canThey: "manage" as const,
        onWhat: property,
      };
      // No withSnapshot on a transaction: "strong" reads follow the caller.
      assert.equal(
        await authz.check({ ...request, consistency: "strong" }),
        true,
      );
      const { via } = await authz.explain(request);
      assert.equal(via?.kind, "hierarchy");
      assert.equal(via?.kind === "hierarchy" && via.via.kind, "direct");
      assert.equal(
        via?.kind === "hierarchy" && "tuple" in via.via && via.via.tuple.id,
        grant.id,
      );
    });
  });

  it("pins withSnapshot reads to one snapshot on a root client", async () => {
    const adapter = PrismaAdapter(db, {
      snapshotIsolationLevel: "RepeatableRead",
    });
    await adapter.withSnapshot?.(async (reader) => {
      assert.equal((await reader.findTuples({})).length, 0);
      // Committed by another transaction while the snapshot is open.
      await adapter.write([
        { subject: alice, relation: "manager", object: property },
      ]);
      assert.equal((await reader.findTuples({})).length, 0);
    });
    assert.equal((await adapter.findTuples({})).length, 1);
  });

  it("treats a hand-made wrapper of the root client as a root client", async () => {
    const wrapper = { orm: db.orm, transaction: db.transaction.bind(db) };
    const adapter = PrismaAdapter(wrapper);
    assert.ok(adapter.withSnapshot, "a root client offers snapshots");
    const invalid = {
      subject: alice,
      relation: undefined as never,
      object: account,
    };
    await assert.rejects(
      adapter.write([
        { subject: alice, relation: "manager", object: property },
        invalid,
      ]),
    );
    assert.equal((await PrismaAdapter(db).findTuples({})).length, 0);
  });

  it("rejects an object that can neither open a transaction nor is one", () => {
    assert.throws(() => PrismaAdapter({ orm: db.orm }), /could not be atomic/);
  });

  it("keeps subjects apart when a type or id contains a colon", async () => {
    const adapter = PrismaAdapter(db);
    await adapter.write([
      {
        subject: { type: "a:b", id: "c" },
        relation: "viewer",
        object: property,
      },
      {
        subject: { type: "a", id: "b:c" },
        relation: "viewer",
        object: property,
      },
    ]);
    assert.equal((await adapter.findSubjects(property, "viewer")).length, 2);
  });

  it("stores the role catalog", async () => {
    const catalog = PrismaRoleCatalog(db);
    const tenant = "property:p1";
    await catalog.upsert({ tenant, key: "desk", actions: ["check_in"] });
    await catalog.upsert({
      tenant,
      key: "desk",
      label: "Front desk",
      actions: ["check_in", "check_out"],
    });
    await catalog.upsert({ tenant, key: "audit", actions: [] });
    assert.deepEqual(await catalog.get(tenant, "desk"), {
      tenant,
      key: "desk",
      label: "Front desk",
      actions: ["check_in", "check_out"],
    });
    assert.deepEqual(
      (await catalog.list(tenant)).map((r) => r.key),
      ["audit", "desk"],
    );
    await catalog.remove(tenant, "desk");
    assert.equal(await catalog.get(tenant, "desk"), null);
  });
});
