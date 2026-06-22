import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { SchemaError } from "../errors.ts";
import { InMemoryStorageAdapter } from "../polizy.in-memory.storage.ts";
import { AuthSystem } from "../polizy.ts";
import { InMemoryRoleCatalog, RoleRegistry } from "../role-registry.ts";
import { withRoleScaffold } from "../role-scaffold.ts";
import type { SchemaObjectTypes, SchemaSubjectTypes } from "../types.ts";
import { defineSchema, everyone } from "../types.ts";

// A tour-operator workspace, modeled after the permissions-matrix UI:
// permission ROWS are the fixed, typed action vocabulary; role COLUMNS are data.
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
    view_finances: ["owner"],
    manage_pricing: ["owner"],
    manage_settings: ["owner"],
  },
  hierarchyPropagation: {
    view_bookings: ["view_bookings"],
    edit_bookings: ["edit_bookings"],
    issue_refunds: ["issue_refunds"],
    view_finances: ["view_finances"],
    manage_pricing: ["manage_pricing"],
    manage_settings: ["manage_settings"],
  },
});

const schema = withRoleScaffold(base, {
  grantable: [
    "view_bookings",
    "edit_bookings",
    "issue_refunds",
    "view_finances",
    "manage_pricing",
    "manage_settings",
  ],
});

type Subj = SchemaSubjectTypes<typeof schema>;
type Obj = SchemaObjectTypes<typeof schema>;

const W = { type: "workspace", id: "acme" } as const;
const alice = { type: "user", id: "alice" } as const;

