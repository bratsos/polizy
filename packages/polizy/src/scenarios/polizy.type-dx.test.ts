import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isConditionValid } from "../conditions.ts";
import { InMemoryStorageAdapter } from "../polizy.in-memory.storage.ts";
import { AuthSystem } from "../polizy.ts";
import { type AttributePredicate, defineSchema } from "../types.ts";

describe("Type-level DX improvements", () => {
  it("allows partial hierarchyPropagation map and functions correctly at runtime", async () => {
    const partialPropSchema = defineSchema({
      subjectTypes: ["user"],
      objectTypes: ["document"],
      relations: {
        owner: { type: "direct" },
        parent: { type: "hierarchy" },
      },
      actionToRelations: {
        view: ["owner"],
        edit: ["owner"],
        delete: ["owner"],
        share: ["owner"],
        manage: ["owner"],
      },
      // Only propagate two of the five actions
      hierarchyPropagation: {
        view: ["view"],
        edit: ["edit"],
      },
    });

    const storage = new InMemoryStorageAdapter();
    const authz = new AuthSystem({ storage, schema: partialPropSchema });

    const parentDoc = { type: "document", id: "parent" } as const;
    const childDoc = { type: "document", id: "child" } as const;
    const user = { type: "user", id: "alice" } as const;

    // Grant owner on parent document
    await authz.allow({
      who: user,
      toBe: "owner",
      onWhat: parentDoc,
    });

    // setParent
    await authz.setParent({
      child: childDoc,
      parent: parentDoc,
    });

    // view should propagate (check is true)
    const viewAllowed = await authz.check({
      who: user,
      canThey: "view",
      onWhat: childDoc,
    });
    assert.equal(viewAllowed, true);

    // edit should propagate (check is true)
    const editAllowed = await authz.check({
      who: user,
      canThey: "edit",
      onWhat: childDoc,
    });
    assert.equal(editAllowed, true);

    // delete should NOT propagate (check is false)
    const deleteAllowed = await authz.check({
      who: user,
      canThey: "delete",
      onWhat: childDoc,
    });
    assert.equal(deleteAllowed, false);
  });

  it("evaluates valid predicates correctly at runtime", () => {
    const eqPredicate: AttributePredicate = {
      attribute: "role",
      operator: "eq",
      value: "admin",
    };

    const nePredicate: AttributePredicate = {
      attribute: "role",
      operator: "ne",
      value: "guest",
    };

    const inPredicate: AttributePredicate = {
      attribute: "status",
      operator: "in",
      value: ["active", "pending"],
    };

    const ninPredicate: AttributePredicate = {
      attribute: "status",
      operator: "nin",
      value: ["archived", "deleted"],
    };

    const gtPredicate: AttributePredicate = {
      attribute: "age",
      operator: "gt",
      value: 18,
    };

    const gtePredicate: AttributePredicate = {
      attribute: "age",
      operator: "gte",
      value: 21,
    };

    const ltPredicate: AttributePredicate = {
      attribute: "age",
      operator: "lt",
      value: 65,
    };

    const ltePredicate: AttributePredicate = {
      attribute: "age",
      operator: "lte",
      value: 70,
    };

    assert.equal(
      isConditionValid({ attributes: [eqPredicate] }, { role: "admin" }),
      true,
    );

    assert.equal(
      isConditionValid({ attributes: [nePredicate] }, { role: "admin" }),
      true,
    );

    assert.equal(
      isConditionValid({ attributes: [inPredicate] }, { status: "active" }),
      true,
    );

    assert.equal(
      isConditionValid({ attributes: [ninPredicate] }, { status: "active" }),
      true,
    );

    assert.equal(
      isConditionValid({ attributes: [gtPredicate] }, { age: 20 }),
      true,
    );

    assert.equal(
      isConditionValid({ attributes: [gtePredicate] }, { age: 21 }),
      true,
    );

    assert.equal(
      isConditionValid({ attributes: [ltPredicate] }, { age: 30 }),
      true,
    );

    assert.equal(
      isConditionValid({ attributes: [ltePredicate] }, { age: 70 }),
      true,
    );
  });

  it("allows bare InMemoryStorageAdapter with literal-typed schema and works at runtime", async () => {
    const literalSchema = defineSchema({
      subjectTypes: ["user"],
      objectTypes: ["document"],
      relations: { owner: { type: "direct" } },
      actionToRelations: { view: ["owner"] },
    });

    const storage = new InMemoryStorageAdapter();
    const authz = new AuthSystem({ storage, schema: literalSchema });

    const user = { type: "user", id: "alice" } as const;
    const doc = { type: "document", id: "doc1" } as const;

    await authz.allow({
      who: user,
      toBe: "owner",
      onWhat: doc,
    });

    const canView = await authz.check({
      who: user,
      canThey: "view",
      onWhat: doc,
    });
    assert.equal(canView, true);
  });
});

// Type assertions wrapper function (not called at runtime)
export function typeAssertions() {
  defineSchema({
    subjectTypes: ["user"],
    objectTypes: ["document"],
    relations: { owner: { type: "direct" }, parent: { type: "hierarchy" } },
    actionToRelations: { view: ["owner"], edit: ["owner"] },
    hierarchyPropagation: {
      // @ts-expect-error — typo'd propagated action
      view: ["vieww"],
    },
  });

  defineSchema({
    subjectTypes: ["user"],
    objectTypes: ["document"],
    relations: { owner: { type: "direct" }, parent: { type: "hierarchy" } },
    actionToRelations: { view: ["owner"], edit: ["owner"] },
    hierarchyPropagation: {
      // @ts-expect-error — typo'd KEY
      vieww: ["view"],
    },
  });

  // @ts-expect-error — eq cannot take an array
  const p1: AttributePredicate = {
    attribute: "x",
    operator: "eq",
    value: ["a"],
  };

  // (b) explicitly-parameterized adapters still narrow standalone results
  const adapterNarrow = new InMemoryStorageAdapter<"user", "doc">();
  const testNarrowType = async () => {
    const tuples = await adapterNarrow.findTuples({});
    const first = tuples[0];
    if (first) {
      if (first.subject.type === "user") {
        const subjectType: "user" = first.subject.type;
        return subjectType;
      }
    }
  };

  // (c) a WRONGLY-parameterized adapter is still rejected:
  const wrongSchema = defineSchema({
    subjectTypes: ["user"],
    objectTypes: ["document"],
    relations: { owner: { type: "direct" } },
    actionToRelations: { view: ["owner"] },
  });
  const wrongAdapter = new InMemoryStorageAdapter<"member", "thing">();
  // @ts-expect-error — wrongly-parameterized adapter must be rejected
  new AuthSystem({ storage: wrongAdapter, schema: wrongSchema });

  return { p1, testNarrowType };
}
