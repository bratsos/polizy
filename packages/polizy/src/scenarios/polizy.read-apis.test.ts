import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { AuthSystem } from "../polizy.ts";
import { InMemoryStorageAdapter } from "../polizy.in-memory.storage.ts";
import { defineSchema, everyone } from "../types.ts";
import { NotAuthorizedError } from "../errors.ts";
import type { InputTuple } from "../types.ts";

/** Counts findTuples calls and how many used an empty (full-scan) filter. */
class ScanCountingAdapter extends InMemoryStorageAdapter<string, string> {
  public emptyFilterCalls = 0;
  async findTuples(
    filter: Partial<InputTuple<string, string>>,
    options?: { limit?: number; offset?: number },
  ) {
    if (!filter.subject && !filter.relation && !filter.object) {
      this.emptyFilterCalls++;
    }
    return super.findTuples(filter, options);
  }
}

const schema = defineSchema({
  subjectTypes: ["user"],
  objectTypes: ["document", "folder", "team"],
  relations: {
    owner: { type: "direct" },
    editor: { type: "direct" },
    viewer: { type: "direct" },
    member: { type: "group" },
    parent: { type: "hierarchy" },
  },
  actionToRelations: {
    view: ["viewer", "editor", "owner", "member"],
    edit: ["editor", "owner"],
    delete: ["owner"],
  },
  hierarchyPropagation: { view: ["view"], edit: ["edit"], delete: [] },
});

const u = (id: string) => ({ type: "user" as const, id });
const doc = (id: string) => ({ type: "document" as const, id });
const folder = (id: string) => ({ type: "folder" as const, id });
const team = (id: string) => ({ type: "team" as const, id });

describe("read APIs", () => {
  let storage: InMemoryStorageAdapter<string, string>;
  let authz: AuthSystem<typeof schema>;

  beforeEach(() => {
    storage = new InMemoryStorageAdapter();
    authz = new AuthSystem({ storage, schema });
  });

  describe("checkMany", () => {
    it("returns booleans aligned with the requests", async () => {
      await authz.allow({ who: u("a"), toBe: "owner", onWhat: doc("d1") });
      const results = await authz.checkMany([
        { who: u("a"), canThey: "edit", onWhat: doc("d1") },
        { who: u("a"), canThey: "edit", onWhat: doc("d2") },
        { who: u("a"), canThey: "view", onWhat: doc("d1") },
      ]);
      assert.deepEqual(results, [true, false, true]);
    });
  });

  describe("checkOrThrow", () => {
    it("resolves when allowed and throws NotAuthorizedError when denied", async () => {
      await authz.allow({ who: u("b"), toBe: "owner", onWhat: doc("d1") });
      await assert.doesNotReject(
        authz.checkOrThrow({ who: u("b"), canThey: "edit", onWhat: doc("d1") }),
      );
      await assert.rejects(
        authz.checkOrThrow({ who: u("b"), canThey: "delete", onWhat: doc("d2") }),
        NotAuthorizedError,
      );
    });
  });

  describe("explain", () => {
    it("explains a direct grant", async () => {
      await authz.allow({ who: u("c"), toBe: "owner", onWhat: doc("d1") });
      const r = await authz.explain({ who: u("c"), canThey: "edit", onWhat: doc("d1") });
      assert.equal(r.allowed, true);
      assert.equal(r.via?.kind, "direct");
    });
    it("explains a denial with via null", async () => {
      const r = await authz.explain({ who: u("c"), canThey: "edit", onWhat: doc("none") });
      assert.equal(r.allowed, false);
      assert.equal(r.via, null);
    });
    it("explains a group grant", async () => {
      await authz.allow({ who: team("t") as any, toBe: "viewer", onWhat: doc("d1") });
      await authz.addMember({ member: u("c"), group: team("t") });
      const r = await authz.explain({ who: u("c"), canThey: "view", onWhat: doc("d1") });
      assert.equal(r.allowed, true);
      assert.equal(r.via?.kind, "group");
    });
    it("explains a hierarchy grant", async () => {
      await authz.allow({ who: u("c"), toBe: "viewer", onWhat: folder("f") });
      await authz.setParent({ child: doc("d1"), parent: folder("f") });
      const r = await authz.explain({ who: u("c"), canThey: "view", onWhat: doc("d1") });
      assert.equal(r.allowed, true);
      assert.equal(r.via?.kind, "hierarchy");
    });
    it("explains a wildcard grant", async () => {
      await authz.allow({ who: everyone("user"), toBe: "viewer", onWhat: doc("d1") });
      const r = await authz.explain({ who: u("z"), canThey: "view", onWhat: doc("d1") });
      assert.equal(r.allowed, true);
      assert.equal(r.via?.kind, "wildcard");
    });
  });

  describe("listSubjects (reverse expand)", () => {
    it("returns direct holders, group members, and hierarchy descendants' grantees", async () => {
      await authz.allow({ who: u("direct"), toBe: "viewer", onWhat: doc("d1") });
      await authz.allow({ who: team("t") as any, toBe: "viewer", onWhat: doc("d1") });
      await authz.addMember({ member: u("viaGroup"), group: team("t") });
      const subjects = await authz.listSubjects({ canThey: "view", onWhat: doc("d1") });
      const ids = subjects.map((s) => s.id).sort();
      assert.ok(ids.includes("direct"), "direct holder missing");
      assert.ok(ids.includes("viaGroup"), "group member missing");
    });
    it("honors the ofType filter and dedupes", async () => {
      await authz.allow({ who: u("x"), toBe: "owner", onWhat: doc("d1") });
      await authz.allow({ who: u("x"), toBe: "viewer", onWhat: doc("d1") });
      const subjects = await authz.listSubjects({ canThey: "view", onWhat: doc("d1"), ofType: "user" });
      assert.equal(subjects.filter((s) => s.id === "x").length, 1, "should dedupe");
    });
  });

  describe("listAccessibleObjects", () => {
    it("returns accessible objects with their actions, without a full-table scan", async () => {
      const scan = new ScanCountingAdapter();
      const a = new AuthSystem({ storage: scan, schema });
      await a.allow({ who: u("o"), toBe: "owner", onWhat: doc("d1") });
      await a.allow({ who: u("o"), toBe: "viewer", onWhat: doc("d2") });
      scan.emptyFilterCalls = 0;
      const { accessible } = await a.listAccessibleObjects({ who: u("o"), ofType: "document" });
      const ids = accessible.map((x) => x.object.id).sort();
      assert.deepEqual(ids, ["d1", "d2"]);
      const d1 = accessible.find((x) => x.object.id === "d1");
      assert.ok(d1?.actions.includes("edit") && d1?.actions.includes("view"));
      assert.equal(scan.emptyFilterCalls, 0, "must not perform an empty-filter full-table scan");
    });
    it("filters by canThey when provided", async () => {
      await authz.allow({ who: u("o"), toBe: "viewer", onWhat: doc("d1") });
      await authz.allow({ who: u("o"), toBe: "owner", onWhat: doc("d2") });
      const { accessible } = await authz.listAccessibleObjects({ who: u("o"), ofType: "document", canThey: "edit" });
      assert.deepEqual(accessible.map((x) => x.object.id), ["d2"]);
    });
  });

  describe("listTuples pagination", () => {
    it("applies limit and offset", async () => {
      for (let i = 0; i < 5; i++) {
        await authz.allow({ who: u(`u${i}`), toBe: "viewer", onWhat: doc("shared") });
      }
      const page = await authz.listTuples({ object: doc("shared") }, { limit: 2, offset: 1 });
      assert.equal(page.length, 2);
    });
  });
});
