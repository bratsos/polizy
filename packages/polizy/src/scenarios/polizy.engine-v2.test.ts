import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { MaxDepthExceededError } from "../errors.ts";
import { InMemoryStorageAdapter } from "../polizy.in-memory.storage.ts";
import { AuthSystem } from "../polizy.ts";
import type {
  InputTuple,
  SchemaObjectTypes,
  SchemaSubjectTypes,
} from "../types.ts";
import { defineSchema, everyone } from "../types.ts";

const schema = defineSchema({
  subjectTypes: ["user"],
  objectTypes: ["document", "folder", "team", "org"],
  relations: {
    owner: { type: "direct" },
    editor: { type: "direct" },
    viewer: { type: "direct" },
    member: { type: "group" },
    orgMember: { type: "group" },
    folderParent: { type: "hierarchy" },
    orgParent: { type: "hierarchy" },
  },
  actionToRelations: {
    view: ["viewer", "editor", "owner", "member", "orgMember"],
    edit: ["editor", "owner"],
    delete: ["owner"],
  },
  hierarchyPropagation: {
    view: ["view"],
    edit: ["edit"],
    delete: [],
  },
  fieldLevelObjects: ["document"],
});

type Subj = SchemaSubjectTypes<typeof schema>;
type Obj = SchemaObjectTypes<typeof schema>;

/** In-memory adapter that counts findTuples calls, for perf assertions. */
class CountingAdapter extends InMemoryStorageAdapter<Subj, Obj> {
  public findCalls = 0;
  override async findTuples(
    filter: Partial<InputTuple<Subj, Obj>>,
    options?: { limit?: number; offset?: number },
  ) {
    this.findCalls++;
    return super.findTuples(filter, options);
  }
}

