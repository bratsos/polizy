import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MaxDepthExceededError } from "../errors.ts";
import { InMemoryStorageAdapter } from "../polizy.in-memory.storage.ts";
import { AuthSystem } from "../polizy.ts";
import { ReadCache } from "../read-layer.ts";
import type { StoredTuple } from "../types.ts";
import { defineSchema, everyone } from "../types.ts";

/**
 * Correctness + parity tests for the list-operation / read-layer performance work:
 *  - findGroupsRecursive must evaluate conditions WITH the check context, so
 *    listAccessibleObjects matches check() for ABAC-conditioned memberships.
 *  - the shared positive memo must never change a decision (parity).
 */

const schema = defineSchema({
  subjectTypes: ["user", "team"],
  objectTypes: ["document", "folder", "team"],
  relations: {
    owner: { type: "direct" },
    editor: { type: "direct" },
    viewer: { type: "direct" },
    member: { type: "group" },
    parent: { type: "hierarchy" },
  },
  actionToRelations: {
    view: ["owner", "editor", "viewer", "member"],
    edit: ["owner", "editor"],
    delete: ["owner"],
  },
  hierarchyPropagation: { view: ["view"], edit: ["edit"], delete: [] },
});

describe("findGroupsRecursive honors the check context (ABAC parity)", () => {
  it("listAccessibleObjects lists an object reachable via an attribute-conditioned membership when check() allows it", async () => {
    const authz = new AuthSystem({
      storage: new InMemoryStorageAdapter(),
      schema,
    });
    // alice is a member of eng-team ONLY when context.department === "eng".
    await authz.addMember({
      member: { type: "user", id: "alice" },
      group: { type: "team", id: "eng-team" },
      condition: {
        attributes: [{ attribute: "department", operator: "eq", value: "eng" }],
      },
    });
    // The team can view a document.
    await authz.allow({
      who: { type: "team", id: "eng-team" },
      toBe: "viewer",
      onWhat: { type: "document", id: "spec" },
    });

    const ctx = { department: "eng" };

    // check() honors context and allows.
    assert.equal(
      await authz.check({
        who: { type: "user", id: "alice" },
        canThey: "view",
        onWhat: { type: "document", id: "spec" },
        context: ctx,
      }),
      true,
    );

    // listAccessibleObjects MUST agree (the bug omitted it).
    const { accessible } = await authz.listAccessibleObjects({
      who: { type: "user", id: "alice" },
      ofType: "document",
      context: ctx,
    });
    const ids = accessible.map((a) => a.object.id);
    assert.ok(
      ids.includes("spec"),
      "listAccessibleObjects must include the document reachable via the conditioned membership",
    );
  });

  it("still excludes it when the context does NOT satisfy the membership condition", async () => {
    const authz = new AuthSystem({
      storage: new InMemoryStorageAdapter(),
      schema,
    });
    await authz.addMember({
      member: { type: "user", id: "alice" },
      group: { type: "team", id: "eng-team" },
      condition: {
        attributes: [{ attribute: "department", operator: "eq", value: "eng" }],
      },
    });
    await authz.allow({
      who: { type: "team", id: "eng-team" },
      toBe: "viewer",
      onWhat: { type: "document", id: "spec" },
    });

    const ctx = { department: "sales" };
    assert.equal(
      await authz.check({
        who: { type: "user", id: "alice" },
        canThey: "view",
        onWhat: { type: "document", id: "spec" },
        context: ctx,
      }),
      false,
    );
    const { accessible } = await authz.listAccessibleObjects({
      who: { type: "user", id: "alice" },
      ofType: "document",
      context: ctx,
    });
    assert.ok(!accessible.map((a) => a.object.id).includes("spec"));
  });

  it("time-window-only conditions are unaffected (no context needed)", async () => {
    const authz = new AuthSystem({
      storage: new InMemoryStorageAdapter(),
      schema,
    });
    await authz.addMember({
      member: { type: "user", id: "bob" },
      group: { type: "team", id: "t" },
      condition: { validUntil: new Date(Date.now() + 3_600_000) },
    });
    await authz.allow({
      who: { type: "team", id: "t" },
      toBe: "viewer",
      onWhat: { type: "document", id: "d" },
    });
    const { accessible } = await authz.listAccessibleObjects({
      who: { type: "user", id: "bob" },
      ofType: "document",
    });
    assert.ok(accessible.map((a) => a.object.id).includes("d"));
  });
});

