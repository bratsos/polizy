import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { InMemoryStorageAdapter } from "../polizy.in-memory.storage.ts";
import { AuthSystem } from "../polizy.ts";
import { defineSchema, PUBLIC_ID } from "../types.ts";

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

const everyone = (type: string) => ({ type, id: PUBLIC_ID });

const schema = defineSchema({
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
  fieldLevelObjects: ["doc"],
});

describe("field-level randomized differential", () => {
  it("matches the forward check() oracle across 40 seeded graphs", async () => {
    const rand = mulberry32(0xc0ffee);
    const pick = <T>(xs: readonly T[]): T =>
      xs[Math.floor(rand() * xs.length)] as T;

    const users = ["u0", "u1", "u2"];
    const teams = ["t0", "t1"];
    const orgs = ["o0"];
    const docs = ["d0", "d1"];
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
      ...docs.map((id) => ({ type: "doc", id: `${id}#fA` })),
      ...docs.map((id) => ({ type: "doc", id: `${id}#fB` })),
      ...folders.map((id) => ({ type: "folder", id })),
      ...teams.map((id) => ({ type: "team", id })),
      ...orgs.map((id) => ({ type: "org", id })),
    ];

    const context = { dept: "eng" };

    for (let g = 0; g < 40; g++) {
      const depth = 2 + Math.floor(rand() * 4); // depth cap 2 to 5
      const authz = new AuthSystem({
        storage: new InMemoryStorageAdapter(),
        schema,
        maxDepthBehavior: "deny",
        defaultCheckDepth: depth,
      });

      // Seeding graph tuples
      const grantsCount = 6 + Math.floor(rand() * 10);
      for (let i = 0; i < grantsCount; i++) {
        const roll = rand();
        if (roll < 0.3) {
          // Direct/wildcard grant
          const who =
            rand() < 0.2
              ? everyone(pick(["user", "team", "org"]))
              : pick(subjects);
          const cond =
            rand() < 0.15
              ? {
                  attributes: [
                    { attribute: "dept", operator: "eq", value: "eng" },
                  ],
                }
              : undefined;
          await authz.allow({
            who: who as never,
            toBe: pick(directRels),
            onWhat: pick(objects) as never,
            when: cond,
          });
        } else if (roll < 0.6) {
          // Group membership
          const rel = pick(["member", "orgMember"] as const);
          const member =
            rand() < 0.2
              ? everyone(pick(["user", "team"]))
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
          // Hierarchy links
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
          // Field level direct grant
          const who = pick(subjects);
          const docObj = pick(docs.map((id) => ({ type: "doc", id })));
          const field = pick(["fA", "fB"]);
          await authz.allow({
            who: who as never,
            toBe: pick(directRels),
            onWhat: { type: "doc", id: `${docObj.id}#${field}` } as never,
          });
        }
      }

      // Assert parity for every subject, object and action
      for (const obj of objects) {
        for (const action of actions) {
          const listed = await authz.listSubjects({
            canThey: action as never,
            onWhat: obj as never,
            context,
          });

          const wildTypes = new Set(
            listed.filter((s) => s.id === PUBLIC_ID).map((s) => s.type),
          );
          const keys = new Set(listed.map((s) => `${s.type}:${s.id}`));

          for (const s of subjects) {
            const expected = await authz.check({
              who: s as never,
              canThey: action as never,
              onWhat: obj as never,
              context,
            });
            const actual =
              keys.has(`${s.type}:${s.id}`) || wildTypes.has(s.type);
            assert.equal(
              actual,
              expected,
              `seed ${g}: listSubjects(${action}, ${obj.type}:${obj.id}) vs check for ${s.type}:${s.id}`,
            );
          }

          // someoneCan matches (listSubjects.length > 0)
          const someone = await authz.someoneCan({
            canThey: action as never,
            onWhat: obj as never,
            context,
          });
          assert.equal(
            someone,
            listed.length > 0,
            `seed ${g}: someoneCan(${action}, ${obj.type}:${obj.id})`,
          );

          // countSubjects agrees with listSubjects().length
          const count = await authz.countSubjects({
            canThey: action as never,
            onWhat: obj as never,
            context,
          });
          assert.equal(
            count,
            listed.length,
            `seed ${g}: countSubjects(${action}, ${obj.type}:${obj.id})`,
          );
        }
      }

      // listAccessibleObjects object membership matches per action
      for (const who of subjects) {
        const expectedActionsMap = new Map<string, string[]>();
        for (const obj of objects) {
          const expectedActions: string[] = [];
          for (const action of actions) {
            if (
              await authz.check({
                who: who as never,
                canThey: action as never,
                onWhat: obj as never,
                context,
              })
            ) {
              expectedActions.push(action);
            }
          }
          expectedActionsMap.set(obj.id, expectedActions);
        }

        for (const ofType of ["doc", "folder", "team", "org"]) {
          const { accessible } = await authz.listAccessibleObjects({
            who: who as never,
            ofType: ofType as never,
            context,
          });
          const byId = new Map(accessible.map((a) => [a.object.id, a.actions]));

          for (const obj of objects.filter((o) => o.type === ofType)) {
            const expectedActions = expectedActionsMap.get(obj.id) ?? [];
            const isField = obj.id.includes("#");
            const hasObject = byId.has(obj.id);
            if (!isField || hasObject) {
              const actualActions = byId.get(obj.id) ?? [];
              assert.deepEqual(
                actualActions.slice().sort(),
                expectedActions.slice().sort(),
                `seed ${g}: listAccessibleObjects(${who.type}:${who.id}, ${ofType}) actions for ${obj.id}`,
              );
            } else {
              const baseId = obj.id.split("#")[0];
              const expectedBaseActions = expectedActionsMap.get(baseId) ?? [];
              assert.deepEqual(
                expectedActions.slice().sort(),
                expectedBaseActions.slice().sort(),
                `seed ${g}: omitted field id ${obj.id} must have base-only access`,
              );
            }
          }
        }
      }
    }
  });
});
