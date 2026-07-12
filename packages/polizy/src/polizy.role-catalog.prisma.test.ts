import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { after, afterEach, before, describe, it } from "node:test";
import { PrismaClient } from "../prisma/client-generated/index.js";
import { PrismaAdapter, PrismaRoleCatalog } from "./polizy.prisma.storage.ts";
import { AuthSystem } from "./polizy.ts";
import { RoleRegistry } from "./role-registry.ts";
import { withRoleScaffold } from "./role-scaffold.ts";
import { defineSchema } from "./types.ts";

// `node --test` runs test files in parallel processes. Isolate this suite on its
// own SQLite file so its `db push`/cleanup never collide with the storage
// adapter's Prisma tests (which own dev.db). The PrismaClient is constructed in
// `before()`, which runs after this top-level assignment.
process.env.DATABASE_URL = "file:./dev-roles.db";

const base = defineSchema({
  subjectTypes: ["user"],
  objectTypes: ["workspace", "booking"],
  relations: {
    owner: { type: "direct" },
    member: { type: "group" },
    parent: { type: "hierarchy" },
  },
  actionToRelations: {
    view_bookings: ["owner"],
    edit_bookings: ["owner"],
    issue_refunds: ["owner"],
  },
  hierarchyPropagation: {
    view_bookings: ["view_bookings"],
    edit_bookings: ["edit_bookings"],
    issue_refunds: ["issue_refunds"],
  },
});

const schema = withRoleScaffold(base, {
  grantable: ["view_bookings", "edit_bookings", "issue_refunds"],
});

const W = { type: "workspace", id: "acme" } as const;

describe("PrismaRoleCatalog", () => {
  let prisma: PrismaClient;

  before(() => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is not set for testing.");
    }
    prisma = new PrismaClient();
    execSync("pnpm exec prisma db push --skip-generate --accept-data-loss", {
      stdio: "inherit",
    });
  });

  afterEach(async () => {
    await prisma.polizyTuple.deleteMany();
    await prisma.polizyRole.deleteMany();
  });

  after(async () => {
    await prisma.$disconnect();
  });

  it("upsert/get/list/remove round-trip", async () => {
    const catalog = PrismaRoleCatalog(prisma as any);
    await catalog.upsert({
      tenant: "workspace:acme",
      key: "ops",
      label: "Ops",
      actions: ["view_bookings", "edit_bookings"],
    });
    const got = await catalog.get("workspace:acme", "ops");
    assert.deepEqual(got, {
      tenant: "workspace:acme",
      key: "ops",
      label: "Ops",
      actions: ["view_bookings", "edit_bookings"],
    });

    // Upsert again updates in place (no duplicate).
    await catalog.upsert({
      tenant: "workspace:acme",
      key: "ops",
      label: "Operations",
      actions: ["view_bookings"],
    });
    const list = await catalog.list("workspace:acme");
    assert.equal(list.length, 1);
    assert.equal(list[0]?.label, "Operations");
    assert.deepEqual(list[0]?.actions, ["view_bookings"]);

    await catalog.remove("workspace:acme", "ops");
    assert.equal(await catalog.get("workspace:acme", "ops"), null);
  });

  it("backs a RoleRegistry over the Prisma adapter end-to-end", async () => {
    const authz = new AuthSystem({
      storage: PrismaAdapter(prisma as any) as any,
      schema,
      defaultGroupRelation: "member",
    });
    const roles = new RoleRegistry(authz, schema, {
      catalog: PrismaRoleCatalog(prisma as any),
    });

    await authz.setParent({
      child: { type: "booking", id: "b1" },
      parent: W,
    });
    const billing = await roles.defineRole({
      tenant: W,
      name: "billing",
      label: "Billing",
      can: ["view_bookings", "issue_refunds"],
    });
    await roles.assignRole({ type: "user", id: "alice" }, billing);

    assert.equal(
      await authz.check({
        who: { type: "user", id: "alice" },
        canThey: "issue_refunds",
        onWhat: { type: "booking", id: "b1" },
      }),
      true,
    );

    const list = await roles.listRoles(W);
    assert.equal(list.length, 1);
    assert.equal(list[0]?.label, "Billing");
    assert.deepEqual([...(list[0]?.can ?? [])].sort(), [
      "issue_refunds",
      "view_bookings",
    ]);

    // Toggling a cell persists.
    await roles.revokeFromRole(billing, "issue_refunds");
    assert.equal(
      await authz.check({
        who: { type: "user", id: "alice" },
        canThey: "issue_refunds",
        onWhat: { type: "booking", id: "b1" },
      }),
      false,
    );

    const { caps, members } = await roles.deleteRole(billing);
    assert.equal(caps, 1); // only view_bookings remained
    assert.equal(members, 1);
    assert.deepEqual(await roles.listRoles(W), []);
  });
});