/**
 * Differential: the list operations must agree with the forward check() ground
 * truth on every graph, in BOTH deny mode (where the shared positive memo is
 * active) and the default throw mode (where it is not). This transitively proves
 * the sharedPos optimization (Design C) changes no decision.
 */
async function assertListParity(
  authz: AuthSystem<typeof schema>,
  subjects: { type: string; id: string }[],
  objects: { type: string; id: string }[],
  actions: ("view" | "edit" | "delete")[],
  label: string,
) {
  // listSubjects parity (with wildcard handling).
  for (const obj of objects) {
    for (const action of actions) {
      const listed = await authz.listSubjects({
        canThey: action,
        onWhat: obj as never,
      });
      const wildTypes = new Set(
        listed.filter((s) => s.id === "*").map((s) => s.type),
      );
      const listedKeys = new Set(listed.map((s) => `${s.type}:${s.id}`));
      for (const s of subjects) {
        if (s.id === "*") continue;
        const expected = await authz.check({
          who: s as never,
          canThey: action,
          onWhat: obj as never,
        });
        const actual =
          listedKeys.has(`${s.type}:${s.id}`) || wildTypes.has(s.type as any);
        assert.equal(
          actual,
          expected,
          `${label}: listSubjects(${action}, ${obj.type}:${obj.id}) disagrees with check for ${s.type}:${s.id}`,
        );
      }
    }
  }

  // listAccessibleObjects parity (per concrete subject, per object type).
  const objTypes = [...new Set(objects.map((o) => o.type))];
  for (const who of subjects) {
    if (who.id === "*") continue;
    for (const ofType of objTypes) {
      const { accessible } = await authz.listAccessibleObjects({
        who: who as never,
        ofType: ofType as never,
      });
      const byId = new Map(accessible.map((a) => [a.object.id, a.actions]));
      for (const obj of objects.filter((o) => o.type === ofType)) {
        const expectedActions: string[] = [];
        for (const action of actions) {
          if (
            await authz.check({
              who: who as never,
              canThey: action,
              onWhat: obj as never,
            })
          ) {
            expectedActions.push(action);
          }
        }
        const got = (byId.get(obj.id) ?? []).slice().sort();
        assert.deepEqual(
          got,
          expectedActions.sort(),
          `${label}: listAccessibleObjects(${who.id}, ${ofType}) actions for ${obj.id} disagree with check`,
        );
      }
    }
  }
}

describe("list fast paths run in throw mode too", () => {
  it("returns the full result for a sub-cap graph in throw mode (no throw)", async () => {
    const authz = new AuthSystem({
      storage: new InMemoryStorageAdapter(),
      schema, // default maxDepthBehavior: "throw"
    });
    await authz.addMember({
      member: { type: "user", id: "alice" },
      group: { type: "team", id: "eng" },
    });
    await authz.allow({
      who: { type: "team", id: "eng" },
      toBe: "viewer",
      onWhat: { type: "folder", id: "f" },
    });
    await authz.setParent({
      child: { type: "document", id: "d1" },
      parent: { type: "folder", id: "f" },
    });

    const subs = await authz.listSubjects({
      canThey: "view",
      onWhat: { type: "document", id: "d1" },
    });
    assert.ok(subs.map((s) => `${s.type}:${s.id}`).includes("user:alice"));
    const { accessible } = await authz.listAccessibleObjects({
      who: { type: "user", id: "alice" },
      ofType: "document",
    });
    assert.ok(accessible.map((a) => a.object.id).includes("d1"));
  });

  it("throws MaxDepthExceededError when the graph is deeper than the cap (throw mode)", async () => {
    const authz = new AuthSystem({
      storage: new InMemoryStorageAdapter(),
      schema,
      maxDepthBehavior: "throw",
      defaultCheckDepth: 3,
    });
    // group chain longer than the cap, terminating in a grant.
    await authz.allow({
      who: { type: "team", id: "g0" },
      toBe: "viewer",
      onWhat: { type: "document", id: "deep" },
    });
    let prev = "g0";
    for (let i = 1; i <= 6; i++) {
      await authz.addMember({
        member: { type: "team", id: `g${i}` },
        group: { type: "team", id: prev },
      });
      prev = `g${i}`;
    }
    await authz.addMember({
      member: { type: "user", id: "leaf" },
      group: { type: "team", id: "g6" },
    });

    await assert.rejects(
      () =>
        authz.listSubjects({
          canThey: "view",
          onWhat: { type: "document", id: "deep" },
        }),
      MaxDepthExceededError,
    );
  });

  it("the same deep graph in deny mode bounds instead of throwing", async () => {
    const authz = new AuthSystem({
      storage: new InMemoryStorageAdapter(),
      schema,
      maxDepthBehavior: "deny",
      defaultCheckDepth: 3,
    });
    await authz.allow({
      who: { type: "team", id: "g0" },
      toBe: "viewer",
      onWhat: { type: "document", id: "deep" },
    });
    let prev = "g0";
    for (let i = 1; i <= 6; i++) {
      await authz.addMember({
        member: { type: "team", id: `g${i}` },
        group: { type: "team", id: prev },
      });
      prev = `g${i}`;
    }
    // deny mode never throws — returns the within-cap subjects.
    const subs = await authz.listSubjects({
      canThey: "view",
      onWhat: { type: "document", id: "deep" },
    });
    // g0..g3 are within the depth budget; deeper ones are bounded out.
    assert.ok(subs.map((s) => `${s.type}:${s.id}`).includes("team:g1"));
  });
});

