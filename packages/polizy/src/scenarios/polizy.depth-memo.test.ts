import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { InMemoryStorageAdapter } from "../polizy.in-memory.storage.ts";
import { AuthSystem } from "../polizy.ts";
import { defineSchema } from "../types.ts";

/**
 * Regression: depth-bounded results must never leak across a shared reader.
 *
 * The read-batching perf work made several read APIs (`checkMany`,
 * `listAccessibleObjects`, `listSubjects`) resolve many checks against ONE
 * shared per-operation reader/snapshot. A `check` is depth-sensitive: a granting
 * path longer than `defaultCheckDepth` is denied (or throws). The danger is that
 * a shared *decision* memo — one that cached a grant proven via a short path —
 * could be reused to over-grant a different, deeper request in the same batch,
 * or that batching otherwise changed a per-request depth outcome. Each request
 * must keep its OWN decision memo while sharing only raw storage reads.
 *
 * Setup: a granting path strictly LONGER than a small `defaultCheckDepth`.
 *   user:alice in g1 in g2 in g3 in g4, and g4 is `viewer` of doc:secret.
 * That is FOUR group hops (alice -> g1 -> g2 -> g3 -> g4 -> direct viewer),
 * so resolution reaches depth 4. With `defaultCheckDepth: 3` the path exceeds
 * the cap and access is DENIED; with a generous cap it is within budget.
 *
 * doc:pub is a SHALLOW, directly-granted resource (user:bob viewer of doc:pub)
 * used as a `true` neighbor in the batch, so the shared reader's memo is
 * populated by genuinely-allowed checks before the deep one runs — exactly the
 * condition under which a leaked grant would surface.
 */

const schema = defineSchema({
  relations: {
    viewer: { type: "direct" },
    member: { type: "group" },
  },
  actionToRelations: {
    view: ["viewer"],
  },
  subjectTypes: ["user"],
  objectTypes: ["doc", "team"],
});

const alice = { type: "user" as const, id: "alice" };
const bob = { type: "user" as const, id: "bob" };
const secret = { type: "doc" as const, id: "secret" };
const pub = { type: "doc" as const, id: "pub" };

/** Build a fresh system at the given depth, seeded with the chain above. */
async function seed(
  defaultCheckDepth: number,
): Promise<AuthSystem<typeof schema>> {
  const sys = new AuthSystem({
    schema,
    storage: new InMemoryStorageAdapter(),
    defaultCheckDepth,
    maxDepthBehavior: "deny",
  });

  // Deep granting path: alice -> g1 -> g2 -> g3 -> g4 (four group hops).
  await sys.addMember({ member: alice, group: { type: "team", id: "g1" } });
  await sys.addMember({
    member: { type: "team", id: "g1" },
    group: { type: "team", id: "g2" },
  });
  await sys.addMember({
    member: { type: "team", id: "g2" },
    group: { type: "team", id: "g3" },
  });
  await sys.addMember({
    member: { type: "team", id: "g3" },
    group: { type: "team", id: "g4" },
  });
  await sys.allow({
    who: { type: "team", id: "g4" },
    toBe: "viewer",
    onWhat: secret,
  });

  // Shallow, directly-granted neighbor used to warm the shared batch reader.
  await sys.allow({ who: bob, toBe: "viewer", onWhat: pub });

  return sys;
}

describe("depth-bounded decisions do not leak across a shared reader", () => {
  it("DENIES the over-budget path at defaultCheckDepth:3 (no over-grant from a shared memo)", async () => {
    const sys = await seed(3);

    // A standalone check denies: the path (depth 4) exceeds the cap (3).
    const standalone = await sys.check({
      who: alice,
      canThey: "view",
      onWhat: secret,
    });
    assert.equal(standalone, false, "deep path must be denied at depth 3");

    // checkMany batches two genuinely-allowed shallow checks BEFORE the deep
    // one. The shared reader serves their reads (and would expose a shared
    // decision memo). The deep element must still be false — no leaked grant.
    const batch = await sys.checkMany([
      { who: bob, canThey: "view", onWhat: pub },
      { who: bob, canThey: "view", onWhat: pub },
      { who: alice, canThey: "view", onWhat: secret },
    ]);
    assert.deepEqual(
      batch,
      [true, true, false],
      "deep element must stay denied despite allowed neighbors sharing the reader",
    );

    // listAccessibleObjects (also a shared-reader op) must EXCLUDE the resource.
    const objs = await sys.listAccessibleObjects({ who: alice, ofType: "doc" });
    const objIds = objs.accessible.map((a) => a.object.id).sort();
    assert.deepEqual(
      objIds,
      [],
      "secret must not be listed as accessible at depth 3",
    );

    // listSubjects must EXCLUDE the deep subject (user:alice) for the
    // over-budget resource. The intermediate teams g1..g4 legitimately remain —
    // each is itself a viewer of secret within budget (g4 directly, g1..g3 via
    // shorter member chains), so they are NOT the regression target. Only
    // user:alice's path (four hops) exceeds the cap, so only alice is dropped.
    const subs = await sys.listSubjects({ canThey: "view", onWhat: secret });
    const subKeys = subs.map((s) => `${s.type}:${s.id}`);
    assert.ok(
      !subKeys.includes("user:alice"),
      "alice must not be listed as a subject at depth 3 (her path exceeds the cap)",
    );
  });

  it("GRANTS the same path at defaultCheckDepth:20 (proves the test is meaningful)", async () => {
    // Same data, generous cap: the path is now within budget, so every API must
    // include/grant it. This guards against the deny assertions trivially always
    // holding (e.g. a typo'd schema that never grants anything).
    const sys = await seed(20);

    const standalone = await sys.check({
      who: alice,
      canThey: "view",
      onWhat: secret,
    });
    assert.equal(standalone, true, "deep path must be allowed within budget");

    const batch = await sys.checkMany([
      { who: bob, canThey: "view", onWhat: pub },
      { who: bob, canThey: "view", onWhat: pub },
      { who: alice, canThey: "view", onWhat: secret },
    ]);
    assert.deepEqual(batch, [true, true, true]);

    const objs = await sys.listAccessibleObjects({ who: alice, ofType: "doc" });
    const objIds = objs.accessible.map((a) => a.object.id).sort();
    assert.deepEqual(
      objIds,
      ["secret"],
      "secret must be accessible within budget",
    );

    const subs = await sys.listSubjects({ canThey: "view", onWhat: secret });
    const subKeys = subs.map((s) => `${s.type}:${s.id}`);
    assert.ok(
      subKeys.includes("user:alice"),
      "alice must be listed as a subject within budget",
    );
  });
});
