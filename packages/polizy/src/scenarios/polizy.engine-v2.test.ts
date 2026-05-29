import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { AuthSystem } from "../polizy.ts";
import { InMemoryStorageAdapter } from "../polizy.in-memory.storage.ts";
import { defineSchema, everyone } from "../types.ts";
import { MaxDepthExceededError } from "../errors.ts";
import type { InputTuple } from "../types.ts";

/** In-memory adapter that counts findTuples calls, for perf assertions. */
class CountingAdapter extends InMemoryStorageAdapter<string, string> {
  public findCalls = 0;
  async findTuples(
    filter: Partial<InputTuple<string, string>>,
    options?: { limit?: number; offset?: number },
  ) {
    this.findCalls++;
    return super.findTuples(filter, options);
  }
}

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

const u = (id: string) => ({ type: "user" as const, id });
const doc = (id: string) => ({ type: "document" as const, id });
const folder = (id: string) => ({ type: "folder" as const, id });
const team = (id: string) => ({ type: "team" as const, id });
const org = (id: string) => ({ type: "org" as const, id });

describe("engine v2", () => {
  let storage: InMemoryStorageAdapter<string, string>;
  let authz: AuthSystem<typeof schema>;

  beforeEach(() => {
    storage = new InMemoryStorageAdapter();
    authz = new AuthSystem({ storage, schema });
  });

  describe("multi-relation traversal", () => {
    it("traverses ALL group relations (member and orgMember)", async () => {
      await authz.allow({
        who: team("t1") as any,
        toBe: "viewer",
        onWhat: doc("dA"),
      });
      await authz.allow({
        who: org("o1") as any,
        toBe: "viewer",
        onWhat: doc("dB"),
      });
      await authz.addMember({
        member: u("alice"),
        group: team("t1"),
        as: "member",
      });
      await authz.addMember({
        member: u("alice"),
        group: org("o1"),
        as: "orgMember",
      });

      assert.equal(
        await authz.check({
          who: u("alice"),
          canThey: "view",
          onWhat: doc("dA"),
        }),
        true,
      );
      assert.equal(
        await authz.check({
          who: u("alice"),
          canThey: "view",
          onWhat: doc("dB"),
        }),
        true,
      );
    });

    it("traverses ALL hierarchy relations (folderParent and orgParent)", async () => {
      await authz.allow({
        who: u("bob"),
        toBe: "viewer",
        onWhat: folder("f1"),
      });
      await authz.allow({ who: u("bob"), toBe: "viewer", onWhat: org("o9") });
      await authz.setParent({
        child: doc("dX"),
        parent: folder("f1"),
        as: "folderParent",
      });
      await authz.setParent({
        child: doc("dY"),
        parent: org("o9"),
        as: "orgParent",
      });

      assert.equal(
        await authz.check({
          who: u("bob"),
          canThey: "view",
          onWhat: doc("dX"),
        }),
        true,
      );
      assert.equal(
        await authz.check({
          who: u("bob"),
          canThey: "view",
          onWhat: doc("dY"),
        }),
        true,
      );
    });

    it("requires `as` for addMember/setParent when multiple relations exist", async () => {
      await assert.rejects(
        authz.addMember({ member: u("alice"), group: team("t1") }),
        /multiple 'group' relations/,
      );
      await assert.rejects(
        authz.setParent({ child: doc("dX"), parent: folder("f1") }),
        /multiple 'hierarchy' relations/,
      );
    });
  });

  describe("field opt-in propagation", () => {
    it("does NOT split ids for object types not in fieldLevelObjects", async () => {
      await authz.allow({
        who: u("carl"),
        toBe: "viewer",
        onWhat: folder("f1"),
      });
      // folder is not field-enabled: "f1#sub" must not inherit from "f1"
      assert.equal(
        await authz.check({
          who: u("carl"),
          canThey: "view",
          onWhat: folder("f1#sub"),
        }),
        false,
      );
    });

    it("inherits a field id from its base via a DIRECT grant", async () => {
      await authz.allow({ who: u("dan"), toBe: "owner", onWhat: doc("d1") });
      assert.equal(
        await authz.check({
          who: u("dan"),
          canThey: "view",
          onWhat: doc("d1#title"),
        }),
        true,
      );
    });

    it("inherits a field id from its base via a GROUP grant", async () => {
      await authz.allow({
        who: team("t1") as any,
        toBe: "viewer",
        onWhat: doc("d1"),
      });
      await authz.addMember({
        member: u("erin"),
        group: team("t1"),
        as: "member",
      });
      assert.equal(
        await authz.check({
          who: u("erin"),
          canThey: "view",
          onWhat: doc("d1#title"),
        }),
        true,
      );
    });

    it("inherits a field id from its base via a HIERARCHY grant", async () => {
      await authz.allow({
        who: u("fin"),
        toBe: "viewer",
        onWhat: folder("f1"),
      });
      await authz.setParent({
        child: doc("d1"),
        parent: folder("f1"),
        as: "folderParent",
      });
      assert.equal(
        await authz.check({
          who: u("fin"),
          canThey: "view",
          onWhat: doc("d1#title"),
        }),
        true,
      );
    });

    it("rejects writing a malformed field id (empty base or trailing separator)", async () => {
      await assert.rejects(
        authz.allow({ who: u("g"), toBe: "viewer", onWhat: doc("#title") }),
      );
      await assert.rejects(
        authz.allow({ who: u("g"), toBe: "viewer", onWhat: doc("d1#") }),
      );
    });

    it("does not treat an empty base as a wildcard", async () => {
      // No grant exists; a query with a leading separator must not match anything.
      assert.equal(
        await authz.check({
          who: u("h"),
          canThey: "view",
          onWhat: doc("#secret"),
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
        onWhat: doc("pub"),
      });
      assert.equal(
        await authz.check({
          who: u("anyone"),
          canThey: "view",
          onWhat: doc("pub"),
        }),
        true,
      );
      assert.equal(
        await authz.check({
          who: u("other"),
          canThey: "view",
          onWhat: doc("pub"),
        }),
        true,
      );
      // viewer does not grant edit
      assert.equal(
        await authz.check({
          who: u("anyone"),
          canThey: "edit",
          onWhat: doc("pub"),
        }),
        false,
      );
    });
  });

  describe("predicate (ABAC) conditions", () => {
    it("honors attribute predicates against the check context", async () => {
      await authz.allow({
        who: u("ivy"),
        toBe: "viewer",
        onWhat: doc("p1"),
        when: {
          attributes: [{ attribute: "dept", operator: "eq", value: "eng" }],
        },
      });
      assert.equal(
        await authz.check({
          who: u("ivy"),
          canThey: "view",
          onWhat: doc("p1"),
          context: { dept: "eng" },
        }),
        true,
      );
      assert.equal(
        await authz.check({
          who: u("ivy"),
          canThey: "view",
          onWhat: doc("p1"),
          context: { dept: "sales" },
        }),
        false,
      );
      assert.equal(
        await authz.check({
          who: u("ivy"),
          canThey: "view",
          onWhat: doc("p1"),
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
        who: team("mid") as any,
        toBe: "viewer",
        onWhat: doc("dia"),
      });
      await a.addMember({
        member: team("g0a") as any,
        group: team("mid"),
        as: "member",
      });
      await a.addMember({
        member: team("g0b") as any,
        group: team("mid"),
        as: "member",
      });
      await a.addMember({
        member: u("alice"),
        group: team("g0a"),
        as: "member",
      });
      await a.addMember({
        member: u("alice"),
        group: team("g0b"),
        as: "member",
      });
      assert.equal(
        await a.check({ who: u("alice"), canThey: "view", onWhat: doc("dia") }),
        true,
      );

      // No-grant lattice that would blow up exponentially without memoization.
      const lat = new CountingAdapter();
      const b = new AuthSystem({ storage: lat, schema });
      const WIDTH = 2;
      const LAYERS = 10;
      for (let i = 0; i < WIDTH; i++) {
        await b.addMember({
          member: u("zoe"),
          group: team(`L0_${i}`),
          as: "member",
        });
      }
      for (let layer = 0; layer < LAYERS - 1; layer++) {
        for (let i = 0; i < WIDTH; i++) {
          for (let j = 0; j < WIDTH; j++) {
            await b.addMember({
              member: team(`L${layer}_${i}`) as any,
              group: team(`L${layer + 1}_${j}`),
              as: "member",
            });
          }
        }
      }
      lat.findCalls = 0;
      const result = await b.check({
        who: u("zoe"),
        canThey: "view",
        onWhat: doc("none"),
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
      await a.addMember({ member: u("kim"), group: team("c0"), as: "member" });
      for (let i = 0; i < depth; i++) {
        await a.addMember({
          member: team(`c${i}`) as any,
          group: team(`c${i + 1}`),
          as: "member",
        });
      }
      // No grant anywhere — forces full descent to the depth cap.
    };

    it("throws MaxDepthExceededError when maxDepthBehavior is 'throw'", async () => {
      const a = new AuthSystem({
        storage: new InMemoryStorageAdapter(),
        schema,
        defaultCheckDepth: 2,
        maxDepthBehavior: "throw",
      });
      await buildChain(a, 6);
      await assert.rejects(
        a.check({ who: u("kim"), canThey: "view", onWhat: doc("z") }),
        MaxDepthExceededError,
      );
    });

    it("returns false and warns when maxDepthBehavior is 'deny'", async () => {
      const warnings: string[] = [];
      const a = new AuthSystem({
        storage: new InMemoryStorageAdapter(),
        schema,
        defaultCheckDepth: 2,
        maxDepthBehavior: "deny",
        logger: { warn: (m) => warnings.push(m), error: () => {} },
      });
      await buildChain(a, 6);
      assert.equal(
        await a.check({ who: u("kim"), canThey: "view", onWhat: doc("z") }),
        false,
      );
      assert.ok(warnings.length > 0, "Expected a depth warning to be logged");
    });
  });

  describe("cycle safety", () => {
    it("terminates on a membership cycle", async () => {
      await authz.addMember({
        member: team("a") as any,
        group: team("b"),
        as: "member",
      });
      await authz.addMember({
        member: team("b") as any,
        group: team("a"),
        as: "member",
      });
      await authz.addMember({
        member: u("lee"),
        group: team("a"),
        as: "member",
      });
      assert.equal(
        await authz.check({
          who: u("lee"),
          canThey: "view",
          onWhat: doc("nope"),
        }),
        false,
      );
    });
  });
});