describe("exists / count query variants (#5)", () => {
  async function seed(authz: AuthSystem<typeof schema>) {
    await authz.addMember({
      member: { type: "user", id: "alice" },
      group: { type: "team", id: "eng" },
    });
    await authz.allow({
      who: { type: "team", id: "eng" },
      toBe: "viewer",
      onWhat: { type: "folder", id: "f" },
    });
    await authz.setParent({
      child: { type: "document", id: "d1" },
      parent: { type: "folder", id: "f" },
    });
    await authz.allow({
      who: { type: "user", id: "bob" },
      toBe: "owner",
      onWhat: { type: "document", id: "d2" },
    });
  }

  for (const mode of ["deny", "throw"] as const) {
    it(`someoneCan matches listSubjects().length>0 (${mode} mode)`, async () => {
      const authz = new AuthSystem({
        storage: new InMemoryStorageAdapter(),
        schema,
        maxDepthBehavior: mode,
      });
      await seed(authz);
      for (const obj of [
        { type: "document", id: "d1" },
        { type: "document", id: "d2" },
        { type: "document", id: "nope" },
      ]) {
        const expected =
          (await authz.listSubjects({ canThey: "view", onWhat: obj as never }))
            .length > 0;
        assert.equal(
          await authz.someoneCan({ canThey: "view", onWhat: obj as never }),
          expected,
          `obj ${obj.id}`,
        );
      }
      // ofType filter respected
      assert.equal(
        await authz.someoneCan({
          canThey: "view",
          onWhat: { type: "document", id: "d1" },
          ofType: "user",
        }),
        true,
      );
      assert.equal(
        await authz.someoneCan({
          canThey: "view",
          onWhat: { type: "document", id: "nope" },
        }),
        false,
      );
    });
  }

  it("countSubjects / countAccessibleObjects equal the list lengths", async () => {
    const authz = new AuthSystem({
      storage: new InMemoryStorageAdapter(),
      schema,
      maxDepthBehavior: "deny",
    });
    await seed(authz);
    const subs = await authz.listSubjects({
      canThey: "view",
      onWhat: { type: "document", id: "d1" },
    });
    assert.equal(
      await authz.countSubjects({
        canThey: "view",
        onWhat: { type: "document", id: "d1" },
      }),
      subs.length,
    );
    const objs = await authz.listAccessibleObjects({
      who: { type: "user", id: "alice" },
      ofType: "document",
    });
    assert.equal(
      await authz.countAccessibleObjects({
        who: { type: "user", id: "alice" },
        ofType: "document",
      }),
      objs.accessible.length,
    );
  });
});

