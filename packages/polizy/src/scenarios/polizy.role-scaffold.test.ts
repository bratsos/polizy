import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SchemaError } from "../errors.ts";
import { InMemoryStorageAdapter } from "../polizy.in-memory.storage.ts";
import { AuthSystem } from "../polizy.ts";
import { withRoleScaffold } from "../role-scaffold.ts";
import { defineSchema, everyone } from "../types.ts";

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
    manage_settings: ["owner"],
  },
  hierarchyPropagation: {
    view_bookings: ["view_bookings"],
    edit_bookings: ["edit_bookings"],
    manage_settings: ["manage_settings"],
  },
});

describe("withRoleScaffold (runtime structure)", () => {
  const schema = withRoleScaffold(base, {
    grantable: ["view_bookings", "edit_bookings"],
  });

  it("adds a reserved `assignee` group relation", () => {
    assert.deepEqual(schema.relations.assignee, { type: "group" });
  });

  it("adds one cap_<action> direct relation per grantable action", () => {
    assert.deepEqual(schema.relations.cap_view_bookings, { type: "direct" });
    assert.deepEqual(schema.relations.cap_edit_bookings, { type: "direct" });
    assert.ok(
      !("cap_manage_settings" in schema.relations),
      "non-grantable actions get no cap relation",
    );
  });

  it("appends the cap relation only to grantable actions", () => {
    assert.deepEqual(schema.actionToRelations.view_bookings, [
      "owner",
      "cap_view_bookings",
    ]);
    assert.deepEqual(schema.actionToRelations.manage_settings, ["owner"]);
  });

  it("records role-scaffold metadata", () => {
    assert.deepEqual(schema.roleScaffold, {
      roleType: "role",
      assigneeRelation: "assignee",
      capPrefix: "cap_",
      grantable: ["view_bookings", "edit_bookings"],
    });
  });

  it("leaves the base schema untouched (purely additive)", () => {
    assert.ok(!("assignee" in base.relations));
    assert.deepEqual(base.actionToRelations.view_bookings, ["owner"]);
  });

  it("supports custom role type / relation / prefix names", () => {
    const custom = withRoleScaffold(base, {
      grantable: ["view_bookings"],
      roleType: "permset",
      assigneeRelation: "holds",
      capPrefix: "can_",
    });
    assert.deepEqual(custom.relations.holds, { type: "group" });
    assert.deepEqual(custom.relations.can_view_bookings, { type: "direct" });
    assert.equal(custom.roleScaffold.roleType, "permset");
  });
});

describe("withRoleScaffold (validation)", () => {
  it("throws if the assignee relation already exists", () => {
    assert.throws(
      () =>
        withRoleScaffold(base, {
          grantable: ["view_bookings"],
          assigneeRelation: "member",
        }),
      SchemaError,
    );
  });

  it("throws if a grantable action is not defined in actionToRelations", () => {
    assert.throws(
      () =>
        withRoleScaffold(base, {
          grantable: ["nope"] as unknown as ["view_bookings"],
        }),
      SchemaError,
    );
  });
});

describe("withRoleScaffold (end-to-end resolution on the unchanged engine)", () => {
  const schema = withRoleScaffold(base, {
    grantable: ["view_bookings", "edit_bookings"],
  });

  it("resolves user --assignee--> role --hierarchy--> workspace --cap--> grant", async () => {
    const authz = new AuthSystem({
      storage: new InMemoryStorageAdapter(),
      schema,
      defaultGroupRelation: "member",
    });
    // Define a "Support" role on workspace W granting view + edit (caps live on W).
    await authz.allowMany([
      {
        who: { type: "role", id: "W/support" },
        toBe: "cap_view_bookings",
        onWhat: { type: "workspace", id: "W" },
      },
      {
        who: { type: "role", id: "W/support" },
        toBe: "cap_edit_bookings",
        onWhat: { type: "workspace", id: "W" },
      },
    ]);
    // Assign alice to the role (reserved assignee relation).
    await authz.addMember({
      member: { type: "user", id: "alice" },
      group: { type: "role", id: "W/support" },
      as: "assignee",
    });
    // booking:7 belongs to workspace W.
    await authz.setParent({
      child: { type: "booking", id: "7" },
      parent: { type: "workspace", id: "W" },
    });

    assert.equal(
      await authz.check({
        who: { type: "user", id: "alice" },
        canThey: "edit_bookings",
        onWhat: { type: "booking", id: "7" },
      }),
      true,
    );
    // No cap for manage_settings -> denied (fail-closed).
    assert.equal(
      await authz.check({
        who: { type: "user", id: "alice" },
        canThey: "manage_settings",
        onWhat: { type: "workspace", id: "W" },
      }),
      false,
    );
  });

  it("a wildcard role assignment grants every user the role's caps", async () => {
    const authz = new AuthSystem({
      storage: new InMemoryStorageAdapter(),
      schema,
      defaultGroupRelation: "member",
    });
    await authz.allow({
      who: { type: "role", id: "W/guide" },
      toBe: "cap_view_bookings",
      onWhat: { type: "workspace", id: "W" },
    });
    await authz.addMember({
      member: everyone("user"),
      group: { type: "role", id: "W/guide" },
      as: "assignee",
    });
    assert.equal(
      await authz.check({
        who: { type: "user", id: "anyone" },
        canThey: "view_bookings",
        onWhat: { type: "workspace", id: "W" },
      }),
      true,
    );
  });

  it("existing addMember calls still infer the app's `member` relation after scaffolding", async () => {
    const authz = new AuthSystem({
      storage: new InMemoryStorageAdapter(),
      schema, // two group relations now (member + assignee)
    });
    // No `as`, no defaultGroupRelation configured: infers `member` because the
    // scaffold's `assignee` is excluded from inference.
    await authz.addMember({
      member: { type: "user", id: "bob" },
      group: { type: "workspace", id: "W" },
    });
    const tuples = await authz.listTuples({
      subject: { type: "user", id: "bob" },
      relation: "member",
    });
    assert.equal(tuples.length, 1);
  });
});