describe("engine v2", () => {
  let storage: InMemoryStorageAdapter<Subj, Obj>;
  let authz: AuthSystem<typeof schema>;

  beforeEach(() => {
    storage = new InMemoryStorageAdapter<Subj, Obj>();
    authz = new AuthSystem({ storage, schema });
  });

  describe("multi-relation traversal", () => {
    it("traverses ALL group relations (member and orgMember)", async () => {
      await authz.allow({
        who: { type: "team", id: "t1" },
        toBe: "viewer",
        onWhat: { type: "document", id: "dA" },
      });
      await authz.allow({
        who: { type: "org", id: "o1" },
        toBe: "viewer",
        onWhat: { type: "document", id: "dB" },
      });
      await authz.addMember({
        member: { type: "user", id: "alice" },
        group: { type: "team", id: "t1" },
        as: "member",
      });
      await authz.addMember({
        member: { type: "user", id: "alice" },
        group: { type: "org", id: "o1" },
        as: "orgMember",
      });

      assert.equal(
        await authz.check({
          who: { type: "user", id: "alice" },
          canThey: "view",
          onWhat: { type: "document", id: "dA" },
        }),
        true,
      );
      assert.equal(
        await authz.check({
          who: { type: "user", id: "alice" },
          canThey: "view",
          onWhat: { type: "document", id: "dB" },
        }),
        true,
      );
    });

    it("traverses ALL hierarchy relations (folderParent and orgParent)", async () => {
      await authz.allow({
        who: { type: "user", id: "bob" },
        toBe: "viewer",
        onWhat: { type: "folder", id: "f1" },
      });
      await authz.allow({
        who: { type: "user", id: "bob" },
        toBe: "viewer",
        onWhat: { type: "org", id: "o9" },
      });
      await authz.setParent({
        child: { type: "document", id: "dX" },
        parent: { type: "folder", id: "f1" },
        as: "folderParent",
      });
      await authz.setParent({
        child: { type: "document", id: "dY" },
        parent: { type: "org", id: "o9" },
        as: "orgParent",
      });

      assert.equal(
        await authz.check({
          who: { type: "user", id: "bob" },
          canThey: "view",
          onWhat: { type: "document", id: "dX" },
        }),
        true,
      );
      assert.equal(
        await authz.check({
          who: { type: "user", id: "bob" },
          canThey: "view",
          onWhat: { type: "document", id: "dY" },
        }),
        true,
      );
    });

    it("requires `as` for addMember/setParent when multiple relations exist", async () => {
      await assert.rejects(
        authz.addMember({
          member: { type: "user", id: "alice" },
          group: { type: "team", id: "t1" },
        }),
        /multiple 'group' relations/,
      );
      await assert.rejects(
        authz.setParent({
          child: { type: "document", id: "dX" },
          parent: { type: "folder", id: "f1" },
        }),
        /multiple 'hierarchy' relations/,
      );
    });
  });

  describe("field opt-in propagation", () => {
    it("does NOT split ids for object types not in fieldLevelObjects", async () => {
      await authz.allow({
        who: { type: "user", id: "carl" },
        toBe: "viewer",
        onWhat: { type: "folder", id: "f1" },
      });
      // folder is not field-enabled: "f1#sub" must not inherit from "f1"
      assert.equal(
        await authz.check({
          who: { type: "user", id: "carl" },
          canThey: "view",
          onWhat: { type: "folder", id: "f1#sub" },
        }),
        false,
      );
    });

    it("inherits a field id from its base via a DIRECT grant", async () => {
      await authz.allow({
        who: { type: "user", id: "dan" },
        toBe: "owner",
        onWhat: { type: "document", id: "d1" },
      });
      assert.equal(
        await authz.check({
          who: { type: "user", id: "dan" },
          canThey: "view",
          onWhat: { type: "document", id: "d1#title" },
        }),
        true,
      );
    });

    it("inherits a field id from its base via a GROUP grant", async () => {
      await authz.allow({
        who: { type: "team", id: "t1" },
        toBe: "viewer",
        onWhat: { type: "document", id: "d1" },
      });
      await authz.addMember({
        member: { type: "user", id: "erin" },
        group: { type: "team", id: "t1" },
        as: "member",
      });
      assert.equal(
        await authz.check({
          who: { type: "user", id: "erin" },
          canThey: "view",
          onWhat: { type: "document", id: "d1#title" },
        }),
        true,
      );
    });

    it("inherits a field id from its base via a HIERARCHY grant", async () => {
      await authz.allow({
        who: { type: "user", id: "fin" },
        toBe: "viewer",
        onWhat: { type: "folder", id: "f1" },
      });
      await authz.setParent({
        child: { type: "document", id: "d1" },
        parent: { type: "folder", id: "f1" },
        as: "folderParent",
      });
      assert.equal(
        await authz.check({
          who: { type: "user", id: "fin" },
          canThey: "view",
          onWhat: { type: "document", id: "d1#title" },
        }),
        true,
      );
    });

    it("rejects writing a malformed field id (empty base or trailing separator)", async () => {
      await assert.rejects(
        authz.allow({
          who: { type: "user", id: "g" },
          toBe: "viewer",
          onWhat: { type: "document", id: "#title" },
        }),
      );
      await assert.rejects(
        authz.allow({
          who: { type: "user", id: "g" },
          toBe: "viewer",
          onWhat: { type: "document", id: "d1#" },
        }),
      );
    });

    it("does not treat an empty base as a wildcard", async () => {
      // No grant exists; a query with a leading separator must not match anything.
      assert.equal(
        await authz.check({
          who: { type: "user", id: "h" },
          canThey: "view",
          onWhat: { type: "document", id: "#secret" },
        }),
        false,
      );
    });
  });

  describe("wildcard / public subjects", () => {
    it("grants to everyone(type) authorize any subject of that type", async () => {
      await authz.allow({
        who: everyone("user"),
        toBe: "viewer",
        onWhat: { type: "document", id: "pub" },
      });
      assert.equal(
        await authz.check({
          who: { type: "user", id: "anyone" },
          canThey: "view",
          onWhat: { type: "document", id: "pub" },
        }),
        true,
      );
      assert.equal(
        await authz.check({
          who: { type: "user", id: "other" },
          canThey: "view",
          onWhat: { type: "document", id: "pub" },
        }),
        true,
      );
      // viewer does not grant edit
      assert.equal(
        await authz.check({
          who: { type: "user", id: "anyone" },
          canThey: "edit",
          onWhat: { type: "document", id: "pub" },
        }),
        false,
      );
    });
  });

  describe("predicate (ABAC) conditions", () => {
    it("honors attribute predicates against the check context", async () => {
      await authz.allow({
        who: { type: "user", id: "ivy" },
        toBe: "viewer",
        onWhat: { type: "document", id: "p1" },
        when: {
          attributes: [{ attribute: "dept", operator: "eq", value: "eng" }],
        },
      });
      assert.equal(
        await authz.check({
          who: { type: "user", id: "ivy" },
          canThey: "view",
          onWhat: { type: "document", id: "p1" },
          context: { dept: "eng" },
        }),
        true,
      );
      assert.equal(
        await authz.check({
          who: { type: "user", id: "ivy" },
          canThey: "view",
          onWhat: { type: "document", id: "p1" },
          context: { dept: "sales" },
        }),
        false,
      );
      assert.equal(
        await authz.check({
          who: { type: "user", id: "ivy" },
          canThey: "view",
          onWhat: { type: "document", id: "p1" },
        }),
        false,
      );
    });
  });

  describe("memoization (no exponential blowup)", () => {
    it("returns correct result on a diamond and stays bounded on a lattice", async () => {
      const counting = new CountingAdapter();
      const a = new AuthSystem({ storage: counting, schema });

      // Diamond: alice in g0a and g0b; both members of mid; mid views doc.
      await a.allow({
        who: { type: "team", id: "mid" },
        toBe: "viewer",
        onWhat: { type: "document", id: "dia" },
      });
      await a.addMember({
        member: { type: "team", id: "g0a" },
        group: { type: "team", id: "mid" },
        as: "member",
      });
      await a.addMember({
        member: { type: "team", id: "g0b" },
        group: { type: "team", id: "mid" },
        as: "member",
      });
      await a.addMember({
        member: { type: "user", id: "alice" },
        group: { type: "team", id: "g0a" },
        as: "member",
      });
      await a.addMember({
        member: { type: "user", id: "alice" },
        group: { type: "team", id: "g0b" },
        as: "member",
      });
      assert.equal(
        await a.check({
          who: { type: "user", id: "alice" },
          canThey: "view",
          onWhat: { type: "document", id: "dia" },
        }),
        true,
      );

      // No-grant lattice that would blow up exponentially without memoization.
      const lat = new CountingAdapter();
      const b = new AuthSystem({ storage: lat, schema });
      const WIDTH = 2;
      const LAYERS = 10;
      for (let i = 0; i < WIDTH; i++) {
        await b.addMember({
          member: { type: "user", id: "zoe" },
          group: { type: "team", id: `L0_${i}` },
          as: "member",
        });
      }
      for (let layer = 0; layer < LAYERS - 1; layer++) {
        for (let i = 0; i < WIDTH; i++) {
          for (let j = 0; j < WIDTH; j++) {
            await b.addMember({
              member: { type: "team", id: `L${layer}_${i}` },
              group: { type: "team", id: `L${layer + 1}_${j}` },
              as: "member",
            });
          }
        }
      }
      lat.findCalls = 0;
      const result = await b.check({
        who: { type: "user", id: "zoe" },
        canThey: "view",
        onWhat: { type: "document", id: "none" },
      });
      assert.equal(result, false);
      // Memoized traversal is linear in distinct nodes (~290 here); without
      // memoization a 10-deep width-2 lattice would be exponential (thousands).
      assert.ok(
        lat.findCalls < 800,
        `Expected memoized traversal to stay bounded, got ${lat.findCalls} findTuples calls`,
      );
    });
  });

  describe("depth behavior", () => {
    const buildChain = async (a: AuthSystem<typeof schema>, depth: number) => {
      await a.addMember({
        member: { type: "user", id: "kim" },
        group: { type: "team", id: "c0" },
        as: "member",
      });
      for (let i = 0; i < depth; i++) {
        await a.addMember({
          member: { type: "team", id: `c${i}` },
          group: { type: "team", id: `c${i + 1}` },
          as: "member",
        });
      }
      // No grant anywhere — forces full descent to the depth cap.
    };

    it("throws MaxDepthExceededError when maxDepthBehavior is 'throw'", async () => {
      const a = new AuthSystem({
        storage: new InMemoryStorageAdapter<Subj, Obj>(),
        schema,
        defaultCheckDepth: 2,
        maxDepthBehavior: "throw",
      });
      await buildChain(a, 6);
      await assert.rejects(
        a.check({
          who: { type: "user", id: "kim" },
          canThey: "view",
          onWhat: { type: "document", id: "z" },
        }),
        MaxDepthExceededError,
      );
    });

    it("returns false and warns when maxDepthBehavior is 'deny'", async () => {
      const warnings: string[] = [];
      const a = new AuthSystem({
        storage: new InMemoryStorageAdapter<Subj, Obj>(),
        schema,
        defaultCheckDepth: 2,
        maxDepthBehavior: "deny",
        logger: { warn: (m) => warnings.push(m), error: () => {} },
      });
      await buildChain(a, 6);
      assert.equal(
        await a.check({
          who: { type: "user", id: "kim" },
          canThey: "view",
          onWhat: { type: "document", id: "z" },
        }),
        false,
      );
      assert.ok(warnings.length > 0, "Expected a depth warning to be logged");
    });
  });

  describe("cycle safety", () => {
    it("terminates on a membership cycle", async () => {
      await authz.addMember({
        member: { type: "team", id: "a" },
        group: { type: "team", id: "b" },
        as: "member",
      });
      await authz.addMember({
        member: { type: "team", id: "b" },
        group: { type: "team", id: "a" },
        as: "member",
      });
      await authz.addMember({
        member: { type: "user", id: "lee" },
        group: { type: "team", id: "a" },
        as: "member",
      });
      assert.equal(
        await authz.check({
          who: { type: "user", id: "lee" },
          canThey: "view",
          onWhat: { type: "document", id: "nope" },
        }),
        false,
      );
    });
  });
});