describe("preload option on list ops (#2)", () => {
  async function seed(authz: AuthSystem<typeof schema>) {
    await authz.addMember({
      member: { type: "user", id: "alice" },
      group: { type: "team", id: "eng" },
    });
    await authz.allow({
      who: { type: "team", id: "eng" },
      toBe: "viewer",
      onWhat: { type: "folder", id: "f" },
    });
    await authz.setParent({
      child: { type: "document", id: "d1" },
      parent: { type: "folder", id: "f" },
    });
    await authz.allow({
      who: { type: "user", id: "bob" },
      toBe: "owner",
      onWhat: { type: "document", id: "d2" },
    });
  }

  it("listSubjects returns the same result with and without preload", async () => {
    const authz = new AuthSystem({
      storage: new InMemoryStorageAdapter(),
      schema,
    });
    await seed(authz);
    const a = (
      await authz.listSubjects({
        canThey: "view",
        onWhat: { type: "document", id: "d1" },
      })
    )
      .map((s) => `${s.type}:${s.id}`)
      .sort();
    const b = (
      await authz.listSubjects({
        canThey: "view",
        onWhat: { type: "document", id: "d1" },
        preload: true,
      })
    )
      .map((s) => `${s.type}:${s.id}`)
      .sort();
    assert.deepEqual(b, a);
    assert.ok(a.includes("user:alice"));
  });

  it("listAccessibleObjects returns the same result with and without preload", async () => {
    const authz = new AuthSystem({
      storage: new InMemoryStorageAdapter(),
      schema,
    });
    await seed(authz);
    const norm = (r: {
      accessible: { object: { id: string }; actions: string[] }[];
    }) =>
      r.accessible
        .map((x) => `${x.object.id}:${[...x.actions].sort().join(",")}`)
        .sort();
    const a = norm(
      await authz.listAccessibleObjects({
        who: { type: "user", id: "alice" },
        ofType: "document",
      }),
    );
    const b = norm(
      await authz.listAccessibleObjects({
        who: { type: "user", id: "alice" },
        ofType: "document",
        preload: true,
      }),
    );
    assert.deepEqual(b, a);
    assert.ok(a.some((x) => x.startsWith("d1:")));
  });

  it("checkMany returns the same result with and without preload", async () => {
    const authz = new AuthSystem({
      storage: new InMemoryStorageAdapter(),
      schema,
    });
    await seed(authz);
    const reqs = [
      {
        who: { type: "user" as const, id: "alice" },
        canThey: "view" as const,
        onWhat: { type: "document" as const, id: "d1" },
      },
      {
        who: { type: "user" as const, id: "alice" },
        canThey: "view" as const,
        onWhat: { type: "document" as const, id: "d2" },
      },
    ];
    const a = await authz.checkMany(reqs);
    const b = await authz.checkMany(reqs, { preload: true });
    assert.deepEqual(b, a);
    assert.deepEqual(a, [true, false]);
  });
});

