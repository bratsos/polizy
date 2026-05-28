import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { defineSchema } from "../types.ts";
import { SchemaError } from "../errors.ts";
import {
  groupRelations,
  hierarchyRelations,
  fieldSeparator,
  isFieldType,
  resolveRelation,
} from "../schema.ts";

const multi = defineSchema({
  subjectTypes: ["user"],
  objectTypes: ["document", "folder", "team", "org"],
  relations: {
    owner: { type: "direct" },
    viewer: { type: "direct" },
    member: { type: "group" },
    orgMember: { type: "group" },
    folderParent: { type: "hierarchy" },
    orgParent: { type: "hierarchy" },
  },
  actionToRelations: {
    view: ["viewer", "owner", "member", "orgMember"],
  },
  fieldLevelObjects: ["document"],
});

describe("schema helpers", () => {
  it("groupRelations returns all group-typed relations", () => {
    assert.deepEqual(groupRelations(multi).sort(), ["member", "orgMember"]);
  });
  it("hierarchyRelations returns all hierarchy-typed relations", () => {
    assert.deepEqual(hierarchyRelations(multi).sort(), [
      "folderParent",
      "orgParent",
    ]);
  });
  it("fieldSeparator defaults to '#'", () => {
    assert.equal(fieldSeparator(multi), "#");
  });
  it("isFieldType is true only for declared field-level object types", () => {
    assert.equal(isFieldType(multi, "document"), true);
    assert.equal(isFieldType(multi, "folder"), false);
  });

  describe("resolveRelation", () => {
    const fail = (m: string) => new SchemaError(m);
    it("infers when exactly one relation of the kind exists", () => {
      assert.equal(resolveRelation(["member"], undefined, "group", fail), "member");
    });
    it("requires 'as' when multiple exist", () => {
      assert.throws(
        () => resolveRelation(["member", "orgMember"], undefined, "group", fail),
        SchemaError,
      );
      assert.equal(
        resolveRelation(["member", "orgMember"], "orgMember", "group", fail),
        "orgMember",
      );
    });
    it("rejects an 'as' that is not of the kind", () => {
      assert.throws(
        () => resolveRelation(["member"], "owner", "group", fail),
        SchemaError,
      );
    });
    it("throws when no relation of the kind exists", () => {
      assert.throws(() => resolveRelation([], undefined, "hierarchy", fail), SchemaError);
    });
  });
});

describe("defineSchema validation", () => {
  it("throws on an action referencing an undefined relation", () => {
    assert.throws(
      () =>
        defineSchema({
          relations: { owner: { type: "direct" } },
          actionToRelations: { view: ["nope"] as unknown as ["owner"] },
        }),
      SchemaError,
    );
  });
  it("allows multiple group and hierarchy relations without throwing", () => {
    assert.doesNotThrow(() => multi);
  });
});
