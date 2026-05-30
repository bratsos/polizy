import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { InMemoryStorageAdapter } from "../polizy.in-memory.storage.ts";
import type { StorageAdapter } from "../polizy.storage.ts";
import { AuthSystem } from "../polizy.ts";
import { defineSchema, everyone } from "../types.ts";

// A storage adapter that counts read calls, to prove the engine batches reads
// (fetch-then-resolve) instead of doing one point-lookup per graph edge.
class CountingAdapter<S extends string, O extends string>
  implements StorageAdapter<S, O>
{
  reads = 0;
  private readonly inner: StorageAdapter<S, O>;
  constructor(inner: StorageAdapter<S, O>) {
    this.inner = inner;
  }
  write: StorageAdapter<S, O>["write"] = (t) => this.inner.write(t);
  delete: StorageAdapter<S, O>["delete"] = (f) => this.inner.delete(f);
  findTuples: StorageAdapter<S, O>["findTuples"] = (f, o) => {
    this.reads++;
    return this.inner.findTuples(f, o);
  };
  findSubjects: StorageAdapter<S, O>["findSubjects"] = (obj, rel, o) => {
    this.reads++;
    return this.inner.findSubjects(obj, rel, o);
  };
  findObjects: StorageAdapter<S, O>["findObjects"] = (sub, rel, o) => {
    this.reads++;
    return this.inner.findObjects(sub, rel, o);
  };
}

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
    share: ["owner", "editor"],
    manage_members: ["owner"],
  },
  hierarchyPropagation: { view: ["view"], edit: ["edit"] },
});

const USER = (id: string) => ({ type: "user" as const, id });
const DOC = (id: string) => ({ type: "document" as const, id });
const FOLDER = (id: string) => ({ type: "folder" as const, id });
const TEAM = (id: string) => ({ type: "team" as const, id });

async function seeded() {
  const counter = new CountingAdapter(
    new InMemoryStorageAdapter<
      "user" | "team",
      "document" | "folder" | "team"
    >(),
  );
  const authz = new AuthSystem({ schema, storage: counter });
  await authz.allow({
    who: USER("alice"),
    toBe: "owner",
    onWhat: FOLDER("eng"),
  });
  await authz.allow({ who: USER("alice"), toBe: "owner", onWhat: DOC("arch") });
  await authz.allow({ who: USER("alice"), toBe: "owner", onWhat: DOC("api") });
  await authz.allow({ who: USER("bob"), toBe: "editor", onWhat: DOC("arch") });
  await authz.allow({
    who: USER("charlie"),
    toBe: "owner",
    onWhat: DOC("brand"),
  });
  await authz.setParent({ child: DOC("arch"), parent: FOLDER("eng") });
  await authz.setParent({ child: DOC("api"), parent: FOLDER("eng") });
  await authz.addMember({ member: USER("david"), group: TEAM("eng") });
  await authz.allow({
    who: TEAM("eng"),
    toBe: "viewer",
    onWhat: FOLDER("eng"),
  });
  await authz.allow({
    who: everyone("user"),
    toBe: "viewer",
    onWhat: DOC("public"),
  });
  counter.reads = 0; // ignore the seeding writes' reads
  return { authz, counter };
}

const OBJECTS = [
  FOLDER("eng"),
  DOC("arch"),
  DOC("api"),
  DOC("brand"),
  DOC("public"),
  TEAM("eng"),
];
const ACTIONS = ["view", "edit", "delete", "share", "manage_members"] as const;

describe("read batching (fetch-then-resolve)", () => {
  it("a checkMany over many objects×actions makes few storage reads, not one per edge", async () => {
    const { authz, counter } = await seeded();
    const checks = OBJECTS.flatMap((onWhat) =>
      ACTIONS.map((canThey) => ({ who: USER("alice"), canThey, onWhat })),
    );
    const results = await authz.checkMany(checks);

    // 6 objects × 5 actions = 30 checks. A per-edge engine would issue ~100+
    // reads; the batched reader should be in the low double digits at most.
    assert.equal(results.length, 30);
    assert.ok(
      counter.reads < checks.length,
      `expected far fewer reads than ${checks.length} checks, got ${counter.reads}`,
    );
    assert.ok(
      counter.reads <= 25,
      `expected batched reads <= 25, got ${counter.reads}`,
    );
  });

  it("still returns correct decisions with batching", async () => {
    const { authz } = await seeded();
    // alice owns eng folder → view/edit on arch (in folder) via hierarchy
    assert.equal(
      await authz.check({
        who: USER("alice"),
        canThey: "edit",
        onWhat: DOC("arch"),
      }),
      true,
    );
    // david is in team eng → team views folder → david views arch (group→hierarchy)
    assert.equal(
      await authz.check({
        who: USER("david"),
        canThey: "view",
        onWhat: DOC("arch"),
      }),
      true,
    );
    assert.equal(
      await authz.check({
        who: USER("david"),
        canThey: "edit",
        onWhat: DOC("arch"),
      }),
      false,
    );
    // public doc: anyone can view
    assert.equal(
      await authz.check({
        who: USER("bob"),
        canThey: "view",
        onWhat: DOC("public"),
      }),
      true,
    );
    // bob only edits arch, nothing on brand
    assert.equal(
      await authz.check({
        who: USER("bob"),
        canThey: "view",
        onWhat: DOC("brand"),
      }),
      false,
    );
  });

  it("contextual tuples enable read-your-writes without a stored grant", async () => {
    const { authz } = await seeded();
    const before = await authz.check({
      who: USER("erin"),
      canThey: "view",
      onWhat: DOC("arch"),
    });
    assert.equal(before, false);
    const withContext = await authz.check({
      who: USER("erin"),
      canThey: "view",
      onWhat: DOC("arch"),
      contextualTuples: [
        { subject: USER("erin"), relation: "viewer", object: DOC("arch") },
      ],
    });
    assert.equal(withContext, true);
    // ephemeral: not persisted
    const after = await authz.check({
      who: USER("erin"),
      canThey: "view",
      onWhat: DOC("arch"),
    });
    assert.equal(after, false);
  });
});