describe("shared positive memo parity (Design C)", () => {
  // Build one graph that exercises every trap, return the seed facts.
  async function buildGraph(authz: AuthSystem<typeof schema>) {
    // nested groups: alice -> sub-team -> super-team -> viewer of folder
    await authz.addMember({
      member: { type: "user", id: "alice" },
      group: { type: "team", id: "sub" },
    });
    await authz.addMember({
      member: { type: "team", id: "sub" },
      group: { type: "team", id: "super" },
    });
    await authz.allow({
      who: { type: "team", id: "super" },
      toBe: "viewer",
      onWhat: { type: "folder", id: "root" },
    });
    // group cycle: A <-> B (must terminate)
    await authz.addMember({
      member: { type: "team", id: "A" },
      group: { type: "team", id: "B" },
    });
    await authz.addMember({
      member: { type: "team", id: "B" },
      group: { type: "team", id: "A" },
    });
    await authz.addMember({
      member: { type: "user", id: "carol" },
      group: { type: "team", id: "A" },
    });
    await authz.allow({
      who: { type: "team", id: "B" },
      toBe: "editor",
      onWhat: { type: "document", id: "shared" },
    });
    // deep hierarchy chain: root -> f1 -> f2 -> doc-deep (view + edit propagate)
    await authz.setParent({
      child: { type: "folder", id: "f1" },
      parent: { type: "folder", id: "root" },
    });
    await authz.setParent({
      child: { type: "folder", id: "f2" },
      parent: { type: "folder", id: "f1" },
    });
    await authz.setParent({
      child: { type: "document", id: "doc-deep" },
      parent: { type: "folder", id: "f2" },
    });
    // a doc directly in root, reachable by many (the "popular doc" via the super-team)
    await authz.setParent({
      child: { type: "document", id: "doc-root" },
      parent: { type: "folder", id: "root" },
    });
    // direct grant + owner (delete only via owner)
    await authz.allow({
      who: { type: "user", id: "dave" },
      toBe: "owner",
      onWhat: { type: "document", id: "doc-root" },
    });
    // wildcard grant: everyone can view a public doc
    await authz.allow({
      who: everyone("user"),
      toBe: "viewer",
      onWhat: { type: "document", id: "public" },
    });
    // wildcard membership: everyone is a member of "all-hands", which views a folder
    await authz.addMember({
      member: everyone("user"),
      group: { type: "team", id: "all-hands" },
    });
    await authz.allow({
      who: { type: "team", id: "all-hands" },
      toBe: "viewer",
      onWhat: { type: "folder", id: "town" },
    });
    await authz.setParent({
      child: { type: "document", id: "memo" },
      parent: { type: "folder", id: "town" },
    });
  }

  const subjects = [
    { type: "user", id: "alice" },
    { type: "user", id: "carol" },
    { type: "user", id: "dave" },
    { type: "user", id: "nobody" },
    { type: "team", id: "super" },
    { type: "team", id: "B" },
  ];
  const objects = [
    { type: "document", id: "shared" },
    { type: "document", id: "doc-deep" },
    { type: "document", id: "doc-root" },
    { type: "document", id: "public" },
    { type: "document", id: "memo" },
    { type: "folder", id: "root" },
    { type: "folder", id: "f2" },
    { type: "folder", id: "town" },
  ];
  const actions: ("view" | "edit" | "delete")[] = ["view", "edit", "delete"];

  it("list ops equal forward check() in deny mode (sharedPos active)", async () => {
    const authz = new AuthSystem({
      storage: new InMemoryStorageAdapter(),
      schema,
      maxDepthBehavior: "deny",
    });
    await buildGraph(authz);
    await assertListParity(authz, subjects, objects, actions, "deny");
  });

  it("list ops equal forward check() in default throw mode (sharedPos inactive)", async () => {
    const authz = new AuthSystem({
      storage: new InMemoryStorageAdapter(),
      schema,
    });
    await buildGraph(authz);
    await assertListParity(authz, subjects, objects, actions, "throw");
  });

  it("respects the depth cap: a chain past the cap is denied identically by check and list (deny mode)", async () => {
    const authz = new AuthSystem({
      storage: new InMemoryStorageAdapter(),
      schema,
      maxDepthBehavior: "deny",
      defaultCheckDepth: 3,
    });
    // grant on the top of a long group chain so reaching it costs > cap hops
    let prev = "g0";
    await authz.allow({
      who: { type: "team", id: "g0" },
      toBe: "viewer",
      onWhat: { type: "document", id: "capped" },
    });
    for (let i = 1; i <= 6; i++) {
      await authz.addMember({
        member: { type: "team", id: `g${i}` },
        group: { type: "team", id: prev },
      });
      prev = `g${i}`;
    }
    await authz.addMember({
      member: { type: "user", id: "deep" },
      group: { type: "team", id: "g6" },
    });

    const subs = [
      { type: "user", id: "deep" },
      { type: "team", id: "g1" },
    ];
    const objs = [{ type: "document", id: "capped" }];
    await assertListParity(authz, subs, objs, ["view"], "depth-cap");
  });
});

/**
 * Randomized differential (the merge gate for Designs A & B): on many random
 * graphs, the deny-mode list operations — which use reverse expansion (A) and
 * single-pass derivation (B) — must equal the forward check() oracle, which is
 * the untouched engine. Seeded for reproducibility.
 */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A richer schema: two group axes + two hierarchy axes + an ASYMMETRIC remap
