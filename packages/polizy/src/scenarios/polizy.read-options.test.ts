import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NotAuthorizedError } from "../errors.ts";
import { InMemoryStorageAdapter } from "../polizy.in-memory.storage.ts";
import { AuthSystem } from "../polizy.ts";
import { defineSchema } from "../types.ts";

const schema = defineSchema({
  subjectTypes: ["user", "team"],
  objectTypes: ["document", "folder"],
  relations: {
    owner: { type: "direct" },
    viewer: { type: "direct" },
    member: { type: "group" },
    parent: { type: "hierarchy" },
  },
  actionToRelations: {
    view: ["owner", "viewer", "member"],
    edit: ["owner"],
  },
  hierarchyPropagation: { view: ["view"], edit: ["edit"] },
});

const USER = (id: string) => ({ type: "user" as const, id });
const DOC = (id: string) => ({ type: "document" as const, id });

describe("uniform read options scenarios", () => {
  it("checkMany + contextualTuples", async () => {
    const authz = new AuthSystem({
      schema,
      storage: new InMemoryStorageAdapter(),
    });
    const requests = [
      { who: USER("alice"), canThey: "view" as const, onWhat: DOC("1") },
      { who: USER("bob"), canThey: "edit" as const, onWhat: DOC("2") },
    ];
    // Initially, no access.
    const before = await authz.checkMany(requests);
    assert.deepEqual(before, [false, false]);

    // Access with contextual tuples.
    const context = await authz.checkMany(requests, {
      contextualTuples: [
        { subject: USER("alice"), relation: "viewer", object: DOC("1") },
        { subject: USER("bob"), relation: "owner", object: DOC("2") },
      ],
    });
    assert.deepEqual(context, [true, true]);

    // Assert not persisted in storage.
    const stored = await authz.listTuples({});
    assert.equal(stored.length, 0);

    // Follow-up checkMany without contextual tuples returns false.
    const after = await authz.checkMany(requests);
    assert.deepEqual(after, [false, false]);
  });

  it("checkOrThrow + contextualTuples", async () => {
    const authz = new AuthSystem({
      schema,
      storage: new InMemoryStorageAdapter(),
    });
    const request = {
      who: USER("alice"),
      canThey: "view" as const,
      onWhat: DOC("1"),
    };

    // Throws NotAuthorizedError without contextual tuples.
    await assert.rejects(
      async () => {
        await authz.checkOrThrow(request);
      },
      (err: any) => {
        return err instanceof NotAuthorizedError;
      },
    );

    // Does not throw with the ephemeral grant.
    await authz.checkOrThrow({
      ...request,
      contextualTuples: [
        { subject: USER("alice"), relation: "viewer", object: DOC("1") },
      ],
    });
  });

  it("explain + contextualTuples", async () => {
    const authz = new AuthSystem({
      schema,
      storage: new InMemoryStorageAdapter(),
    });
    const request = {
      who: USER("alice"),
      canThey: "view" as const,
      onWhat: DOC("1"),
    };

    const before = await authz.explain(request);
    assert.equal(before.allowed, false);
    assert.equal(before.via, null);

    const withContext = await authz.explain(request, {
      contextualTuples: [
        { subject: USER("alice"), relation: "viewer", object: DOC("1") },
      ],
    });
    assert.equal(withContext.allowed, true);
    assert.ok(withContext.via);
  });

  it("listSubjects/listAccessibleObjects/someoneCan/countSubjects + contextualTuples", async () => {
    const authz = new AuthSystem({
      schema,
      storage: new InMemoryStorageAdapter(),
    });

    const subArgs = {
      canThey: "view" as const,
      onWhat: DOC("1"),
      ofType: "user" as const,
    };
    const objArgs = {
      who: USER("alice"),
      ofType: "document" as const,
      canThey: "view" as const,
    };

    const contextualTuples = [
      { subject: USER("alice"), relation: "viewer", object: DOC("1") },
    ];

    // Standalone without contextual tuples
    assert.deepEqual(await authz.listSubjects(subArgs), []);
    assert.deepEqual(
      (await authz.listAccessibleObjects(objArgs)).accessible,
      [],
    );
    assert.equal(await authz.someoneCan(subArgs), false);
    assert.equal(await authz.countSubjects(subArgs), 0);

    // Standalone with contextual tuples
    const listSubStandalone = await authz.listSubjects({
      ...subArgs,
      contextualTuples,
    });
    const listObjStandalone = await authz.listAccessibleObjects({
      ...objArgs,
      contextualTuples,
    });
    const someoneCanStandalone = await authz.someoneCan({
      ...subArgs,
      contextualTuples,
    });
    const countSubStandalone = await authz.countSubjects({
      ...subArgs,
      contextualTuples,
    });

    assert.deepEqual(listSubStandalone, [USER("alice")]);
    assert.equal(listObjStandalone.accessible.length, 1);
    assert.deepEqual(listObjStandalone.accessible[0].object, DOC("1"));
    assert.equal(someoneCanStandalone, true);
    assert.equal(countSubStandalone, 1);

    // Inside withReadScope with scope-wide contextualTuples
    await authz.withReadScope(
      async (scope) => {
        const listSubScope = await scope.listSubjects(subArgs);
        const listObjScope = await scope.listAccessibleObjects(objArgs);
        const someoneCanScope = await scope.someoneCan(subArgs);
        const countSubScope = await scope.countSubjects(subArgs);

        assert.deepEqual(listSubScope, listSubStandalone);
        assert.deepEqual(listObjScope.accessible, listObjStandalone.accessible);
        assert.equal(someoneCanScope, someoneCanStandalone);
        assert.equal(countSubScope, countSubStandalone);
      },
      { contextualTuples },
    );
  });

  it("listSubjects pagination", async () => {
    const authz = new AuthSystem({
      schema,
      storage: new InMemoryStorageAdapter(),
    });

    // Seed 5 subjects on one object.
    const users = ["user1", "user2", "user3", "user4", "user5"];
    for (const u of users) {
      await authz.allow({ who: USER(u), toBe: "viewer", onWhat: DOC("1") });
    }

    const subArgs = {
      canThey: "view" as const,
      onWhat: DOC("1"),
      ofType: "user" as const,
    };
    const fullList = await authz.listSubjects(subArgs);
    assert.equal(fullList.length, 5);

    // Let's test limit and offset combinations
    const p1 = await authz.listSubjects({ ...subArgs, limit: 2 });
    assert.deepEqual(p1, fullList.slice(0, 2));

    const p2 = await authz.listSubjects({ ...subArgs, offset: 2 });
    assert.deepEqual(p2, fullList.slice(2));

    const p3 = await authz.listSubjects({ ...subArgs, offset: 1, limit: 3 });
    assert.deepEqual(p3, fullList.slice(1, 4));

    // countSubjects still returns the full count (5).
    const count = await authz.countSubjects({
      ...subArgs,
      limit: 2,
      offset: 1,
    });
    assert.equal(count, 5);
  });

  it("ReadScope someoneCan/counts deep-equal standalone", async () => {
    const authz = new AuthSystem({
      schema,
      storage: new InMemoryStorageAdapter(),
    });

    await authz.allow({ who: USER("alice"), toBe: "viewer", onWhat: DOC("1") });
    await authz.allow({ who: USER("bob"), toBe: "owner", onWhat: DOC("2") });

    const subArgs = {
      canThey: "view" as const,
      onWhat: DOC("1"),
      ofType: "user" as const,
    };
    const objArgs = {
      who: USER("alice"),
      ofType: "document" as const,
      canThey: "view" as const,
    };

    const standaloneSomeoneCan = await authz.someoneCan(subArgs);
    const standaloneCountSubs = await authz.countSubjects(subArgs);
    const standaloneCountObjs = await authz.countAccessibleObjects(objArgs);

    await authz.withReadScope(async (scope) => {
      const scopeSomeoneCan = await scope.someoneCan(subArgs);
      const scopeCountSubs = await scope.countSubjects(subArgs);
      const scopeCountObjs = await scope.countAccessibleObjects(objArgs);

      assert.equal(scopeSomeoneCan, standaloneSomeoneCan);
      assert.equal(scopeCountSubs, standaloneCountSubs);
      assert.equal(scopeCountObjs, standaloneCountObjs);
    });
  });

  it("consistency:strong passthrough on a list op", async () => {
    const authz = new AuthSystem({
      schema,
      storage: new InMemoryStorageAdapter(),
    });

    await authz.allow({ who: USER("alice"), toBe: "viewer", onWhat: DOC("1") });

    const subArgs = {
      canThey: "view" as const,
      onWhat: DOC("1"),
      ofType: "user" as const,
    };

    const defaultList = await authz.listSubjects(subArgs);
    const strongList = await authz.listSubjects({
      ...subArgs,
      consistency: "strong",
    });
    assert.deepEqual(strongList, defaultList);

    await authz.withReadScope(
      async (scope) => {
        const scopeList = await scope.listSubjects(subArgs);
        assert.deepEqual(scopeList, defaultList);
      },
      { consistency: "strong", preload: true },
    );
  });
});
