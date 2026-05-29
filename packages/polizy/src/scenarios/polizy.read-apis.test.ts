import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { AuthSystem } from "../polizy.ts";
import { InMemoryStorageAdapter } from "../polizy.in-memory.storage.ts";
import { defineSchema, everyone } from "../types.ts";
import { NotAuthorizedError } from "../errors.ts";
import type {
  InputTuple,
  SchemaObjectTypes,
  SchemaSubjectTypes,
} from "../types.ts";

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

type Subj = SchemaSubjectTypes<typeof schema>;
type Obj = SchemaObjectTypes<typeof schema>;

/** Counts findTuples calls and how many used an empty (full-scan) filter. */
class ScanCountingAdapter extends InMemoryStorageAdapter<Subj, Obj> {
  public emptyFilterCalls = 0;
  override async findTuples(
    filter: Partial<InputTuple<Subj, Obj>>,
    options?: { limit?: number; offset?: number },
  ) {
    if (!filter.subject && !filter.relation && !filter.object) {
      this.emptyFilterCalls++;
    }
    return super.findTuples(filter, options);
  }
}

describe("read APIs", () => {
  let storage: InMemoryStorageAdapter<Subj, Obj>;
  let authz: AuthSystem<typeof schema>;

  beforeEach(() => {
    storage = new InMemoryStorageAdapter<Subj, Obj>();
    authz = new AuthSystem({ storage, schema });
  });

  describe("checkMany", () => {
    it("returns booleans aligned with the requests", async () => {
      await authz.allow({
        who: { type: "user", id: "a" },
        toBe: "owner",
        onWhat: { type: "document", id: "d1" },
      });
      const results = await authz.checkMany([
        { who: { type: "user", id: "a" }, canThey: "edit", onWhat: { type: "document", id: "d1" } },
        { who: { type: "user", id: "a" }, canThey: "edit", onWhat: { type: "document", id: "d2" } },
        { who: { type: "user", id: "a" }, canThey: "view", onWhat: { type: "document", id: "d1" } },
      ]);
      assert.deepEqual(results, [true, false, true]);
    });
  });

  describe("checkOrThrow", () => {
    it("resolves when allowed and throws NotAuthorizedError when denied", async () => {
      await authz.allow({
        who: { type: "user", id: "b" },
        toBe: "owner",
        onWhat: { type: "document", id: "d1" },
      });
      await assert.doesNotReject(
        authz.checkOrThrow({
          who: { type: "user", id: "b" },
          canThey: "edit",
          onWhat: { type: "document", id: "d1" },
        }),
      );
      await assert.rejects(
        authz.checkOrThrow({
          who: { type: "user", id: "b" },
          canThey: "delete",
          onWhat: { type: "document", id: "d2" },
        }),
        NotAuthorizedError,
      );
    });
  });

  describe("explain", () => {
    it("explains a direct grant", async () => {
      await authz.allow({
        who: { type: "user", id: "c" },
        toBe: "owner",
        onWhat: { type: "document", id: "d1" },
      });
      const r = await authz.explain({
        who: { type: "user", id: "c" },
        canThey: "edit",
        onWhat: { type: "document", id: "d1" },
      });
      assert.equal(r.allowed, true);
      assert.equal(r.via?.kind, "direct");
    });

    it("explains a denial with via null", async () => {
      const r = await authz.explain({
        who: { type: "user", id: "c" },
        canThey: "edit",
        onWhat: { type: "document", id: "none" },
      });
      assert.equal(r.allowed, false);
      assert.equal(r.via, null);
    });

    it("explains a group grant", async () => {
      await authz.allow({
        who: { type: "team", id: "t" },
        toBe: "viewer",
        onWhat: { type: "document", id: "d1" },
      });
      await authz.addMember({ member: { type: "user", id: "c" }, group: { type: "team", id: "t" } });
      const r = await authz.explain({
        who: { type: "user", id: "c" },
        canThey: "view",
        onWhat: { type: "document", id: "d1" },
      });
      assert.equal(r.allowed, true);
      assert.equal(r.via?.kind, "group");
    });

    it("explains a hierarchy grant", async () => {
      await authz.allow({
        who: { type: "user", id: "c" },
        toBe: "viewer",
        onWhat: { type: "folder", id: "f" },
      });
      await authz.setParent({
        child: { type: "document", id: "d1" },
        parent: { type: "folder", id: "f" },
      });
      const r = await authz.explain({
        who: { type: "user", id: "c" },
        canThey: "view",
        onWhat: { type: "document", id: "d1" },
      });
      assert.equal(r.allowed, true);
      assert.equal(r.via?.kind, "hierarchy");
    });

    it("explains a wildcard grant", async () => {
      await authz.allow({
        who: everyone("user"),
        toBe: "viewer",
        onWhat: { type: "document", id: "d1" },
      });
      const r = await authz.explain({
        who: { type: "user", id: "z" },
        canThey: "view",
        onWhat: { type: "document", id: "d1" },
      });
      assert.equal(r.allowed, true);
      assert.equal(r.via?.kind, "wildcard");
    });
  });

  describe("listSubjects (reverse expand)", () => {
    it("returns direct holders and group members", async () => {
      await authz.allow({
        who: { type: "user", id: "direct" },
        toBe: "viewer",
        onWhat: { type: "document", id: "d1" },
      });
      await authz.allow({
        who: { type: "team", id: "t" },
        toBe: "viewer",
        onWhat: { type: "document", id: "d1" },
      });
      await authz.addMember({ member: { type: "user", id: "viaGroup" }, group: { type: "team", id: "t" } });
      const subjects = await authz.listSubjects({
        canThey: "view",
        onWhat: { type: "document", id: "d1" },
      });
      const ids = subjects.map((s) => s.id).sort();
      assert.ok(ids.includes("direct"), "direct holder missing");
      assert.ok(ids.includes("viaGroup"), "group member missing");
    });

    it("honors the ofType filter and dedupes", async () => {
      await authz.allow({
        who: { type: "user", id: "x" },
        toBe: "owner",
        onWhat: { type: "document", id: "d1" },
      });
      await authz.allow({
        who: { type: "user", id: "x" },
        toBe: "viewer",
        onWhat: { type: "document", id: "d1" },
      });
      const subjects = await authz.listSubjects({
        canThey: "view",
        onWhat: { type: "document", id: "d1" },
        ofType: "user",
      });
      assert.equal(
        subjects.filter((s) => s.id === "x").length,
        1,
        "should dedupe",
      );
    });
  });

  describe("listAccessibleObjects", () => {
    it("returns accessible objects with their actions, without a full-table scan", async () => {
      const scan = new ScanCountingAdapter();
      const a = new AuthSystem({ storage: scan, schema });
      await a.allow({
        who: { type: "user", id: "o" },
        toBe: "owner",
        onWhat: { type: "document", id: "d1" },
      });
      await a.allow({
        who: { type: "user", id: "o" },
        toBe: "viewer",
        onWhat: { type: "document", id: "d2" },
      });
      scan.emptyFilterCalls = 0;
      const { accessible } = await a.listAccessibleObjects({
        who: { type: "user", id: "o" },
        ofType: "document",
      });
      const ids = accessible.map((x) => x.object.id).sort();
      assert.deepEqual(ids, ["d1", "d2"]);
      const d1 = accessible.find((x) => x.object.id === "d1");
      assert.ok(d1?.actions.includes("edit") && d1?.actions.includes("view"));
      assert.equal(
        scan.emptyFilterCalls,
        0,
        "must not perform an empty-filter full-table scan",
      );
    });

    it("filters by canThey when provided", async () => {
      await authz.allow({
        who: { type: "user", id: "o" },
        toBe: "viewer",
        onWhat: { type: "document", id: "d1" },
      });
      await authz.allow({
        who: { type: "user", id: "o" },
        toBe: "owner",
        onWhat: { type: "document", id: "d2" },
      });
      const { accessible } = await authz.listAccessibleObjects({
        who: { type: "user", id: "o" },
        ofType: "document",
        canThey: "edit",
      });
      assert.deepEqual(
        accessible.map((x) => x.object.id),
        ["d2"],
      );
    });
  });

  describe("listTuples pagination", () => {
    it("applies limit and offset", async () => {
      for (let i = 0; i < 5; i++) {
        await authz.allow({
          who: { type: "user", id: `u${i}` },
          toBe: "viewer",
          onWhat: { type: "document", id: "shared" },
        });
      }
      const page = await authz.listTuples(
        { object: { type: "document", id: "shared" } },
        { limit: 2, offset: 1 },
      );
      assert.equal(page.length, 2);
    });
  });
});