// (comment on a parent grants comment on the child, which also implies view).
const richSchema = defineSchema({
  subjectTypes: ["user", "team", "org"],
  objectTypes: ["doc", "folder", "team", "org"],
  relations: {
    owner: { type: "direct" },
    editor: { type: "direct" },
    viewer: { type: "direct" },
    commenter: { type: "direct" },
    member: { type: "group" },
    orgMember: { type: "group" },
    parent: { type: "hierarchy" },
    orgParent: { type: "hierarchy" },
  },
  actionToRelations: {
    view: ["owner", "editor", "viewer", "commenter", "member", "orgMember"],
    edit: ["owner", "editor"],
    comment: ["owner", "editor", "commenter"],
    delete: ["owner"],
  },
  hierarchyPropagation: {
    view: ["view"],
    edit: ["edit"],
    comment: ["comment"],
    delete: [],
  },
});

describe("randomized differential: deny-mode list ops == forward check()", () => {
  it("matches the forward oracle across 120 random graphs", async () => {
    const rand = mulberry32(0xc0ffee);
    const pick = <T>(xs: readonly T[]): T =>
      xs[Math.floor(rand() * xs.length)] as T;

    const users = ["u0", "u1", "u2", "u3"];
    const teams = ["t0", "t1", "t2"];
    const orgs = ["o0", "o1"];
    const docs = ["d0", "d1", "d2"];
    const folders = ["f0", "f1"];
    const directRels = ["owner", "editor", "viewer", "commenter"] as const;
    const actions = ["view", "edit", "comment", "delete"] as const;

    const subjects = [
      ...users.map((id) => ({ type: "user", id })),
      ...teams.map((id) => ({ type: "team", id })),
      ...orgs.map((id) => ({ type: "org", id })),
    ];
    const objects = [
      ...docs.map((id) => ({ type: "doc", id })),
      ...folders.map((id) => ({ type: "folder", id })),
      ...teams.map((id) => ({ type: "team", id })),
      ...orgs.map((id) => ({ type: "org", id })),
    ];

    for (let g = 0; g < 120; g++) {
      const depth = 1 + Math.floor(rand() * 6); // stress small caps
      const authz = new AuthSystem({
        storage: new InMemoryStorageAdapter(),
        schema: richSchema,
        maxDepthBehavior: "deny",
        defaultCheckDepth: depth,
      });

      const grants = 4 + Math.floor(rand() * 10);
      for (let i = 0; i < grants; i++) {
        const roll = rand();
        if (roll < 0.35) {
          // direct grant (sometimes wildcard, sometimes time-conditioned)
          const who =
            rand() < 0.15 ? everyone(pick(["user", "team"])) : pick(subjects);
          const cond =
            rand() < 0.15
              ? { validUntil: new Date(Date.now() + 3_600_000) }
              : undefined;
          await authz.allow({
            who: who as never,
            toBe: pick(directRels),
            onWhat: pick(objects) as never,
            when: cond,
          });
        } else if (roll < 0.6) {
          // group membership (member or orgMember), sometimes wildcard/nested
          const rel = pick(["member", "orgMember"] as const);
          const member =
            rand() < 0.12
              ? everyone("user")
              : pick([
                  ...users.map((id) => ({ type: "user", id })),
                  ...teams.map((id) => ({ type: "team", id })),
                ]);
          const group =
            rel === "orgMember"
              ? pick(orgs.map((id) => ({ type: "org", id })))
              : pick(teams.map((id) => ({ type: "team", id })));
          await authz.addMember({
            member: member as never,
            group: group as never,
            as: rel,
          });
        } else if (roll < 0.85) {
          // hierarchy link (parent or orgParent)
          const rel = pick(["parent", "orgParent"] as const);
          const child = pick([
            ...docs.map((id) => ({ type: "doc", id })),
            ...folders.map((id) => ({ type: "folder", id })),
          ]);
          const parent =
            rel === "orgParent"
              ? pick(orgs.map((id) => ({ type: "org", id })))
              : pick(folders.map((id) => ({ type: "folder", id })));
          await authz.setParent({
            child: child as never,
            parent: parent as never,
            as: rel,
          });
        } else {
          // field-level grant on a doc (doc is not field-enabled here, so this
          // just exercises ids containing '#' staying literal — safe)
          await authz.allow({
            who: pick(subjects) as never,
            toBe: pick(directRels),
            onWhat: pick(objects) as never,
          });
        }
      }

      // Differential: every list result must equal the forward check() oracle.
      for (const obj of objects) {
        for (const action of actions) {
          const listed = await authz.listSubjects({
            canThey: action as never,
            onWhat: obj as never,
          });
          const wildTypes = new Set(
            listed.filter((s) => s.id === "*").map((s) => s.type),
          );
          const keys = new Set(listed.map((s) => `${s.type}:${s.id}`));
          for (const s of subjects) {
            const expected = await authz.check({
              who: s as never,
              canThey: action as never,
              onWhat: obj as never,
            });
            const actual =
              keys.has(`${s.type}:${s.id}`) || wildTypes.has(s.type as any);
            assert.equal(
              actual,
              expected,
              `graph ${g} (depth ${depth}): listSubjects(${action}, ${obj.type}:${obj.id}) vs check for ${s.type}:${s.id}`,
            );
          }
        }
      }

      for (const who of subjects) {
        for (const ofType of ["doc", "folder"]) {
          const { accessible } = await authz.listAccessibleObjects({
            who: who as never,
            ofType: ofType as never,
          });
          const byId = new Map(accessible.map((a) => [a.object.id, a.actions]));
          for (const obj of objects.filter((o) => o.type === ofType)) {
            const expected: string[] = [];
            for (const action of actions) {
              if (
                await authz.check({
                  who: who as never,
                  canThey: action as never,
                  onWhat: obj as never,
                })
              ) {
                expected.push(action);
              }
            }
            assert.deepEqual(
              (byId.get(obj.id) ?? []).slice().sort(),
              expected.sort(),
              `graph ${g} (depth ${depth}): listAccessibleObjects(${who.type}:${who.id}, ${ofType}) actions for ${obj.id}`,
            );
          }
        }
      }
    }
  });
});