describe("RoleRegistry", () => {
  let authz: AuthSystem<typeof schema>;
  let roles: RoleRegistry<typeof schema>;

  beforeEach(async () => {
    authz = new AuthSystem({
      storage: new InMemoryStorageAdapter<Subj, Obj>(),
      schema,
      defaultGroupRelation: "member",
    });
    roles = new RoleRegistry(authz, schema, {
      catalog: new InMemoryRoleCatalog(),
    });
    // booking belongs to the workspace, so workspace-scoped caps reach it.
    await authz.setParent({
      child: { type: "booking", id: "b1" },
      parent: W,
    });
  });

  it("requires a scaffolded schema", () => {
    assert.throws(
      () =>
        new RoleRegistry(authz as unknown as AuthSystem<never>, base as never),
      SchemaError,
    );
  });

  it("defines a role, assigns a user, and the check resolves", async () => {
    const billing = await roles.defineRole({
      tenant: W,
      name: "billing_manager",
      can: ["view_bookings", "view_finances", "issue_refunds"],
    });
    await roles.assignRole(alice, billing);

    assert.equal(
      await authz.check({
        who: alice,
        canThey: "issue_refunds",
        onWhat: { type: "booking", id: "b1" },
      }),
      true,
    );
    // A capability the role does not have is denied (fail-closed).
    assert.equal(
      await authz.check({
        who: alice,
        canThey: "manage_settings",
        onWhat: W,
      }),
      false,
    );
  });

  it("toggles a permission cell on and off (grant/revoke)", async () => {
    const ops = await roles.defineRole({ tenant: W, name: "ops", can: [] });
    await roles.assignRole(alice, ops);

    const can = () =>
      authz.check({ who: alice, canThey: "edit_bookings", onWhat: W });

    assert.equal(await can(), false);
    await roles.grantToRole(ops, "edit_bookings"); // cell ON
    assert.equal(await can(), true);
    await roles.revokeFromRole(ops, "edit_bookings"); // cell OFF
    assert.equal(await can(), false);
  });

  it("getRolePermissions reflects the granted capabilities", async () => {
    const ops = await roles.defineRole({
      tenant: W,
      name: "ops",
      can: ["view_bookings", "edit_bookings"],
    });
    const perms = (await roles.getRolePermissions(ops)).sort();
    assert.deepEqual(perms, ["edit_bookings", "view_bookings"]);
  });

  it("listRoleMembers returns assigned subjects", async () => {
    const ops = await roles.defineRole({ tenant: W, name: "ops", can: [] });
    await roles.assignRole(alice, ops);
    await roles.assignRole({ type: "user", id: "bob" }, ops);
    const members = (await roles.listRoleMembers(ops))
      .map((m) => `${m.type}:${m.id}`)
      .sort();
    assert.deepEqual(members, ["user:alice", "user:bob"]);
  });

  it("deleteRole cascades caps and memberships", async () => {
    const ops = await roles.defineRole({
      tenant: W,
      name: "ops",
      can: ["view_bookings"],
    });
    await roles.assignRole(alice, ops);
    assert.equal(
      await authz.check({ who: alice, canThey: "view_bookings", onWhat: W }),
      true,
    );

    const { caps, members } = await roles.deleteRole(ops);
    assert.equal(caps, 1);
    assert.equal(members, 1);
    assert.equal(
      await authz.check({ who: alice, canThey: "view_bookings", onWhat: W }),
      false,
    );
    assert.deepEqual(await roles.listRoles(W), []);
  });

  it("listRoles / permissionMatrix back the UI grid", async () => {
    await roles.defineRole({
      tenant: W,
      name: "ops",
      label: "Ops",
      can: ["view_bookings", "edit_bookings"],
    });
    await roles.defineRole({
      tenant: W,
      name: "finance",
      label: "Finance",
      can: ["view_finances"],
    });

    const list = (await roles.listRoles(W)).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    assert.deepEqual(
      list.map((r) => ({ name: r.name, label: r.label })),
      [
        { name: "finance", label: "Finance" },
        { name: "ops", label: "Ops" },
      ],
    );

    const matrix = await roles.permissionMatrix(W);
    assert.equal(matrix.permissions.length, 6); // all six grantable rows
    const ops = matrix.roles.find((r) => r.name === "ops");
    assert.ok(ops);
    assert.deepEqual([...ops.can].sort(), ["edit_bookings", "view_bookings"]);
  });

  it("isolates roles per tenant (same name, different permissions)", async () => {
    const G = { type: "workspace", id: "globex" } as const;
    const acmeOps = await roles.defineRole({
      tenant: W,
      name: "ops",
      can: ["view_bookings", "edit_bookings"],
    });
    const globexOps = await roles.defineRole({
      tenant: G,
      name: "ops",
      can: ["view_bookings"], // globex's "ops" is weaker
    });
    assert.notEqual(acmeOps.id, globexOps.id);

    await roles.assignRole(alice, globexOps);
    // alice (globex ops) can view in globex but NOT edit, and nothing in acme.
    assert.equal(
      await authz.check({ who: alice, canThey: "view_bookings", onWhat: G }),
      true,
    );
    assert.equal(
      await authz.check({ who: alice, canThey: "edit_bookings", onWhat: G }),
      false,
    );
    assert.equal(
      await authz.check({ who: alice, canThey: "view_bookings", onWhat: W }),
      false,
    );
  });

  it("supports wildcard role assignment (everyone gets the role)", async () => {
    const guide = await roles.defineRole({
      tenant: W,
      name: "guide",
      can: ["view_bookings"],
    });
    await roles.assignRole(everyone("user"), guide);
    assert.equal(
      await authz.check({
        who: { type: "user", id: "newcomer" },
        canThey: "view_bookings",
        onWhat: W,
      }),
      true,
    );
  });

  it("supports time-boxed role assignment", async () => {
    const ops = await roles.defineRole({
      tenant: W,
      name: "ops",
      can: ["view_bookings"],
    });
    await roles.assignRole(alice, ops, {
      validUntil: new Date(Date.now() - 1000), // already expired
    });
    assert.equal(
      await authz.check({ who: alice, canThey: "view_bookings", onWhat: W }),
      false,
    );
  });

  it("assignRole throws for an unknown role when a catalog is configured", async () => {
    const ghost = roles.roleRef(W, "ghost");
    await assert.rejects(() => roles.assignRole(alice, ghost), SchemaError);
  });

  it("rejects role names containing the id separator", () => {
    assert.throws(() => roles.roleRef(W, "a/b"), SchemaError);
    assert.throws(() => roles.roleRef(W, ""), SchemaError);
  });

  it("does not leak role objects into listSubjects", async () => {
    const ops = await roles.defineRole({
      tenant: W,
      name: "ops",
      can: ["view_bookings"],
    });
    await roles.assignRole(alice, ops);
    const subjects = await authz.listSubjects({
      canThey: "view_bookings",
      onWhat: W,
    });
    const keys = subjects.map((s) => `${s.type}:${s.id}`);
    assert.ok(keys.includes("user:alice"));
    assert.ok(!keys.some((k) => k.startsWith("role:")));
  });
});
