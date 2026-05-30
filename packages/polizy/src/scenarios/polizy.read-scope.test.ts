import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { InMemoryStorageAdapter } from "../polizy.in-memory.storage.ts";
import type { StorageAdapter } from "../polizy.storage.ts";
import { AuthSystem } from "../polizy.ts";
import { defineSchema, everyone } from "../types.ts";

// Counts storage reads so we can prove a read scope coalesces them.
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
  findSubjects: StorageAdapter<S, O>["findSubjects"] = (a, b, c) => {
    this.reads++;
    return this.inner.findSubjects(a, b, c);
  };
  findObjects: StorageAdapter<S, O>["findObjects"] = (a, b, c) => {
    this.reads++;
    return this.inner.findObjects(a, b, c);
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
    manage: ["owner"],
  },
  hierarchyPropagation: { view: ["view"], edit: ["edit"] },
});

const U = (id: string) => ({ type: "user" as const, id });
const D = (id: string) => ({ type: "document" as const, id });
const F = (id: string) => ({ type: "folder" as const, id });
const T = (id: string) => ({ type: "team" as const, id });
const ACTIONS = ["view", "edit", "delete", "share", "manage"];
const OBJECTS = [
  F("eng"),
  D("arch"),
  D("api"),
  D("brand"),
  D("public"),
  T("eng"),
];

async function seeded() {
  const counter = new CountingAdapter(
    new InMemoryStorageAdapter<
      "user" | "team",
      "document" | "folder" | "team"
    >(),
  );
  const authz = new AuthSystem({ schema, storage: counter });
  await authz.allow({ who: U("alice"), toBe: "owner", onWhat: F("eng") });
  await authz.allow({ who: U("alice"), toBe: "owner", onWhat: D("arch") });
  await authz.allow({ who: U("bob"), toBe: "editor", onWhat: D("arch") });
  await authz.allow({ who: U("charlie"), toBe: "owner", onWhat: D("brand") });
  await authz.setParent({ child: D("arch"), parent: F("eng") });
  await authz.setParent({ child: D("api"), parent: F("eng") });
  await authz.addMember({ member: U("david"), group: T("eng") });
  await authz.allow({ who: T("eng"), toBe: "viewer", onWhat: F("eng") });
  await authz.allow({
    who: everyone("user"),
    toBe: "viewer",
    onWhat: D("public"),
  });
  counter.reads = 0;
  return { authz, counter };
}

// The full mix of read operations a page might run.
async function page(s: {
  checkMany: AuthSystem<typeof schema>["checkMany"];
  explain: AuthSystem<typeof schema>["explain"];
  listAccessibleObjects: AuthSystem<typeof schema>["listAccessibleObjects"];
  listSubjects: AuthSystem<typeof schema>["listSubjects"];
}) {
  return {
    docs: await s.listAccessibleObjects({
      who: U("alice"),
      ofType: "document",
    }),
    folders: await s.listAccessibleObjects({
      who: U("alice"),
      ofType: "folder",
    }),
    grid: await s.checkMany(
      OBJECTS.flatMap((o) =>
        ACTIONS.map((a) => ({ who: U("alice"), canThey: a, onWhat: o })),
      ),
    ),
    why: await s.explain({
      who: U("david"),
      canThey: "view",
      onWhat: D("arch"),
    }),
    who: (
      await s.listSubjects({
        canThey: "view",
        onWhat: D("arch"),
        ofType: "user",
      })
    ).map((x) => x.id),
  };
}

describe("withReadScope", () => {
  it("shares one read pass across many operations", async () => {
    const { authz, counter } = await seeded();

    counter.reads = 0;
    await page(authz);
    const separate = counter.reads;

    counter.reads = 0;
    await authz.withReadScope((scope) => page(scope));
    const scoped = counter.reads;

    assert.ok(
      scoped < separate,
      `scope should read less than separate ops: ${scoped} vs ${separate}`,
    );
  });

  it("{ preload: true } loads the store in a single read", async () => {
    const { authz, counter } = await seeded();
    counter.reads = 0;
    await authz.withReadScope((scope) => page(scope), { preload: true });
    assert.equal(
      counter.reads,
      1,
      `preload should be one storage read, got ${counter.reads}`,
    );
  });

  it("scope results are identical to running the operations standalone", async () => {
    const { authz } = await seeded();
    const standalone = await page(authz);
    const scoped = await authz.withReadScope((scope) => page(scope), {
      preload: true,
    });
    assert.deepEqual(scoped, standalone);
  });
});