describe("listAccessibleObjects reachable-only parent map (Design F1)", () => {
  it("reports the same `parent` field, including with multiple hierarchy relations", async () => {
    const multiHier = defineSchema({
      subjectTypes: ["user"],
      objectTypes: ["document", "folder", "org"],
      relations: {
        owner: { type: "direct" },
        folderParent: { type: "hierarchy" },
        orgParent: { type: "hierarchy" },
      },
      actionToRelations: { view: ["owner"], edit: ["owner"] },
      hierarchyPropagation: { view: ["view"], edit: ["edit"] },
    });
    const authz = new AuthSystem({
      storage: new InMemoryStorageAdapter(),
      schema: multiHier,
      defaultHierarchyRelation: "folderParent",
    });
    await authz.allow({
      who: { type: "user", id: "alice" },
      toBe: "owner",
      onWhat: { type: "folder", id: "f1" },
    });
    // doc has BOTH a folder parent and an org parent — declared order is
    // folderParent first, so that wins the reported `parent`.
    await authz.setParent({
      child: { type: "document", id: "d1" },
      parent: { type: "folder", id: "f1" },
      as: "folderParent",
    });
    await authz.setParent({
      child: { type: "document", id: "d1" },
      parent: { type: "org", id: "acme" },
      as: "orgParent",
    });

    const { accessible } = await authz.listAccessibleObjects({
      who: { type: "user", id: "alice" },
      ofType: "document",
    });
    const d1 = accessible.find((a) => a.object.id === "d1");
    assert.ok(d1, "d1 should be accessible via folder hierarchy");
    assert.deepEqual(d1.parent, { type: "folder", id: "f1" });
  });

  it("a document with no parent reports parent: undefined", async () => {
    const authz = new AuthSystem({
      storage: new InMemoryStorageAdapter(),
      schema,
    });
    await authz.allow({
      who: { type: "user", id: "alice" },
      toBe: "owner",
      onWhat: { type: "document", id: "loose" },
    });
    const { accessible } = await authz.listAccessibleObjects({
      who: { type: "user", id: "alice" },
      ofType: "document",
    });
    const loose = accessible.find((a) => a.object.id === "loose");
    assert.ok(loose);
    assert.equal(loose.parent, undefined);
  });

  it("honors conditions on the parent link", async () => {
    const authz = new AuthSystem({
      storage: new InMemoryStorageAdapter(),
      schema,
    });
    await authz.allow({
      who: { type: "user", id: "alice" },
      toBe: "viewer",
      onWhat: { type: "document", id: "d1" },
    });
    // expired parent link — must not be reported as the parent
    await authz.setParent({
      child: { type: "document", id: "d1" },
      parent: { type: "folder", id: "f1" },
      condition: { validUntil: new Date(Date.now() - 1000) },
    });
    const { accessible } = await authz.listAccessibleObjects({
      who: { type: "user", id: "alice" },
      ofType: "document",
    });
    const d1 = accessible.find((a) => a.object.id === "d1");
    assert.ok(d1);
    assert.equal(d1.parent, undefined, "expired parent link must be ignored");
  });
});

describe("ReadCache preload secondary indexes (Design D)", () => {
  // A storage with a few tuples that share type:id but differ in extra props,
  // to prove bucketing by objKey + matches()'s full deepEqual stays correct.
  const tuples: StoredTuple[] = [
    {
      id: "1",
      subject: { type: "user", id: "a" },
      relation: "member",
      object: { type: "team", id: "x" },
    },
    {
      id: "2",
      subject: { type: "user", id: "a" },
      relation: "viewer",
      object: { type: "doc", id: "1" },
    },
    {
      id: "3",
      subject: { type: "user", id: "b" },
      relation: "member",
      object: { type: "team", id: "x" },
    },
    {
      id: "4",
      subject: { type: "team", id: "x" },
      relation: "viewer",
      object: { type: "doc", id: "1" },
    },
    {
      id: "5",
      subject: { type: "doc", id: "1" },
      relation: "parent",
      object: { type: "folder", id: "f" },
    },
    // tenant-tagged: same type:id as #4's subject but extra prop -> must NOT collide
    {
      id: "6",
      subject: { type: "team", id: "x", tenant: "acme" } as never,
      relation: "viewer",
      object: { type: "doc", id: "2" },
    },
  ];

  const storage = {
    findTuples: async (filter: Record<string, unknown>) => {
      return tuples.filter((t) => {
        if (
          filter.subject &&
          JSON.stringify(t.subject) !== JSON.stringify(filter.subject)
        )
          return false;
        if (filter.relation && t.relation !== filter.relation) return false;
        if (
          filter.object &&
          JSON.stringify(t.object) !== JSON.stringify(filter.object)
        )
          return false;
        return true;
      });
    },
    findSubjects: async () => [],
    findObjects: async () => [],
  };

  const filters = [
    { subject: { type: "user", id: "a" } },
    { subject: { type: "user", id: "a" }, relation: "member" },
    {
      subject: { type: "user", id: "a" },
      relation: "member",
      object: { type: "team", id: "x" },
    },
    { object: { type: "team", id: "x" } },
    { object: { type: "doc", id: "1" }, relation: "viewer" },
    { relation: "member" },
    { subject: { type: "team", id: "x" } }, // bare {type,id}: must NOT match the tenant-tagged #6
    { subject: { type: "team", id: "x", tenant: "acme" } as never }, // tagged: only #6
  ];

  const key = (ts: StoredTuple[]) =>
    ts
      .map((t) => t.id)
      .sort()
      .join(",");

  it("returns identical sets with and without preload, for every filter shape", async () => {
    for (const f of filters) {
      const plain = new ReadCache(storage);
      const preloaded = new ReadCache(storage);
      await preloaded.findTuples({}); // materialize the "*" set

      const a = key(await plain.findTuples(f as never));
      const b = key(await preloaded.findTuples(f as never));
      assert.equal(b, a, `mismatch for filter ${JSON.stringify(f)}`);
    }
  });

  it("a bare {type,id} subject does not match a tenant-tagged tuple (preload)", async () => {
    const preloaded = new ReadCache(storage);
    await preloaded.findTuples({});
    const res = await preloaded.findTuples({
      subject: { type: "team", id: "x" },
    } as never);
    assert.deepEqual(res.map((t) => t.id).sort(), ["4"]); // not #6
  });

  it("contextual tuples are still returned under preload", async () => {
    const ctx: StoredTuple[] = [
      {
        id: "ctx:0",
        subject: { type: "user", id: "z" },
        relation: "viewer",
        object: { type: "doc", id: "9" },
      },
    ];
    const preloaded = new ReadCache(storage, ctx);
    await preloaded.findTuples({});
    const res = await preloaded.findTuples({
      subject: { type: "user", id: "z" },
    } as never);
    assert.deepEqual(
      res.map((t) => t.id),
      ["ctx:0"],
    );
  });
});
